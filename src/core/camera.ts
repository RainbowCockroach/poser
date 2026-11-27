/*
 * Camera views: where the camera stands, what it looks at, and its lens in millimeters (full-frame terms,
 * 24 mm tall sensor), because artists think of perspective as "wide 24 mm" or "portrait 85 mm".
 * A scene file keeps the current view ("camera") and named views ("views"); the app and the CLI render both
 * use them, so a shared scene opens from the exact angle it was posed for.
 * Fisheye is an equidistant projection: the distance from the middle of the picture grows evenly with the angle,
 * so straight lines bow outward and the corners see 75° off-axis. The app bends a very wide normal picture into it;
 * the CLI ray tracer shoots fisheye rays directly. Both use fisheyeRay() below.
 * Run the checks: npm test
 */

// #region Setup
import type { Vec3 } from './rig.ts';
// #endregion

// #region Types and config
export interface CameraView {
  name?: string;
  position: Vec3;
  target: Vec3;
  lensMm: number;
  fisheye?: boolean;
}

export const LENS_PRESETS: { lensMm: number; label: string }[] = [
  { lensMm: 24, label: 'Wide 24' },
  { lensMm: 35, label: '35' },
  { lensMm: 50, label: 'Normal 50' },
  { lensMm: 85, label: 'Portrait 85' },
];

export const MIN_LENS_MM = 14;
export const MAX_LENS_MM = 200;
// About the 40° view the app always had.
export const DEFAULT_LENS_MM = 33;
const SENSOR_HEIGHT_MM = 24;
export const FISHEYE_HALF_DIAGONAL_DEGREES = 75;
// #endregion

// #region Main flow
export function fieldOfViewDegrees(lensMm: number): number {
  return (2 * Math.atan(SENSOR_HEIGHT_MM / 2 / lensMm) * 180) / Math.PI;
}

// Moving back while zooming in keeps the subject the same size on screen; only the perspective changes.
export function distanceForLens(distance: number, fromLensMm: number, toLensMm: number): number {
  const halfAngle = (lensMm: number) => (fieldOfViewDegrees(lensMm) * Math.PI) / 360;
  return (distance * Math.tan(halfAngle(fromLensMm))) / Math.tan(halfAngle(toLensMm));
}

// A point on the picture, in units where the picture is 2 tall (x from -aspect to aspect, y from -1 to 1, measured
// from the middle of the view), to the ray through it as offsets on the image plane one unit in front of the camera.
export function fisheyeRay(x: number, y: number, halfDiagonal: number): [number, number] {
  const radius = Math.hypot(x, y);
  if (radius < 1e-9) return [0, 0];
  const angle = (radius / halfDiagonal) * ((FISHEYE_HALF_DIAGONAL_DEGREES * Math.PI) / 180);
  const planeRadius = Math.tan(Math.min(angle, Math.PI / 2 - 1e-3));
  return [(x / radius) * planeRadius, (y / radius) * planeRadius];
}

// The other way: a ray (image-plane offsets) to where it lands on the fisheye picture.
export function fisheyePoint(planeX: number, planeY: number, halfDiagonal: number): [number, number] {
  const planeRadius = Math.hypot(planeX, planeY);
  if (planeRadius < 1e-9) return [0, 0];
  const radius = (Math.atan(planeRadius) / ((FISHEYE_HALF_DIAGONAL_DEGREES * Math.PI) / 180)) * halfDiagonal;
  return [(planeX / planeRadius) * radius, (planeY / planeRadius) * radius];
}

// In the middle of a fisheye picture things are as big as through this normal lens, so switching keeps them in size.
export function fisheyeEquivalentLensMm(halfDiagonal: number): number {
  return (SENSOR_HEIGHT_MM / 2) * (halfDiagonal / ((FISHEYE_HALF_DIAGONAL_DEGREES * Math.PI) / 180));
}

export function normalizeView(data: Partial<CameraView>): CameraView | null {
  const isPoint = (value: unknown): value is Vec3 => Array.isArray(value) && value.length === 3 && value.every((entry) => typeof entry === 'number' && Number.isFinite(entry));
  if (!isPoint(data.position) || !isPoint(data.target)) return null;
  if (Math.hypot(...data.position.map((value, axis) => value - data.target![axis])) < 0.01) return null;
  const lensMm = typeof data.lensMm === 'number' && Number.isFinite(data.lensMm) ? Math.min(MAX_LENS_MM, Math.max(MIN_LENS_MM, data.lensMm)) : DEFAULT_LENS_MM;
  const view: CameraView = { position: data.position, target: data.target, lensMm };
  if (typeof data.name === 'string' && data.name.trim()) view.name = data.name.trim().slice(0, 40);
  if (data.fisheye === true) view.fisheye = true;
  return view;
}
// #endregion
