/*
 * Drag a body part to pose it (mouse, one finger or a pencil). The grabbed point follows the pointer:
 *   - hand or foot: the whole arm or leg reaches for it (IK)
 *   - hips: the whole character moves on the floor; with something pinned the hips move and the limbs bend
 *   - any other part: its joint bends toward the pointer
 * Pinned hands and feet (core/reach.ts holdPins) go back to where they were at the start, every frame of the drag;
 * dragging a pinned hand or foot itself moves it (and its pin with it).
 * A finger or pencil held still on a part opens its menu instead (long press).
 * The pointer moves on a plane through the grabbed point that faces the camera (upright for the hips).
 * Joint limits always apply, because the solve changes the anatomical angles (core/reach.ts).
 */

// #region Setup
import { useThree } from '@react-three/fiber';
import { Plane, Raycaster, Vector2, Vector3 } from 'three';
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
// #endregion

// #region Main flow
export function pinOfBone(bone: string): Pin | null {
  const side = bone.match(/_(l|r)$/)?.[1];
  if (!side) return null;
  if (/^(wrist|thumb|index|middle|ring|pinky)_/.test(bone)) return `hand_${side}` as Pin;
  if (/^(ankle|toes)_/.test(bone)) return `foot_${side}` as Pin;
  return null;
}

export function useDragPosing(onPose: (id: string, pose: Pose, gestureKey: string) => void, onLongPress: (character: SceneCharacter, bone: string, clientX: number, clientY: number) => void) {
  const camera = useThree((state) => state.camera);
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
    const gestureKey = `drag:${performance.now()}`;

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
        pose = reach(rig, pose, [{ bone: grab.bone, point: grab.localPoint, target: hit.toArray() }], dragMotions(grab.bone), SOLVE_ITERATIONS_PER_FRAME);
      }
      if (heldPins.length > 0) pose = holdPins(rig, pose, heldPins, startWorld, SOLVE_ITERATIONS_PER_FRAME);
      onPose(character.id, pose, gestureKey);
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
      if (!frame) return;
      // A quick flick can lift the finger before the next frame; still land where it was let go.
      cancelAnimationFrame(frame);
      applyPointer();
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
