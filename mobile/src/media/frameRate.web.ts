import { fileFpsFromFrameTimes } from '@/domain/jump';

type FrameCallback = (now: number, metadata: { mediaTime: number }) => void;
type FrameVideo = HTMLVideoElement & { requestVideoFrameCallback?: (cb: FrameCallback) => number };

/**
 * Browsers don't expose a video's frame rate, so play the clip muted and off screen and time its frames.
 * Played at 0.2× so even a 240 fps file (48 frames a second) is not faster than the screen refreshes and
 * every frame gets shown. Null when the browser can't report frames (no requestVideoFrameCallback) or the clip won't play.
 */
export function probeFrameRate(uri: string, frames = 14, timeoutMs = 5000): Promise<number | null> {
  const video = document.createElement('video') as FrameVideo;
  if (!video.requestVideoFrameCallback) return Promise.resolve(null);
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';
  video.src = uri;

  return new Promise((resolve) => {
    const times: number[] = [];
    const finish = () => {
      clearTimeout(timer);
      video.pause();
      video.removeAttribute('src');
      video.load();
      resolve(fileFpsFromFrameTimes(times));
    };
    const timer = setTimeout(finish, timeoutMs);
    const onFrame: FrameCallback = (_now, { mediaTime }) => {
      times.push(mediaTime);
      if (times.length >= frames) finish();
      else video.requestVideoFrameCallback!(onFrame);
    };
    video.requestVideoFrameCallback!(onFrame);
    video.playbackRate = 0.2;
    video.play().catch(finish);
  });
}
