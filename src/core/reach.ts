/*
 * Where the body is in space, and how to move it there.
 *   reach():       change joint angles so body points land on targets (drag a hand, keep feet planted)
 *   dragMotions(): which joint angles a drag on a bone is allowed to change
 *   dropToFloor(): lift or lower a character so its lowest point touches the floor, or the top of a prop under it
 *   holdPins():    bend the arms and legs so pinned hands and feet go back to where they were
 * reach() works on the anatomical angles, not on raw rotations, so the result still respects
 * every joint limit and coupled motion of pose.ts. It is a damped least squares solve with a
 * numeric Jacobian (the whole body is cheap enough to re-solve per probe).
 * Run the checks: npm test
 */

// #region Setup
import { Vector3 } from 'three';
import { CONTROL_FOR_BONE, CONTROLS, forwardKinematics, solvePose, type Pose } from './pose.ts';
import type { Rig, Shape, Vec3 } from './rig.ts';
import type { PropBox } from './props.ts';
// #endregion

// #region Types
export interface ReachGoal {
  bone: string;
  point: Vec3;
  target: Vec3;
}

export interface ReachMotion {
  control: string;
  motion: string;
  weight?: number;
}

export type Pin = 'hand_l' | 'hand_r' | 'foot_l' | 'foot_r';
// #endregion

// #region Config
const PROBE_DEGREES = 0.5;
const MAX_STEP_DEGREES = 15;
const CLOSE_ENOUGH_METERS = 0.0005;
const STRAIGHT_HINGE_START_DEGREES = 5;
// Twisting around the segment's own axis is a last resort, so arms keep a natural elbow direction.
const TWIST_WEIGHT = 0.35;
const TWIST_MOTIONS = new Set(['turn', 'rotation', 'internal_rotation', 'pronation', 'cmc_opposition']);
// A body part this far below a prop's top still lands on it (a sitting pose settles onto the seat); deeper means it stands beside or inside it.
const LAND_ON_PROP_METERS = 0.25;
// #endregion

// #region Main flow
export function reach(rig: Rig, pose: Pose, goals: ReachGoal[], motions: ReachMotion[], iterations = 30): Pose {
  const angles = motions.map(({ control, motion }) => {
    const limits = CONTROLS[control].motions[motion];
    const current = Math.min(limits.max, Math.max(limits.min, pose.joints?.[control]?.[motion] ?? 0));
    // A fully straight knee or elbow can't tell which way to fold (its first move is sideways), so start slightly bent.
    return limits.min === 0 ? Math.max(current, STRAIGHT_HINGE_START_DEGREES) : current;
  });
  const weights = motions.map((motion) => motion.weight ?? 1);
  const targets = goals.flatMap((goal) => goal.target);

  const withAngles = (values: number[]): Pose => {
    const joints = { ...pose.joints };
    motions.forEach(({ control, motion }, index) => {
      joints[control] = { ...joints[control], [motion]: values[index] };
    });
    return { ...pose, joints };
  };
  const effectorPositions = (values: number[]): number[] => {
    const world = forwardKinematics(rig, solvePose(withAngles(values)));
    return goals.flatMap((goal) => new Vector3(...goal.point).applyQuaternion(world[goal.bone].quaternion).add(world[goal.bone].position).toArray());
  };
  const errorOf = (positions: number[]) => targets.map((target, index) => target - positions[index]);
  const sizeOf = (vector: number[]) => Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));

  let positions = effectorPositions(angles);
  let error = errorOf(positions);
  // Damping in meters per degree: small = fast but jumpy near the edge of reach, large = slow and smooth.
  let damping = 0.004;

  for (let iteration = 0; iteration < iterations; iteration++) {
    if (Math.max(...error.map(Math.abs)) < CLOSE_ENOUGH_METERS) break;

    const jacobianColumns = angles.map((angle, index) => {
      const limits = CONTROLS[motions[index].control].motions[motions[index].motion];
      const probe = angle + PROBE_DEGREES > limits.max ? -PROBE_DEGREES : PROBE_DEGREES;
      const probed = [...angles];
      probed[index] = angle + probe;
      return effectorPositions(probed).map((value, row) => ((value - positions[row]) / probe) * weights[index]);
    });

    const rows = targets.length;
    const normalMatrix = Array.from({ length: rows }, (_, row) =>
      Array.from({ length: rows }, (_, column) => jacobianColumns.reduce((sum, jacobianColumn) => sum + jacobianColumn[row] * jacobianColumn[column], 0) + (row === column ? damping * damping : 0)),
    );
    const solved = solveLinear(normalMatrix, error);
    const candidate = angles.map((angle, index) => {
      const limits = CONTROLS[motions[index].control].motions[motions[index].motion];
      const step = jacobianColumns[index].reduce((sum, value, row) => sum + value * solved[row], 0) * weights[index];
      const limitedStep = Math.max(-MAX_STEP_DEGREES, Math.min(MAX_STEP_DEGREES, step));
      return Math.min(limits.max, Math.max(limits.min, angle + limitedStep));
    });

    const candidatePositions = effectorPositions(candidate);
    const candidateError = errorOf(candidatePositions);
    if (sizeOf(candidateError) >= sizeOf(error)) {
      damping *= 3;
      continue;
    }
    angles.splice(0, angles.length, ...candidate);
    positions = candidatePositions;
    error = candidateError;
    damping = Math.max(0.001, damping / 2);
  }

  return withAngles(angles.map((angle) => Math.round(angle * 10) / 10));
}

