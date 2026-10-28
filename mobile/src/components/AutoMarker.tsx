import { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';

import { Chip } from '@/components/ui';
import { analyseCoarse, analyseFine, coarseRequest, type DetectedJump, type DetectKind, type DetectProblem, type FinePlan, type FrameRequest, type Grey, type VideoInfo } from '@/domain/autoMark';
import { decodeBase64, stageForGrabbing, unstage } from '@/media/frameGrabber';
import { frameGrabberHtml } from '@/media/frameGrabberHtml';
import { colors, radius } from '@/theme';

// The library's class defaults its extra-props parameter to `undefined`, which leaves no props at all under React 19's types.
type Web = WebView<Record<never, never>>;

type Msg =
  | { type: 'ready'; duration: number; width: number; height: number }
  | { type: 'frames'; id: number; from: number; w: number; h: number; data: string }
  | { type: 'done'; id: number }
  | { type: 'error'; message: string };

const PROBLEMS: Record<DetectProblem | 'error', string> = {
  shaky: '画面在晃，没法自动识别。下次把手机放在地上或三脚架上；这次请手动标。',
  'no-jump': '没在这段视频里认出起跳和落地，请手动标。',
  unsure: '没把握认准起跳和落地，请手动标。',
  error: '读不到视频画面，请手动标。',
};

/** Frames the fine pass usually asks for, to make the progress bar honest before it is known. */
const FINE_GUESS = 110;
/** The page answers every seek within a few seconds; this long without a word means it is stuck. */
const SILENCE_MS = 30000;

/**
 * Finds take-off and landing (and a drop jump's touch-down) in the clip by itself, and hands the frames to the marking
 * screen to check. A small page in a WebView reads the frames; `domain/autoMark` decides. Once the athlete has marked
 * something by hand (`keep`), what it finds is only offered, never put over their marks.
 */
export function AutoMarker({
  uri,
  fileFps,
  captureFps,
  frames,
  kind,
  keep,
  onPick,
}: {
  uri: string;
  fileFps: number;
  captureFps: number;
  frames: number;
  kind: DetectKind;
  keep: boolean;
  onPick: (marks: number[]) => void;
}) {
  const web = useRef<Web>(null);
  const [stage, setStage] = useState<{ page: string; dir: string } | null>(null);
  const [state, setState] = useState<{ phase: 'running'; done: number; total: number } | { phase: 'found'; jumps: DetectedJump[]; picked: number } | { phase: 'failed'; message: string }>({
    phase: 'running',
    done: 0,
    total: 1,
  });
  const job = useRef<{ info?: VideoInfo; coarse?: FrameRequest; plan?: FinePlan; got: Grey[]; total: number }>({ got: [], total: 1 });
  const pick = useRef(onPick);
  const kept = useRef(keep);
  useEffect(() => {
    pick.current = onPick;
    kept.current = keep;
  });

  useEffect(() => {
    if (!frames) return;
    let gone = false;
    let dir: string | null = null;
    stageForGrabbing(uri, (video) => frameGrabberHtml({ video, bg: colors.surface, accent: colors.accent }))
      .then((s) => {
        if (gone) return unstage(s.dir);
        dir = s.dir;
        setStage(s);
      })
      .catch(() => !gone && setState({ phase: 'failed', message: PROBLEMS.error }));
    return () => {
      gone = true;
      if (dir) unstage(dir);
    };
  }, [uri, frames]);

  // Done or given up: the copy of the clip goes, and so does the watchdog.
  const running = state.phase === 'running';
  useEffect(() => {
    if (!running && stage) unstage(stage.dir);
  }, [running, stage]);
  const watchdog = useRef<ReturnType<typeof setTimeout> | null>(null);
  function hear() {
    if (watchdog.current) clearTimeout(watchdog.current);
    watchdog.current = setTimeout(() => fail('error'), SILENCE_MS);
  }
  useEffect(() => {
    if (!running || !stage) return;
    hear();
    return () => {
      if (watchdog.current) clearTimeout(watchdog.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- armed once the page is there, re-armed by each message
  }, [running, stage]);

  function grab(id: number, req: FrameRequest) {
    job.current.got = [];
    const call = { id, frames: req.frames, fps: fileFps, rect: req.rect, w: req.w, h: req.h };
    web.current?.injectJavaScript(`window.grab(${JSON.stringify(call)}); true;`);
  }

  function fail(problem: DetectProblem | 'error') {
    setState((s) => (s.phase === 'running' ? { phase: 'failed', message: PROBLEMS[problem] } : s));
  }

  function onMessage(e: WebViewMessageEvent) {
    if (state.phase !== 'running') return;
    hear();
    let m: Msg;
    try {
      m = JSON.parse(e.nativeEvent.data);
    } catch {
      return;
    }
    try {
      handle(m);
    } catch {
      fail('error');
    }
  }

  function handle(m: Msg) {
    const j = job.current;
    if (m.type === 'error') return fail('error');
    if (m.type === 'ready') {
      j.info = { width: m.width, height: m.height, frames, captureFps };
      j.coarse = coarseRequest(j.info);
      j.total = j.coarse.frames.length + FINE_GUESS;
      grab(1, j.coarse);
      return;
    }
    if (m.type === 'frames') {
      const bytes = decodeBase64(m.data);
      const size = m.w * m.h;
      for (let k = 0; k * size < bytes.length; k++) j.got[m.from + k] = { w: m.w, h: m.h, data: bytes.subarray(k * size, (k + 1) * size) };
      const done = (m.id === 2 ? j.coarse!.frames.length : 0) + j.got.length;
      setState({ phase: 'running', done, total: j.total });
      return;
    }
    if (m.type === 'done' && m.id === 1) {
      const r = analyseCoarse(j.info!, j.coarse!, j.got, kind);
      if (!r.ok) return fail(r.problem);
      j.plan = r.plan;
      j.total = j.coarse!.frames.length + r.plan.request.frames.length;
      grab(2, r.plan.request);
      return;
    }
    if (m.type === 'done' && m.id === 2) {
      const r = analyseFine(j.plan!, j.got);
      if (!r.ok) return fail(r.problem);
      if (kept.current) return setState({ phase: 'found', jumps: r.jumps, picked: -1 });
      setState({ phase: 'found', jumps: r.jumps, picked: 0 });
      pick.current(r.jumps[0].marks);
    }
  }

  function choose(i: number) {
    if (state.phase !== 'found') return;
    setState({ ...state, picked: i });
    onPick(state.jumps[i].marks);
  }

  return (
    <View style={styles.card}>
      {state.phase === 'running' && (
        <View style={styles.row}>
          <View style={styles.preview}>
            {stage && (
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
                onError={() => fail('error')}
                onHttpError={() => fail('error')}
                onContentProcessDidTerminate={() => fail('error')}
                onRenderProcessGone={() => fail('error')}
                style={{ backgroundColor: colors.surface }}
              />
            )}
          </View>
          <View style={{ flex: 1, gap: 8 }}>
            <Text style={styles.title}>正在自动找起跳和落地…</Text>
            <View style={styles.track}>
              <View style={[styles.bar, { width: `${Math.round((100 * Math.min(state.done, state.total)) / state.total)}%` }]} />
            </View>
            <Text style={styles.hint}>也可以不等，直接手动标。</Text>
          </View>
        </View>
      )}
      {state.phase === 'found' && (
        <View style={{ gap: 8 }}>
          <Text style={styles.title}>
            {state.picked < 0 ? '自动也找到了，你标的没动' : state.jumps.length > 1 ? `认出 ${state.jumps.length} 跳，已标好第 ${state.picked + 1} 跳` : '已自动标好'}
          </Text>
          {(state.jumps.length > 1 || state.picked < 0) && (
            <View style={styles.chips}>
              {state.jumps.map((jmp, i) => (
                <Chip
                  key={jmp.marks.join('-')}
                  label={`${state.picked < 0 ? '换成自动找到的' : ''}${state.jumps.length > 1 ? `第 ${i + 1} 跳` : '帧'} · ${Math.round(jmp.flightS * 1000)} ms`}
                  selected={i === state.picked}
                  onPress={() => choose(i)}
                />
              ))}
            </View>
          )}
          <Text style={styles.hint}>点下面的帧号跳过去核对；不准就逐帧调一下再重新标。</Text>
        </View>
      )}
      {state.phase === 'failed' && <Text style={styles.hint}>{state.message}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: radius.card, backgroundColor: colors.surface, padding: 12 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  preview: { width: 54, height: 96, borderRadius: 8, overflow: 'hidden', backgroundColor: colors.bg },
  title: { color: colors.text, fontSize: 14, fontWeight: '700' },
  hint: { color: colors.textMuted, fontSize: 12, lineHeight: 18 },
  track: { height: 6, borderRadius: 3, backgroundColor: colors.border },
  bar: { height: 6, borderRadius: 3, backgroundColor: colors.accent },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
});
