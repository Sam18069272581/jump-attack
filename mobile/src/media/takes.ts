import { Directory, File, Paths } from 'expo-file-system';

/**
 * Takes filmed in the app (the technique camera screen). The camera's file is the only copy, so a take that is saved
 * keeps it here, in the documents folder, for as long as the take is kept; one that isn't is dropped.
 */
const takesDir = () => new Directory(Paths.document, 'technique');
/**
 * Takes filmed for a test (jumps, VBT): needed only until the clip is measured (a VBT set saves its own copy), so they
 * live in the cache, apart from the technique takes, and each filming drops the ones before it.
 */
const testTakesDir = () => new Directory(Paths.cache, 'test-takes');

/** A new, empty file for a take. */
export function newTakeFile(ext: string, kind: 'technique' | 'test' = 'technique'): File {
  const dir = kind === 'test' ? testTakesDir() : takesDir();
  dir.create({ intermediates: true, idempotent: true });
  const file = new File(dir, `take-${Date.now()}.${ext}`);
  file.create({ overwrite: true });
  return file;
}

/**
 * Copies a clip picked from the photo library in with the takes, for a dunk attempt to keep its video: the picker's
 * file is a temporary copy. Returns the copy's uri.
 */
export async function keepTake(uri: string): Promise<string> {
  const source = new File(uri);
  const ext = source.extension ? source.extension.replace(/^\.?/, '') : 'mov';
  const dir = takesDir();
  dir.create({ intermediates: true, idempotent: true });
  const dest = new File(dir, `take-${Date.now()}.${ext}`);
  await source.copy(dest);
  return dest.uri;
}

/**
 * Where a kept take is now, or null when it isn't on this phone (data restored from a backup, or since deleted). Found
 * by its name, as in `pruneTakes`: iOS can move the app's folder in an update.
 */
export function takeUri(uri: string): string | null {
  const name = uri.split('/').pop();
  if (!name) return null;
  try {
    const file = new File(takesDir(), name);
    return file.exists ? file.uri : null;
  } catch {
    return null;
  }
}

export function dropTake(uri: string) {
  try {
    const f = new File(uri);
    if (f.exists) f.delete();
  } catch {
    // Already gone.
  }
}

/**
 * Drops every take's file but the ones `keep` points to: what a screen closed before saving left behind, and the files
 * of deleted takes. A file is known by its name, which is its own: iOS can move the app's folder in an update.
 */
export function pruneTakes(keep: Iterable<string>) {
  const dir = takesDir();
  if (!dir.exists) return;
  const kept = new Set([...keep].map((uri) => uri.split('/').pop()));
  for (const entry of dir.list()) if (entry instanceof File && !kept.has(entry.name)) dropTake(entry.uri);
}

/** Drops the takes filmed for tests before this one. */
export function dropTestTakes() {
  const dir = testTakesDir();
  if (!dir.exists) return;
  for (const entry of dir.list()) if (entry instanceof File) dropTake(entry.uri);
}
