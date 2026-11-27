/*
 * Checks the headless renderer: a character and a prop show up in the picture, and the PNG is valid.
 * Run: npm test
 */

// #region Setup
import { describe, expect, it } from 'vitest';
import { inflateSync } from 'node:zlib';
import { buildRig, DEFAULT_PROFILE } from '../core/rig.ts';
import { DEFAULT_LIGHTS } from '../core/lights.ts';
import { newProp } from '../core/props.ts';
import { renderScene } from './render.ts';
import { encodePng } from './png.ts';
// #endregion

// #region Tests
describe('render', () => {
  const scene = { characters: [{ rig: buildRig(DEFAULT_PROFILE), pose: {} }], lights: DEFAULT_LIGHTS, background: '#eef0f5' };

  // The sun throws shadows back and to the left, so the near right corner is plain floor.
  it('draws the character in the middle and the floor in the near corner', () => {
    const image = renderScene(scene, { width: 40, height: 60, view: 'front', supersample: 1 });
    const pixel = (x: number, y: number) => [...image.rgba.slice((y * 40 + x) * 4, (y * 40 + x) * 4 + 4)];
    expect(pixel(39, 59)).toEqual([0xee, 0xf0, 0xf5, 255]);
    expect(pixel(20, 30)).not.toEqual([0xee, 0xf0, 0xf5, 255]);
  });

  it('leaves the background see-through when asked', () => {
    const image = renderScene(scene, { width: 20, height: 30, view: 'front', supersample: 1, isTransparent: true });
    expect(image.rgba[3]).toBe(0);
  });

  it('draws a prop, framed in the picture, in its own color', () => {
    const wall = { ...newProp('wall'), color: '#ff0000' };
    const image = renderScene({ characters: [], props: [wall], lights: DEFAULT_LIGHTS, background: '#eef0f5' }, { width: 40, height: 30, view: 'front', supersample: 1 });
    const [red, green, blue] = image.rgba.slice((15 * 40 + 20) * 4, (15 * 40 + 20) * 4 + 3);
    expect(red).toBeGreaterThan(green + 80);
    expect(red).toBeGreaterThan(blue + 80);
  });

  it('writes a PNG whose pixel data unpacks to the right size', () => {
    const png = encodePng(3, 2, new Uint8Array(3 * 2 * 4).fill(128));
    expect([...png.subarray(1, 4)]).toEqual([80, 78, 71]);
    const dataStart = png.indexOf('IDAT') + 4;
    const dataLength = png.readUInt32BE(dataStart - 8);
    expect(inflateSync(png.subarray(dataStart, dataStart + dataLength)).length).toBe((3 * 4 + 1) * 2);
  });
});
// #endregion
