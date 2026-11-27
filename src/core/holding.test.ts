/*
 * Checks holding hands: side by side, each uses the hand toward the other, the palms meet, the fingers close,
 * a tall and a small character still reach, and a locked character doesn't move.
 * Run: npm test
 */

// #region Setup
import { describe, expect, it } from 'vitest';
import { holdHands } from './holding.ts';
import { buildRig, type CharacterProfile } from './rig.ts';
import type { PosedCharacter } from './body.ts';
import potat from '../../characters/potat.oc.json';
import bush from '../../characters/bush.oc.json';
// #endregion

// #region Tests
describe('holding hands', () => {
  const standing = (profile: unknown, x: number): PosedCharacter => ({ name: 'someone', rig: buildRig(profile as CharacterProfile), pose: { position: [x, 0, 0] } });

  it('meets palm to palm with the hands that face each other, fingers closed', () => {
    const result = holdHands([standing(potat, 0), standing(potat, 0.9)], 0, 1);
    // A character at rest faces +Z, so its left side is +X: the one on the left holds with its left hand.
    expect(result.sides).toEqual(['l', 'r']);
    expect(result.gapMeters).toBeLessThan(0.03);
    expect(result.poses[0].joints!.index_l.base_flexion).toBeGreaterThan(20);
    expect(result.poses[1].joints!.elbow_r.pronation).toBeLessThan(0);
  });

  it('works for a tall and a small character', () => {
    const result = holdHands([standing(potat, 0), standing(bush, 0.75)], 0, 1);
    expect(result.gapMeters).toBeLessThan(0.05);
  });

  it('leaves a locked character as it is and brings the other to its hand', () => {
    const locked = standing(potat, 0.9);
    const result = holdHands([standing(potat, 0), locked], 0, 1, [true, false]);
    expect(result.poses[1]).toBe(locked.pose);
    expect(result.gapMeters).toBeLessThan(0.06);
  });
});
// #endregion
