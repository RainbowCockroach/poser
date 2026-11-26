/*
 * Pose = anatomical joint angles in degrees, e.g. { joints: { elbow_l: { flexion: 90 } } }.
 * Each control (elbow_l, lumbar, index_l...) has named motions with a positive direction
 * (flexion, abduction, internal_rotation...) and limits from normal human range of motion.
 * Coupled movement like a real body:
 *   - a spine bend spreads over two vertebra segments, the neck over neck and head
 *   - the last finger knuckle follows the middle one at 2/3
 *   - raising an arm lifts the shoulder girdle (scapulohumeral rhythm, about 2:1 above 30 degrees)
 * Shoulder angles are measured against the chest, so the girdle lift never changes where the arm points.
 * Run the checks: npm test
 */

// #region Setup
import { Euler, Quaternion, Vector3 } from 'three';
import type { Rig, Vec3 } from './rig';
// #endregion

// #region Types
export interface Pose {
  position?: Vec3;
  joints?: Record<string, Record<string, number>>;
}

export interface Motion {
  axis: Vec3;
  min: number;
  max: number;
  bones: [bone: string, share: number][];
}

export interface Control {
  label: string;
  motions: Record<string, Motion>;
}

export interface SolvedPose {
  position: Vec3;
  rotations: Record<string, Quaternion>;
}

export interface PoseFile {
  format: 'poser.pose/1';
  name: string;
  joints: Record<string, Record<string, number>>;
}

export type MirrorMode = 'left-to-right' | 'right-to-left' | 'flip';

export interface BoneWorld {
  position: Vector3;
  quaternion: Quaternion;
}
// #endregion

