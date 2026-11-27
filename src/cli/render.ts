/*
 * Renders a scene to a PNG without a browser or GPU, for the CLI and the MCP server.
 * A small ray tracer over the same shapes the app draws (balls, ellipsoids, tapered capsules, prop boxes),
 * lit by the scene lights with hard shadows on a floor in the background color.
 * Light math follows three.js (Lambert part of MeshStandardMaterial, ACES tone mapping), so a render
 * looks close to the app's "Save PNG", minus soft shadow edges and shine.
 * Run: node src/cli/poser.ts render <file.scene.json>
 */

// #region Setup
import { deflateSync } from 'node:zlib';
import { Color, Matrix3, Matrix4, Quaternion, Vector3 } from 'three';
import { forwardKinematics, solvePose, type Pose } from '../core/pose.ts';
import type { SceneLight } from '../core/lights.ts';
import type { Rig } from '../core/rig.ts';
import { propBoxes, type SceneProp } from '../core/props.ts';
import { fieldOfViewDegrees, type CameraView } from '../core/camera.ts';
// #endregion

// #region Types and config
export type View = 'front' | 'three-quarter' | 'side' | 'back' | 'top';

export interface RenderScene {
  characters: { rig: Rig; pose: Pose }[];
  props?: SceneProp[];
  lights: SceneLight[];
  background: string;
}

export interface RenderOptions {
  width: number;
  height: number;
  view: View;
  isTransparent?: boolean;
  // 2 = four rays per pixel for smooth edges.
  supersample?: number;
  // Frame only these bones of one character (a close-up of a hand, say) instead of the whole scene.
  focus?: { character: number; bones: string[] };
  // A lens for the framed views; ignored when `camera` is given.
  lensMm?: number;
  // An exact camera (a view saved in the app); replaces `view` and the framing.
  camera?: CameraView;
}

export const VIEWS: Record<View, Vec3Tuple> = {
  front: [0, 0.12, 1],
  'three-quarter': [0.57, 0.2, 0.82],
  side: [1, 0.1, 0],
  back: [0, 0.12, -1],
  top: [0.35, 1.6, 1],
};

type Vec3Tuple = [number, number, number];

interface Primitive {
  kind: 'sphere' | 'ellipsoid' | 'capsule' | 'box';
  bone: string;
  // World → local: subtract `origin`, then multiply by `toLocal` (a rotation).
  origin: Vector3;
  toLocal: Matrix3;
  toWorld: Matrix3;
  radius: number;
  radii: Vector3;
  start: Vector3;
  end: Vector3;
  radiusStart: number;
  radiusEnd: number;
  squash: Vector3;
  smallestSquash: number;
  boundCenter: Vector3;
  boundRadius: number;
  color: Vector3;
}

interface Group {
  center: Vector3;
  radius: number;
  primitives: Primitive[];
}

const FIELD_OF_VIEW_DEGREES = 40;
const SHADOW_OPACITY = 0.18;
const SURFACE_EPSILON = 0.0002;
const MAX_MARCH_STEPS = 80;
const CRC_TABLE = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});
// #endregion

