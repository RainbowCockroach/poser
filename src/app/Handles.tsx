/*
 * Handles on the selected character, so it is clear what can be grabbed:
 *   - dots on the hands, feet, elbows, knees, head, chest and a square on the hips; grabbing a dot is the same as
 *     grabbing that body part at that point (useDragPosing). An elbow or knee dot swings the upper arm or thigh.
 *   - a ring around the selected part that twists it (upper arm, forearm, thigh, spine, head)
 *   - a ring on the floor that turns the whole character
 * Dots are page elements (drei Html): they keep their size on screen, are easy to hit with a finger and show through
 * the body. Pinned hands and feet show a filled dot. Rings are 3D; dragging along a ring turns the part about its axis.
 */

// #region Setup
import { useMemo, type PointerEvent as ReactPointerEvent } from 'react';
import { Html } from '@react-three/drei';
import { useThree, type ThreeEvent } from '@react-three/fiber';
import { Quaternion, Vector3 } from 'three';
import { buildRig, type Rig, type Vec3 } from '../core/rig';
import { CONTROLS, forwardKinematics, solvePose, type Pose } from '../core/pose';
import type { Pin } from '../core/reach';
import type { Grab } from './useDragPosing';
import type { SceneCharacter } from './App';
// #endregion

// #region Config
const TWIST_MOTION: Record<string, string> = {
  lumbar: 'rotation',
  thoracic: 'rotation',
  neck: 'rotation',
  shoulder: 'internal_rotation',
  elbow: 'pronation',
  hip: 'internal_rotation',
};
const RING_COLOR = '#5b57d1';
// Rings are drawn over the body so they never hide inside a thick limb.
const RING_RENDER_ORDER = 10;
const RING_LINE_METERS = 0.006;
const RING_HIT_METERS = 0.05;

interface Spot {
  name: string;
  label: string;
  bone: string;
  localPoint: Vec3;
  kind: 'end' | 'joint' | 'hips';
  pin?: Pin;
}

interface HandlesProps {
  character: SceneCharacter;
  selectedControl: string | null;
  pins: Pin[];
  isPencilOnly: boolean;
  onGrab: (grab: Grab) => void;
  onMenu: (bone: string, clientX: number, clientY: number) => void;
  onTwist: (control: string, motion: string, degrees: number, startPose: Pose, gestureKey: string) => void;
}
// #endregion

