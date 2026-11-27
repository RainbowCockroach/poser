/*
 * The body as solid shapes in the world: which parts sink into each other, and how to make two parts touch.
 *   findOverlaps(): body parts inside each other, within one character or between characters
 *   touch():        bend a limb (or slide the whole character) until one body part rests on another
 *   separate():     push limbs back out of the body they sink into
 * Overlap is measured against the rest pose, so a heavy arm that always brushes the belly isn't reported.
 * Capsules are exact; ellipsoids are measured in their own squashed space, which is close enough for posing.
 * Run the checks: npm test
 */

// #region Setup
import { Quaternion, Vector3 } from 'three';
import { forwardKinematics, solvePose, type Pose } from './pose.ts';
import { legMotions, reach, type ReachGoal, type ReachMotion } from './reach.ts';
import type { Rig, Vec3 } from './rig.ts';
// #endregion

// #region Types and config
export interface PosedCharacter {
  name: string;
  rig: Rig;
  pose: Pose;
}

export interface Overlap {
  character: number;
  bone: string;
  part: string;
  otherCharacter: number;
  otherBone: string;
  otherPart: string;
  depthMeters: number;
}

export type TouchSide = 'nearest' | 'front' | 'back' | 'left' | 'right';

export interface TouchResult {
  pose: Pose;
  gapMeters: number;
}

type WorldShape =
  | { kind: 'capsule'; bone: string; start: Vector3; end: Vector3; radius: number; isJoint: boolean }
  | { kind: 'ellipsoid'; bone: string; center: Vector3; rotation: Quaternion; radii: Vector3; isJoint: false };

interface Contact {
  pointOnShape: Vector3;
  pointOnOther: Vector3;
  // Points from the other shape toward this one.
  normal: Vector3;
  gap: number;
}

// Body parts by the names people use. "Joint only" parts are the ball of the joint, so a hand lands on the knee, not the shin.
const LEFT_AND_MIDLINE_PARTS: Record<string, { label: string; bone: string; isJointOnly?: boolean }> = {
  head: { label: 'Head', bone: 'head' },
  neck: { label: 'Neck', bone: 'neck' },
  chest: { label: 'Chest', bone: 'thoracic_upper' },
  belly: { label: 'Belly', bone: 'lumbar_upper' },
  hips: { label: 'Hips', bone: 'pelvis' },
  shoulder_l: { label: 'Left shoulder', bone: 'shoulder_l', isJointOnly: true },
  upper_arm_l: { label: 'Left upper arm', bone: 'shoulder_l' },
  elbow_l: { label: 'Left elbow', bone: 'elbow_l', isJointOnly: true },
  forearm_l: { label: 'Left forearm', bone: 'elbow_l' },
  hand_l: { label: 'Left hand', bone: 'wrist_l' },
  thigh_l: { label: 'Left thigh', bone: 'hip_l' },
  knee_l: { label: 'Left knee', bone: 'knee_l', isJointOnly: true },
  shin_l: { label: 'Left shin', bone: 'knee_l' },
  foot_l: { label: 'Left foot', bone: 'ankle_l' },
};

export const BODY_PARTS: Record<string, { label: string; bone: string; isJointOnly?: boolean }> = {};
for (const [name, part] of Object.entries(LEFT_AND_MIDLINE_PARTS)) {
  BODY_PARTS[name] = part;
  if (name.endsWith('_l')) BODY_PARTS[name.replace(/_l$/, '_r')] = { ...part, label: part.label.replace('Left', 'Right'), bone: part.bone.replace(/_l$/, '_r') };
}

