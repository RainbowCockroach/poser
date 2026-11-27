/*
 * Scene lights: the data format saved in scene files, the presets, and how a light is placed.
 * A light shines from `position` toward `target` (meters, Y up). `intensity` is how bright the light is
 * at its target, for every kind, so a lamp and the sun with the same number light a character the same.
 * The app turns point and spot intensity into three.js units (intensity × distance², falloff by distance²).
 * Run the checks: npm test
 */

// #region Setup
import { Color } from 'three';
import type { Vec3 } from './rig.ts';
// #endregion

// #region Types and config
export type LightKind = 'sun' | 'point' | 'spot' | 'ambient';

export interface SceneLight {
  kind: LightKind;
  color: string;
  intensity: number;
  position: Vec3;
  target: Vec3;
  castShadow: boolean;
  // Spot only: half the cone width in degrees, and how soft its edge is (0 hard … 1 soft).
  coneDegrees?: number;
  softness?: number;
  // Ambient only: the color bounced up from the floor.
  groundColor?: string;
}

export interface LightPlacement {
  aroundDegrees: number;
  heightDegrees: number;
  distance: number;
}

export const MAX_INTENSITY = 10;
const DEFAULT_TARGET: Vec3 = [0, 1, 0];

export const LIGHT_PRESETS: { name: string; lights: SceneLight[] }[] = [
  {
    name: 'Soft day',
    lights: [
      { kind: 'ambient', color: '#ffffff', groundColor: '#b9a99a', intensity: 1.2, position: [0, 5, 0], target: DEFAULT_TARGET, castShadow: false },
      { kind: 'sun', color: '#ffffff', intensity: 2, position: [3, 6, 4], target: DEFAULT_TARGET, castShadow: true },
    ],
  },
  {
    name: 'Studio',
    lights: [
      { kind: 'ambient', color: '#ffffff', groundColor: '#8a8f9e', intensity: 0.4, position: [0, 5, 0], target: DEFAULT_TARGET, castShadow: false },
      { kind: 'spot', color: '#fff4e5', intensity: 3, position: [2.2, 3, 2.8], target: DEFAULT_TARGET, castShadow: true, coneDegrees: 35, softness: 0.5 },
      { kind: 'point', color: '#dce8ff', intensity: 0.8, position: [-3, 1.6, 2], target: DEFAULT_TARGET, castShadow: false },
      { kind: 'spot', color: '#ffffff', intensity: 2.5, position: [-1, 2.8, -3], target: [0, 1.4, 0], castShadow: false, coneDegrees: 30, softness: 0.6 },
    ],
  },
  {
    name: 'Dramatic side',
    lights: [
      { kind: 'ambient', color: '#9aa4c4', groundColor: '#2a2d3a', intensity: 0.15, position: [0, 5, 0], target: DEFAULT_TARGET, castShadow: false },
      { kind: 'spot', color: '#ffe2c0', intensity: 4, position: [3.5, 1.8, 0.3], target: DEFAULT_TARGET, castShadow: true, coneDegrees: 30, softness: 0.3 },
    ],
  },
  {
    name: 'Rim light',
    lights: [
      { kind: 'ambient', color: '#ffffff', groundColor: '#6b6f80', intensity: 0.3, position: [0, 5, 0], target: DEFAULT_TARGET, castShadow: false },
      { kind: 'point', color: '#ffffff', intensity: 0.6, position: [1.5, 1.8, 3.5], target: DEFAULT_TARGET, castShadow: false },
      { kind: 'spot', color: '#9fd4ff', intensity: 5, position: [-2.2, 2.4, -2.6], target: [0, 1.2, 0], castShadow: false, coneDegrees: 35, softness: 0.5 },
      { kind: 'spot', color: '#ffb28a', intensity: 5, position: [2.2, 2.4, -2.6], target: [0, 1.2, 0], castShadow: false, coneDegrees: 35, softness: 0.5 },
    ],
  },
  {
    name: 'From below',
    lights: [
      { kind: 'ambient', color: '#7d86a8', groundColor: '#1f2230', intensity: 0.2, position: [0, 5, 0], target: DEFAULT_TARGET, castShadow: false },
      { kind: 'spot', color: '#ffd9a0', intensity: 4, position: [0.4, 0.15, 1.6], target: [0, 1.3, 0], castShadow: true, coneDegrees: 45, softness: 0.4 },
    ],
  },
  {
    name: 'Night',
    lights: [
      { kind: 'ambient', color: '#5a6aa0', groundColor: '#151826', intensity: 0.35, position: [0, 5, 0], target: DEFAULT_TARGET, castShadow: false },
      { kind: 'sun', color: '#a9c1ff', intensity: 0.8, position: [-3, 7, 2], target: DEFAULT_TARGET, castShadow: true },
    ],
  },
];