export function dragMotions(bone: string): ReachMotion[] {
  const side = bone.match(/_(l|r)$/)?.[1];
  if (side && bone.startsWith('wrist_')) {
    return [
      { control: `shoulder_${side}`, motion: 'flexion' },
      { control: `shoulder_${side}`, motion: 'abduction' },
      { control: `shoulder_${side}`, motion: 'internal_rotation', weight: TWIST_WEIGHT },
      { control: `elbow_${side}`, motion: 'flexion' },
    ];
  }
  if (side && bone.startsWith('ankle_')) return legMotions(side, false);

  const control = CONTROL_FOR_BONE[bone];
  if (!control) return [];
  return Object.keys(CONTROLS[control].motions)
    .filter((motion) => !TWIST_MOTIONS.has(motion))
    .map((motion) => ({ control, motion }));
}

export function legMotions(side: string, includeAnkle: boolean): ReachMotion[] {
  const motions: ReachMotion[] = [
    { control: `hip_${side}`, motion: 'flexion' },
    { control: `hip_${side}`, motion: 'abduction' },
    { control: `hip_${side}`, motion: 'internal_rotation', weight: TWIST_WEIGHT },
    { control: `knee_${side}`, motion: 'flexion' },
  ];
  if (includeAnkle) motions.push({ control: `ankle_${side}`, motion: 'dorsiflexion' }, { control: `ankle_${side}`, motion: 'inversion' });
  return motions;
}

// A hand is held at the wrist and the middle knuckle (so it keeps its direction), a foot at the ankle and the toes.
export function holdPins(rig: Rig, pose: Pose, pins: Pin[], world: ReturnType<typeof forwardKinematics>, iterations = 30): Pose {
  let held = pose;
  for (const pin of pins) {
    const side = pin.slice(-1);
    const isHand = pin.startsWith('hand');
    const bones = isHand ? [`wrist_${side}`, `middle_1_${side}`] : [`ankle_${side}`, `toes_${side}`];
    const goals = bones.map((bone) => ({ bone, point: [0, 0, 0] as Vec3, target: world[bone].position.toArray() as Vec3 }));
    const motions = isHand
      ? [...dragMotions(`wrist_${side}`), { control: `wrist_${side}`, motion: 'flexion' }, { control: `wrist_${side}`, motion: 'radial_deviation' }]
      : legMotions(side, true);
    held = reach(rig, held, goals, motions, iterations);
  }
  return held;
}

export function dropToFloor(rig: Rig, pose: Pose, props: PropBox[] = []): Pose {
  const world = forwardKinematics(rig, solvePose(pose));
  const up = new Vector3(0, 1, 0);
  let lowest = Infinity;
  for (const bone of rig.bones) {
    const { position, quaternion } = world[bone.name];
    for (const shape of bone.shapes) {
      for (const point of surfaceSamples(shape)) {
        point.applyQuaternion(quaternion).add(position);
        let ground = 0;
        for (const box of props) {
          const top = box.center[1] + box.halfSize[1];
          if (point.y < top - LAND_ON_PROP_METERS || top <= ground) continue;
          const local = point.clone().sub(new Vector3(...box.center)).applyAxisAngle(up, (-box.turnDegrees * Math.PI) / 180);
          if (Math.abs(local.x) <= box.halfSize[0] && Math.abs(local.z) <= box.halfSize[2]) ground = top;
        }
        lowest = Math.min(lowest, point.y - ground);
      }
    }
  }
  const [x, y, z] = pose.position ?? [0, 0, 0];
  return { ...pose, position: [x, Math.round((y - lowest) * 1000) / 1000, z] };
}
// #endregion

// #region Helpers
const SAMPLE_DIRECTIONS: Vector3[] = [];
for (let latitude = 0; latitude <= 8; latitude++) {
  for (let longitude = 0; longitude < 12; longitude++) {
    const polar = (latitude / 8) * Math.PI;
    const around = (longitude / 12) * Math.PI * 2;
    SAMPLE_DIRECTIONS.push(new Vector3(Math.sin(polar) * Math.cos(around), Math.cos(polar), Math.sin(polar) * Math.sin(around)));
  }
}

function surfaceSamples(shape: Shape): Vector3[] {
  if (shape.kind === 'ball') return SAMPLE_DIRECTIONS.map((direction) => direction.clone().multiplyScalar(shape.radius).add(new Vector3(...shape.center)));
  if (shape.kind === 'ellipsoid') return SAMPLE_DIRECTIONS.map((direction) => direction.clone().multiply(new Vector3(...shape.radii)).add(new Vector3(...shape.center)));

  // Same as the drawn capsule (Mannequin.tsx): end spheres, then squashed in bone space around the start point.
  const start = new Vector3(...shape.start);
  const squash = new Vector3(...(shape.squash ?? [1, 1, 1]));
  const points: Vector3[] = [];
  for (const direction of SAMPLE_DIRECTIONS) {
    points.push(direction.clone().multiplyScalar(shape.radiusStart).multiply(squash).add(start));
    points.push(direction.clone().multiplyScalar(shape.radiusEnd).add(new Vector3(...shape.end).sub(start)).multiply(squash).add(start));
  }
  return points;
}

function solveLinear(matrix: number[][], vector: number[]): number[] {
  const size = vector.length;
  const rows = matrix.map((row, index) => [...row, vector[index]]);
  for (let column = 0; column < size; column++) {
    let pivot = column;
    for (let row = column + 1; row < size; row++) if (Math.abs(rows[row][column]) > Math.abs(rows[pivot][column])) pivot = row;
    [rows[column], rows[pivot]] = [rows[pivot], rows[column]];
    for (let row = 0; row < size; row++) {
      if (row === column) continue;
      const factor = rows[row][column] / rows[column][column];
      for (let index = column; index <= size; index++) rows[row][index] -= factor * rows[column][index];
    }
  }
  return rows.map((row, index) => row[size] / rows[index][index]);
}
// #endregion