const OVERLAP_TOLERANCE_METERS = 0.01;
const TOUCH_GAP_METERS = 0.002;
const SEPARATE_MARGIN_METERS = 0.005;
const SOLVE_ROUNDS = 10;
// Fingers and toes curl into each other and onto whatever the hand holds; the palm and foot already catch a limb going through the body.
const IGNORED_BONES = /^(index|middle|ring|pinky|thumb)_|^toes_/;
const SPINE_WEIGHT = 0.4;
const TWIST_WEIGHT = 0.35;
const GIRDLE_WEIGHT = 0.3;
const ARM_SEEDS: Record<string, Record<string, number>>[] = [
  { shoulder: { flexion: 90, abduction: 30 }, elbow: { flexion: 90 } },
  { shoulder: { flexion: 20, abduction: 90 }, elbow: { flexion: 110 } },
];
const LEG_SEEDS: Record<string, Record<string, number>>[] = [{ hip: { flexion: 60, abduction: 20 }, knee: { flexion: 90 } }];
const GROUP_PRIORITY = { arm: 0, leg: 1, head: 2, torso: 3 } as const;
// Gaps between body parts at rest, worked out once per rig.
const REST_GAPS = new WeakMap<Rig, Map<string, number>>();
const SIDE_DIRECTIONS: Record<Exclude<TouchSide, 'nearest'>, Vec3> = { front: [0, 0, 1], back: [0, 0, -1], left: [1, 0, 0], right: [-1, 0, 0] };
// #endregion

// #region Main flow
export function findOverlaps(characters: PosedCharacter[]): Overlap[] {
  const shapesOf = characters.map((character) => worldShapes(character.rig, character.pose).filter((shape) => !IGNORED_BONES.test(shape.bone)));
  const deepest = new Map<string, Overlap>();

  for (let first = 0; first < characters.length; first++) {
    for (let second = first; second < characters.length; second++) {
      const isSelf = first === second;
      const restGaps = isSelf ? restGapsOf(characters[first].rig) : null;
      const shapesA = shapesOf[first];
      const shapesB = shapesOf[second];

      for (let indexA = 0; indexA < shapesA.length; indexA++) {
        for (let indexB = isSelf ? indexA + 1 : 0; indexB < shapesB.length; indexB++) {
          const shapeA = shapesA[indexA];
          const shapeB = shapesB[indexB];
          if (isSelf && areNeighbors(characters[first].rig, shapeA.bone, shapeB.bone)) continue;
          // The spine segments always press into each other when the back bends; its limits already keep that real.
          if (isSelf && boneGroup(shapeA.bone) === 'torso' && boneGroup(shapeB.bone) === 'torso') continue;
          if (!boundsMayTouch(shapeA, shapeB)) continue;

          const restDepth = Math.max(0, -(restGaps?.get(`${indexA}:${indexB}`) ?? Infinity));
          const depth = -contactBetween(shapeA, shapeB).gap - restDepth;
          if (depth <= OVERLAP_TOLERANCE_METERS) continue;

          const key = `${first}:${shapeA.bone}|${second}:${shapeB.bone}`;
          if ((deepest.get(key)?.depthMeters ?? 0) >= depth) continue;
          deepest.set(key, {
            character: first,
            bone: shapeA.bone,
            part: partOfBone(shapeA.bone),
            otherCharacter: second,
            otherBone: shapeB.bone,
            otherPart: partOfBone(shapeB.bone),
            depthMeters: Math.round(depth * 1000) / 1000,
          });
        }
      }
    }
  }
  return [...deepest.values()].sort((a, b) => b.depthMeters - a.depthMeters);
}