export const DEFAULT_LIGHTS = LIGHT_PRESETS[0].lights;
// #endregion

// #region Main flow
export function newLight(kind: LightKind): SceneLight {
  const base: SceneLight = { kind, color: '#ffffff', intensity: kind === 'ambient' ? 0.5 : 2, position: [2, 3, 2.5], target: DEFAULT_TARGET, castShadow: kind !== 'ambient' };
  if (kind === 'spot') return { ...base, coneDegrees: 35, softness: 0.4 };
  if (kind === 'ambient') return { ...base, position: [0, 5, 0], groundColor: '#8a8f9e' };
  return base;
}

// Scene files are written by hand and by agents, so anything missing or out of range gets a sane value.
export function normalizeLight(input: Partial<SceneLight>): SceneLight {
  // Color pickers only understand "#rrggbb", so names like "white" become hex.
  const hexColor = (value: unknown, fallbackColor: string) => (typeof value === 'string' ? `#${new Color(value).getHexString()}` : fallbackColor);
  const kind: LightKind = ['sun', 'point', 'spot', 'ambient'].includes(input.kind as string) ? (input.kind as LightKind) : 'point';
  const fallback = newLight(kind);
  const isVec3 = (value: unknown): value is Vec3 => Array.isArray(value) && value.length === 3 && value.every((number) => Number.isFinite(number));
  const light: SceneLight = {
    kind,
    color: hexColor(input.color, fallback.color),
    intensity: Math.min(MAX_INTENSITY, Math.max(0, Number.isFinite(input.intensity) ? input.intensity! : fallback.intensity)),
    position: isVec3(input.position) ? input.position : fallback.position,
    target: isVec3(input.target) ? input.target : fallback.target,
    castShadow: kind === 'ambient' ? false : (input.castShadow ?? fallback.castShadow),
  };
  if (kind === 'spot') {
    light.coneDegrees = Math.min(80, Math.max(5, input.coneDegrees ?? fallback.coneDegrees!));
    light.softness = Math.min(1, Math.max(0, input.softness ?? fallback.softness!));
  }
  if (kind === 'ambient') light.groundColor = hexColor(input.groundColor, fallback.groundColor!);
  return light;
}

// Around: 0 = in front of the target (+Z), 90 = to the character's left (+X). Height: 0 = level, 90 = straight above.
export function placementOf(light: SceneLight): LightPlacement {
  const [x, y, z] = light.position.map((value, index) => value - light.target[index]);
  const distance = Math.max(0.01, Math.hypot(x, y, z));
  return {
    aroundDegrees: Math.round((Math.atan2(x, z) * 180) / Math.PI),
    heightDegrees: Math.round((Math.asin(Math.max(-1, Math.min(1, y / distance))) * 180) / Math.PI),
    distance: Math.round(distance * 100) / 100,
  };
}

export function positionFromPlacement(target: Vec3, placement: LightPlacement): Vec3 {
  const around = (placement.aroundDegrees * Math.PI) / 180;
  const height = (placement.heightDegrees * Math.PI) / 180;
  const level = Math.cos(height) * placement.distance;
  const offset = [Math.sin(around) * level, Math.sin(height) * placement.distance, Math.cos(around) * level];
  return offset.map((value, index) => Math.round((target[index] + value) * 1000) / 1000) as Vec3;
}
// #endregion
