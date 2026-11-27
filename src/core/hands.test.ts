/*
 * Checks hand shapes: they land on the right hand, leave the rest of the pose alone, and really
 * close the hand (fist), bring the thumb and index tips together (pinch), and lay the thumb across the curled
 * fingers from the front, the way a real thumb holds them (peace, fist).
 * Run: npm test
 */

// #region Setup
import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { applyHandShape, HAND_SHAPES } from './hands.ts';
import { CONTROLS, forwardKinematics, solvePose, type Pose } from './pose.ts';
import { buildRig, type CharacterProfile } from './rig.ts';
import potat from '../../characters/potat.oc.json';
// #endregion

// #region Tests
describe('hand shapes', () => {
  const rig = buildRig(potat as CharacterProfile);
  const fingertip = (pose: Pose, bone: string) => {
    const world = forwardKinematics(rig, solvePose(pose));
    const shape = rig.bones.find((entry) => entry.name === bone)!.shapes.filter((entry) => entry.kind === 'capsule').at(-1);
    if (shape?.kind !== 'capsule') throw new Error(`${bone} has no capsule`);
    return new Vector3(...shape.end).applyQuaternion(world[bone].quaternion).add(world[bone].position);
  };
  const wristToIndexTip = (shape: string) => {
    const pose = applyHandShape({}, 'l', shape);
    return fingertip(pose, 'index_3_l').distanceTo(forwardKinematics(rig, solvePose(pose)).wrist_l.position);
  };

  it('only uses motions that exist, within their limits', () => {
    for (const [name, shape] of Object.entries(HAND_SHAPES)) {
      for (const [finger, angles] of Object.entries(shape.fingers)) {
        for (const [motion, degrees] of Object.entries(angles)) {
          const limits = CONTROLS[`${finger}_l`].motions[motion];
          expect(limits, `${name} ${finger} ${motion}`).toBeDefined();
          expect(degrees, `${name} ${finger} ${motion}`).toBeGreaterThanOrEqual(limits.min);
          expect(degrees, `${name} ${finger} ${motion}`).toBeLessThanOrEqual(limits.max);
        }
      }
    }
  });

  it('sets one hand or both, and keeps the rest of the pose', () => {
    const start: Pose = { position: [1, 0, 0], joints: { wrist_l: { flexion: 30 }, index_r: { base_flexion: 40 } } };
    const left = applyHandShape(start, 'l', 'fist');
    expect(left.joints?.index_l?.base_flexion).toBe(85);
    expect(left.joints?.index_r?.base_flexion).toBe(40);
    expect(left.joints?.wrist_l?.flexion).toBe(30);
    expect(left.position).toEqual([1, 0, 0]);

    const both = applyHandShape(start, 'both', 'flat');
    expect(both.joints?.index_l).toBeUndefined();
    expect(both.joints?.index_r).toBeUndefined();
  });

  it('makes the same shape on the right hand as on the left, mirrored', () => {
    const pose = applyHandShape({}, 'both', 'point');
    const left = fingertip(pose, 'index_3_l');
    const right = fingertip(pose, 'index_3_r');
    expect(right.x).toBeCloseTo(-left.x, 5);
    expect(right.y).toBeCloseTo(left.y, 5);
    expect(right.z).toBeCloseTo(left.z, 5);
  });

  it('closes the hand for a fist and opens it when flat', () => {
    expect(wristToIndexTip('fist')).toBeLessThan(wristToIndexTip('relaxed'));
    expect(wristToIndexTip('relaxed')).toBeLessThan(wristToIndexTip('flat'));
    expect(wristToIndexTip('fist')).toBeLessThan(0.6 * wristToIndexTip('flat'));
  });

  it('brings the thumb and index tips together for a pinch', () => {
    const pose = applyHandShape({}, 'r', 'pinch');
    const gap = fingertip(pose, 'thumb_3_r').distanceTo(fingertip(pose, 'index_3_r'));
    expect(gap).toBeLessThan(0.025);
  });

  it('lays the thumb on the front of the curled fingers it holds down, pointing across the hand', () => {
    // Potat's left palm faces -X and its little finger is on the -Z side.
    for (const [shape, heldFinger] of [['peace', 'ring_2_l'], ['fist', 'middle_2_l'], ['point', 'middle_2_l']]) {
      const pose = applyHandShape({}, 'l', shape);
      const world = forwardKinematics(rig, solvePose(pose));
      const thumbPad = world.thumb_3_l.position.clone().lerp(fingertip(pose, 'thumb_3_l'), 0.6);
      const held = world[heldFinger].position.clone().lerp(fingertip(pose, heldFinger), 0.5);
      // Centre to centre: the thumb and finger thicknesses take about 2 cm of this.
      expect(thumbPad.distanceTo(held)).toBeLessThan(0.045);
      expect(thumbPad.x).toBeLessThan(held.x);
      expect(fingertip(pose, 'thumb_3_l').sub(world.thumb_3_l.position).normalize().z).toBeLessThan(-0.4);
    }
  });

  it('names the known shapes when one is unknown', () => {
    expect(() => applyHandShape({}, 'l', 'wave')).toThrow(/fist/);
  });
});
// #endregion