// Moves only `characters[index]`: a limb bends to reach, a torso part slides the whole character over the floor.
export function touch(characters: PosedCharacter[], index: number, part: string, targetIndex: number, targetPart: string, side: TouchSide = 'nearest'): TouchResult {
  const character = characters[index];
  const effector = BODY_PARTS[part];
  const target = BODY_PARTS[targetPart];
  if (!effector) throw new Error(`Unknown body part "${part}". Known: ${Object.keys(BODY_PARTS).join(', ')}`);
  if (!target) throw new Error(`Unknown body part "${targetPart}". Known: ${Object.keys(BODY_PARTS).join(', ')}`);

  const isSelf = index === targetIndex;
  const effectorGroup = boneGroup(effector.bone);
  const targetGroup = boneGroup(target.bone);
  if (isSelf && effector.bone === target.bone) throw new Error('A body part cannot touch itself');
  // The spine moves the arms, head and chest, so it can only help when the target doesn't ride on it.
  const isTargetOnSpine = isSelf && (targetGroup === 'arm' || targetGroup === 'head' || (targetGroup === 'torso' && target.bone !== 'pelvis'));
  if (isSelf && effectorGroup === 'torso' && isTargetOnSpine) throw new Error(`${effector.label} cannot reach its own ${target.label.toLowerCase()}`);

  const isOnLimb = (bone: string) => boneGroup(bone) === effectorGroup && bone.slice(-2) === effector.bone.slice(-2);
  const isTouchedPair = (bone: string, otherIndex: number, otherBone: string) => bone === effector.bone && otherIndex === targetIndex && otherBone === target.bone;
  const gapOf = (pose: Pose) => partContact({ ...character, pose }, effector, targetIndex === index ? { ...character, pose } : characters[targetIndex], target, side).gap;

  const solveFrom = (start: Pose): Pose => {
    let pose = start;
    for (let round = 0; round < SOLVE_ROUNDS; round++) {
      const contact = partContact({ ...character, pose }, effector, targetIndex === index ? { ...character, pose } : characters[targetIndex], target, side);
      const isTouching = Math.abs(contact.gap) < TOUCH_GAP_METERS * 2;
      const goal = contact.pointOnOther.clone().addScaledVector(contact.normal, TOUCH_GAP_METERS);

      if (effectorGroup === 'torso' && !isSelf) {
        if (isTouching) break;
        const [x, y, z] = pose.position ?? [0, 0, 0];
        const shift = goal.sub(contact.pointOnShape).setY(0);
        const slid = (share: number): Pose => ({ ...pose, position: [round3(x + shift.x * share), y, round3(z + shift.z * share)] });
        // Slide as far as the bodies allow: a belly or hips can meet the other character before the chosen parts do.
        const isBlocked = (share: number) =>
          findOverlaps(characters.map((other, otherIndex) => (otherIndex === index ? { ...other, pose: slid(share) } : other))).some(
            (overlap) => (overlap.character === index) !== (overlap.otherCharacter === index),
          );
        let share = 1;
        if (isBlocked(1)) {
          let free = 0;
          let blocked = 1;
          for (let step = 0; step < 12; step++) {
            const middle = (free + blocked) / 2;
            if (isBlocked(middle)) blocked = middle;
            else free = middle;
          }
          share = free;
        }
        pose = slid(share);
        if (share < 1) break;
        continue;
      }
      // While reaching, the rest of the same limb is pushed out of anything it passes through.
      const pushes = pushOutGoals(characters, index, pose, (bone, otherIndex, otherBone) => isOnLimb(bone) && !isTouchedPair(bone, otherIndex, otherBone));
      if (isTouching && pushes.goals.length === 0) break;
      const goals = [goalFor(character.rig, pose, effector.bone, contact.pointOnShape, goal), ...pushes.goals];
      pose = reach(character.rig, pose, goals, chainMotions(effector.bone, !isTargetOnSpine));
    }
    return pose;
  };

  // Reaching from a hanging arm can get stuck (a hand to the head ends up behind the back), so also start from a raised limb and keep the best.
  const limbSide = effector.bone.slice(-1);
  const starts: Pose[] = [character.pose];
  for (const seed of effectorGroup === 'arm' ? ARM_SEEDS : effectorGroup === 'leg' ? LEG_SEEDS : []) {
    const joints = { ...character.pose.joints };
    for (const [control, angles] of Object.entries(seed)) joints[`${control}_${limbSide}`] = { ...joints[`${control}_${limbSide}`], ...angles };
    starts.push({ ...character.pose, joints });
  }

  let best: { pose: Pose; gap: number; score: number } | null = null;
  for (const start of starts) {
    const pose = solveFrom(start);
    const gap = gapOf(pose);
    const overlapDepth = findOverlaps(characters.map((other, otherIndex) => (otherIndex === index ? { ...other, pose } : other)))
      .filter((overlap) => (overlap.character === index && isOnLimb(overlap.bone)) || (overlap.otherCharacter === index && isOnLimb(overlap.otherBone)))
      .reduce((sum, overlap) => sum + overlap.depthMeters, 0);
    const score = Math.abs(gap) + overlapDepth;
    if (!best || score < best.score) best = { pose, gap, score };
  }
  return { pose: best!.pose, gapMeters: Math.round(best!.gap * 1000) / 1000 };
}