// #region Main flow
export function Handles({ character, selectedControl, pins, isPencilOnly, onGrab, onMenu, onTwist }: HandlesProps) {
  const camera = useThree((state) => state.camera);
  const canvas = useThree((state) => state.gl.domElement);
  const controls = useThree((state) => state.controls) as { enabled: boolean } | null;
  const rig = useMemo(() => buildRig(character.profile), [character.profile]);
  const spots = useMemo(() => spotsOf(rig), [rig]);
  const world = useMemo(() => forwardKinematics(rig, solvePose(character.pose)), [rig, character.pose]);
  const heightMeters = character.profile.heightCm / 100;

  const worldPointOf = (bone: string, localPoint: Vec3) => new Vector3(...localPoint).applyQuaternion(world[bone].quaternion).add(world[bone].position);

  const grabSpot = (spot: Spot, event: ReactPointerEvent) => {
    if (event.button !== 0 || (isPencilOnly && event.pointerType === 'touch')) return;
    event.preventDefault();
    event.stopPropagation();
    onGrab({
      bone: spot.bone,
      localPoint: spot.localPoint,
      worldPoint: worldPointOf(spot.bone, spot.localPoint),
      pointerId: event.pointerId,
      pointerType: event.pointerType,
      clientX: event.clientX,
      clientY: event.clientY,
    });
  };

  // Turning follows the pointer's angle around the ring's middle on screen, so a drag along the ring feels like turning a dial.
  const startTwist = (event: ThreeEvent<PointerEvent>, control: string, motion: string, center: Vector3, axis: Vector3) => {
    if (event.nativeEvent.button !== 0 || (isPencilOnly && event.nativeEvent.pointerType === 'touch')) return;
    event.stopPropagation();
    const bounds = canvas.getBoundingClientRect();
    const projected = center.clone().project(camera);
    const centerX = bounds.left + ((projected.x + 1) / 2) * bounds.width;
    const centerY = bounds.top + ((1 - projected.y) / 2) * bounds.height;
    const angleOf = (x: number, y: number) => Math.atan2(y - centerY, x - centerX);
    // Seen from the side the axis points to, a positive turn goes anticlockwise; screen angles grow clockwise.
    const direction = axis.dot(camera.position.clone().sub(center)) > 0 ? -1 : 1;
    const limits = CONTROLS[control].motions[motion];
    const startPose = character.pose;
    const startDegrees = startPose.joints?.[control]?.[motion] ?? 0;
    const pointerId = event.pointerId;
    const gestureKey = `drag:twist:${performance.now()}`;
    let previousAngle = angleOf(event.nativeEvent.clientX, event.nativeEvent.clientY);
    let turnedRadians = 0;

    const handleMove = (moveEvent: PointerEvent) => {
      if (moveEvent.pointerId !== pointerId) return;
      const angle = angleOf(moveEvent.clientX, moveEvent.clientY);
      let step = angle - previousAngle;
      if (step > Math.PI) step -= 2 * Math.PI;
      if (step < -Math.PI) step += 2 * Math.PI;
      previousAngle = angle;
      turnedRadians += step;
      let degrees = Math.round(startDegrees + (direction * turnedRadians * 180) / Math.PI);
      // A heading goes all the way round; every other twist stops at the body's limit.
      if (control === 'pelvis') degrees = ((((degrees + 180) % 360) + 360) % 360) - 180;
      else degrees = Math.min(limits.max, Math.max(limits.min, degrees));
      onTwist(control, motion, degrees, startPose, gestureKey);
    };
    const handleEnd = (endEvent: PointerEvent) => {
      if (endEvent.pointerId !== pointerId) return;
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleEnd);
      window.removeEventListener('pointercancel', handleEnd);
      if (controls) controls.enabled = true;
    };
    if (controls) controls.enabled = false;
    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleEnd);
    window.addEventListener('pointercancel', handleEnd);
  };

  const twistMotion = selectedControl ? TWIST_MOTION[selectedControl.replace(/_(l|r)$/, '')] : undefined;
  let twistRing: { center: Vector3; quaternion: Quaternion; axis: Vector3; radius: number } | null = null;
  if (selectedControl && twistMotion) {
    const motion = CONTROLS[selectedControl].motions[twistMotion];
    const bone = motion.bones[0][0];
    const child = rig.bones.find((entry) => entry.parent === bone);
    const middle: Vec3 = child ? (child.offset.map((value) => value / 2) as Vec3) : [0, 0, 0];
    const thickest = Math.max(0.03, ...(rig.bones.find((entry) => entry.name === bone)?.shapes.map((shape) => (shape.kind === 'capsule' ? shape.radiusStart : 0)) ?? [0]));
    twistRing = {
      center: worldPointOf(bone, middle),
      quaternion: world[bone].quaternion,
      axis: new Vector3(...motion.axis).normalize().applyQuaternion(world[bone].quaternion),
      radius: Math.max(0.07, thickest * 2.2),
    };
  }

  const lowest = Math.max(0.004, Math.min(...Object.values(world).map((entry) => entry.position.y)));
  const [x, , z] = character.pose.position ?? [0, 0, 0];
  const floorRadius = 0.25 * heightMeters + 0.15;

  return (
    <>
      {spots.map((spot) => {
        const isPinned = !!spot.pin && pins.includes(spot.pin);
        return (
          <Html key={spot.name} position={worldPointOf(spot.bone, spot.localPoint)} center zIndexRange={[2, 1]}>
            <div
              className={`handle-dot is-${spot.kind}${isPinned ? ' is-pinned' : ''}`}
              role="button"
              aria-label={isPinned ? `${spot.label} (pinned)` : spot.label}
              title={isPinned ? `${spot.label}, pinned: right-click or hold to unpin` : `Drag the ${spot.label.toLowerCase()}`}
              onPointerDown={(event) => grabSpot(spot, event)}
              onContextMenu={(event) => {
                event.preventDefault();
                onMenu(spot.bone, event.clientX, event.clientY);
              }}
            />
          </Html>
        );
      })}

      {twistRing && selectedControl && twistMotion && (
        <group position={twistRing.center} quaternion={twistRing.quaternion}>
          <Ring radius={twistRing.radius} onPointerDown={(event) => startTwist(event, selectedControl, twistMotion, twistRing!.center, twistRing!.axis)} />
        </group>
      )}

      <group position={[x, lowest, z]}>
        <Ring radius={floorRadius} onPointerDown={(event) => startTwist(event, 'pelvis', 'turn', new Vector3(x, lowest, z), new Vector3(0, 1, 0))} />
      </group>
    </>
  );
}
// #endregion

