/*
 * Two characters holding hands. Both reach for a meeting point between them at a natural low height; one turns
 * its palm back and the other forward so the palms meet, and both close their fingers around the other hand.
 * A character that can't move (locked) stays as it is and the other one reaches for its hand.
 * touch() in body.ts can only bring one part to another; this does the two-sided version people expect.
 * Run the checks: npm test
 */

// #region Setup
import { Vector3 } from 'three';
import { forwardKinematics, solvePose, type Pose } from './pose.ts';
import { dragMotions, reach } from './reach.ts';
import type { PosedCharacter } from './body.ts';
import type { Vec3 } from './rig.ts';
// #endregion

// #region Types and config
export interface HoldResult {
  poses: [Pose, Pose];
  sides: [string, string];
  gapMeters: number;
}

// Palms turned to face back (pronation) on one side and forward on the other, so they meet palm to palm.
const PALM_TURN_DEGREES = 70;
// How far the meeting point sits in front of the shoulders' line (a share of the shorter arm), and above the
// lowest height both hands reach (a share of the shorter character).
const MEETING_FORWARD_SHARE_OF_ARM = 0.15;
const MEETING_LIFT_SHARE_OF_HEIGHT = 0.03;
// Most of a straight arm, so the meeting point is reachable without locking the elbows.
const REACH_SHARE_OF_ARM = 0.92;
const HOLDING_FINGERS: Record<string, Record<string, number>> = {
  thumb: { cmc_flexion: 15, cmc_abduction: 25, cmc_opposition: 20, mcp_flexion: 10, ip_flexion: 15 },
  index: { base_flexion: 40, middle_flexion: 45 },
  middle: { base_flexion: 45, middle_flexion: 50 },
  ring: { base_flexion: 50, middle_flexion: 50 },
  pinky: { base_flexion: 55, middle_flexion: 50 },
};
const SOLVE_ITERATIONS = 60;
// #endregion

// #region Main flow
export function holdHands(characters: PosedCharacter[], index: number, otherIndex: number, canMove: [boolean, boolean] = [true, true]): HoldResult {
  const pair = [characters[index], characters[otherIndex]];
  const worlds = pair.map((character) => forwardKinematics(character.rig, solvePose(character.pose)));
  const centers = worlds.map((world) => world.pelvis.position);

  // Each holds with the hand on the side that faces the other.
  const sides = pair.map((_, which) => {
    const other = centers[1 - which];
    const left = worlds[which].shoulder_l.position.distanceTo(other);
    const right = worlds[which].shoulder_r.position.distanceTo(other);
    return left < right ? 'l' : 'r';
  }) as [string, string];
  const shoulders = pair.map((_, which) => worlds[which][`shoulder_${sides[which]}`].position);
  const armLengths = pair.map((_, which) => worlds[which][`shoulder_${sides[which]}`].position.distanceTo(worlds[which][`wrist_${sides[which]}`].position));

  const facing = pair
    .map((character) => {
      const heading = ((character.pose.joints?.pelvis?.turn ?? 0) * Math.PI) / 180;
      return new Vector3(Math.sin(heading), 0, Math.cos(heading));
    })
    .reduce((sum, direction) => sum.add(direction), new Vector3());
  // Facing each other the directions cancel out; then "forward" is across the line between them.
  if (facing.lengthSq() < 0.01) facing.copy(shoulders[1].clone().sub(shoulders[0]).cross(new Vector3(0, 1, 0)));
  facing.setY(0).normalize();

  // Along the line between the shoulders, each arm takes its share by length, so a short arm isn't overstretched.
  const shareOfFirst = armLengths[0] / (armLengths[0] + armLengths[1]);
  const meeting = shoulders[0].clone().lerp(shoulders[1], shareOfFirst).addScaledVector(facing, MEETING_FORWARD_SHARE_OF_ARM * Math.min(...armLengths));
  // Each arm reaches a band of heights at that spot; take the lowest height both reach, a little above a hanging hand.
  const bands = pair.map((_, which) => {
    const horizontal = Math.hypot(meeting.x - shoulders[which].x, meeting.z - shoulders[which].z);
    const vertical = Math.sqrt(Math.max(0, (REACH_SHARE_OF_ARM * armLengths[which]) ** 2 - horizontal ** 2));
    return { low: shoulders[which].y - vertical, high: shoulders[which].y + vertical };
  });
  const heights = worlds.map((world) => world.head.position.y);
  const lowest = Math.max(...bands.map((band) => band.low));
  const highest = Math.min(...bands.map((band) => band.high));
  meeting.y = lowest <= highest ? Math.min(highest, lowest + MEETING_LIFT_SHARE_OF_HEIGHT * Math.min(...heights)) : (lowest + highest) / 2;

  // A locked character keeps its hand where it is; the other comes to it.
  if (!canMove[0] || !canMove[1]) {
    const still = canMove[0] ? 1 : 0;
    meeting.copy(palmCenter(pair[still], worlds[still], sides[still]));
  }

  const palmGap = 0.5 * palmThickness(pair[0], sides[0]) + 0.5 * palmThickness(pair[1], sides[1]);
  const poses = pair.map((character, which) => {
    if (!canMove[which]) return character.pose;
    const side = sides[which];
    // The first one's palm faces back and sits in front; the second's faces forward and sits behind.
    const palmTurn = which === 0 ? PALM_TURN_DEGREES : -PALM_TURN_DEGREES;
    const target = meeting.clone().addScaledVector(facing, which === 0 ? palmGap / 2 : -palmGap / 2);
    const joints = { ...character.pose.joints, [`elbow_${side}`]: { ...character.pose.joints?.[`elbow_${side}`], pronation: palmTurn } };
    for (const [finger, angles] of Object.entries(HOLDING_FINGERS)) joints[`${finger}_${side}`] = angles;
    const palm = palmLocalPoint(character, side);
    return reach(character.rig, { ...character.pose, joints }, [{ bone: `wrist_${side}`, point: palm, target: target.toArray() as Vec3 }], dragMotions(`wrist_${side}`), SOLVE_ITERATIONS);
  }) as [Pose, Pose];

  const finalPalms = pair.map((character, which) => palmCenter(character, forwardKinematics(character.rig, solvePose(poses[which])), sides[which]));
  return { poses, sides, gapMeters: Math.max(0, finalPalms[0].distanceTo(finalPalms[1]) - palmGap) };
}
// #endregion

// #region Helpers
// The middle of the palm, where one hand holds another.
function palmLocalPoint(character: PosedCharacter, side: string): Vec3 {
  const palm = character.rig.bones.find((bone) => bone.name === `wrist_${side}`)!.shapes.find((shape) => shape.kind === 'capsule');
  if (palm?.kind !== 'capsule') return [0, 0, 0];
  return palm.start.map((value, axis) => (value + palm.end[axis]) / 2) as Vec3;
}

function palmCenter(character: PosedCharacter, world: ReturnType<typeof forwardKinematics>, side: string): Vector3 {
  const wrist = world[`wrist_${side}`];
  return new Vector3(...palmLocalPoint(character, side)).applyQuaternion(wrist.quaternion).add(wrist.position);
}

function palmThickness(character: PosedCharacter, side: string): number {
  const palm = character.rig.bones.find((bone) => bone.name === `wrist_${side}`)!.shapes.find((shape) => shape.kind === 'capsule');
  if (palm?.kind !== 'capsule') return 0.03;
  return 2 * palm.radiusEnd * (palm.squash?.[0] ?? 1);
}
// #endregion
