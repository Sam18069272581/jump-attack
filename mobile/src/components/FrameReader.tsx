import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { type StyleProp, type ViewStyle } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';

import type { FrameRequest, Grey } from '@/domain/autoMark';
import { decodeBase64, stageForGrabbing, unstage } from '@/media/frameGrabber';
import { frameGrabberHtml } from '@/media/frameGrabberHtml';
import { colors } from '@/theme';

// The library's class defaults its extra-props parameter to `undefined`, which leaves no props at all under React 19's types.
type Web = WebView<Record<never, never>>;

type Msg =
  | { type: 'ready'; duration: number; width: number; height: number }
  | { type: 'frames'; id: number; from: number; w: number; h: number; data: string }
  | { type: 'done'; id: number }
  | { type: 'error'; message: string };

export type ClipInfo = { duration: number; width: number; height: number };

export type FrameReaderHandle = {
  /** The frames `req` asks for, as grey pictures; `onProgress` hears how many have arrived. */
  read: (req: FrameRequest, onProgress?: (done: number) => void) => Promise<Grey[]>;
};

/** The page answers every seek within a few seconds; this long without a word means it is stuck. */
const SILENCE_MS = 30000;

/**
 * Reads frames out of a clip for the analysis screen: the same page as automatic marking (media/frameGrabberHtml) in a
 * WebView, which shows each frame it reads with the rectangle it reads from. `onReady` hears the clip's size once the
 * page has it, again after the page is reloaded; `onError` hears that the page can't read the clip, or went quiet.
 */
export const FrameReader = forwardRef<FrameReaderHandle, { uri: string; fileFps: number; onReady: (info: ClipInfo) => void; onError: () => void; style?: StyleProp<ViewStyle> }>(
  function FrameReader({ uri, fileFps, onReady, onError, style }, ref) {
    const web = useRef<Web>(null);
    const [stage, setStage] = useState<{ page: string; dir: string } | null>(null);
    const job = useRef<{ id: number; got: Grey[]; resolve: (g: Grey[]) => void; reject: (e: Error) => void; progress?: (n: number) => void } | null>(null);
    const nextId = useRef(1);
    const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const handlers = useRef({ onReady, onError });
    useEffect(() => {
      handlers.current = { onReady, onError };
    });

    useEffect(() => {
      let gone = false;
      let dir: string | null = null;
      stageForGrabbing(uri, (video) => frameGrabberHtml({ video, bg: colors.text, accent: colors.rim }))
        .then((s) => {
          if (gone) return unstage(s.dir);
          dir = s.dir;
          setStage(s);
        })
        .catch(() => !gone && handlers.current.onError());
      return () => {
        gone = true;
        if (timer.current) clearTimeout(timer.current);
        if (dir) unstage(dir);
      };
    }, [uri]);

    function fail() {
      if (timer.current) clearTimeout(timer.current);
      job.current?.reject(new Error('frame reader stopped'));
      job.current = null;
      handlers.current.onError();
    }

    /** iOS ended the page (memory, or the app in the background): a read under way has failed; load it again for the next. */
    function died() {
      const reading = job.current != null;
      if (timer.current) clearTimeout(timer.current);
      job.current?.reject(new Error('frame reader stopped'));
      job.current = null;
      web.current?.reload();
      if (reading) handlers.current.onError();
    }

    function hear() {
      if (timer.current) clearTimeout(timer.current);
      if (job.current) timer.current = setTimeout(fail, SILENCE_MS);
    }

    useImperativeHandle(ref, () => ({
      read(req, onProgress) {
        return new Promise<Grey[]>((resolve, reject) => {
          const id = nextId.current++;
          job.current = { id, got: [], resolve, reject, progress: onProgress };
          hear();
          const call = { id, frames: req.frames, fps: fileFps, rect: req.rect, w: req.w, h: req.h };
          web.current?.injectJavaScript(`window.grab(${JSON.stringify(call)}); true;`);
        });
      },
    }));

    function onMessage(e: WebViewMessageEvent) {
      let m: Msg;
      try {
        m = JSON.parse(e.nativeEvent.data);
      } catch {
        return;
      }
      if (m.type === 'error') return fail();
      if (m.type === 'ready') return handlers.current.onReady({ duration: m.duration, width: m.width, height: m.height });
      const j = job.current;
      if (!j || m.id !== j.id) return;
      hear();
      if (m.type === 'frames') {
        const bytes = decodeBase64(m.data);
        const size = m.w * m.h;
        for (let k = 0; k * size < bytes.length; k++) j.got[m.from + k] = { w: m.w, h: m.h, data: bytes.subarray(k * size, (k + 1) * size) };
        j.progress?.(j.got.length);
        return;
      }
      if (timer.current) clearTimeout(timer.current);
      job.current = null;
      j.resolve(j.got);
    }

    if (!stage) return null;
    return (
      <WebView<Record<never, never>>
        ref={web}
        source={{ uri: stage.page }}
        originWhitelist={['*']}
        allowingReadAccessToURL={stage.dir}
        allowFileAccess
        allowFileAccessFromFileURLs
        allowUniversalAccessFromFileURLs
        allowsInlineMediaPlayback
        mediaPlaybackRequiresUserAction={false}
        scrollEnabled={false}
        bounces={false}
        onMessage={onMessage}
        onError={fail}
        onHttpError={fail}
        onContentProcessDidTerminate={died}
        onRenderProcessGone={died}
        style={[{ backgroundColor: colors.text }, style]}
      />
    );
  },
);
