/*
 * Picture tiles for poses, hand shapes, lenses and light presets, drawn on the selected character's own body.
 * Pictures come from a worker (thumbnails.worker.ts) one at a time and are cached by what they show, so a tile
 * that scrolls back or a card that reopens shows its picture at once. While a new picture is drawn (say after a
 * body slider moved) the old one stays. Without workers a tile is just its label.
 */

// #region Setup
import { useEffect, useState } from 'react';
import type { View } from '../cli/render';
import type { SceneLight } from '../core/lights';
import type { Pose } from '../core/pose';
import type { CharacterProfile } from '../core/rig';
// #endregion

// #region Config
export interface ThumbnailRequest {
  profile: CharacterProfile;
  pose: Pose;
  lights: SceneLight[];
  background: string;
  view: View;
  size: number;
  lensMm?: number;
  focus?: 'hand_l' | 'hand_r' | 'portrait';
}

// Twice the tile's size on screen, so pictures stay sharp on phones and tablets.
export const THUMBNAIL_PIXELS = 128;
const MAX_CACHED_PICTURES = 300;

const cache = new Map<string, string>();
const waiting = new Map<string, Set<(url: string) => void>>();
const queue: { key: string; request: ThumbnailRequest }[] = [];
let worker: Worker | null = null;
let isWorkerBroken = false;
let isDrawing = false;
// #endregion

// #region Main flow
export function useThumbnail(request: ThumbnailRequest | null): string | null {
  const key = request ? JSON.stringify(request) : '';
  const [url, setUrl] = useState<string | null>(() => cache.get(key) ?? null);

  useEffect(() => {
    if (!request) return;
    const cached = cache.get(key);
    if (cached) {
      setUrl(cached);
      return;
    }
    const listeners = waiting.get(key) ?? new Set();
    listeners.add(setUrl);
    waiting.set(key, listeners);
    if (!queue.some((entry) => entry.key === key)) queue.push({ key, request });
    drawNext();
    return () => {
      listeners.delete(setUrl);
      if (listeners.size > 0) return;
      waiting.delete(key);
      const queued = queue.findIndex((entry) => entry.key === key);
      if (queued >= 0) queue.splice(queued, 1);
    };
  }, [key]);

  return url;
}

interface TileProps {
  label: string;
  request: ThumbnailRequest | null;
  isActive?: boolean;
  title?: string;
  onClick: () => void;
}

export function Tile({ label, request, isActive = false, title, onClick }: TileProps) {
  const url = useThumbnail(request);
  return (
    <button className={isActive ? 'tile is-active' : 'tile'} onClick={onClick} title={title} aria-pressed={isActive}>
      <span className="tile-picture">{url && <img src={url} alt="" draggable={false} />}</span>
      <span className="tile-label">{label}</span>
    </button>
  );
}
// #endregion

// #region Helpers
function drawNext() {
  if (isDrawing || isWorkerBroken || queue.length === 0) return;
  if (!worker) {
    try {
      worker = new Worker(new URL('./thumbnails.worker.ts', import.meta.url), { type: 'module' });
    } catch (error) {
      console.warn('Thumbnails are off: this browser cannot start the drawing worker', error);
      isWorkerBroken = true;
      return;
    }
    worker.onmessage = (event: MessageEvent<{ key: string; width: number; height: number; rgba: Uint8Array }>) => {
      const { key, width, height, rgba } = event.data;
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      canvas.getContext('2d')?.putImageData(new ImageData(Uint8ClampedArray.from(rgba), width, height), 0, 0);
      const url = canvas.toDataURL('image/png');
      if (cache.size >= MAX_CACHED_PICTURES) cache.delete(cache.keys().next().value!);
      cache.set(key, url);
      for (const listener of waiting.get(key) ?? []) listener(url);
      waiting.delete(key);
      isDrawing = false;
      drawNext();
    };
    worker.onerror = (error) => {
      console.warn('Thumbnails are off: the drawing worker failed', error.message);
      isWorkerBroken = true;
    };
  }
  isDrawing = true;
  worker.postMessage(queue.shift());
}
// #endregion