// #region Main flow
export function renderScene(scene: RenderScene, options: RenderOptions): { width: number; height: number; rgba: Uint8Array } {
  const supersample = Math.max(1, Math.round(options.supersample ?? 2));
  const groups = scene.characters.map((character) => groupOf(character.rig, character.pose));
  const characterPrimitives = groups.map((group) => group.primitives);
  for (const prop of scene.props ?? []) {
    const color = linearColor(prop.color);
    const primitives = propBoxes(prop).map((box): Primitive => {
      const toWorld = new Matrix3().setFromMatrix4(new Matrix4().makeRotationY((box.turnDegrees * Math.PI) / 180));
      const center = new Vector3(...box.center);
      const radii = new Vector3(...box.halfSize);
      return {
        kind: 'box', bone: '', origin: center, toLocal: toWorld.clone().transpose(), toWorld, radius: 0, radii, start: new Vector3(), end: new Vector3(),
        radiusStart: 0, radiusEnd: 0, squash: new Vector3(1, 1, 1), smallestSquash: 1, boundCenter: center, boundRadius: radii.length(), color,
      };
    });
    const center = primitives.reduce((sum, primitive) => sum.add(primitive.boundCenter), new Vector3()).divideScalar(primitives.length);
    groups.push({ center, radius: Math.max(...primitives.map((primitive) => primitive.boundCenter.distanceTo(center) + primitive.boundRadius)), primitives });
  }
  const background = linearColor(scene.background);
  const backgroundSrgb = [1, 3, 5].map((start) => parseInt(scene.background.slice(start, start + 2), 16) / 255);

  // Camera: look at the middle of everything (or of the focused bones), back off along the view direction until it all fits.
  const focus = options.focus;
  const framed = focus
    ? (characterPrimitives[focus.character] ?? []).filter((primitive) => focus.bones.includes(primitive.bone))
    : groups.flatMap((group) => group.primitives);
  if (focus && framed.length === 0) throw new Error(`Nothing to focus on: no shapes for ${focus.bones.join(', ')}`);
  const box = { min: new Vector3(Infinity, Infinity, Infinity), max: new Vector3(-Infinity, -Infinity, -Infinity) };
  for (const primitive of framed) {
    box.min.min(primitive.boundCenter.clone().subScalar(primitive.boundRadius));
    box.max.max(primitive.boundCenter.clone().addScalar(primitive.boundRadius));
  }
  if (framed.length === 0) {
    box.min.set(-1, 0, -1);
    box.max.set(1, 1.8, 1);
  }
  if (!focus) box.min.y = 0;
  const target = box.min.clone().add(box.max).multiplyScalar(0.5);
  const aspect = options.width / options.height;
  const lensMm = options.camera?.lensMm ?? options.lensMm;
  const verticalHalf = ((lensMm ? fieldOfViewDegrees(lensMm) : FIELD_OF_VIEW_DEGREES) * Math.PI) / 360;
  const viewDirection = options.camera ? new Vector3(...options.camera.position).sub(new Vector3(...options.camera.target)).normalize() : new Vector3(...VIEWS[options.view]).normalize();
  const forward = viewDirection.clone().negate();
  // Straight down has no "right"; any horizontal direction will do.
  const right = Math.abs(forward.y) > 0.9999 ? new Vector3(1, 0, 0) : forward.clone().cross(new Vector3(0, 1, 0)).normalize();
  const up = right.clone().cross(forward);

  // Back off until every shape fits on screen, with a small margin.
  const tangentY = Math.tan(verticalHalf) * 0.92;
  const tangentX = tangentY * aspect;
  let distance = focus ? 0.05 : 1;
  for (const primitive of framed) {
    const offset = primitive.boundCenter.clone().sub(target);
    const depth = offset.dot(forward);
    distance = Math.max(distance, (Math.abs(offset.dot(right)) + primitive.boundRadius) / tangentX - depth, (Math.abs(offset.dot(up)) + primitive.boundRadius) / tangentY - depth);
  }
  const eye = options.camera ? new Vector3(...options.camera.position) : target.clone().addScaledVector(viewDirection, distance);
  const halfHeight = Math.tan(verticalHalf);

  const lights = scene.lights.map((light) => ({ ...light, linear: linearColor(light.color), ground: linearColor(light.groundColor ?? light.color) }));
  const width = options.width * supersample;
  const height = options.height * supersample;
  const big = new Float32Array(width * height * 4);
  const direction = new Vector3();

  for (let row = 0; row < height; row++) {
    for (let column = 0; column < width; column++) {
      const screenX = ((column + 0.5) / width) * 2 - 1;
      const screenY = 1 - ((row + 0.5) / height) * 2;
      direction.copy(forward).addScaledVector(right, screenX * halfHeight * aspect).addScaledVector(up, screenY * halfHeight).normalize();
      const pixel = (row * width + column) * 4;
      const hit = castRay(groups, eye, direction, Infinity, false);
      const floorDistance = direction.y < 0 ? -eye.y / direction.y : Infinity;

      if (hit && hit.distance < floorDistance) {
        const point = eye.clone().addScaledVector(direction, hit.distance);
        const color = shade(groups, lights, point, hit.normal(point), hit.primitive.color);
        big.set([color.x, color.y, color.z, 1], pixel);
        continue;
      }
      if (floorDistance === Infinity) {
        big.set([background.x, background.y, background.z, options.isTransparent ? 0 : 1], pixel);
        continue;
      }

      // Floor: the background color, darkened where any shadow-casting light is blocked (like three's ShadowMaterial).
      const point = eye.clone().addScaledVector(direction, floorDistance);
      let lit = 1;
      for (const light of lights) {
        if (light.kind === 'ambient' || !light.castShadow) continue;
        const toLight = light.kind === 'sun' ? new Vector3(...light.position).sub(new Vector3(...light.target)).normalize() : new Vector3(...light.position).sub(point);
        const reach = light.kind === 'sun' ? Infinity : toLight.length();
        if (light.kind === 'spot' && spotFactor(light, point) === 0) continue;
        if (castRay(groups, point, toLight.normalize(), reach, true)) lit = 0;
      }
      // ShadowMaterial blends black over the canvas in sRGB, so darken the sRGB background and turn it back into linear.
      const shadow = (1 - lit) * SHADOW_OPACITY;
      if (options.isTransparent) big.set([0, 0, 0, shadow], pixel);
      else big.set([...backgroundSrgb.map((channel) => srgbToLinear(channel * (1 - shadow))), 1], pixel);
    }
  }

  // Average each supersample block, then linear → sRGB bytes. Surfaces are tone mapped in shade(); the background is not, as in the app.
  const rgba = new Uint8Array(options.width * options.height * 4);
  const share = 1 / (supersample * supersample);
  for (let row = 0; row < options.height; row++) {
    for (let column = 0; column < options.width; column++) {
      const sum = [0, 0, 0, 0];
      for (let subRow = 0; subRow < supersample; subRow++) {
        for (let subColumn = 0; subColumn < supersample; subColumn++) {
          const pixel = ((row * supersample + subRow) * width + column * supersample + subColumn) * 4;
          for (let channel = 0; channel < 4; channel++) sum[channel] += big[pixel + channel] * (channel === 3 ? 1 : big[pixel + 3]);
        }
      }
      const alpha = sum[3] * share;
      const out = (row * options.width + column) * 4;
      for (let channel = 0; channel < 3; channel++) rgba[out + channel] = toSrgbByte(alpha > 0 ? (sum[channel] * share) / alpha : 0);
      rgba[out + 3] = Math.round(alpha * 255);
    }
  }
  return { width: options.width, height: options.height, rgba };
}

