import { Directory, File, Paths } from 'expo-file-system';

/**
 * Exercise demos the athlete filmed themselves, one per exercise, copied into the app's documents so they outlive the
 * photo library's cache. They stay on this phone: a clip is tens of MB and isn't part of the backup.
 */
const demoDir = () => new Directory(Paths.document, 'demos');

function existing(code: string): File | undefined {
  const dir = demoDir();
  if (!dir.exists) return undefined;
  return dir.list().find((f): f is File => f instanceof File && f.name.replace(/\.[^.]+$/, '') === code);
}

/** The saved clip's URI, or null. */
export function demoClip(code: string): string | null {
  return existing(code)?.uri ?? null;
}

/** Copies a picked clip in as the exercise's demo, replacing an earlier one. Returns the saved clip's URI. */
export async function saveDemoClip(code: string, sourceUri: string): Promise<string> {
  const dir = demoDir();
  dir.create({ intermediates: true, idempotent: true });
  deleteDemoClip(code);
  const source = new File(sourceUri);
  const ext = source.extension ? (source.extension.startsWith('.') ? source.extension : `.${source.extension}`) : '.mov';
  const dest = new File(dir, `${code}${ext}`);
  await source.copy(dest);
  return dest.uri;
}

export function deleteDemoClip(code: string): void {
  existing(code)?.delete();
}
