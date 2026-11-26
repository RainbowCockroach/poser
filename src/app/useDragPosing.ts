/*
 * Drag a body part to pose it (mouse or one finger). The grabbed point follows the pointer:
 *   - hand or foot: the whole arm or leg reaches for it (IK)
 *   - hips: the whole character moves on the floor, or with "pin feet" the hips move and the legs bend
 *   - any other part: its joint bends toward the pointer
 * The pointer moves on a plane through the grabbed point that faces the camera (upright for the hips).
 * Joint limits always apply, because the solve changes the anatomical angles (core/reach.ts).
 */

// #region Setup
import { useThree } from '@react-three/fiber';
import { Plane, Raycaster, Vector2, Vector3 } from 'three';
import { buildRig, type Vec3 } from '../core/rig';
import { forwardKinematics, solvePose, type Pose } from '../core/pose';
import { dragMotions, legMotions, reach } from '../core/reach';
import type { SceneCharacter } from './App';
// #endregion

// #region Config
export interface Grab {
  bone: string;
  localPoint: Vec3;
  worldPoint: Vector3;
  pointerId: number;
  clientX: number;
  clientY: number;
}

// Below this many pixels a press is a tap (select only), not a drag.
const DRAG_START_PIXELS = 5;
const SOLVE_ITERATIONS_PER_FRAME = 10;
// #endregion

// #region Main flow
export function useDragPosing(isPinFeet: boolean, onPose: (id: string, pose: Pose, gestureKey: string) => void) {
  const camera = useThree((state) => state.camera);
  const canvas = useThree((state) => state.gl.domElement);
  const controls = useThree((state) => state.controls) as { enabled: boolean } | null;

  return (character: SceneCharacter, grab: Grab) => {
    const rig = buildRig(character.profile);
    const startPose = character.pose;
    const startPosition = new Vector3(...(startPose.position ?? [0, 0, 0]));
    const isMove = grab.bone === 'pelvis';
    const isFloorMove = isMove && !isPinFeet;

    const startWorld = forwardKinematics(rig, solvePose(startPose));
    const plantedFeet = ['l', 'r'].map((side) => ({
      side,
      goals: [`ankle_${side}`, `toes_${side}`].map((bone) => ({ bone, point: [0, 0, 0] as Vec3, target: startWorld[bone].position.toArray() as Vec3 })),
    }));

    const cameraDirection = camera.getWorldDirection(new Vector3());
    // Moving the hips with pinned feet uses an upright plane, so dragging down on screen goes straight down (squat), not toward the camera.
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

      if (!isMove) {
        pose = reach(rig, pose, [{ bone: grab.bone, point: grab.localPoint, target: hit.toArray() }], dragMotions(grab.bone), SOLVE_ITERATIONS_PER_FRAME);
        onPose(character.id, pose, gestureKey);
        return;
      }

      const position = startPosition.clone().add(hit.sub(grab.worldPoint));
      pose = { ...pose, position: position.toArray().map((value) => Math.round(value * 1000) / 1000) as Vec3 };
      if (isPinFeet) {
        for (const foot of plantedFeet) pose = reach(rig, pose, foot.goals, legMotions(foot.side, true), SOLVE_ITERATIONS_PER_FRAME);
      }
      onPose(character.id, pose, gestureKey);
    };

    const handleMove = (event: PointerEvent) => {
      if (event.pointerId !== grab.pointerId) return;
      if (!isDragging && Math.hypot(event.clientX - grab.clientX, event.clientY - grab.clientY) < DRAG_START_PIXELS) return;
      isDragging = true;
      pointer = new Vector2(event.clientX, event.clientY);
      if (!frame) frame = requestAnimationFrame(applyPointer);
    };

    const handleEnd = (event: PointerEvent) => {
      if (event.pointerId !== grab.pointerId) return;
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleEnd);
      window.removeEventListener('pointercancel', handleEnd);
      if (controls) controls.enabled = true;
      if (!frame) return;
      // A quick flick can lift the finger before the next frame; still land where it was let go.
      cancelAnimationFrame(frame);
      applyPointer();
    };

    // OrbitControls also saw this press; switched off, it ignores the moves until the finger lifts.
    if (controls) controls.enabled = false;
    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleEnd);
    window.addEventListener('pointercancel', handleEnd);
  };
}
// #endregion