export function encodePng(width: number, height: number, rgba: Uint8Array): Buffer {
  const rows = Buffer.alloc((width * 4 + 1) * height);
  for (let row = 0; row < height; row++) {
    rows[row * (width * 4 + 1)] = 0;
    Buffer.from(rgba.buffer, rgba.byteOffset + row * width * 4, width * 4).copy(rows, row * (width * 4 + 1) + 1);
  }
  const chunk = (type: string, data: Buffer) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const typeAndData = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const checksum = Buffer.alloc(4);
    checksum.writeUInt32BE(crc32(typeAndData));
    return Buffer.concat([length, typeAndData, checksum]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 6, 0, 0, 0], 8);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(rows)), chunk('IEND', Buffer.alloc(0))]);
}
// #endregion

// #region Helpers
function groupOf(rig: Rig, pose: Pose): Group {
  const world = forwardKinematics(rig, solvePose(pose));
  const base = linearColor(rig.profile.color);
  const primitives: Primitive[] = [];

  for (const bone of rig.bones) {
    const { position, quaternion } = world[bone.name];
    const toWorld = new Matrix3().setFromMatrix4(new Matrix4().makeRotationFromQuaternion(quaternion));
    const toLocal = toWorld.clone().transpose();
    const toWorldPoint = (point: Vector3) => point.clone().applyQuaternion(quaternion).add(position);

    for (const shape of bone.shapes) {
      const blank: Primitive = {
        kind: 'sphere', bone: bone.name, origin: position.clone(), toLocal, toWorld, radius: 0, radii: new Vector3(1, 1, 1), start: new Vector3(), end: new Vector3(),
        radiusStart: 0, radiusEnd: 0, squash: new Vector3(1, 1, 1), smallestSquash: 1, boundCenter: new Vector3(), boundRadius: 0, color: base,
      };
      if (shape.kind === 'ball') {
        const center = toWorldPoint(new Vector3(...shape.center));
        primitives.push({ ...blank, origin: center, radius: shape.radius, boundCenter: center, boundRadius: shape.radius, color: base.clone().multiplyScalar(0.82) });
        continue;
      }
      if (shape.kind === 'ellipsoid') {
        const center = toWorldPoint(new Vector3(...shape.center));
        const radii = new Vector3(...shape.radii);
        primitives.push({ ...blank, kind: 'ellipsoid', origin: center, radii, boundCenter: center, boundRadius: Math.max(radii.x, radii.y, radii.z), color: shape.isAccent ? base.clone().multiplyScalar(0.35) : base });
        continue;
      }
      const squash = new Vector3(...(shape.squash ?? [1, 1, 1]));
      const start = new Vector3(...shape.start);
      const end = new Vector3(...shape.end);
      const squashedEnd = end.clone().sub(start).multiply(squash).add(start);
      const largestSquash = Math.max(squash.x, squash.y, squash.z);
      primitives.push({
        ...blank,
        kind: 'capsule',
        start,
        end,
        radiusStart: shape.radiusStart,
        radiusEnd: shape.radiusEnd,
        squash,
        smallestSquash: Math.min(squash.x, squash.y, squash.z),
        boundCenter: toWorldPoint(start.clone().add(squashedEnd).multiplyScalar(0.5)),
        boundRadius: start.distanceTo(squashedEnd) / 2 + Math.max(shape.radiusStart, shape.radiusEnd) * largestSquash,
      });
    }
  }

  const center = new Vector3();
  for (const primitive of primitives) center.add(primitive.boundCenter);
  center.divideScalar(Math.max(1, primitives.length));
  const radius = Math.max(0, ...primitives.map((primitive) => primitive.boundCenter.distanceTo(center) + primitive.boundRadius));
  return { center, radius, primitives };
}

