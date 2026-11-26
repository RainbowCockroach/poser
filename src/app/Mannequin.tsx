/*
 * Draws one character as a segmented art mannequin: rounded segments with ball joints.
 * The bone tree comes from buildRig(profile); the pose is applied with solvePose(pose).
 * Clicking a segment reports its bone so the panel can show that joint's controls.
 */

// #region Setup
import { useEffect, useLayoutEffect, useMemo } from 'react';
import { Color, Group, LatheGeometry, Matrix4, Mesh, MeshStandardMaterial, Quaternion, SphereGeometry, Vector2, Vector3, type BufferGeometry } from 'three';
import type { ThreeEvent } from '@react-three/fiber';
import { buildRig, type CharacterProfile, type Shape } from '../core/rig';
import { restRotation, solvePose, type Pose } from '../core/pose';
// #endregion

// #region Main flow
interface MannequinProps {
  profile: CharacterProfile;
  pose: Pose;
  highlightedBones: string[];
  onSelectBone: (bone: string) => void;
}

export function Mannequin({ profile, pose, highlightedBones, onSelectBone }: MannequinProps) {
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

    for (const bone of rig.bones) {
      const group = new Group();
      group.name = bone.name;
      group.position.set(...bone.offset);
      boneGroups[bone.name] = group;
      (bone.parent ? boneGroups[bone.parent] : root).add(group);

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
    return { root, boneGroups, meshes };
  }, [rig, materials]);

  useEffect(() => () => model.meshes.forEach((mesh) => mesh.geometry.dispose()), [model]);
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
    onSelectBone(event.object.userData.bone);
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
