import { Directory, File, Paths } from 'expo-file-system';

/** Recordings live in the camera's temp folder; keep a copy so a trial can be re-marked later. */
export async function persistVideo(sourceUri: string, sessionId: string): Promise<string> {
  const dir = new Directory(Paths.document, 'videos');
  dir.create({ intermediates: true, idempotent: true });
  const source = new File(sourceUri);
  const ext = source.extension ? (source.extension.startsWith('.') ? source.extension : `.${source.extension}`) : '.mov';
  const dest = new File(dir, `${sessionId}-${Date.now()}${ext}`);
  await source.copy(dest);
  return dest.uri;
}

/** vision-camera returns filesystem paths; expo-video and expo-file-system want file:// URIs. */
export function toFileUri(pathOrUri: string): string {
  return pathOrUri.startsWith('file://') ? pathOrUri : `file://${pathOrUri}`;
}
