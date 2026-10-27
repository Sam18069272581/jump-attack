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

/**
 * Puts a clip and the page that tracks it in one fresh folder, so the WebView can be given read access to exactly
 * that folder and the page can load the clip by its name. Returns the page's file:// URI and the folder's.
 */
export async function stageForTracking(videoUri: string, page: (videoName: string) => string): Promise<{ page: string; dir: string }> {
  const dir = new Directory(Paths.cache, 'bar-track');
  if (dir.exists) dir.delete();
  dir.create({ intermediates: true, idempotent: true });
  const source = new File(videoUri);
  const ext = source.extension ? (source.extension.startsWith('.') ? source.extension : `.${source.extension}`) : '.mov';
  const clip = new File(dir, `clip-${Date.now()}${ext}`);
  await source.copy(clip);
  const html = new File(dir, 'track.html');
  html.write(page(clip.name));
  return { page: html.uri, dir: dir.uri };
}
