/*
 * Checks direct posing: reaching targets with real joint limits, mirroring poses, standing on the floor.
 * Run: npm test
 */

// #region Setup
import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { buildRig, type CharacterProfile } from './rig.ts';
import { CONTROLS, copyLimbToOtherSide, forwardKinematics, mirrorPose, solvePose, type Pose } from './pose.ts';
import { dragMotions, dropToFloor, legMotions, reach } from './reach.ts';
import potat from '../../characters/potat.oc.json';
import bush from '../../characters/bush.oc.json';
// #endregion

// #region Tests
describe('reach', () => {
  const rig = buildRig(potat as CharacterProfile);
  const worldOf = (pose: Pose) => forwardKinematics(rig, solvePose(pose));

  it('moves the hand to a point in front of the chest', () => {
    const rest = worldOf({});
    const target = rest.thoracic_upper.position.clone().add(new Vector3(0.15, 0, 0.35));
    const posed = reach(rig, {}, [{ bone: 'wrist_l', point: [0, 0, 0], target: target.toArray() }], dragMotions('wrist_l'));
    expect(worldOf(posed).wrist_l.position.distanceTo(target)).toBeLessThan(0.01);
    expect(posed.joints!.elbow_l.flexion).toBeGreaterThan(20);
  });

  it('never bends a joint past its limit, even for a target out of reach', () => {
    const posed = reach(rig, {}, [{ bone: 'wrist_l', point: [0, 0, 0], target: [5, 5, 5] }], dragMotions('wrist_l'));
    for (const { control, motion } of dragMotions('wrist_l')) {
      const limits = CONTROLS[control].motions[motion];
      const degrees = posed.joints![control][motion];
      expect(degrees).toBeGreaterThanOrEqual(limits.min);
      expect(degrees).toBeLessThanOrEqual(limits.max);
    }
  });

  it('keeps the feet planted while the hips go down into a squat', () => {
    const rest = worldOf({});
    const lowered: Pose = { position: [0, -0.25, -0.2] };
    const goals = (side: string) => [
      { bone: `ankle_${side}`, point: [0, 0, 0] as [number, number, number], target: rest[`ankle_${side}`].position.toArray() },
      { bone: `toes_${side}`, point: [0, 0, 0] as [number, number, number], target: rest[`toes_${side}`].position.toArray() },
    ];
    let posed = reach(rig, lowered, goals('l'), legMotions('l', true), 30);
    posed = reach(rig, posed, goals('r'), legMotions('r', true), 30);
    const world = worldOf(posed);
    expect(world.ankle_l.position.distanceTo(rest.ankle_l.position)).toBeLessThan(0.01);
    expect(world.toes_r.position.distanceTo(rest.toes_r.position)).toBeLessThan(0.01);
    expect(posed.joints!.knee_l.flexion).toBeGreaterThan(40);
  });

  it('dragging the forearm only bends the elbow', () => {
    expect(dragMotions('elbow_r')).toEqual([{ control: 'elbow_r', motion: 'flexion' }]);
  });
});

describe('mirror pose', () => {
  const pose: Pose = { joints: { shoulder_l: { abduction: 80 }, knee_r: { flexion: 30 }, lumbar: { side_bend: 10, flexion: 20 }, pelvis: { turn: 45 } } };

  it('copies the left side onto the right', () => {
    const mirrored = mirrorPose(pose, 'left-to-right');
    expect(mirrored.joints!.shoulder_r).toEqual({ abduction: 80 });
    expect(mirrored.joints!.knee_r).toBeUndefined();
    expect(mirrored.joints!.lumbar).toEqual(pose.joints!.lumbar);
  });

  it('copies one arm or leg onto the other side and leaves the rest', () => {
    const withHand: Pose = { joints: { ...pose.joints, index_l: { base_flexion: 60 }, elbow_r: { flexion: 90 } } };
    const copied = copyLimbToOtherSide(withHand, 'index_l');
    expect(copied.joints!.shoulder_r).toEqual({ abduction: 80 });
    expect(copied.joints!.index_r).toEqual({ base_flexion: 60 });
    expect(copied.joints!.elbow_r).toBeUndefined();
    expect(copied.joints!.knee_r).toEqual({ flexion: 30 });
    expect(copyLimbToOtherSide(withHand, 'knee_r').joints!.knee_l).toEqual({ flexion: 30 });
  });

  it('flips sides, bends the spine the other way and keeps the heading', () => {
    const flipped = mirrorPose(pose, 'flip');
    expect(flipped.joints!.shoulder_r).toEqual({ abduction: 80 });
    expect(flipped.joints!.shoulder_l).toBeUndefined();
    expect(flipped.joints!.knee_l).toEqual({ flexion: 30 });
    expect(flipped.joints!.lumbar).toEqual({ side_bend: -10, flexion: 20 });
    expect(flipped.joints!.pelvis).toEqual({ turn: 45 });
  });
});

describe('drop to floor', () => {
  it('leaves a standing character where it is', () => {
    const rig = buildRig(bush as CharacterProfile);
    expect(dropToFloor(rig, {}).position![1]).toBeCloseTo(0, 2);
  });

  it('lowers a kneeling character until it touches the floor', () => {
    const rig = buildRig(potat as CharacterProfile);
    const kneeling = dropToFloor(rig, { joints: { knee_l: { flexion: 90 }, knee_r: { flexion: 90 } } });
    expect(kneeling.position![1]).toBeLessThan(-0.2);
    expect(dropToFloor(rig, kneeling).position![1]).toBeCloseTo(kneeling.position![1], 3);
  });
});
// #endregion