// Pushes the limbs of `characters[index]` out of its own body and out of other characters. Torsos inside another character slide away.
export function separate(characters: PosedCharacter[], index: number): Pose {
  const character = characters[index];
  let pose = character.pose;

  for (let round = 0; round < SOLVE_ROUNDS; round++) {
    const pushes = pushOutGoals(characters, index, pose, () => true);
    if (pushes.goals.length === 0 && pushes.slide.lengthSq() === 0) break;
    if (pushes.goals.length > 0) pose = reach(character.rig, pose, pushes.goals, pushes.motions);
    if (pushes.slide.lengthSq() > 0) {
      const [x, y, z] = pose.position ?? [0, 0, 0];
      pose = { ...pose, position: [round3(x + pushes.slide.x), y, round3(z + pushes.slide.z)] };
    }
  }
  return pose;
}
// #endregion

// #region Helpers
// For each overlap on `characters[index]`, a reach goal that moves its freest part (arm, then leg, then head) back out.
// A torso inside another character can't bend out of it, so it gives a floor slide instead (the biggest one wins).
function pushOutGoals(characters: PosedCharacter[], index: number, pose: Pose, isWanted: (bone: string, otherIndex: number, otherBone: string) => boolean) {
  const character = characters[index];
  const posed = { ...character, pose };
  const current = characters.map((other, otherIndex) => (otherIndex === index ? posed : other));
  const goals: ReachGoal[] = [];
  const motions = new Map<string, ReachMotion>();
  let slide = new Vector3();

  for (const overlap of findOverlaps(current)) {
    const sides = [
      { index: overlap.character, bone: overlap.bone },
      { index: overlap.otherCharacter, bone: overlap.otherBone },
    ];
    const moving = sides.filter((side) => side.index === index).sort((a, b) => GROUP_PRIORITY[boneGroup(a.bone)] - GROUP_PRIORITY[boneGroup(b.bone)])[0];
    if (!moving) continue;
    const still = sides.find((side) => side !== moving)!;
    if (!isWanted(moving.bone, still.index, still.bone)) continue;

    const contact = boneContact(posed, moving.bone, current[still.index], still.bone);
    const push = contact.normal.clone().multiplyScalar(-contact.gap + SEPARATE_MARGIN_METERS);
    if (boneGroup(moving.bone) === 'torso') {
      if (still.index !== index && push.lengthSq() > slide.lengthSq()) slide = push.setY(0);
      continue;
    }
    goals.push(goalFor(character.rig, pose, moving.bone, contact.pointOnShape, contact.pointOnShape.clone().add(push)));
    for (const motion of chainMotions(moving.bone, false)) motions.set(`${motion.control}.${motion.motion}`, motion);
  }
  return { goals, motions: [...motions.values()], slide };
}

function boneGroup(bone: string): keyof typeof GROUP_PRIORITY {
  if (/^(clavicle|shoulder|elbow|wrist|index|middle|ring|pinky|thumb)_/.test(bone)) return 'arm';
  if (/^(hip|knee|ankle|toes)_/.test(bone)) return 'leg';
  if (bone === 'head' || bone === 'neck') return 'head';
  return 'torso';
}

function partOfBone(bone: string): string {
  const part = Object.entries(BODY_PARTS).find(([, candidate]) => candidate.bone === bone && !candidate.isJointOnly);
  return part?.[0] ?? bone;
}

function chainMotions(bone: string, includeSpine: boolean): ReachMotion[] {
  const side = bone.match(/_(l|r)$/)?.[1];
  const spine: ReachMotion[] = includeSpine
    ? ['lumbar', 'thoracic'].flatMap((control) => ['flexion', 'side_bend', 'rotation'].map((motion) => ({ control, motion, weight: SPINE_WEIGHT })))
    : [];
  const group = boneGroup(bone);

  if (group === 'arm') {
    const motions: ReachMotion[] = [
      { control: `shoulder_${side}`, motion: 'flexion' },
      { control: `shoulder_${side}`, motion: 'abduction' },
      { control: `shoulder_${side}`, motion: 'internal_rotation', weight: TWIST_WEIGHT },
      { control: `elbow_${side}`, motion: 'flexion' },
      { control: `shoulder_girdle_${side}`, motion: 'elevation', weight: GIRDLE_WEIGHT },
      { control: `shoulder_girdle_${side}`, motion: 'protraction', weight: GIRDLE_WEIGHT },
    ];
    if (!/^(shoulder|elbow|clavicle)_/.test(bone)) motions.push({ control: `wrist_${side}`, motion: 'flexion', weight: 0.5 }, { control: `wrist_${side}`, motion: 'radial_deviation', weight: 0.5 });
    return [...motions, ...spine];
  }
  if (group === 'leg') return legMotions(side!, !bone.startsWith('hip_') && !bone.startsWith('knee_'));
  if (group === 'head') {
    return [
      { control: 'neck', motion: 'flexion' },
      { control: 'neck', motion: 'side_bend' },
      { control: 'neck', motion: 'rotation', weight: TWIST_WEIGHT },
      ...spine,
    ];
  }
  return spine.map((motion) => ({ ...motion, weight: 1 }));
}

