/*
 * Draws one character as a segmented art mannequin: rounded segments with ball joints.
 * The bone tree comes from buildRig(profile); the pose is applied with solvePose(pose).
 * Pressing a segment reports the bone and the exact point grabbed, for selecting and drag posing.
 * While a hand or foot is small on screen, a press on a finger or toe grabs the whole hand or foot,
 * so pulling a hand moves the arm instead of bending one finger. Zoom in and the fingers take over.
 * Pressing the same part twice quickly asks for a closer look at it.
 */

// #region Setup
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Color, Group, LatheGeometry, Matrix4, Mesh, MeshStandardMaterial, PerspectiveCamera, Quaternion, SphereGeometry, Vector2, Vector3, type BufferGeometry, type Object3D } from 'three';
import { useThree, type ThreeEvent } from '@react-three/fiber';
import { buildRig, type CharacterProfile, type Shape } from '../core/rig';
import { CONTROL_FOR_BONE, restRotation, solvePose, type Pose } from '../core/pose';
import type { Grab } from './useDragPosing';
// #endregion

// #region Config
const IS_TOUCH_SCREEN = matchMedia('(pointer: coarse)').matches;
const TOUCH_GRAB_RADIUS = 0.08;
// A hand or foot shorter than this on screen is grabbed whole; its fingers and toes are too thin to aim at.
const WHOLE_HAND_BELOW_PIXELS = 110;
const DOUBLE_PRESS_MILLISECONDS = 350;
const DOUBLE_PRESS_PIXELS = 24;
// #endregion

// #region Main flow
interface MannequinProps {
  profile: CharacterProfile;
  pose: Pose;
  highlightedBones: string[];
  onGrab: (grab: Grab) => void;
  onLookCloser: (bone: string) => void;
  onMenu: (bone: string, clientX: number, clientY: number) => void;
}

export function Mannequin({ profile, pose, highlightedBones, onGrab, onLookCloser, onMenu }: MannequinProps) {
  const rig = useMemo(() => buildRig(profile), [profile]);
  const camera = useThree((state) => state.camera);
  const viewportHeight = useThree((state) => state.size.height);
  const canvas = useThree((state) => state.gl.domElement);
  const invalidate = useThree((state) => state.invalidate);
  const [hoveredControl, setHoveredControl] = useState<string | null>(null);
  const lastPress = useRef({ bone: '', time: 0, clientX: 0, clientY: 0 });

  const materials = useMemo(() => {
    const base = new Color(profile.color);
    return {
      body: new MeshStandardMaterial({ color: base, roughness: 0.65 }),
      joint: new MeshStandardMaterial({ color: base.clone().multiplyScalar(0.82), roughness: 0.5 }),
      accent: new MeshStandardMaterial({ color: base.clone().multiplyScalar(0.35), roughness: 0.6 }),
      highlight: new MeshStandardMaterial({ color: '#ff8a3d', emissive: '#ff6a00', emissiveIntensity: 0.25, roughness: 0.5 }),
      hover: new MeshStandardMaterial({ color: base.clone().lerp(new Color('#ffffff'), 0.3), emissive: '#ff6a00', emissiveIntensity: 0.12, roughness: 0.6 }),
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
      const bone: string = mesh.userData.bone;
      const isHovered = hoveredControl !== null && CONTROL_FOR_BONE[bone] === hoveredControl;
      mesh.material = highlightedBones.includes(bone) ? materials.highlight : isHovered ? materials.hover : mesh.userData.material;
    }
    invalidate();
  }, [model, materials, highlightedBones, hoveredControl]);

  // The camera can move a part out from under a pointer that stays still (a view key, a closer look), so moving it drops the hover.
  const controls = useThree((state) => state.controls);
  useEffect(() => {
    if (!hoveredControl) return;
    const clearHover = () => setHoveredControl(null);
    canvas.style.cursor = 'grab';
    controls?.addEventListener('change' as never, clearHover);
    return () => {
      canvas.style.cursor = '';
      controls?.removeEventListener('change' as never, clearHover);
    };
  }, [hoveredControl, canvas, controls]);

  const grabbedBoneGroup = (object: Object3D, point: Vector3): Object3D => {
    const boneGroup = object.parent!;
    const side = boneGroup.name.slice(-1);
    const whole = /^(thumb|index|middle|ring|pinky)_\d_[lr]$/.test(boneGroup.name) ? `wrist_${side}` : /^toes_[lr]$/.test(boneGroup.name) ? `ankle_${side}` : null;
    if (!whole) return boneGroup;
    const palmOrFoot = rig.bones.find((bone) => bone.name === whole)?.shapes.find((shape) => shape.kind === 'capsule');
    if (palmOrFoot?.kind !== 'capsule') return boneGroup;
    // A hand is about twice its palm; a foot is a little longer than its capsule because of the toes.
    const length = new Vector3(...palmOrFoot.start).distanceTo(new Vector3(...palmOrFoot.end)) * (whole.startsWith('wrist') ? 2 : 1.3);
    const metersPerPixel = camera instanceof PerspectiveCamera ? (2 * Math.tan((camera.fov * Math.PI) / 360) * camera.position.distanceTo(point)) / viewportHeight : 1 / camera.zoom;
    return length / metersPerPixel < WHOLE_HAND_BELOW_PIXELS ? model.boneGroups[whole] : boneGroup;
  };

  const handlePointerDown = (event: ThreeEvent<PointerEvent>) => {
    event.stopPropagation();
    const boneGroup = grabbedBoneGroup(event.object, event.point);
    const { clientX, clientY } = event.nativeEvent;

    // A right-click that doesn't move opens the part's menu; a right-drag still slides the camera.
    if (event.nativeEvent.button === 2) {
      const handleUp = (upEvent: PointerEvent) => {
        window.removeEventListener('pointerup', handleUp);
        if (Math.hypot(upEvent.clientX - clientX, upEvent.clientY - clientY) < DOUBLE_PRESS_PIXELS / 4) onMenu(boneGroup.name, clientX, clientY);
      };
      window.addEventListener('pointerup', handleUp);
      return;
    }
    // The middle button, and Alt with the left one, stay with the camera.
    if (event.nativeEvent.button !== 0 || event.nativeEvent.altKey) return;

    const previous = lastPress.current;
    const now = performance.now();
    lastPress.current = { bone: boneGroup.name, time: now, clientX, clientY };
    if (previous.bone === boneGroup.name && now - previous.time < DOUBLE_PRESS_MILLISECONDS && Math.hypot(clientX - previous.clientX, clientY - previous.clientY) < DOUBLE_PRESS_PIXELS) {
      lastPress.current.time = 0;
      onLookCloser(boneGroup.name);
      return;
    }

    onGrab({
      bone: boneGroup.name,
      localPoint: boneGroup.worldToLocal(event.point.clone()).toArray(),
      worldPoint: event.point.clone(),
      pointerId: event.pointerId,
      pointerType: event.nativeEvent.pointerType,
      clientX,
      clientY,
    });
  };

  // Fingers have no hover: a tap would leave the highlight stuck on.
  const handlePointerMove = (event: ThreeEvent<PointerEvent>) => {
    if (event.nativeEvent.pointerType === 'touch') return;
    event.stopPropagation();
    const control = CONTROL_FOR_BONE[grabbedBoneGroup(event.object, event.point).name] ?? null;
    if (control !== hoveredControl) setHoveredControl(control);
  };

  return <primitive object={model.root} onPointerDown={handlePointerDown} onPointerMove={handlePointerMove} onPointerOut={() => setHoveredControl(null)} />;
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
