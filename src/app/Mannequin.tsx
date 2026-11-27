/*
 * Draws one character as a segmented art mannequin: rounded segments with ball joints.
 * The bone tree comes from buildRig(profile); the pose is applied with solvePose(pose).
 * Pressing a segment reports the bone and the exact point grabbed, for selecting and drag posing.
 */

// #region Setup
import { useEffect, useLayoutEffect, useMemo } from 'react';
import { Color, Group, LatheGeometry, Matrix4, Mesh, MeshStandardMaterial, Quaternion, SphereGeometry, Vector2, Vector3, type BufferGeometry } from 'three';
import type { ThreeEvent } from '@react-three/fiber';
import { buildRig, type CharacterProfile, type Shape } from '../core/rig';
import { restRotation, solvePose, type Pose } from '../core/pose';
import type { Grab } from './useDragPosing';
// #endregion

// #region Config
const IS_TOUCH_SCREEN = matchMedia('(pointer: coarse)').matches;
const TOUCH_GRAB_RADIUS = 0.08;
// #endregion

// #region Main flow
interface MannequinProps {
  profile: CharacterProfile;
  pose: Pose;
  highlightedBones: string[];
  onGrab: (grab: Grab) => void;
}

export function Mannequin({ profile, pose, highlightedBones, onGrab }: MannequinProps) {
  const rig = useMemo(() => buildRig(profile), [profile]);

  const materials = useMemo(() => {
    const base = new Color(profile.color);
    return {
      body: new MeshStandardMaterial({ color: base, roughness: 0.65 }),
      joint: new MeshStandardMaterial({ color: base.clone().multiplyScalar(0.82), roughness: 0.5 }),
      accent: new MeshStandardMaterial({ color: base.clone().multiplyScalar(0.35), roughness: 0.6 }),
      highlight: new MeshStandardMaterial({ color: '#ff8a3d', emissive: '#ff6a00', emissiveIntensity: 0.25, roughness: 0.5 }),
    };
  }, [profile.color]);

  const model = useMemo(() => {
    const root = new Group();
    const boneGroups: Record<string, Group> = {};
    const meshes: Mesh[] = [];
    const grabAreas: Mesh[] = [];

    for (const bone of rig.bones) {
      const group = new Group();
      group.name = bone.name;
      group.position.set(...bone.offset);
      boneGroups[bone.name] = group;
      (bone.parent ? boneGroups[bone.parent] : root).add(group);

      // Fingers can't hit a hand a few pixels wide; on touch screens an invisible ball around each hand and foot catches the press.
      // It covers the fingers and toes too, which stay posable with the sliders.
      if (IS_TOUCH_SCREEN && /^(wrist|ankle)_/.test(bone.name)) {
        const palmOrFoot = bone.shapes.find((shape) => shape.kind === 'capsule');
        if (palmOrFoot?.kind === 'capsule') {
          // A hand is about twice its palm, so its middle is the knuckles; a foot's middle is the middle of its sole.
          const start = new Vector3(...palmOrFoot.start);
          const end = new Vector3(...palmOrFoot.end);
          const isHand = bone.name.startsWith('wrist_');
          const center = isHand ? end : start.clone().add(end).multiplyScalar(0.5);
          const radius = Math.max(TOUCH_GRAB_RADIUS, start.distanceTo(end) * (isHand ? 1.25 : 0.8));
          const grabArea = new Mesh(new SphereGeometry(radius, 12, 8).translate(center.x, center.y, center.z), materials.body);
          grabArea.visible = false;
          grabArea.userData = { bone: bone.name };
          group.add(grabArea);
          grabAreas.push(grabArea);
        }
      }

      for (const shape of bone.shapes) {
        const material = shape.kind === 'ball' ? materials.joint : shape.kind === 'ellipsoid' && shape.isAccent ? materials.accent : materials.body;
        const mesh = new Mesh(shapeGeometry(shape), material);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.userData = { bone: bone.name, material };
        group.add(mesh);
        meshes.push(mesh);
      }
    }
    return { root, boneGroups, meshes, grabAreas };
  }, [rig, materials]);

  useEffect(() => () => [...model.meshes, ...model.grabAreas].forEach((mesh) => mesh.geometry.dispose()), [model]);
  useEffect(() => () => Object.values(materials).forEach((material) => material.dispose()), [materials]);

  useLayoutEffect(() => {
    const solved = solvePose(pose);
    for (const bone of rig.bones) {
      const group = model.boneGroups[bone.name];
      group.quaternion.copy(restRotation(bone.restRotationDegrees).multiply(solved.rotations[bone.name] ?? new Quaternion()));
    }
    model.root.position.set(...solved.position);
  }, [rig, model, pose]);

  useLayoutEffect(() => {
    for (const mesh of model.meshes) {
      mesh.material = highlightedBones.includes(mesh.userData.bone) ? materials.highlight : mesh.userData.material;
    }
  }, [model, materials, highlightedBones]);

  const handlePointerDown = (event: ThreeEvent<PointerEvent>) => {
    event.stopPropagation();
    // Right and middle buttons stay with the camera (pan).
    if (event.nativeEvent.button !== 0) return;
    const boneGroup = event.object.parent!;
    onGrab({
      bone: event.object.userData.bone,
      localPoint: boneGroup.worldToLocal(event.point.clone()).toArray(),
      worldPoint: event.point.clone(),
      pointerId: event.pointerId,
      clientX: event.nativeEvent.clientX,
      clientY: event.nativeEvent.clientY,
    });
  };

  return <primitive object={model.root} onPointerDown={handlePointerDown} />;
}
// #endregion

// #region Helpers
function shapeGeometry(shape: Shape): BufferGeometry {
  if (shape.kind === 'ball') return new SphereGeometry(shape.radius, 20, 14).translate(...shape.center);
  if (shape.kind === 'ellipsoid') return new SphereGeometry(1, 28, 18).scale(...shape.radii).translate(...shape.center);

  // Tapered capsule: a lathe outline with a half circle at each end, built along +Y then turned toward the end point.
  const start = new Vector3(...shape.start);
  const direction = new Vector3(...shape.end).sub(start);
  const length = direction.length();
  const outline: Vector2[] = [];
  for (let step = 0; step <= 8; step++) {
    const angle = -Math.PI / 2 + (step / 8) * (Math.PI / 2);
    outline.push(new Vector2(shape.radiusStart * Math.cos(angle), shape.radiusStart * Math.sin(angle)));
  }
  for (let step = 0; step <= 8; step++) {
    const angle = (step / 8) * (Math.PI / 2);
    outline.push(new Vector2(Math.max(1e-5, shape.radiusEnd * Math.cos(angle)), length + shape.radiusEnd * Math.sin(angle)));
  }
  const geometry = new LatheGeometry(outline, 24);
  geometry.applyMatrix4(new Matrix4().makeRotationFromQuaternion(new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), direction.normalize())));
  // Squash is in bone space around the start point, e.g. a flat palm or a low foot.
  if (shape.squash) geometry.scale(...shape.squash);
  return geometry.translate(...shape.start);
}
// #endregion
