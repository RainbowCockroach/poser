/*
 * Hand shapes: a whole hand in one step (fist, point, grip…) instead of fourteen finger sliders.
 * A shape is the angles of the five finger controls (thumb_l, index_l…), written for the left hand;
 * right-hand controls are mirror images in pose.ts, so the same angles make the same shape on the right.
 * Applying a shape replaces only the finger controls, so the wrist and the rest of the pose stay.
 * Run the checks: npm test
 */

// #region Setup
import type { Pose } from './pose.ts';
// #endregion

// #region Types and config
export type HandSide = 'l' | 'r' | 'both';

export interface HandShape {
  label: string;
  fingers: Record<string, Record<string, number>>;
}

export const FINGER_CONTROLS = ['thumb', 'index', 'middle', 'ring', 'pinky'];

const CURLED = { base_flexion: 85, middle_flexion: 100 };
const THUMB_OVER_FINGERS = { cmc_flexion: 42, cmc_abduction: 12, mcp_flexion: 50, ip_flexion: 50 };

export const HAND_SHAPES: Record<string, HandShape> = {
  relaxed: {
    label: 'Relaxed',
    fingers: {
      thumb: { cmc_abduction: 20, mcp_flexion: 10, ip_flexion: 10 },
      index: { base_flexion: 15, middle_flexion: 20 },
      middle: { base_flexion: 20, middle_flexion: 25 },
      ring: { base_flexion: 25, middle_flexion: 30 },
      pinky: { base_flexion: 30, middle_flexion: 35 },
    },
  },
  fist: {
    label: 'Fist',
    fingers: { thumb: THUMB_OVER_FINGERS, index: CURLED, middle: CURLED, ring: CURLED, pinky: CURLED },
  },
  flat: {
    label: 'Flat',
    fingers: { thumb: { cmc_abduction: 10 }, index: {}, middle: {}, ring: {}, pinky: {} },
  },
  spread: {
    label: 'Spread',
    fingers: {
      thumb: { cmc_abduction: 65, ip_flexion: -10 },
      index: { spread: 15, base_flexion: -5 },
      middle: { base_flexion: -5 },
      ring: { spread: 12, base_flexion: -5 },
      pinky: { spread: 20, base_flexion: -5 },
    },
  },
  point: {
    label: 'Point',
    fingers: { thumb: THUMB_OVER_FINGERS, index: {}, middle: CURLED, ring: CURLED, pinky: CURLED },
  },
  peace: {
    label: 'Peace',
    fingers: { thumb: THUMB_OVER_FINGERS, index: { spread: 12 }, middle: { spread: -12 }, ring: CURLED, pinky: CURLED },
  },
  grip: {
    label: 'Grip',
    fingers: {
      thumb: { cmc_flexion: 30, cmc_abduction: 45, mcp_flexion: 25, ip_flexion: 25 },
      index: { base_flexion: 55, middle_flexion: 70 },
      middle: { base_flexion: 60, middle_flexion: 75 },
      ring: { base_flexion: 65, middle_flexion: 80 },
      pinky: { base_flexion: 70, middle_flexion: 85 },
    },
  },
  pinch: {
    label: 'Pinch',
    fingers: {
      thumb: { cmc_flexion: 30, cmc_abduction: 20, ip_flexion: 60 },
      index: { base_flexion: 75, middle_flexion: 30 },
      middle: { base_flexion: 10, middle_flexion: 10, spread: -5 },
      ring: { base_flexion: 15, middle_flexion: 15, spread: 5 },
      pinky: { base_flexion: 20, middle_flexion: 20, spread: 12 },
    },
  },
};
// #endregion

// #region Main flow
export function applyHandShape(pose: Pose, side: HandSide, shapeName: string): Pose {
  const shape = HAND_SHAPES[shapeName];
  if (!shape) throw new Error(`Unknown hand shape "${shapeName}". Known: ${Object.keys(HAND_SHAPES).join(', ')}`);

  const joints = { ...pose.joints };
  for (const handSide of side === 'both' ? ['l', 'r'] : [side]) {
    for (const finger of FINGER_CONTROLS) {
      const angles = shape.fingers[finger] ?? {};
      if (Object.keys(angles).length === 0) delete joints[`${finger}_${handSide}`];
      else joints[`${finger}_${handSide}`] = { ...angles };
    }
  }
  return { ...pose, joints };
}
// #endregion
