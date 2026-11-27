/*
 * Checks props: their boxes sit where the file says, odd files are cleaned up, and "Drop to floor"
 * lands a character on a seat or a step but not on top of a wall it stands next to.
 * Run: npm test
 */

// #region Setup
import { describe, expect, it } from 'vitest';
import { newProp, normalizeProp, propBoxes } from './props.ts';
import { dropToFloor } from './reach.ts';
import { buildRig, type CharacterProfile } from './rig.ts';
import bush from '../../characters/bush.oc.json';
import potat from '../../characters/potat.oc.json';
import sitOnChair from '../../poses/sit-chair.pose.json';
// #endregion

// #region Tests
describe('props', () => {
  it('builds a chair from a seat, four legs and a back on its -Z side, turned with the prop', () => {
    const chair = newProp('chair', [1, 0, 2]);
    const boxes = propBoxes(chair);
    expect(boxes).toHaveLength(6);
    const seatTop = Math.max(...boxes.slice(0, 5).map((box) => box.center[1] + box.halfSize[1]));
    expect(seatTop).toBeCloseTo(chair.size[1], 5);
    expect(boxes[5].center[2]).toBeLessThan(2);

    const turned = propBoxes({ ...chair, turn: 180 });
    expect(turned[5].center[2]).toBeGreaterThan(2);
    expect(turned[5].center[0]).toBeCloseTo(1, 5);
  });

  it('cleans up props from files: unknown kinds, missing numbers, silly sizes', () => {
    const prop = normalizeProp({ kind: 'sofa' as never, position: [1, 'x' as never, 2] as never, size: [100, -1, 0.3] as never, color: 'red' });
    expect(prop.kind).toBe('box');
    expect(prop.position).toEqual([1, 0, 2]);
    expect(prop.size).toEqual([5, 0.05, 0.3]);
    expect(prop.color).toMatch(/^#/);
  });

  it('drops a small sitting character onto a chair seat, feet hanging', () => {
    const rig = buildRig(bush as CharacterProfile);
    const pose = { position: [0, 0, 0] as [number, number, number], joints: sitOnChair.joints };
    const onFloor = dropToFloor(rig, pose);
    const onChair = dropToFloor(rig, pose, propBoxes(newProp('chair', [0, 0, 0])));
    expect(onChair.position![1]).toBeGreaterThan(onFloor.position![1] + 0.1);
  });

  it('steps up onto a step under the feet, but not onto a wall next to the body', () => {
    const rig = buildRig(potat as CharacterProfile);
    const standing = { position: [0, 0, 0] as [number, number, number] };
    const step = newProp('step', [0, 0, 0]);
    expect(dropToFloor(rig, standing, propBoxes(step)).position![1]).toBeCloseTo(step.size[1], 2);

    const wall = newProp('wall', [0, 0, -0.2]);
    expect(dropToFloor(rig, standing, propBoxes(wall)).position![1]).toBeCloseTo(0, 2);
  });
});
// #endregion
