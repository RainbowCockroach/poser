/*
 * Checks scene lights: hand-written light data gets cleaned up, and placing a light by angles round-trips.
 * Run: npm test
 */

// #region Setup
import { describe, expect, it } from 'vitest';
import { LIGHT_PRESETS, MAX_INTENSITY, normalizeLight, placementOf, positionFromPlacement, type SceneLight } from './lights';
// #endregion

// #region Tests
describe('lights', () => {
  it('fills in a half-written spot light and keeps values in range', () => {
    const light = normalizeLight({ kind: 'spot', intensity: 99, coneDegrees: 200 });
    expect(light.intensity).toBe(MAX_INTENSITY);
    expect(light.coneDegrees).toBe(80);
    expect(light.softness).toBeGreaterThanOrEqual(0);
    expect(light.target).toEqual([0, 1, 0]);
  });

  it('turns color names into hex for the color pickers', () => {
    expect(normalizeLight({ kind: 'sun', color: 'white' }).color).toBe('#ffffff');
  });

  it('never lets ambient light cast shadows', () => {
    expect(normalizeLight({ kind: 'ambient', castShadow: true }).castShadow).toBe(false);
  });

  it('places a light by angles and reads the same angles back', () => {
    const target: SceneLight['target'] = [0.5, 1.2, -0.3];
    const position = positionFromPlacement(target, { aroundDegrees: 120, heightDegrees: 35, distance: 3 });
    const light = normalizeLight({ kind: 'point', position, target });
    expect(placementOf(light)).toEqual({ aroundDegrees: 120, heightDegrees: 35, distance: 3 });
  });

  it('puts "around 90" on the character\'s left (+X)', () => {
    const [x, , z] = positionFromPlacement([0, 0, 0], { aroundDegrees: 90, heightDegrees: 0, distance: 2 });
    expect(x).toBeCloseTo(2);
    expect(z).toBeCloseTo(0);
  });

  it('has presets that are already clean', () => {
    for (const preset of LIGHT_PRESETS) {
      for (const light of preset.lights) expect(normalizeLight(light)).toEqual(light);
    }
  });
});
// #endregion