function goalFor(rig: Rig, pose: Pose, bone: string, worldPoint: Vector3, target: Vector3): ReachGoal {
  const world = forwardKinematics(rig, solvePose(pose))[bone];
  const local = worldPoint.clone().sub(world.position).applyQuaternion(world.quaternion.clone().invert());
  return { bone, point: local.toArray() as Vec3, target: target.toArray() as Vec3 };
}

function partContact(character: PosedCharacter, effector: { bone: string }, targetCharacter: PosedCharacter, target: { bone: string; isJointOnly?: boolean }, side: TouchSide): Contact {
  const effectorShapes = worldShapes(character.rig, character.pose).filter((shape) => shape.bone === effector.bone);
  const targetShapes = worldShapes(targetCharacter.rig, targetCharacter.pose).filter((shape) => shape.bone === target.bone && (!target.isJointOnly || shape.isJoint));
  if (side === 'nearest') return closestContact(effectorShapes, targetShapes);

  // A chosen side: the surface point of the target's biggest shape in that direction (in the target bone's own frame), then the effector point nearest it.
  const biggest = targetShapes.reduce((best, shape) => (shapeSize(shape) > shapeSize(best) ? shape : best));
  const boneWorld = forwardKinematics(targetCharacter.rig, solvePose(targetCharacter.pose))[target.bone];
  const direction = new Vector3(...SIDE_DIRECTIONS[side]).applyQuaternion(boneWorld.quaternion);
  const surface = sidePoint(biggest, direction);
  const point: WorldShape = { kind: 'capsule', bone: target.bone, start: surface.point, end: surface.point, radius: 0, isJoint: false };
  const contact = closestContact(effectorShapes, [point]);
  return { ...contact, normal: surface.normal, gap: contact.pointOnShape.clone().sub(surface.point).dot(surface.normal) };
}

function boneContact(character: PosedCharacter, bone: string, otherCharacter: PosedCharacter, otherBone: string): Contact {
  const shapes = worldShapes(character.rig, character.pose).filter((shape) => shape.bone === bone);
  const others = worldShapes(otherCharacter.rig, otherCharacter.pose).filter((shape) => shape.bone === otherBone);
  return closestContact(shapes, others);
}

function closestContact(shapes: WorldShape[], others: WorldShape[]): Contact {
  let best: Contact | null = null;
  for (const shape of shapes) {
    for (const other of others) {
      const contact = contactBetween(shape, other);
      if (!best || contact.gap < best.gap) best = contact;
    }
  }
  if (!best) throw new Error('Body part has no shapes');
  return best;
}

function worldShapes(rig: Rig, pose: Pose): WorldShape[] {
  const world = forwardKinematics(rig, solvePose(pose));
  const shapes: WorldShape[] = [];
  for (const bone of rig.bones) {
    const { position, quaternion } = world[bone.name];
    const toWorld = (point: Vec3) => new Vector3(...point).applyQuaternion(quaternion).add(position);
    for (const shape of bone.shapes) {
      if (shape.kind === 'ball') {
        shapes.push({ kind: 'capsule', bone: bone.name, start: toWorld(shape.center), end: toWorld(shape.center), radius: shape.radius, isJoint: true });
        continue;
      }
      if (shape.kind === 'ellipsoid') {
        if (shape.isAccent) continue;
        shapes.push({ kind: 'ellipsoid', bone: bone.name, center: toWorld(shape.center), rotation: quaternion.clone(), radii: new Vector3(...shape.radii), isJoint: false });
        continue;
      }
      // A squashed capsule (palm, foot) keeps its squashed end points and a radius between its flat and full widths.
      const squash = new Vector3(...(shape.squash ?? [1, 1, 1]));
      const start = new Vector3(...shape.start);
      const end = new Vector3(...shape.end).sub(start).multiply(squash).add(start);
      const [smallest, middle] = squash.toArray().sort((a, b) => a - b);
      const radius = ((shape.radiusStart + shape.radiusEnd) / 2) * Math.sqrt(smallest * middle);
      shapes.push({ kind: 'capsule', bone: bone.name, start: toWorld(start.toArray() as Vec3), end: toWorld(end.toArray() as Vec3), radius, isJoint: false });
    }
  }
  return shapes;
}