function castRay(groups: Group[], origin: Vector3, direction: Vector3, maxDistance: number, isAnyHit: boolean) {
  let best: { distance: number; primitive: Primitive } | null = null;
  let nearest = maxDistance;
  for (const group of groups) {
    if (sphereEntry(origin, direction, group.center, group.radius, nearest) === null) continue;
    for (const primitive of group.primitives) {
      const entry = sphereEntry(origin, direction, primitive.boundCenter, primitive.boundRadius, nearest);
      if (entry === null) continue;
      const distance = intersect(primitive, origin, direction, entry, nearest);
      if (distance === null || distance >= nearest) continue;
      nearest = distance;
      best = { distance, primitive };
      if (isAnyHit) return { ...best, normal: () => new Vector3() };
    }
  }
  if (!best) return null;
  const hit = best;
  return { ...hit, normal: (point: Vector3) => normalAt(hit.primitive, point) };
}

// Returns the [enter, exit] range of a ray through a sphere, or null when it misses or starts beyond `maxDistance`.
function sphereEntry(origin: Vector3, direction: Vector3, center: Vector3, radius: number, maxDistance: number): [number, number] | null {
  const offsetX = origin.x - center.x;
  const offsetY = origin.y - center.y;
  const offsetZ = origin.z - center.z;
  const along = offsetX * direction.x + offsetY * direction.y + offsetZ * direction.z;
  const rest = offsetX * offsetX + offsetY * offsetY + offsetZ * offsetZ - radius * radius;
  const discriminant = along * along - rest;
  if (discriminant < 0) return null;
  const root = Math.sqrt(discriminant);
  const enter = -along - root;
  const exit = -along + root;
  if (exit < SURFACE_EPSILON * 5 || enter > maxDistance) return null;
  return [enter, exit];
}

function intersect(primitive: Primitive, origin: Vector3, direction: Vector3, range: [number, number], maxDistance: number): number | null {
  const minimum = SURFACE_EPSILON * 5;
  if (primitive.kind === 'sphere') return range[0] > minimum ? range[0] : range[1] > minimum ? range[1] : null;

  const localOrigin = origin.clone().sub(primitive.origin).applyMatrix3(primitive.toLocal);
  const localDirection = direction.clone().applyMatrix3(primitive.toLocal);

  if (primitive.kind === 'box') {
    let enter = -Infinity;
    let exit = Infinity;
    for (let axis = 0; axis < 3; axis++) {
      const start = localOrigin.getComponent(axis);
      const step = localDirection.getComponent(axis);
      const half = primitive.radii.getComponent(axis);
      if (Math.abs(step) < 1e-12) {
        if (Math.abs(start) > half) return null;
        continue;
      }
      const near = (-half - start) / step;
      const far = (half - start) / step;
      enter = Math.max(enter, Math.min(near, far));
      exit = Math.min(exit, Math.max(near, far));
    }
    if (enter > exit) return null;
    return enter > minimum ? enter : exit > minimum ? exit : null;
  }

  if (primitive.kind === 'ellipsoid') {
    const scaledOrigin = localOrigin.divide(primitive.radii);
    const scaledDirection = localDirection.divide(primitive.radii);
    const a = scaledDirection.dot(scaledDirection);
    const b = scaledOrigin.dot(scaledDirection);
    const c = scaledOrigin.dot(scaledOrigin) - 1;
    const discriminant = b * b - a * c;
    if (discriminant < 0) return null;
    const enter = (-b - Math.sqrt(discriminant)) / a;
    const exit = (-b + Math.sqrt(discriminant)) / a;
    return enter > minimum ? enter : exit > minimum ? exit : null;
  }

  // Capsule: march the distance field in bone space with the squash undone; a squash only shrinks distances, so scale steps down by the flattest axis.
  let distance = Math.max(range[0], minimum);
  const limit = Math.min(range[1], maxDistance);
  const point = new Vector3();
  for (let step = 0; step < MAX_MARCH_STEPS && distance <= limit; step++) {
    point.copy(localOrigin).addScaledVector(localDirection, distance).sub(primitive.start).divide(primitive.squash).add(primitive.start);
    const field = roundConeDistance(point, primitive);
    if (field < SURFACE_EPSILON) return distance;
    distance += field * primitive.smallestSquash;
  }
  return null;
}

