/*
 * Draws thumbnails off the page's thread with the CLI ray tracer (cli/render.ts), so the card stays responsive while
 * pose, hand, lens and light pictures appear one by one. Thumbnail.tsx sends requests and caches the pictures.
 */

// #region Setup
import { renderScene } from '../cli/render';
import { buildRig } from '../core/rig';
import { dropToFloor } from '../core/reach';
import type { ThumbnailRequest } from './Thumbnail';
// #endregion

// #region Main flow
self.onmessage = (event: MessageEvent<{ key: string; request: ThumbnailRequest }>) => {
  const { key, request } = event.data;
  const rig = buildRig(request.profile);
  const pose = dropToFloor(rig, request.pose);
  const side = request.focus?.slice(-1);
  // A hand close-up takes the palm and every finger bone of that side; a portrait the head, neck and shoulders.
  const isFocused = (bone: string) =>
    request.focus === 'portrait' ? /^(head|neck|thoracic_upper|clavicle_[lr]|shoulder_[lr])$/.test(bone) : new RegExp(`^(wrist|thumb|index|middle|ring|pinky)(_\\d)?_${side}$`).test(bone);
  const focusBones = request.focus ? rig.bones.map((bone) => bone.name).filter(isFocused) : null;
  const image = renderScene(
    { characters: [{ rig, pose }], lights: request.lights, background: request.background },
    { width: request.size, height: request.size, view: request.view, lensMm: request.lensMm, focus: focusBones ? { character: 0, bones: focusBones } : undefined },
  );
  (self as unknown as Worker).postMessage({ key, width: image.width, height: image.height, rgba: image.rgba }, [image.rgba.buffer]);
};
// #endregion
