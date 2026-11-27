/*
 * Drag a body part to pose it (mouse, one finger or a pencil). The grabbed point follows the pointer:
 *   - hand or foot: the whole arm or leg reaches for it (IK)
 *   - hips: the whole character moves on the floor; with something pinned the hips move and the limbs bend
 *   - any other part: its joint bends toward the pointer
 * Pinned hands and feet (core/reach.ts holdPins) go back to where they were at the start, every frame of the drag;
 * dragging a pinned hand or foot itself moves it (and its pin with it).
 * A dragged hand or foot that comes close to another body part under the pointer (its own or someone else's), or
 * strains toward one it can't reach, lights that part up; letting go there makes them touch (core/body.ts touch,
 * which bends the whole body over when the arm alone can't reach).
 * A finger or pencil held still on a part opens its menu instead (long press).
 * The pointer moves on a plane through the grabbed point that faces the camera (upright for the hips).
 * Joint limits always apply, because the solve changes the anatomical angles (core/reach.ts).
 */

// #region Setup
import { useThree } from '@react-three/fiber';
import { Mesh, Plane, Raycaster, Vector2, Vector3, type Object3D } from 'three';
import { buildRig, type Vec3 } from '../core/rig';
import { forwardKinematics, solvePose, type Pose } from '../core/pose';
import { dragMotions, holdPins, reach, type Pin } from '../core/reach';
import type { SceneCharacter } from './App';
// #endregion

// #region Config
export interface Grab {
  bone: string;
  localPoint: Vec3;
  worldPoint: Vector3;
  pointerId: number;
  pointerType: string;
  clientX: number;
  clientY: number;
}

// Below this many pixels a press is a tap (select only), not a drag.
const DRAG_START_PIXELS = 5;
const SOLVE_ITERATIONS_PER_FRAME = 10;
const LONG_PRESS_MILLISECONDS = 550;
// How close a dragged hand or foot has to come to a part before letting go makes them touch; a limb that can't
// follow the pointer by more than the strain distance aims at a part up to the reach distance away.
const TOUCH_MAGNET_METERS = 0.15;
const TOUCH_STRAIN_METERS = 0.05;
const TOUCH_REACH_METERS = 1;
// The end quarter of an upper arm, forearm, thigh or shin counts as the joint there.
const JOINT_SHARE_OF_SEGMENT = 0.25;

export interface TouchTarget {
  characterId: string;
  bone: string;
  part: string;
}
// #endregion

// #region Main flow
export function pinOfBone(bone: string): Pin | null {
  const side = bone.match(/_(l|r)$/)?.[1];
  if (!side) return null;
  if (/^(wrist|thumb|index|middle|ring|pinky)_/.test(bone)) return `hand_${side}` as Pin;
  if (/^(ankle|toes)_/.test(bone)) return `foot_${side}` as Pin;
  return null;
}

interface DragCallbacks {
  onPose: (id: string, pose: Pose, gestureKey: string) => void;
  onLongPress: (character: SceneCharacter, bone: string, clientX: number, clientY: number) => void;
  onTouchTarget: (target: TouchTarget | null) => void;
  onTouchDrop: (character: SceneCharacter, part: string, target: TouchTarget) => void;
}

