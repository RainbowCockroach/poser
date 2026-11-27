/*
 * Checks camera lenses and saved views: lens to angle of view, the dolly that keeps the subject's size,
 * and views from files that are broken.
 * Run: npm test
 */

// #region Setup
import { describe, expect, it } from 'vitest';
import { distanceForLens, fieldOfViewDegrees, fisheyeEquivalentLensMm, fisheyePoint, fisheyeRay, FISHEYE_HALF_DIAGONAL_DEGREES, normalizeView } from './camera.ts';
// #endregion

// #region Tests
describe('camera', () => {
  it('turns a full-frame lens into the vertical angle of view', () => {
    expect(fieldOfViewDegrees(50)).toBeCloseTo(26.99, 1);
    expect(fieldOfViewDegrees(24)).toBeGreaterThan(fieldOfViewDegrees(85));
  });

  it('moves the camera so the subject keeps its size when the lens changes', () => {
    const visibleHeight = (distance: number, lensMm: number) => 2 * distance * Math.tan((fieldOfViewDegrees(lensMm) * Math.PI) / 360);
    const distance = distanceForLens(5, 33, 85);
    expect(distance).toBeGreaterThan(5);
    expect(visibleHeight(distance, 85)).toBeCloseTo(visibleHeight(5, 33), 6);
  });

  it('keeps good views, clamps the lens, and drops broken ones', () => {
    expect(normalizeView({ position: [0, 1, 5], target: [0, 1, 0], lensMm: 500, name: '  Low angle  ' })).toEqual({ position: [0, 1, 5], target: [0, 1, 0], lensMm: 200, name: 'Low angle' });
    expect(normalizeView({ position: [0, 1, 5], target: [0, 1, 0] })?.lensMm).toBe(33);
    expect(normalizeView({ position: [0, 1] as never, target: [0, 1, 0] })).toBeNull();
    expect(normalizeView({ position: [0, 1, 0], target: [0, 1, 0] })).toBeNull();
  });
  it('bends fisheye rays evenly by angle, reaching 75° in the corners, and maps them back', () => {
    const halfDiagonal = Math.hypot(1.6, 1);
    const [cornerX, cornerY] = fisheyeRay(1.6, 1, halfDiagonal);
    expect((Math.atan(Math.hypot(cornerX, cornerY)) * 180) / Math.PI).toBeCloseTo(FISHEYE_HALF_DIAGONAL_DEGREES, 3);
    const [backX, backY] = fisheyePoint(...fisheyeRay(0.7, -0.3, halfDiagonal), halfDiagonal);
    expect(backX).toBeCloseTo(0.7, 6);
    expect(backY).toBeCloseTo(-0.3, 6);
    expect(fisheyeEquivalentLensMm(halfDiagonal)).toBeGreaterThan(14);
    expect(fisheyeEquivalentLensMm(halfDiagonal)).toBeLessThan(24);
    expect(normalizeView({ position: [0, 1, 3], target: [0, 1, 0], lensMm: 33, fisheye: true })?.fisheye).toBe(true);
  });
});
// #endregion
