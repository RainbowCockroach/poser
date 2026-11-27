/*
 * Checks that the rig is the right height and that joints move the anatomical way.
 * Run: npm test
 */

// #region Setup
import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { buildRig, type CharacterProfile } from './rig.ts';
import { forwardKinematics, solvePose, type Pose } from './pose.ts';
import potat from '../../characters/potat.oc.json';
import seana from '../../characters/seana.oc.json';
import notMad from '../../characters/not-mad.oc.json';
import bush from '../../characters/bush.oc.json';
// #endregion

// #region Config
const CHARACTERS = [potat, seana, notMad, bush] as CharacterProfile[];
// #endregion

// #region Tests
describe('rig proportions', () => {
  for (const profile of CHARACTERS) {
    it(`${profile.name} is exactly ${profile.heightCm} cm and stands on the ground`, () => {
      const rig = buildRig(profile);
      const world = forwardKinematics(rig, solvePose({}));
      const headBone = rig.bones.find((bone) => bone.name === 'head')!;
      const skull = headBone.shapes[0];
      if (skull.kind !== 'ellipsoid') throw new Error('Head shape changed');
      const crown = world.head.position.y + skull.center[1] + skull.radii[1];
      expect(crown).toBeCloseTo(profile.heightCm / 100, 2);

      const footBone = rig.bones.find((bone) => bone.name === 'ankle_l')!;
      const foot = footBone.shapes[1];
      if (foot.kind !== 'capsule') throw new Error('Foot shape changed');
      const sole = world.ankle_l.position.y + foot.start[1] - foot.radiusStart * foot.squash![1];
      expect(sole).toBeCloseTo(0, 2);
    });
  }

  it('Bush is a chibi: head is over a quarter of the height', () => {
    const rig = buildRig(bush as CharacterProfile);
    expect(rig.headHeight / rig.heightMeters).toBeGreaterThan(0.25);
  });
});

describe('joint motions', () => {
  const rig = buildRig(potat as CharacterProfile);
  const pointAt = (pose: Pose, from: string, to: string) => {
    const world = forwardKinematics(rig, solvePose(pose));
    return world[to].position.clone().sub(world[from].position).normalize();
  };

  it('elbow flexion brings the forearm forward', () => {
    const direction = pointAt({ joints: { elbow_l: { flexion: 90 } } }, 'elbow_l', 'wrist_l');
    expect(direction.z).toBeCloseTo(1, 3);
  });

  it('knee flexion sends the shin backward', () => {
    const direction = pointAt({ joints: { knee_r: { flexion: 90 } } }, 'knee_r', 'ankle_r');
    expect(direction.z).toBeCloseTo(-1, 3);
  });

  it('abduction moves each arm away from the body on its own side', () => {
    const leftArm = pointAt({ joints: { shoulder_l: { abduction: 90 } } }, 'shoulder_l', 'elbow_l');
    const rightArm = pointAt({ joints: { shoulder_r: { abduction: 90 } } }, 'shoulder_r', 'elbow_r');
    expect(leftArm.x).toBeCloseTo(1, 3);
    expect(rightArm.x).toBeCloseTo(-1, 3);
  });

  it('flexion plus abduction points the arm halfway between front and side', () => {
    const direction = pointAt({ joints: { shoulder_l: { flexion: 90, abduction: 90 } } }, 'shoulder_l', 'elbow_l');
    expect(direction.y).toBeCloseTo(0, 3);
    expect(direction.x).toBeCloseTo(direction.z, 3);
  });

  it('the pelvis turn stays a heading when the body tilts forward', () => {
    const world = forwardKinematics(rig, solvePose({ joints: { pelvis: { turn: 90, forward_tilt: 30 } } }));
    const up = new Vector3(0, 1, 0).applyQuaternion(world.pelvis.quaternion);
    expect(up.x).toBeGreaterThan(0.4);
  });

  it('raising the arm lifts the shoulder girdle but the arm still points straight up', () => {
    const rest = forwardKinematics(rig, solvePose({}));
    const raisedPose = { joints: { shoulder_l: { flexion: 180 } } };
    const raised = forwardKinematics(rig, solvePose(raisedPose));
    expect(raised.shoulder_l.position.y).toBeGreaterThan(rest.shoulder_l.position.y + 0.02);
    expect(pointAt(raisedPose, 'shoulder_l', 'elbow_l').y).toBeCloseTo(1, 3);
  });

  it('limits clamp impossible angles', () => {
    const overBent = pointAt({ joints: { elbow_l: { flexion: 300 } } }, 'elbow_l', 'wrist_l');
    const maxBent = pointAt({ joints: { elbow_l: { flexion: 150 } } }, 'elbow_l', 'wrist_l');
    expect(overBent.distanceTo(maxBent)).toBeLessThan(1e-6);
  });

  it('turning the head left makes the face point to the character left (+X)', () => {
    const world = forwardKinematics(rig, solvePose({ joints: { neck: { rotation: 70 } } }));
    const facing = new Vector3(0, 0, 1).applyQuaternion(world.head.quaternion);
    expect(facing.x).toBeGreaterThan(0.9);
  });

  it('the fingertip follows the middle finger joint', () => {
    const solved = solvePose({ joints: { index_l: { middle_flexion: 90 } } });
    const middleAngle = 2 * Math.acos(solved.rotations.index_2_l.w);
    const tipAngle = 2 * Math.acos(solved.rotations.index_3_l.w);
    expect(tipAngle / middleAngle).toBeCloseTo(0.67, 2);
  });
});
// #endregion