// #region Config
// Defined for the left side and midline; right-side controls are mirrored below.
// Axes are in the bone's rest frame (see rig.ts): a positive angle moves the body part in the named direction.
const LEFT_AND_MIDLINE_CONTROLS: Record<string, Control> = {
  pelvis: {
    label: 'Pelvis (whole body)',
    motions: {
      turn: { axis: [0, 1, 0], min: -180, max: 180, bones: [['pelvis', 1]] },
      forward_tilt: { axis: [1, 0, 0], min: -90, max: 90, bones: [['pelvis', 1]] },
      side_tilt: { axis: [0, 0, -1], min: -90, max: 90, bones: [['pelvis', 1]] },
    },
  },
  lumbar: {
    label: 'Lower back',
    motions: {
      flexion: { axis: [1, 0, 0], min: -20, max: 50, bones: [['lumbar_lower', 0.5], ['lumbar_upper', 0.5]] },
      side_bend: { axis: [0, 0, -1], min: -20, max: 20, bones: [['lumbar_lower', 0.5], ['lumbar_upper', 0.5]] },
      rotation: { axis: [0, 1, 0], min: -10, max: 10, bones: [['lumbar_lower', 0.5], ['lumbar_upper', 0.5]] },
    },
  },
  thoracic: {
    label: 'Upper back / chest',
    motions: {
      flexion: { axis: [1, 0, 0], min: -15, max: 30, bones: [['thoracic_lower', 0.5], ['thoracic_upper', 0.5]] },
      side_bend: { axis: [0, 0, -1], min: -15, max: 15, bones: [['thoracic_lower', 0.5], ['thoracic_upper', 0.5]] },
      rotation: { axis: [0, 1, 0], min: -35, max: 35, bones: [['thoracic_lower', 0.5], ['thoracic_upper', 0.5]] },
    },
  },
  neck: {
    label: 'Neck and head',
    motions: {
      flexion: { axis: [1, 0, 0], min: -55, max: 45, bones: [['neck', 0.6], ['head', 0.4]] },
      side_bend: { axis: [0, 0, -1], min: -40, max: 40, bones: [['neck', 0.6], ['head', 0.4]] },
      // Most head turning happens at the top vertebra (C1-C2), so the head bone takes the larger share.
      rotation: { axis: [0, 1, 0], min: -70, max: 70, bones: [['neck', 0.4], ['head', 0.6]] },
    },
  },
  shoulder_girdle_l: {
    label: 'Left shoulder girdle (shrug)',
    motions: {
      elevation: { axis: [0, 0, 1], min: -10, max: 35, bones: [['clavicle_l', 1]] },
      protraction: { axis: [0, -1, 0], min: -20, max: 20, bones: [['clavicle_l', 1]] },
    },
  },
  shoulder_l: {
    label: 'Left shoulder',
    motions: {
      flexion: { axis: [-1, 0, 0], min: -60, max: 180, bones: [['shoulder_l', 1]] },
      abduction: { axis: [0, 0, 1], min: -30, max: 180, bones: [['shoulder_l', 1]] },
      internal_rotation: { axis: [0, -1, 0], min: -90, max: 70, bones: [['shoulder_l', 1]] },
    },
  },
  elbow_l: {
    label: 'Left elbow and forearm',
    motions: {
      flexion: { axis: [-1, 0, 0], min: 0, max: 150, bones: [['elbow_l', 1]] },
      pronation: { axis: [0, -1, 0], min: -80, max: 80, bones: [['elbow_l', 1]] },
    },
  },
  wrist_l: {
    label: 'Left wrist',
    motions: {
      flexion: { axis: [0, 0, -1], min: -70, max: 80, bones: [['wrist_l', 1]] },
      radial_deviation: { axis: [-1, 0, 0], min: -30, max: 20, bones: [['wrist_l', 1]] },
    },
  },
  thumb_l: {
    label: 'Left thumb',
    motions: {
      cmc_flexion: { axis: [1, 0, 0], min: -10, max: 50, bones: [['thumb_1_l', 1]] },
      cmc_abduction: { axis: [0, 0, -1], min: -10, max: 70, bones: [['thumb_1_l', 1]] },
      mcp_flexion: { axis: [0.4, 0, -0.92], min: 0, max: 55, bones: [['thumb_2_l', 1]] },
      ip_flexion: { axis: [0.4, 0, -0.92], min: -15, max: 80, bones: [['thumb_3_l', 1]] },
    },
  },
  index_l: fingerControl('Left index finger', 'index', [-1, 0, 0]),
  middle_l: fingerControl('Left middle finger', 'middle', [-1, 0, 0]),
  ring_l: fingerControl('Left ring finger', 'ring', [1, 0, 0]),
  pinky_l: fingerControl('Left pinky', 'pinky', [1, 0, 0]),
  hip_l: {
    label: 'Left hip',
    motions: {
      flexion: { axis: [-1, 0, 0], min: -20, max: 120, bones: [['hip_l', 1]] },
      abduction: { axis: [0, 0, 1], min: -30, max: 45, bones: [['hip_l', 1]] },
      internal_rotation: { axis: [0, -1, 0], min: -45, max: 45, bones: [['hip_l', 1]] },
    },
  },
  knee_l: {
    label: 'Left knee',
    motions: {
      flexion: { axis: [1, 0, 0], min: 0, max: 135, bones: [['knee_l', 1]] },
    },
  },
  ankle_l: {
    label: 'Left ankle',
    motions: {
      // 20 degrees is the textbook passive value; standing with the body weight on it (lunge, deep squat) the ankle bends about 35.
      dorsiflexion: { axis: [-1, 0, 0], min: -50, max: 35, bones: [['ankle_l', 1]] },
      inversion: { axis: [0, 0, -1], min: -15, max: 35, bones: [['ankle_l', 1]] },
    },
  },
  toes_l: {
    label: 'Left toes',
    motions: {
      flexion: { axis: [1, 0, 0], min: -60, max: 40, bones: [['toes_l', 1]] },
    },
  },
};

export const CONTROLS: Record<string, Control> = mirrorControls(LEFT_AND_MIDLINE_CONTROLS);