// #region Helpers
function Ring({ radius, onPointerDown }: { radius: number; onPointerDown: (event: ThreeEvent<PointerEvent>) => void }) {
  return (
    <group rotation={[Math.PI / 2, 0, 0]}>
      <mesh renderOrder={RING_RENDER_ORDER}>
        <torusGeometry args={[radius, RING_LINE_METERS, 8, 64]} />
        <meshBasicMaterial color={RING_COLOR} depthTest={false} transparent opacity={0.85} />
      </mesh>
      <mesh visible={false} onPointerDown={onPointerDown}>
        <torusGeometry args={[radius, Math.min(radius * 0.3, RING_HIT_METERS), 6, 48]} />
      </mesh>
    </group>
  );
}

function spotsOf(rig: Rig): Spot[] {
  const boneNamed = (name: string) => rig.bones.find((bone) => bone.name === name)!;
  const spots: Spot[] = [];
  for (const side of ['l', 'r']) {
    const sideName = side === 'l' ? 'Left' : 'Right';
    const palm = boneNamed(`wrist_${side}`).shapes.find((shape) => shape.kind === 'capsule');
    const foot = boneNamed(`ankle_${side}`).shapes.find((shape) => shape.kind === 'capsule');
    if (palm?.kind === 'capsule') spots.push({ name: `hand_${side}`, label: `${sideName} hand`, bone: `wrist_${side}`, localPoint: palm.end, kind: 'end', pin: `hand_${side}` as Pin });
    if (foot?.kind === 'capsule') {
      const middle = foot.start.map((value, axis) => (value + foot.end[axis]) / 2);
      spots.push({ name: `foot_${side}`, label: `${sideName} foot`, bone: `ankle_${side}`, localPoint: middle as Vec3, kind: 'end', pin: `foot_${side}` as Pin });
    }
    spots.push({ name: `elbow_${side}`, label: `${sideName} elbow`, bone: `shoulder_${side}`, localPoint: boneNamed(`elbow_${side}`).offset, kind: 'joint' });
    spots.push({ name: `knee_${side}`, label: `${sideName} knee`, bone: `hip_${side}`, localPoint: boneNamed(`knee_${side}`).offset, kind: 'joint' });
  }
  const skull = boneNamed('head').shapes[0];
  spots.push({ name: 'head', label: 'Head', bone: 'head', localPoint: skull.kind === 'ellipsoid' ? skull.center : [0, 0.1, 0], kind: 'joint' });
  spots.push({ name: 'chest', label: 'Chest', bone: 'thoracic_upper', localPoint: boneNamed('neck').offset.map((value) => value / 2) as Vec3, kind: 'joint' });
  spots.push({ name: 'hips', label: 'Hips', bone: 'pelvis', localPoint: [0, 0, 0], kind: 'hips' });
  return spots;
}
// #endregion
