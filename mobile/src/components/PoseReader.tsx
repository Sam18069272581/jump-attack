import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { type StyleProp, type ViewStyle } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';

import type { Pt } from '@/domain/pose';
import type { Square, WireFrame } from '@/domain/techniqueRead';
import { tr } from '@/i18n';
import { stagePosePage, unstagePosePage } from '@/media/poseLib';
import { poseReaderHtml } from '@/media/poseReaderHtml';
import { colors } from '@/theme';

// The library's class defaults its extra-props parameter to `undefined`, which leaves no props at all under React 19's types.
type Web = WebView<Record<never, never>>;

type Msg =
  | { type: 'ready'; duration: number; width: number; height: number }
  | { type: 'model'; delegate: string; source: string }
  | { type: 'poses'; id: number; items: WireFrame[] }
  | { type: 'lost'; id: number; frame: number }
  | { type: 'done'; id: number }
  | { type: 'error'; message: string; stage?: string };

export type ClipInfo = { duration: number; width: number; height: number };

export type PoseReaderHandle = {
  /** The frames in the order given, following the athlete from `at` (video px) in the first; stops where it loses them. */
  follow: (frames: number[], at: Pt, onProgress?: (done: number) => void) => Promise<WireFrame[]>;
  /** Each frame read in its own square. */
  crops: (frames: number[], squares: Square[], onProgress?: (done: number) => void) => Promise<WireFrame[]>;
  /** Everyone in each frame, searched for across the whole picture (slower): where to start following when nobody tapped. */
  everyone: (frames: number[], onProgress?: (done: number) => void) => Promise<WireFrame[]>;
};

/** The page answers every frame within a second or two, and starts the model within several; this long without a word means it is stuck. */
const SILENCE_MS = 30000;

/**
 * Reads people's poses out of a clip for the technique analysis: the pose page (media/poseReaderHtml.ts) in a WebView,
 * which shows each frame it reads with the square it reads and the athlete's skeleton. `onReady` hears the clip's size
 * once the page has it, again after the page is reloaded; `onError` hears that the page can't read the clip, can't run
 * the model, or went quiet.
 */
export const PoseReader = forwardRef<PoseReaderHandle, { uri: string; fileFps: number; onReady: (info: ClipInfo) => void; onError: (message: string) => void; style?: StyleProp<ViewStyle> }>(
  function PoseReader({ uri, fileFps, onReady, onError, style }, ref) {
    const web = useRef<Web>(null);
    const [stage, setStage] = useState<{ page: string; dir: string; root: string } | null>(null);
    const job = useRef<{ id: number; got: WireFrame[]; resolve: (items: WireFrame[]) => void; reject: (e: Error) => void; progress?: (n: number) => void } | null>(null);
    const nextId = useRef(1);
    const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
    /** Whether the page has said it has the clip since it was loaded: a request made before then waits for it. */
    const loaded = useRef(false);
    const waiting = useRef<string | null>(null);
    const handlers = useRef({ onReady, onError });
    useEffect(() => {
      handlers.current = { onReady, onError };
    });

    useEffect(() => {
      let gone = false;
      let dir: string | null = null;
      stagePosePage((clip) => poseReaderHtml({ video: clip!, bg: colors.text, accent: colors.rim }), uri)
        .then((s) => {
          if (gone) return unstagePosePage(s.dir);
          dir = s.dir;
          setStage(s);
        })
        .catch((e) => !gone && fail(String(e)));
      return () => {
        gone = true;
        if (timer.current) clearTimeout(timer.current);
        if (dir) unstagePosePage(dir);
      };
    }, [uri]);

    function fail(message: string) {
      if (timer.current) clearTimeout(timer.current);
      job.current?.reject(new Error(message));
      job.current = null;
      handlers.current.onError(message);
    }

    /** iOS ended the page (memory, or the app in the background): a read under way has failed; load it again for the next. */
    function died() {
      const reading = job.current != null;
      const message = tr('手机把识别页面关掉了');
      if (timer.current) clearTimeout(timer.current);
      // The read's own failure says the same as onError: whichever the screen hears last is what the athlete reads.
      job.current?.reject(new Error(message));
      job.current = null;
      loaded.current = false;
      waiting.current = null;
      web.current?.reload();
      if (reading) handlers.current.onError(message);
    }

    function hear() {
      if (timer.current) clearTimeout(timer.current);
      if (job.current) timer.current = setTimeout(() => fail(tr('识别页面没有反应了')), SILENCE_MS);
    }

    function ask(call: string, req: Record<string, unknown>, onProgress?: (n: number) => void) {
      return new Promise<WireFrame[]>((resolve, reject) => {
        const id = nextId.current++;
        job.current = { id, got: [], resolve, reject, progress: onProgress };
        hear();
        const js = `window.${call}(${JSON.stringify({ id, fps: fileFps, ...req })}); true;`;
        if (loaded.current) web.current?.injectJavaScript(js);
        else waiting.current = js;
      });
    }

    useImperativeHandle(ref, () => ({
      follow: (frames, at, onProgress) => ask('follow', { frames, at }, onProgress),
      crops: (frames, squares, onProgress) => ask('crops', { frames, crops: squares }, onProgress),
      everyone: (frames, onProgress) => ask('everyone', { frames }, onProgress),
    }));

    function onMessage(e: WebViewMessageEvent) {
      let m: Msg;
      try {
        m = JSON.parse(e.nativeEvent.data);
      } catch {
        return;
      }
      if (m.type === 'error') return fail(m.stage === 'model' ? tr('骨架识别启动不了：{message}', { message: m.message }) : m.message);
      if (m.type === 'ready') {
        loaded.current = true;
        if (waiting.current) web.current?.injectJavaScript(waiting.current);
        waiting.current = null;
        return handlers.current.onReady({ duration: m.duration, width: m.width, height: m.height });
      }
      if (m.type === 'model') return hear();
      const j = job.current;
      if (!j || m.id !== j.id) return;
      hear();
      if (m.type === 'poses') {
        j.got.push(...m.items);
        j.progress?.(j.got.length);
        return;
      }
      if (m.type === 'lost') return;
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
        // The page reads the library from beside its own folder (media/poseLib.ts).
        allowingReadAccessToURL={stage.root}
        allowFileAccess
        allowFileAccessFromFileURLs
        allowUniversalAccessFromFileURLs
        allowsInlineMediaPlayback
        mediaPlaybackRequiresUserAction={false}
        scrollEnabled={false}
        bounces={false}
        onMessage={onMessage}
        onError={() => fail(tr('识别页面打不开'))}
        onHttpError={() => fail(tr('识别页面打不开'))}
        onContentProcessDidTerminate={died}
        onRenderProcessGone={died}
        style={[{ backgroundColor: colors.text }, style]}
      />
    );
  },
);
