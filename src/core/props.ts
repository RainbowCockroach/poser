/*
 * Props: plain furniture to sit on, lean on or stand on (chair, stool, box, step, wall, table).
 * Each prop is a few boxes, so the app draws them, the CLI render traces them, and "Drop to floor"
 * lands a character on their tops with the same shapes. Size is width × height × depth in meters;
 * for a chair or stool the height is the seat. A prop at rest faces +Z like a character, so a chair's
 * back is on its −Z side and a character facing +Z sits on it.
 * Run the checks: npm test
 */

// #region Setup
import { Vector3 } from 'three';
import type { Vec3 } from './rig.ts';
// #endregion

// #region Types and config
export type PropKind = 'chair' | 'stool' | 'box' | 'step' | 'wall' | 'table';

export interface SceneProp {
  kind: PropKind;
  // Floor point under the middle of the prop.
  position: Vec3;
  turn: number;
  size: Vec3;
  color: string;
}

export interface PropBox {
  center: Vec3;
  halfSize: Vec3;
  turnDegrees: number;
}

export const PROP_KINDS: Record<PropKind, { label: string; size: Vec3; color: string }> = {
  chair: { label: 'Chair', size: [0.45, 0.45, 0.45], color: '#b9a58c' },
  stool: { label: 'Stool', size: [0.35, 0.65, 0.35], color: '#b9a58c' },
  box: { label: 'Box', size: [0.5, 0.5, 0.5], color: '#c9b79c' },
  step: { label: 'Step', size: [0.8, 0.2, 0.4], color: '#c3c7d1' },
  wall: { label: 'Wall', size: [2, 2.4, 0.12], color: '#d9d6cf' },
  table: { label: 'Table', size: [1.2, 0.75, 0.7], color: '#b9a58c' },
};

export const MIN_PROP_SIZE = 0.05;
export const MAX_PROP_SIZE = 5;
const SLAB = 0.04;
const LEG = 0.04;
const CHAIR_BACK_HEIGHT = 0.45;
// #endregion

// #region Main flow
export function newProp(kind: PropKind, position: Vec3 = [0, 0, 0.8]): SceneProp {
  const defaults = PROP_KINDS[kind];
  return { kind, position, turn: 0, size: [...defaults.size], color: defaults.color };
}

export function normalizeProp(data: Partial<SceneProp>): SceneProp {
  const kind = data.kind && data.kind in PROP_KINDS ? data.kind : 'box';
  const defaults = PROP_KINDS[kind];
  const number = (value: unknown, fallback: number) => (typeof value === 'number' && Number.isFinite(value) ? value : fallback);
  const position = Array.isArray(data.position) ? data.position : [];
  const size = Array.isArray(data.size) ? data.size : [];
  return {
    kind,
    position: [number(position[0], 0), number(position[1], 0), number(position[2], 0)],
    turn: number(data.turn, 0),
    size: [0, 1, 2].map((axis) => Math.min(MAX_PROP_SIZE, Math.max(MIN_PROP_SIZE, number(size[axis], defaults.size[axis])))) as Vec3,
    color: /^#[0-9a-f]{6}$/i.test(data.color ?? '') ? data.color! : defaults.color,
  };
}

// The boxes a prop is made of, in the world.
export function propBoxes(prop: SceneProp): PropBox[] {
  const [width, height, depth] = prop.size;
  const local: { center: Vec3; halfSize: Vec3 }[] = [];

  if (prop.kind === 'chair' || prop.kind === 'stool' || prop.kind === 'table') {
    const slab = Math.min(SLAB, height / 2);
    local.push({ center: [0, height - slab / 2, 0], halfSize: [width / 2, slab / 2, depth / 2] });
    const legWidth = Math.min(LEG, width / 3);
    const legDepth = Math.min(LEG, depth / 3);
    const legHeight = height - slab;
    const inset = Math.max(legWidth, legDepth) / 2 + 0.01;
    for (const x of [-1, 1]) {
      for (const z of [-1, 1]) local.push({ center: [x * (width / 2 - inset), legHeight / 2, z * (depth / 2 - inset)], halfSize: [legWidth / 2, legHeight / 2, legDepth / 2] });
    }
    if (prop.kind === 'chair') {
      const backDepth = Math.min(SLAB, depth / 4);
      local.push({ center: [0, height + CHAIR_BACK_HEIGHT / 2, -depth / 2 + backDepth / 2], halfSize: [width / 2, CHAIR_BACK_HEIGHT / 2, backDepth / 2] });
    }
  } else {
    local.push({ center: [0, height / 2, 0], halfSize: [width / 2, height / 2, depth / 2] });
  }

  const turn = (prop.turn * Math.PI) / 180;
  return local.map(({ center, halfSize }) => {
    const rotated = new Vector3(...center).applyAxisAngle(new Vector3(0, 1, 0), turn).add(new Vector3(...prop.position));
    return { center: rotated.toArray() as Vec3, halfSize, turnDegrees: prop.turn };
  });
}
// #endregion
