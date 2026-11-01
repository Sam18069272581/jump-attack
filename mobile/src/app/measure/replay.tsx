import { File, Paths } from 'expo-file-system';
import { useLocalSearchParams } from 'expo-router';
import * as Sharing from 'expo-sharing';
import { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';

import { PoseReader, type ClipInfo, type PoseReaderHandle } from '@/components/PoseReader';
import { PulseProgress } from '@/components/PulseProgress';
import { Button, Empty } from '@/components/ui';
import { analysisKindFor } from '@/domain/analysisTrials';
import { toISODate } from '@/domain/dates';
import { comSamples, jumpPhases, phaseFrames, type JumpPhases, type JumpPhasesProblem } from '@/domain/jumpPhases';
import { analyseJumps, type JumpEvents } from '@/domain/jumpAnalysis';
import { getMetric } from '@/domain/metrics';
import { startFrom } from '@/domain/poseJump';
import { framesFromWire } from '@/domain/techniqueRead';
import { tr } from '@/i18n';
import { stageForGrabbing, unstage } from '@/media/frameGrabber';
import { replayConfig } from '@/media/replayConfig';
import { replayHtml } from '@/media/replayHtml';
import { colors, radius } from '@/theme';

type Web = WebView<Record<never, never>>;

type Msg =
  | { type: 'ready' }
  | { type: 'progress'; done: number; total: number }
  | { type: 'file'; mime: string; part: number; parts: number; data: string }
  | { type: 'cancelled' }
  | { type: 'unsupported' }
  | { type: 'error'; message: string };

/** Why a video goes out without the phases. */
const NO_PHASES: Record<JumpPhasesProblem, string> = {
  gaps: '没拍到全身，或者骨架跟丢了，这次导出不标离心和向心。',
  flight: '腾空那段没读全，定不了比例，这次导出不标离心和向心。',
  jitter: '骨架抖得太厉害，阶段分不准，这次导出不标离心和向心。',
  'no-quiet': '起跳前没先站稳一下，这次导出不标离心和向心。',
};

type PhasesState = { name: 'reading'; done: number; total: number } | { name: 'settled'; phases: JumpPhases | null; why?: string };

/**
 * Replays an analysed set in slow motion with its numbers on top (media/replayHtml), and exports it as a portrait video
 * for the share sheet: save to Photos, send to the team, post it. For a standing jump it first reads the athlete's
 * skeleton through the best jump (components/PoseReader), so the video can carry its eccentric, concentric and flight
 * phases (domain/jumpPhases); the pose page and the replay page don't run side by side, each holds a copy of the clip.
 */
export default function Replay() {
  const params = useLocalSearchParams<{ uri: string; metric: string; fileFps: string; captureFps: string; from: string; to: string; events: string; box?: string; focus?: string }>();
  const def = getMetric(params.metric);
  const kind = def ? analysisKindFor(def) : null;
  const web = useRef<Web>(null);
  const file = useRef<File | null>(null);
  const [stage, setStage] = useState<{ page: string; dir: string } | null>(null);
  // A problem that `retry` allows: the export can be tried again (the page itself still works).
  const [state, setState] = useState<{ name: 'loading' | 'ready' | 'sharing' } | { name: 'exporting'; done: number; total: number } | { name: 'problem'; text: string; retry?: boolean }>({
    name: 'loading',
  });

  const analysis = useMemo(() => {
    if (!kind) return null;
    const events = JSON.parse(params.events) as (JumpEvents & { counted: boolean })[];
    return analyseJumps(events, { kind, captureFps: Number(params.captureFps), boxCm: Number(params.box) || undefined, keep: events.flatMap((e, i) => (e.counted ? [i] : [])) });
  }, [kind, params.events, params.captureFps, params.box]);
  // The phases are for a standing jump: the highest one counted.
  const best = useMemo(() => {
    if (kind !== 'jump' || !analysis) return null;
    const counted = analysis.jumps.filter((j) => j.counted);
    return counted.length ? counted.reduce((a, b) => (b.jhCm > a.jhCm ? b : a)).events : null;
  }, [kind, analysis]);
  const [phases, setPhases] = useState<PhasesState>(() => (best ? { name: 'reading', done: 0, total: 1 } : { name: 'settled', phases: null }));
  const pose = useRef<PoseReaderHandle>(null);
  const reading = useRef<'idle' | 'running' | 'over'>('idle');

  const config = useMemo(() => {
    if (!def || !kind || !analysis || phases.name !== 'settled') return null;
    return replayConfig({
      def,
      kind,
      analysis,
      video: '',
      fileFps: Number(params.fileFps),
      captureFps: Number(params.captureFps),
      from: Number(params.from),
      to: Number(params.to),
      date: toISODate(new Date()),
      colors: { ink: colors.text, paper: colors.bg, card: colors.surface, accent: colors.accent, rim: colors.rim, muted: colors.textMuted, touch: colors.purple },
      ...(params.focus ? { focus: JSON.parse(params.focus) } : {}),
      phases: phases.phases,
    });
  }, [def, kind, analysis, phases, params.captureFps, params.fileFps, params.from, params.to, params.focus]);

  useEffect(
    () => () => {
      reading.current = 'over';
    },
    [],
  );

  function settle(found: JumpPhases | null, why?: string) {
    if (reading.current === 'over') return;
    reading.current = 'over';
    setPhases({ name: 'settled', phases: found, ...(why ? { why } : {}) });
  }

  /** Every frame of the best jump through the pose model, then its centre of mass into the phases. */
  async function readPhases(clip: ClipInfo) {
    const r = pose.current;
    if (!best || !r || reading.current !== 'idle') return;
    reading.current = 'running';
    const fps = Number(params.captureFps);
    const frames = phaseFrames(best, fps, Number(params.from));
    setPhases({ name: 'reading', done: 0, total: frames.length });
    try {
      const start = startFrom(framesFromWire(await r.everyone([frames[0]]), clip.width, clip.height, fps));
      if (!start) return settle(null, tr('骨架识别没找到人，这次导出不标离心和向心。'));
      const wire = await r.follow(frames, start.at, (n) => reading.current === 'running' && setPhases({ name: 'reading', done: n, total: frames.length }));
      const samples = comSamples(framesFromWire(wire, clip.width, clip.height, fps), clip, start.at);
      const jp = jumpPhases({ samples, takeoffS: best.takeoff / fps, landingS: best.landing / fps, fps });
      settle(jp.ok ? jp.result : null, jp.ok ? undefined : tr(NO_PHASES[jp.problem]));
    } catch {
      settle(null, tr('骨架识别没能启动，这次导出不标离心和向心。'));
    }
  }

  useEffect(() => {
    if (!config) return;
    let gone = false;
    let dir: string | null = null;
    stageForGrabbing(params.uri, (video) => replayHtml({ ...config, video }))
      .then((s) => {
        if (gone) return unstage(s.dir);
        dir = s.dir;
        setStage(s);
      })
      .catch(() => !gone && setState({ name: 'problem', text: tr('视频打不开') }));
    return () => {
      gone = true;
      if (dir) unstage(dir);
    };
  }, [params.uri, config]);

  const call = (js: string) => web.current?.injectJavaScript(`${js}; true;`);

  function startExport() {
    setState({ name: 'exporting', done: 0, total: 1 });
    call('window.replay.exportVideo()');
  }

  /** Drops a video written in part, or already shared: each export is a new file, and the cache is no place to keep them. */
  function dropFile() {
    try {
      file.current?.delete();
    } catch {
      // Already gone.
    }
    file.current = null;
  }

  /** iOS ended the page (memory, or the app in the background): load it again, and say what happened to an export. */
  function died() {
    const exporting = state.name === 'exporting';
    dropFile();
    setState(exporting ? { name: 'problem', text: tr('导出中断：手机把回放页面关掉了，页面重新加载后可以再导出一次。'), retry: true } : { name: 'loading' });
    web.current?.reload();
  }

  async function onMessage(e: WebViewMessageEvent) {
    let m: Msg;
    try {
      m = JSON.parse(e.nativeEvent.data);
    } catch {
      return;
    }
    if (m.type === 'ready') {
      setState({ name: 'ready' });
      return call('window.replay.play()');
    }
    if (m.type === 'progress') return setState({ name: 'exporting', done: m.done, total: m.total });
    if (m.type === 'cancelled') return setState({ name: 'ready' });
    if (m.type === 'unsupported') return setState({ name: 'problem', text: tr('这台手机的系统录不了这个画面。可以点「再放一次」，用系统录屏录下来。') });
    if (m.type === 'error') return setState({ name: 'problem', text: tr('出错了：{message}', { message: m.message }), retry: true });
    // The video arrives in parts, each written as it comes: base64 to bytes, no copy of the whole video in memory.
    const mp4 = m.mime.includes('mp4');
    try {
      if (m.part === 0) {
        file.current = new File(Paths.cache, `jump-attack-${params.metric}-${Date.now()}.${mp4 ? 'mp4' : 'webm'}`);
        file.current.create({ overwrite: true });
      }
      if (!file.current) return;
      file.current.write(m.data, m.part === 0 ? { encoding: 'base64' } : { encoding: 'base64', append: true });
    } catch (err) {
      dropFile();
      return setState({ name: 'problem', text: tr('导出失败：{p}', { p: err instanceof Error ? err.message : String(err) }), retry: true });
    }
    if (m.part < m.parts - 1) return;
    setState({ name: 'sharing' });
    try {
      await Sharing.shareAsync(file.current.uri, { mimeType: mp4 ? 'video/mp4' : 'video/webm', UTI: mp4 ? 'public.mpeg-4' : 'org.webmproject.webm', dialogTitle: tr('保存或分享视频') });
      setState({ name: 'ready' });
    } catch (err) {
      setState({ name: 'problem', text: tr('分享失败：{p}', { p: err instanceof Error ? err.message : String(err) }), retry: true });
    } finally {
      dropFile();
    }
  }

  if (!def || !kind) return <Empty title={tr('这个项目不能回放')} />;
  const exporting = state.name === 'exporting';
  const canExport = state.name === 'ready' || (state.name === 'problem' && state.retry === true);

  return (
    <SafeAreaView style={styles.screen} edges={['bottom']}>
      <View style={styles.stage}>
        {phases.name === 'reading' && (
          <PoseReader ref={pose} uri={params.uri} fileFps={Number(params.fileFps)} onReady={readPhases} onError={() => settle(null, tr('骨架识别没能启动，这次导出不标离心和向心。'))} style={StyleSheet.absoluteFill} />
        )}
        {stage && phases.name === 'settled' && (
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
            onError={() => setState({ name: 'problem', text: tr('视频打不开') })}
            onContentProcessDidTerminate={died}
            onRenderProcessGone={died}
            style={{ backgroundColor: colors.bg }}
          />
        )}
      </View>
      <View style={styles.footer}>
        {phases.name === 'reading' && (
          <>
            <PulseProgress progress={phases.done / phases.total} label={tr('正在读骨架，分离心和向心…')} />
            <Button label={tr('跳过，不标阶段')} variant="ghost" onPress={() => settle(null)} />
          </>
        )}
        {exporting && <PulseProgress progress={state.done / state.total} label={tr('正在导出视频…')} />}
        {state.name === 'problem' && <Text style={styles.problem}>{state.text}</Text>}
        <View style={styles.row}>
          <Button label={tr('再放一次')} variant="secondary" onPress={() => call('window.replay.play()')} disabled={state.name === 'loading' || exporting} style={{ flex: 1 }} />
          <Button label={tr('导出视频')} onPress={startExport} disabled={!canExport} busy={exporting || state.name === 'sharing'} style={{ flex: 1 }} />
        </View>
        {phases.name === 'settled' && phases.why && <Text style={styles.why}>{phases.why}</Text>}
        <Text style={styles.note}>
          {phases.name === 'settled' && phases.phases
            ? tr('竖屏 720 × 1280，带水印、跳高、估算的发力趋势、离心向心用时和起跳速度，可以存到相册或直接发出去。')
            : tr('竖屏 720 × 1280，带水印、起跳曲线和每跳数据，可以存到相册或直接发出去。')}
        </Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  stage: { flex: 1, margin: 12, borderRadius: radius.card, overflow: 'hidden' },
  footer: { paddingHorizontal: 16, paddingTop: 4, gap: 8 },
  row: { flexDirection: 'row', gap: 10 },
  problem: { color: colors.warn, fontSize: 13, lineHeight: 19 },
  why: { color: colors.textMuted, fontSize: 13, lineHeight: 19 },
  note: { color: colors.textMuted, fontSize: 11, textAlign: 'center' },
});