export const CONTROL_FOR_BONE: Record<string, string> = Object.fromEntries(
  Object.entries(CONTROLS)
    .flatMap(([controlName, control]) =>
      Object.values(control.motions).flatMap((motion) => motion.bones.map(([bone]) => [bone, controlName] as const)),
    )
    .reverse(),
);

const ARM_LIFT_BEFORE_GIRDLE_MOVES = 30;
const MAX_AUTOMATIC_GIRDLE_ELEVATION = 30;
// #endregion

// #region Main flow
export function solvePose(pose: Pose, options: { ignoreLimits?: boolean } = {}): SolvedPose {
  // Per bone: a swing (where the segment points) and a twist (turn around its own long Y axis).
  const swings: Record<string, { sum: Vector3; largestDegrees: number }> = {};
  const twistDegrees: Record<string, number> = {};

  for (const [controlName, control] of Object.entries(CONTROLS)) {
    const angles = pose.joints?.[controlName];
    if (!angles) continue;

    for (const [motionName, motion] of Object.entries(control.motions)) {
      const requested = angles[motionName];
      if (!requested) continue;
      const degrees = options.ignoreLimits ? requested : Math.min(motion.max, Math.max(motion.min, requested));
      const axis = new Vector3(...motion.axis).normalize();
      const isTwist = Math.abs(axis.y) === 1;
      for (const [bone, share] of motion.bones) {
        if (isTwist) {
          twistDegrees[bone] = (twistDegrees[bone] ?? 0) + degrees * share * axis.y;
          continue;
        }
        swings[bone] ??= { sum: new Vector3(), largestDegrees: 0 };
        swings[bone].sum.addScaledVector(axis, degrees * share);
        swings[bone].largestDegrees = Math.max(swings[bone].largestDegrees, Math.abs(degrees * share));
      }
    }
  }

  const rotations: Record<string, Quaternion> = {};
  for (const bone of new Set([...Object.keys(swings), ...Object.keys(twistDegrees)])) {
    // Combined swing turns by the largest single angle, toward the blend of the motions:
    // flexion 90 + abduction 90 = horizontal, halfway between front and side.
    const hasSwing = swings[bone] && swings[bone].sum.lengthSq() > 1e-12;
    const swing = hasSwing ? new Quaternion().setFromAxisAngle(swings[bone].sum.clone().normalize(), (swings[bone].largestDegrees * Math.PI) / 180) : new Quaternion();
    const twist = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), ((twistDegrees[bone] ?? 0) * Math.PI) / 180);
    // The pelvis turn is a heading in the world, so it goes outside the tilt; every other twist is around the bent segment.
    rotations[bone] = bone === 'pelvis' ? twist.multiply(swing) : swing.multiply(twist);
  }

  for (const side of ['l', 'r']) {
    const arm = rotations[`shoulder_${side}`] ?? new Quaternion();
    const armDirection = new Vector3(0, -1, 0).applyQuaternion(arm);
    const armLiftDegrees = (armDirection.angleTo(new Vector3(0, -1, 0)) * 180) / Math.PI;
    const liftShare = Math.min(1, Math.max(0, (armLiftDegrees - ARM_LIFT_BEFORE_GIRDLE_MOVES) / (180 - ARM_LIFT_BEFORE_GIRDLE_MOVES)));
    const elevationAxis = new Vector3(...CONTROLS[`shoulder_girdle_${side}`].motions.elevation.axis);
    const automaticLift = new Quaternion().setFromAxisAngle(elevationAxis, (liftShare * MAX_AUTOMATIC_GIRDLE_ELEVATION * Math.PI) / 180);

    const girdle = (rotations[`clavicle_${side}`] ?? new Quaternion()).clone().multiply(automaticLift);
    rotations[`clavicle_${side}`] = girdle;
    rotations[`shoulder_${side}`] = girdle.clone().invert().multiply(arm);
  }

  return { position: pose.position ?? [0, 0, 0], rotations };
}

