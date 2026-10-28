import { Directory, File, Paths } from 'expo-file-system';

/**
 * Puts a clip and the page that reads its frames in one fresh folder, so the WebView can be given read access to
 * exactly that folder and the page can load the clip by its name. Returns the page's file:// URI and the folder's.
 */
export async function stageForGrabbing(videoUri: string, page: (videoName: string) => string): Promise<{ page: string; dir: string }> {
  const dir = new Directory(Paths.cache, 'jump-detect');
  if (dir.exists) dir.delete();
  dir.create({ intermediates: true, idempotent: true });
  const source = new File(videoUri);
  const ext = source.extension ? (source.extension.startsWith('.') ? source.extension : `.${source.extension}`) : '.mov';
  const clip = new File(dir, `clip-${Date.now()}${ext}`);
  await source.copy(clip);
  const html = new File(dir, 'grab.html');
  html.write(page(clip.name));
  return { page: html.uri, dir: dir.uri };
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const LOOKUP = new Uint8Array(128);
for (let i = 0; i < B64.length; i++) LOOKUP[B64.charCodeAt(i)] = i;

/** Base64 to bytes, without relying on `atob` (and its detour through a binary string). */
export function decodeBase64(s: string): Uint8Array {
  const pad = s.endsWith('==') ? 2 : s.endsWith('=') ? 1 : 0;
  const out = new Uint8Array((s.length / 4) * 3 - pad);
  let o = 0;
  for (let i = 0; i < s.length; i += 4) {
    const v = (LOOKUP[s.charCodeAt(i)] << 18) | (LOOKUP[s.charCodeAt(i + 1)] << 12) | (LOOKUP[s.charCodeAt(i + 2)] << 6) | LOOKUP[s.charCodeAt(i + 3)];
    if (o < out.length) out[o++] = v >> 16;
    if (o < out.length) out[o++] = (v >> 8) & 255;
    if (o < out.length) out[o++] = v & 255;
  }
  return out;
}