function normalAt(primitive: Primitive, point: Vector3): Vector3 {
  if (primitive.kind === 'sphere') return point.clone().sub(primitive.origin).normalize();
  const local = point.clone().sub(primitive.origin).applyMatrix3(primitive.toLocal);
  if (primitive.kind === 'ellipsoid') return local.divide(primitive.radii).divide(primitive.radii).applyMatrix3(primitive.toWorld).normalize();
  if (primitive.kind === 'box') {
    const scaled = local.clone().divide(primitive.radii);
    const axis = Math.abs(scaled.x) >= Math.abs(scaled.y) && Math.abs(scaled.x) >= Math.abs(scaled.z) ? 0 : Math.abs(scaled.y) >= Math.abs(scaled.z) ? 1 : 2;
    return new Vector3().setComponent(axis, Math.sign(scaled.getComponent(axis))).applyMatrix3(primitive.toWorld);
  }

  const unsquashed = local.sub(primitive.start).divide(primitive.squash).add(primitive.start);
  const step = 0.0005;
  const gradient = new Vector3();
  for (let axis = 0; axis < 3; axis++) {
    const plus = unsquashed.clone().setComponent(axis, unsquashed.getComponent(axis) + step);
    const minus = unsquashed.clone().setComponent(axis, unsquashed.getComponent(axis) - step);
    gradient.setComponent(axis, roundConeDistance(plus, primitive) - roundConeDistance(minus, primitive));
  }
  return gradient.divide(primitive.squash).applyMatrix3(primitive.toWorld).normalize();
}

// Distance to a cone with rounded ends (radius `radiusStart` at start, `radiusEnd` at end), after Inigo Quilez.
function roundConeDistance(point: Vector3, primitive: Primitive): number {
  const { start, end, radiusStart, radiusEnd } = primitive;
  const axisX = end.x - start.x;
  const axisY = end.y - start.y;
  const axisZ = end.z - start.z;
  const lengthSquared = axisX * axisX + axisY * axisY + axisZ * axisZ;
  const fromX = point.x - start.x;
  const fromY = point.y - start.y;
  const fromZ = point.z - start.z;
  if (lengthSquared < 1e-12) return Math.sqrt(fromX * fromX + fromY * fromY + fromZ * fromZ) - radiusStart;

  const radiusChange = radiusStart - radiusEnd;
  const slant = lengthSquared - radiusChange * radiusChange;
  const along = fromX * axisX + fromY * axisY + fromZ * axisZ;
  const beyond = along - lengthSquared;
  const crossX = fromX * lengthSquared - axisX * along;
  const crossY = fromY * lengthSquared - axisY * along;
  const crossZ = fromZ * lengthSquared - axisZ * along;
  const acrossSquared = crossX * crossX + crossY * crossY + crossZ * crossZ;
  const alongSquared = along * along * lengthSquared;
  const beyondSquared = beyond * beyond * lengthSquared;
  const threshold = Math.sign(radiusChange) * radiusChange * radiusChange * acrossSquared;
  if (Math.sign(beyond) * slant * beyondSquared > threshold) return Math.sqrt(acrossSquared + beyondSquared) / lengthSquared - radiusEnd;
  if (Math.sign(along) * slant * alongSquared < threshold) return Math.sqrt(acrossSquared + alongSquared) / lengthSquared - radiusStart;
  return (Math.sqrt((acrossSquared * slant) / lengthSquared) + along * radiusChange) / lengthSquared - radiusStart;
}