export function forwardKinematics(rig: Rig, solved: SolvedPose): Record<string, BoneWorld> {
  const world: Record<string, BoneWorld> = {};
  for (const bone of rig.bones) {
    const local = restRotation(bone.restRotationDegrees).multiply(solved.rotations[bone.name] ?? new Quaternion());
    const offset = new Vector3(...bone.offset);
    if (!bone.parent) {
      world[bone.name] = { position: offset.add(new Vector3(...solved.position)), quaternion: local };
      continue;
    }
    const parent = world[bone.parent];
    world[bone.name] = {
      position: offset.applyQuaternion(parent.quaternion).add(parent.position),
      quaternion: parent.quaternion.clone().multiply(local),
    };
  }
  return world;
}

export function mirrorPose(pose: Pose, mode: MirrorMode): Pose {
  const joints: Record<string, Record<string, number>> = {};
  for (const [controlName, angles] of Object.entries(pose.joints ?? {})) {
    const side = controlName.match(/_(l|r)$/)?.[1];
    const otherSide = controlName.replace(/_(l|r)$/, side === 'l' ? '_r' : '_l');

    if (!side) {
      if (mode !== 'flip') {
        joints[controlName] = angles;
        continue;
      }
      // A midline bend or turn to the left becomes the same to the right; forward stays forward. The heading stays.
      const flipped: Record<string, number> = {};
      for (const [motionName, degrees] of Object.entries(angles)) {
        const isSideways = CONTROLS[controlName]?.motions[motionName]?.axis[0] === 0;
        flipped[motionName] = isSideways && !(controlName === 'pelvis' && motionName === 'turn') ? -degrees : degrees;
      }
      joints[controlName] = flipped;
      continue;
    }

    // Right-side controls are defined as mirror images, so the same angles mean the mirrored motion.
    if (mode === 'flip') joints[otherSide] = angles;
    if (mode === 'left-to-right' && side === 'l') joints[controlName] = joints[otherSide] = angles;
    if (mode === 'right-to-left' && side === 'r') joints[controlName] = joints[otherSide] = angles;
  }
  return { ...pose, joints };
}

export function restRotation(degrees: Vec3 | undefined): Quaternion {
  if (!degrees) return new Quaternion();
  const toRadians = Math.PI / 180;
  return new Quaternion().setFromEuler(new Euler(degrees[0] * toRadians, degrees[1] * toRadians, degrees[2] * toRadians, 'XYZ'));
}
// #endregion

// #region Helpers
function fingerControl(label: string, finger: string, spreadAxis: Vec3): Control {
  return {
    label,
    motions: {
      base_flexion: { axis: [0, 0, -1], min: -30, max: 90, bones: [[`${finger}_1_l`, 1]] },
      spread: { axis: spreadAxis, min: -15, max: 20, bones: [[`${finger}_1_l`, 1]] },
      // The fingertip joint can't move on its own in a real hand; it follows the middle joint.
      middle_flexion: { axis: [0, 0, -1], min: 0, max: 100, bones: [[`${finger}_2_l`, 1], [`${finger}_3_l`, 0.67]] },
    },
  };
}

function mirrorControls(controls: Record<string, Control>): Record<string, Control> {
  const result: Record<string, Control> = {};
  for (const [name, control] of Object.entries(controls)) {
    result[name] = control;
    if (!name.endsWith('_l')) continue;

    const motions: Record<string, Motion> = {};
    for (const [motionName, motion] of Object.entries(control.motions)) {
      motions[motionName] = {
        ...motion,
        // A mirrored rotation keeps its X component and flips Y and Z, so "abduction" still means "away from the body".
        axis: [motion.axis[0], -motion.axis[1], -motion.axis[2]],
        bones: motion.bones.map(([bone, share]) => [bone.replace(/_l$/, '_r'), share]),
      };
    }
    result[name.replace(/_l$/, '_r')] = { label: control.label.replace(/^Left/, 'Right'), motions };
  }
  return result;
}
// #endregion
