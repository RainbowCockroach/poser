/*
 * Checks body contact: overlapping parts are found, pushed apart, and touch() lands one part on another.
 * Run: npm test
 */

// #region Setup
import { describe, expect, it } from 'vitest';
import { buildRig, type CharacterProfile } from './rig.ts';
import { findOverlaps, separate, touch, type PosedCharacter } from './body.ts';
import { forwardKinematics, solvePose } from './pose.ts';
import potat from '../../characters/potat.oc.json';
import bush from '../../characters/bush.oc.json';
import seana from '../../characters/seana.oc.json';
import notMad from '../../characters/not-mad.oc.json';
// #endregion

// #region Tests
// Leaning solves the whole body from several starts, about a second per character; CI runners are slower.
const LEAN_TEST_TIMEOUT = 30_000;

describe('body contact', () => {
  const samples = [potat, bush, seana, notMad].map((profile) => ({ name: profile.name, rig: buildRig(profile as CharacterProfile), pose: {} }));
  const one = (character: PosedCharacter, pose = character.pose) => [{ ...character, pose }];

  it('finds nothing wrong with any sample character standing at rest', () => {
    for (const character of samples) expect(findOverlaps(one(character))).toEqual([]);
  });

  it('finds an arm pushed through the chest, and pushes it back out', () => {
    const [character] = samples;
    const through = { joints: { shoulder_l: { flexion: 30, abduction: -30, internal_rotation: 70 }, elbow_l: { flexion: 120 } } };
    const overlaps = findOverlaps(one(character, through));
    expect(overlaps.length).toBeGreaterThan(0);
    const fixed = separate(one(character, through), 0);
    expect(findOverlaps(one(character, fixed))).toEqual([]);
  });

  it('puts a hand on top of the own head', () => {
    for (const character of samples) {
      const result = touch(one(character), 0, 'hand_r', 0, 'head');
      expect(Math.abs(result.gapMeters)).toBeLessThan(0.01);
    }
  });

  it('puts a foot on the other knee', () => {
    const result = touch(one(samples[0]), 0, 'foot_l', 0, 'knee_r');
    expect(Math.abs(result.gapMeters)).toBeLessThan(0.03);
    expect(result.pose.joints!.knee_l.flexion).toBeGreaterThan(45);
  });

  // The hips of two standing bodies meet first, so the chests end up a few centimeters apart, like real people.
  it('slides a whole character up against the back of another', () => {
    const behind = { ...samples[0], pose: { position: [0, 0, -1] as [number, number, number] } };
    const result = touch([behind, { ...samples[0], pose: {} }], 0, 'chest', 1, 'chest', 'back');
    expect(Math.abs(result.gapMeters)).toBeLessThan(0.05);
    expect(result.pose.position![1]).toBe(0);
  });

  it('stops sliding when another part of the bodies meets first', () => {
    const behind = { ...samples[0], pose: { position: [0, 0, -1] as [number, number, number] } };
    const front = samples[2];
    const result = touch([behind, front], 0, 'chest', 1, 'chest', 'back');
    expect(result.pose.position![2]).toBeGreaterThan(-0.8);
    expect(findOverlaps([{ ...behind, pose: result.pose }, front]).filter((overlap) => overlap.character !== overlap.otherCharacter)).toEqual([]);
  });

  it('leans the whole body to reach the own foot standing, keeping the feet in place', () => {
    for (const character of samples) {
      const result = touch(one(character), 0, 'hand_r', 0, 'foot_r');
      expect(Math.abs(result.gapMeters), character.name).toBeLessThan(0.015);
      expect(result.pose.joints?.pelvis?.forward_tilt ?? 0, character.name).toBeGreaterThan(20);
      const before = forwardKinematics(character.rig, solvePose({}));
      const after = forwardKinematics(character.rig, solvePose(result.pose));
      for (const bone of ['ankle_l', 'ankle_r']) expect(after[bone].position.distanceTo(before[bone].position), `${character.name} ${bone}`).toBeLessThan(0.02);
    }
  }, LEAN_TEST_TIMEOUT);

  it('gets a standing hand to the own knee', () => {
    for (const character of samples) expect(Math.abs(touch(one(character), 0, 'hand_r', 0, 'knee_r').gapMeters), character.name).toBeLessThan(0.02);
  }, LEAN_TEST_TIMEOUT);

  it('says which body part names exist when given a wrong one', () => {
    expect(() => touch(one(samples[0]), 0, 'paw_l', 0, 'head')).toThrow(/hand_l/);
  });
});
// #endregion