function contactBetween(shape: WorldShape, other: WorldShape): Contact {
  if (shape.kind === 'ellipsoid' && other.kind === 'ellipsoid') {
    // Two ellipsoids: the smaller one stands in as a capsule along its longest axis.
    if (shapeSize(shape) <= shapeSize(other)) return contactBetween(ellipsoidAsCapsule(shape), other);
    return flip(contactBetween(ellipsoidAsCapsule(other), shape));
  }
  if (shape.kind === 'ellipsoid') return flip(contactBetween(other, shape));

  if (other.kind === 'capsule') {
    const [onShape, onOther] = closestOnSegments(shape.start, shape.end, other.start, other.end);
    const between = onShape.clone().sub(onOther);
    const distance = between.length();
    const normal = distance > 1e-9 ? between.divideScalar(distance) : new Vector3(0, 1, 0);
    return {
      pointOnShape: onShape.clone().addScaledVector(normal, -shape.radius),
      pointOnOther: onOther.clone().addScaledVector(normal, other.radius),
      normal,
      gap: distance - shape.radius - other.radius,
    };
  }

  // Capsule against ellipsoid: find the closest segment point in the ellipsoid's unit-sphere space, then come back.
  const inverse = other.rotation.clone().invert();
  const toUnit = (point: Vector3) => point.clone().sub(other.center).applyQuaternion(inverse).divide(other.radii);
  const [onSegmentUnit] = closestOnSegments(toUnit(shape.start), toUnit(shape.end), new Vector3(), new Vector3());
  const unitDirection = onSegmentUnit.lengthSq() > 1e-12 ? onSegmentUnit.clone().normalize() : new Vector3(0, 1, 0);
  const segmentPoint = onSegmentUnit.clone().multiply(other.radii).applyQuaternion(other.rotation).add(other.center);
  const surface = unitDirection.clone().multiply(other.radii).applyQuaternion(other.rotation).add(other.center);
  const normal = unitDirection.clone().divide(other.radii).applyQuaternion(other.rotation).normalize();
  return {
    pointOnShape: segmentPoint.clone().addScaledVector(normal, -shape.radius),
    pointOnOther: surface,
    normal,
    gap: segmentPoint.clone().sub(surface).dot(normal) - shape.radius,
  };
}

function flip(contact: Contact): Contact {
  return { pointOnShape: contact.pointOnOther, pointOnOther: contact.pointOnShape, normal: contact.normal.clone().negate(), gap: contact.gap };
}

function ellipsoidAsCapsule(shape: Extract<WorldShape, { kind: 'ellipsoid' }>): WorldShape {
  const radii = shape.radii.toArray();
  const longest = radii.indexOf(Math.max(...radii));
  const [smallest, middle] = [...radii].sort((a, b) => a - b);
  const radius = Math.sqrt(smallest * middle);
  const axis = new Vector3().setComponent(longest, Math.max(0, radii[longest] - radius)).applyQuaternion(shape.rotation);
  return { kind: 'capsule', bone: shape.bone, start: shape.center.clone().sub(axis), end: shape.center.clone().add(axis), radius, isJoint: false };
}

