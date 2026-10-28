import { Directory, File, Paths } from 'expo-file-system';

const savedDir = () => new Directory(Paths.document, 'videos');

/**
 * Copies a recording out of the camera's temp folder. Marked clips are no longer copied (each slow-motion clip is
 * tens of MB and the original stays in the photo library), so only screens that must keep a recording use this.
 */
export async function persistVideo(sourceUri: string, sessionId: string): Promise<string> {
  const dir = savedDir();
  dir.create({ intermediates: true, idempotent: true });
  const source = new File(sourceUri);
  const ext = source.extension ? (source.extension.startsWith('.') ? source.extension : `.${source.extension}`) : '.mov';
  const dest = new File(dir, `${sessionId}-${Date.now()}${ext}`);
  await source.copy(dest);
  return dest.uri;
}

/** The copies earlier versions kept of every marked clip. */
export async function savedVideos(): Promise<{ count: number; bytes: number }> {
  const dir = savedDir();
  if (!dir.exists) return { count: 0, bytes: 0 };
  return { count: dir.list().length, bytes: dir.size ?? 0 };
}

export async function deleteSavedVideos(): Promise<void> {
  const dir = savedDir();
  if (dir.exists) dir.delete();
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
