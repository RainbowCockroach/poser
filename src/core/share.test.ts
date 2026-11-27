/*
 * Checks share links: a scene survives the trip through the URL, and stays short enough to paste.
 * Run: npm test
 */

// #region Setup
import { describe, expect, it } from 'vitest';
import { deflateRawSync } from 'node:zlib';
import { MAX_SHARE_LINK_LENGTH, packForLink, readShareHash, shareLink, unpackFromLink } from './share.ts';
import potat from '../../characters/potat.oc.json';
import bush from '../../characters/bush.oc.json';
import sitOnChair from '../../poses/sit-chair.pose.json';
// #endregion

// #region Tests
describe('share links', () => {
  const scene = {
    format: 'poser.scene/1',
    characters: [
      { profile: potat, pose: { position: [-0.5, 0, 0], joints: sitOnChair.joints } },
      { profile: bush, pose: { position: [0.5, 0, 0] } },
    ],
    background: '#eef0f5',
  };

  it('gives back exactly the scene that went in', async () => {
    const link = shareLink('https://example.com/poser/#old', 'scene', await packForLink(scene));
    expect(link.startsWith('https://example.com/poser/#scene=')).toBe(true);
    const parsed = readShareHash(link.slice(link.indexOf('#')));
    expect(parsed?.kind).toBe('scene');
    expect(await unpackFromLink(parsed!.packed)).toEqual(scene);
  });

  it('keeps a two-character scene well under the length chat apps allow', async () => {
    expect((await packForLink(scene)).length).toBeLessThan(MAX_SHARE_LINK_LENGTH / 4);
  });

  it('opens links packed by the CLI with Node zlib', async () => {
    const packed = deflateRawSync(JSON.stringify(scene)).toString('base64url');
    expect(await unpackFromLink(packed)).toEqual(scene);
  });

  it('ignores hashes that are not share links', () => {
    expect(readShareHash('#about')).toBeNull();
    expect(readShareHash('#scene=has spaces')).toBeNull();
  });
});
// #endregion