function sidePoint(shape: WorldShape, direction: Vector3): { point: Vector3; normal: Vector3 } {
  if (shape.kind === 'ellipsoid') {
    const unitDirection = direction.clone().applyQuaternion(shape.rotation.clone().invert()).divide(shape.radii).normalize();
    return {
      point: unitDirection.clone().multiply(shape.radii).applyQuaternion(shape.rotation).add(shape.center),
      normal: unitDirection.clone().divide(shape.radii).applyQuaternion(shape.rotation).normalize(),
    };
  }
  const axis = shape.end.clone().sub(shape.start);
  const across = axis.lengthSq() > 1e-12 ? direction.clone().projectOnPlane(axis.clone().normalize()).normalize() : direction.clone().normalize();
  const middle = shape.start.clone().add(shape.end).multiplyScalar(0.5);
  return { point: middle.addScaledVector(across, shape.radius), normal: across };
}

function shapeSize(shape: WorldShape): number {
  if (shape.kind === 'ellipsoid') return shape.radii.x * shape.radii.y * shape.radii.z;
  return shape.radius * shape.radius * (shape.radius + shape.start.distanceTo(shape.end));
}

function boundsMayTouch(shape: WorldShape, other: WorldShape): boolean {
  const bound = (candidate: WorldShape) =>
    candidate.kind === 'ellipsoid'
      ? { center: candidate.center, radius: Math.max(candidate.radii.x, candidate.radii.y, candidate.radii.z) }
      : { center: candidate.start.clone().add(candidate.end).multiplyScalar(0.5), radius: candidate.start.distanceTo(candidate.end) / 2 + candidate.radius };
  const first = bound(shape);
  const second = bound(other);
  return first.center.distanceTo(second.center) < first.radius + second.radius;
}

// Bones up to two steps apart in the skeleton always meet at a joint (upper arm and chest, thigh and hips), so they never count.
function areNeighbors(rig: Rig, bone: string, other: string): boolean {
  if (bone === other) return true;
  const parentOf = (name: string) => rig.bones.find((candidate) => candidate.name === name)?.parent ?? null;
  const ancestors = (name: string) => [name, parentOf(name), parentOf(parentOf(name) ?? '')].filter((value): value is string => !!value);
  const first = ancestors(bone);
  const second = ancestors(other);
  return first.some((name, index) => second.some((otherName, otherIndex) => name === otherName && index + otherIndex <= 2));
}

function restGapsOf(rig: Rig): Map<string, number> {
  const cached = REST_GAPS.get(rig);
  if (cached) return cached;
  const shapes = worldShapes(rig, {}).filter((shape) => !IGNORED_BONES.test(shape.bone));
  const gaps = new Map<string, number>();
  for (let indexA = 0; indexA < shapes.length; indexA++) {
    for (let indexB = indexA + 1; indexB < shapes.length; indexB++) {
      if (!boundsMayTouch(shapes[indexA], shapes[indexB])) continue;
      gaps.set(`${indexA}:${indexB}`, contactBetween(shapes[indexA], shapes[indexB]).gap);
    }
  }
  REST_GAPS.set(rig, gaps);
  return gaps;
}

function closestOnSegments(startA: Vector3, endA: Vector3, startB: Vector3, endB: Vector3): [Vector3, Vector3] {
  const directionA = endA.clone().sub(startA);
  const directionB = endB.clone().sub(startB);
  const between = startA.clone().sub(startB);
  const lengthA = directionA.dot(directionA);
  const lengthB = directionB.dot(directionB);
  const alongB = directionB.dot(between);
  const clamp = (value: number) => Math.min(1, Math.max(0, value));
  let shareA = 0;
  let shareB = 0;

  if (lengthA < 1e-12 && lengthB < 1e-12) return [startA.clone(), startB.clone()];
  if (lengthA < 1e-12) {
    shareB = clamp(alongB / lengthB);
  } else {
    const alongA = directionA.dot(between);
    if (lengthB < 1e-12) {
      shareA = clamp(-alongA / lengthA);
    } else {
      const cross = directionA.dot(directionB);
      const denominator = lengthA * lengthB - cross * cross;
      shareA = denominator > 1e-12 ? clamp((cross * alongB - alongA * lengthB) / denominator) : 0;
      shareB = (cross * shareA + alongB) / lengthB;
      if (shareB < 0 || shareB > 1) {
        shareB = clamp(shareB);
        shareA = clamp((cross * shareB - alongA) / lengthA);
      }
    }
  }
  return [startA.clone().addScaledVector(directionA, shareA), startB.clone().addScaledVector(directionB, shareB)];
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}
// #endregion
