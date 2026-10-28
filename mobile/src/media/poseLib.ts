import { Directory, File, Paths } from 'expo-file-system';

/**
 * The pose model and the MediaPipe library that the pose pages (media/posePage.ts) run in a WebView, downloaded once
 * and kept on the phone, so the analysis works without a connection and nothing is fetched each time. Videos never
 * leave the phone; only these public files come in.
 *
 * Pinned to MediaPipe Tasks Vision 0.10.35, the newest release that sends nothing back: 1.0 and later post usage
 * metrics to Google with no way to turn them off, which the project's rule against analytics doesn't allow.
 */
export const MEDIAPIPE_VERSION = '0.10.35';
const CDN = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MEDIAPIPE_VERSION}`;
/** BlazePose GHUM "full", float16: the middle of the three sizes (lite 5.8 MB, full 9.4 MB, heavy 30.7 MB). */
const MODEL = 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task';

/** What the pages need, with each file's size in the release, which also tells a whole download from a cut one. */
export const POSE_FILES = [
  { name: 'vision_bundle.mjs', url: `${CDN}/vision_bundle.mjs`, bytes: 136_993 },
  { name: 'vision_wasm_internal.js', url: `${CDN}/wasm/vision_wasm_internal.js`, bytes: 322_044 },
  { name: 'vision_wasm_internal.wasm', url: `${CDN}/wasm/vision_wasm_internal.wasm`, bytes: 11_153_617 },
  { name: 'pose_landmarker_full.task', url: MODEL, bytes: 9_398_198 },
] as const;

export const POSE_DOWNLOAD_BYTES = POSE_FILES.reduce((s, f) => s + f.bytes, 0);

/** Where a page fetches the same files from when it can't read the phone's copy. */
export const POSE_CDN = { bundle: POSE_FILES[0].url, loader: POSE_FILES[1].url, wasm: POSE_FILES[2].url, model: MODEL };

/** The library as a classic script, made by the app from the ES module the release ships. */
export const CLASSIC_BUNDLE = 'vision.js';

/**
 * The ES module as a classic script that a page can load from a file (module scripts from `file:` URLs are refused):
 * the module's code runs as it would in a module (strict, its names its own) and its one `export {…}` becomes the
 * global `MPVision`.
 */
export function classicBundle(esm: string): string {
  const m = /export\s*\{([^}]*)\}\s*;?\s*(\/\/# sourceMappingURL=\S*\s*)?$/.exec(esm);
  if (!m) throw new Error('vision bundle: no export list at the end');
  const fields = m[1]
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      const [local, name = local] = s.split(/\s+as\s+/);
      return `${name.trim()}:${local.trim()}`;
    });
  return `(function () {\n"use strict";\n${esm.slice(0, m.index)}\nself.MPVision = {${fields.join(',')}};\n})();\n`;
}

const root = () => new Directory(Paths.document, 'pose');
const libDir = () => new Directory(root(), 'lib', MEDIAPIPE_VERSION);
/** The library's folder as a page in `run-…` refers to it. */
export const LIB_FROM_PAGE = `../lib/${MEDIAPIPE_VERSION}`;

/** Whether every file is on the phone, whole. */
export function poseLibReady(): boolean {
  const dir = libDir();
  if (!dir.exists || !new File(dir, CLASSIC_BUNDLE).exists) return false;
  return POSE_FILES.every((f) => {
    const file = new File(dir, f.name);
    return file.exists && file.size === f.bytes;
  });
}

/** Downloads what isn't on the phone yet; `onProgress` hears the share done (0–1). Throws on a cut or failed download. */
export async function downloadPoseLib(onProgress?: (share: number) => void, signal?: AbortSignal): Promise<void> {
  const dir = libDir();
  dir.create({ intermediates: true, idempotent: true });
  let done = 0;
  for (const f of POSE_FILES) {
    const dest = new File(dir, f.name);
    if (dest.exists && dest.size === f.bytes) {
      done += f.bytes;
      onProgress?.(done / POSE_DOWNLOAD_BYTES);
      continue;
    }
    if (dest.exists) dest.delete();
    const task = File.createDownloadTask(f.url, dest, {
      sessionType: 'foreground',
      signal,
      onProgress: ({ bytesWritten }) => onProgress?.(Math.min(1, (done + bytesWritten) / POSE_DOWNLOAD_BYTES)),
    });
    await task.downloadAsync();
    if (dest.size !== f.bytes) {
      const got = dest.size;
      dest.delete();
      throw new Error(`${f.name} 下载不完整（${got} / ${f.bytes} 字节）`);
    }
    done += f.bytes;
  }
  // Written in place: one that fails part-way (the phone full) would leave a cut script that passes for whole.
  const vision = new File(dir, CLASSIC_BUNDLE);
  try {
    await vision.write(classicBundle(await new File(dir, 'vision_bundle.mjs').text()));
  } catch (e) {
    if (vision.exists) vision.delete();
    throw e;
  }
  onProgress?.(1);
}

/**
 * A fresh folder beside the library for one page and the clip it reads (copied in, or none for the camera), so the
 * WebView can be given read access to the parent folder, which holds both. Returns the page's file:// URI, the folder
 * (for `unstagePosePage`) and the folder to allow reading from.
 */
export async function stagePosePage(page: (clipName: string | null) => string, clipUri?: string): Promise<{ page: string; dir: string; root: string }> {
  const dir = new Directory(root(), `run-${Date.now()}`);
  dir.create({ intermediates: true, idempotent: true });
  let name: string | null = null;
  if (clipUri) {
    const source = new File(clipUri);
    const ext = source.extension ? (source.extension.startsWith('.') ? source.extension : `.${source.extension}`) : '.mov';
    const clip = new File(dir, `clip${ext}`);
    await source.copy(clip);
    name = clip.name;
  }
  const html = new File(dir, 'page.html');
  await html.write(page(name));
  return { page: html.uri, dir: dir.uri, root: root().uri };
}

/** Removes what `stagePosePage` put in place; the library stays. */
export function unstagePosePage(dir: string) {
  try {
    const d = new Directory(dir);
    if (d.exists) d.delete();
  } catch {
    // Already gone: nothing to keep.
  }
}

/** Run folders a page left behind when the app was closed mid-analysis. */
export function clearPoseRuns() {
  const r = root();
  if (!r.exists) return;
  for (const entry of r.list()) if (entry instanceof Directory && entry.name.startsWith('run-')) unstagePosePage(entry.uri);
}
