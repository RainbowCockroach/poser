/*
 * Share links: a scene or a character packed into the URL, so a friend opens it with one tap.
 * JSON → deflate (CompressionStream) → base64url, after "#scene=" or "#character=" in the link.
 * The hash never reaches a server (GitHub Pages only sees the page path), so nothing is uploaded anywhere.
 * Works in current browsers (Safari 16.4+) and Node 22+, which all have CompressionStream("deflate-raw").
 * Run the checks: npm test
 */

// #region Types and config
export type SharedKind = 'scene' | 'character';

// Chat apps and some browsers cut very long links; past this the app suggests a file instead.
export const MAX_SHARE_LINK_LENGTH = 8000;
// #endregion

// #region Main flow
export async function packForLink(data: unknown): Promise<string> {
  const stream = new Blob([JSON.stringify(data)]).stream().pipeThrough(new CompressionStream('deflate-raw'));
  const bytes = new Uint8Array(await new Response(stream).arrayBuffer());
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function unpackFromLink(packed: string): Promise<unknown> {
  const binary = atob(packed.replace(/-/g, '+').replace(/_/g, '/'));
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return JSON.parse(await new Response(stream).text());
}

export function shareLink(pageUrl: string, kind: SharedKind, packed: string): string {
  return `${pageUrl.split('#')[0]}#${kind}=${packed}`;
}

export function readShareHash(hash: string): { kind: SharedKind; packed: string } | null {
  const match = hash.match(/^#(scene|character)=([A-Za-z0-9_-]+)$/);
  return match ? { kind: match[1] as SharedKind, packed: match[2] } : null;
}
// #endregion