export function useDragPosing({ onPose, onLongPress, onTouchTarget, onTouchDrop }: DragCallbacks) {
  const camera = useThree((state) => state.camera);
  const scene = useThree((state) => state.scene);
  const canvas = useThree((state) => state.gl.domElement);
  const controls = useThree((state) => state.controls) as { enabled: boolean } | null;

  return (character: SceneCharacter, grab: Grab, pins: Pin[]) => {
    const rig = buildRig(character.profile);
    const startPose = character.pose;
    const startPosition = new Vector3(...(startPose.position ?? [0, 0, 0]));
    const isMove = grab.bone === 'pelvis';
    const heldPins = pins.filter((pin) => pin !== pinOfBone(grab.bone));
    const isFloorMove = isMove && heldPins.length === 0;
    const startWorld = forwardKinematics(rig, solvePose(startPose));

    const cameraDirection = camera.getWorldDirection(new Vector3());
    // Moving the hips with something pinned uses an upright plane, so dragging down on screen goes straight down (squat), not toward the camera.
    const planeNormal = isFloorMove ? new Vector3(0, 1, 0) : isMove ? cameraDirection.setY(0).normalize() : cameraDirection;
    const plane = new Plane().setFromNormalAndCoplanarPoint(planeNormal, grab.worldPoint);
    const raycaster = new Raycaster();
    let pose = startPose;
    let pointer: Vector2 | null = null;
    let frame = 0;
    let isDragging = false;
    let touchTarget: TouchTarget | null = null;
    let pointerTarget = grab.worldPoint.clone();
    const gestureKey = `drag:${performance.now()}`;
    const touchingPart = pinOfBone(grab.bone);
    // The dragged arm or leg can't be its own target.
    const ownLimb = touchingPart?.startsWith('hand') ? /^(clavicle|shoulder|elbow|wrist|thumb|index|middle|ring|pinky)/ : /^(hip|knee|ankle|toes)/;
    const ownSide = grab.bone.slice(-2);

    const findTouchTarget = (): TouchTarget | null => {
      const grabbedWorld = forwardKinematics(rig, solvePose(pose))[grab.bone];
      const grabbedPoint = new Vector3(...grab.localPoint).applyQuaternion(grabbedWorld.quaternion).add(grabbedWorld.position);
      const isStraining = grabbedPoint.distanceTo(pointerTarget) > TOUCH_STRAIN_METERS;
      for (const hit of raycaster.intersectObjects(scene.children, true)) {
        if (!(hit.object instanceof Mesh) || !hit.object.visible || !hit.object.userData.bone) continue;
        const bone: string = hit.object.userData.bone;
        const characterId = characterIdOf(hit.object);
        if (!characterId) continue;
        if (characterId === character.id && bone.endsWith(ownSide) && ownLimb.test(bone)) continue;
        if (hit.point.distanceTo(grabbedPoint) > (isStraining ? TOUCH_REACH_METERS : TOUCH_MAGNET_METERS)) return null;
        return { characterId, bone, part: partOfBone(hit.object, hit.point) };
      }
      return null;
    };

    const applyPointer = () => {
      frame = 0;
      if (!pointer) return;
      const bounds = canvas.getBoundingClientRect();
      const normalized = new Vector2(((pointer.x - bounds.left) / bounds.width) * 2 - 1, -((pointer.y - bounds.top) / bounds.height) * 2 + 1);
      raycaster.setFromCamera(normalized, camera);
      const hit = raycaster.ray.intersectPlane(plane, new Vector3());
      if (!hit) return;

      if (isMove) {
        const position = startPosition.clone().add(hit.sub(grab.worldPoint));
        pose = { ...pose, position: position.toArray().map((value) => Math.round(value * 1000) / 1000) as Vec3 };
      } else {
        pointerTarget = hit.clone();
        pose = reach(rig, pose, [{ bone: grab.bone, point: grab.localPoint, target: hit.toArray() }], dragMotions(grab.bone), SOLVE_ITERATIONS_PER_FRAME);
      }
      if (heldPins.length > 0) pose = holdPins(rig, pose, heldPins, startWorld, SOLVE_ITERATIONS_PER_FRAME);
      onPose(character.id, pose, gestureKey);

      if (!touchingPart) return;
      const found = findTouchTarget();
      if (found?.characterId === touchTarget?.characterId && found?.bone === touchTarget?.bone) return;
      touchTarget = found;
      onTouchTarget(found);
    };

    const stop = () => {
      clearTimeout(longPressTimer);
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleEnd);
      window.removeEventListener('pointercancel', handleEnd);
      if (controls) controls.enabled = true;
    };

    const handleMove = (event: PointerEvent) => {
      if (event.pointerId !== grab.pointerId) return;
      if (!isDragging && Math.hypot(event.clientX - grab.clientX, event.clientY - grab.clientY) < DRAG_START_PIXELS) return;
      isDragging = true;
      clearTimeout(longPressTimer);
      pointer = new Vector2(event.clientX, event.clientY);
      if (!frame) frame = requestAnimationFrame(applyPointer);
    };

    const handleEnd = (event: PointerEvent) => {
      if (event.pointerId !== grab.pointerId) return;
      stop();
      if (frame) {
        // A quick flick can lift the finger before the next frame; still land where it was let go.
        cancelAnimationFrame(frame);
        applyPointer();
      }
      if (!touchTarget || !touchingPart) return;
      onTouchTarget(null);
      onTouchDrop({ ...character, pose }, touchingPart, touchTarget);
    };

    // A mouse has a right button for the menu; fingers and pencils hold still instead.
    const longPressTimer =
      grab.pointerType === 'mouse'
        ? 0
        : window.setTimeout(() => {
            if (isDragging) return;
            stop();
            onLongPress(character, grab.bone, grab.clientX, grab.clientY);
          }, LONG_PRESS_MILLISECONDS);

    // OrbitControls also saw this press; switched off, it ignores the moves until the finger lifts.
    if (controls) controls.enabled = false;
    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleEnd);
    window.addEventListener('pointercancel', handleEnd);
  };
}
// #endregion

// #region Helpers
function characterIdOf(object: Object3D): string | null {
  for (let current: Object3D | null = object; current; current = current.parent) {
    if (typeof current.userData.characterId === 'string') return current.userData.characterId;
  }
  return null;
}

// The ball of a shoulder, elbow or knee, or the last bit of the limb next to it, is that joint; the rest of a bone is
// the segment people name. So a hand let go on the lower thigh lands on the knee.
export function partOfBone(mesh: Object3D, point: Vector3): string {
  const bone: string = mesh.userData.bone;
  const side = bone.slice(-1);
  const boneGroup = mesh.parent!;
  const start = boneGroup.getWorldPosition(new Vector3());
  const end = boneGroup.children.find((child) => child.name && child.name !== bone)?.getWorldPosition(new Vector3()) ?? start;
  const along = start.distanceTo(end) > 0 ? point.clone().sub(start).dot(end.clone().sub(start)) / start.distanceToSquared(end) : 0.5;
  const isJointBall = mesh.userData.isJoint === true;
  const isNearStart = isJointBall || along < JOINT_SHARE_OF_SEGMENT;
  const isNearEnd = along > 1 - JOINT_SHARE_OF_SEGMENT;
  if (/^(wrist|thumb|index|middle|ring|pinky)/.test(bone)) return `hand_${side}`;
  if (/^(ankle|toes)_/.test(bone)) return `foot_${side}`;
  if (bone.startsWith('clavicle_')) return `shoulder_${side}`;
  if (bone.startsWith('shoulder_')) return isNearStart ? `shoulder_${side}` : isNearEnd ? `elbow_${side}` : `upper_arm_${side}`;
  if (bone.startsWith('elbow_')) return isNearStart ? `elbow_${side}` : `forearm_${side}`;
  if (bone.startsWith('hip_')) return isNearEnd ? `knee_${side}` : `thigh_${side}`;
  if (bone.startsWith('knee_')) return isNearStart ? `knee_${side}` : `shin_${side}`;
  if (bone.startsWith('thoracic')) return 'chest';
  if (bone.startsWith('lumbar')) return 'belly';
  if (bone === 'pelvis') return 'hips';
  return bone;
}
// #endregion