function shade(groups: Group[], lights: (SceneLight & { linear: Vector3; ground: Vector3 })[], point: Vector3, normal: Vector3, albedo: Vector3): Vector3 {
  const irradiance = new Vector3();
  const lifted = point.clone().addScaledVector(normal, 0.002);

  for (const light of lights) {
    if (light.kind === 'ambient') {
      const skyShare = 0.5 * normal.y + 0.5;
      irradiance.add(light.ground.clone().lerp(light.linear, skyShare).multiplyScalar(light.intensity));
      continue;
    }
    const position = new Vector3(...light.position);
    const toLight = light.kind === 'sun' ? position.clone().sub(new Vector3(...light.target)) : position.clone().sub(point);
    const lightDistance = toLight.length();
    toLight.normalize();
    const facing = normal.dot(toLight);
    if (facing <= 0) continue;

    // Intensity is "brightness at the target"; point and spot lights fall off with the square of the distance from there.
    let strength = light.intensity;
    if (light.kind !== 'sun') {
      const targetDistance = position.distanceTo(new Vector3(...light.target));
      strength *= (targetDistance * targetDistance) / Math.max(1e-4, lightDistance * lightDistance);
      if (light.kind === 'spot') strength *= spotFactor(light, point);
      if (strength === 0) continue;
    }
    if (light.castShadow && castRay(groups, lifted, toLight, light.kind === 'sun' ? Infinity : lightDistance, true)) continue;
    irradiance.addScaledVector(light.linear, strength * facing);
  }

  const color = albedo.clone().multiply(irradiance).multiplyScalar(1 / Math.PI);
  return acesToneMap(color);
}

function spotFactor(light: SceneLight, point: Vector3): number {
  const position = new Vector3(...light.position);
  const axis = new Vector3(...light.target).sub(position).normalize();
  const cosine = point.clone().sub(position).normalize().dot(axis);
  const outer = Math.cos(((light.coneDegrees ?? 35) * Math.PI) / 180);
  const inner = Math.cos(((light.coneDegrees ?? 35) * Math.PI) / 180 * (1 - (light.softness ?? 0.4)));
  if (cosine <= outer) return 0;
  if (cosine >= inner) return 1;
  const share = (cosine - outer) / (inner - outer);
  return share * share * (3 - 2 * share);
}

// three.js ACESFilmicToneMapping, exposure 1.
function acesToneMap(color: Vector3): Vector3 {
  const scaled = color.clone().multiplyScalar(1 / 0.6);
  const input = new Vector3(
    0.59719 * scaled.x + 0.35458 * scaled.y + 0.04823 * scaled.z,
    0.076 * scaled.x + 0.90834 * scaled.y + 0.01566 * scaled.z,
    0.0284 * scaled.x + 0.13383 * scaled.y + 0.83777 * scaled.z,
  );
  const fit = (value: number) => (value * (value + 0.0245786) - 0.000090537) / (value * (0.983729 * value + 0.432951) + 0.238081);
  const fitted = new Vector3(fit(input.x), fit(input.y), fit(input.z));
  const clamp = (value: number) => Math.min(1, Math.max(0, value));
  return new Vector3(
    clamp(1.60475 * fitted.x - 0.53108 * fitted.y - 0.07367 * fitted.z),
    clamp(-0.10208 * fitted.x + 1.10813 * fitted.y - 0.00605 * fitted.z),
    clamp(-0.00327 * fitted.x - 0.07276 * fitted.y + 1.07602 * fitted.z),
  );
}

// three.js color management already turns "#rrggbb" (sRGB) into linear values.
function linearColor(hex: string): Vector3 {
  const color = new Color(hex);
  return new Vector3(color.r, color.g, color.b);
}

function srgbToLinear(value: number): number {
  return value <= 0.04045 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4);
}

function toSrgbByte(linear: number): number {
  const value = linear <= 0.0031308 ? linear * 12.92 : 1.055 * Math.pow(linear, 1 / 2.4) - 0.055;
  return Math.round(Math.min(1, Math.max(0, value)) * 255);
}


function crc32(data: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of data) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
// #endregion
