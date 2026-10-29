import Slider from '@react-native-community/slider';
import { useEventListener } from 'expo';
import { useKeepAwake } from 'expo-keep-awake';
import { router, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useVideoPlayer, VideoView, type VideoPlayer } from 'expo-video';
import { useEffect, useRef, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Rise, tick } from '@/components/motion';
import { PoseReader, type ClipInfo, type PoseReaderHandle } from '@/components/PoseReader';
import { PulseProgress } from '@/components/PulseProgress';
import { Button, Chip } from '@/components/ui';
import { addTechniqueTake, reachByDay, type TechniqueSource } from '@/db/technique';
import { toISODate } from '@/domain/dates';
import { frameCount, frameToSeconds, markingRates } from '@/domain/jump';
import { APPROACH_TOUCH } from '@/domain/metrics';
import type { Pt } from '@/domain/pose';
import { analyseTechnique, type Markers, type TechniqueProblem, type TechniqueResult } from '@/domain/technique';
import { coarseFrames, coarseStep, denseFrames, denseSquares, framesFromWire, JUMP_WINDOW, MARKER_GAP_M, planWindow, TAP_REACH_S, windowOf } from '@/domain/techniqueRead';
import { FLAG_TEXT, formatError, formatMeasured, METRIC_ORDER, METRIC_TEXT, PROBLEM_TEXT } from '@/domain/techniqueText';
import { localized, tr } from '@/i18n';
import { useAthlete } from '@/state/athlete';
import { colors, fonts, radius } from '@/theme';

const FPS_CHOICES = [60, 120, 240];

/** A floor line is tapped twice: roughly, then on the picture zoomed this much around the first tap. */
const ZOOM = 4;

/** What the next tap on the picture places. */
type Step = 'athlete' | 'takeoff' | 'back';
const STEPS: { key: Step; label: string; color: string }[] = localized([
  { key: 'athlete', label: '运动员', color: colors.accent },
  { key: 'takeoff', label: '起跳线', color: colors.rim },
  { key: 'back', label: '3 米线', color: colors.purple },
], 'label');

type Phase =
  | { name: 'setup' }
  | { name: 'running'; done: number; total: number; label: string }
  | { name: 'done'; result: TechniqueResult }
  | { name: 'failed'; problem: TechniqueProblem | 'error'; message?: string };

// AVPlayer seeks exactly by default (zero tolerance), so this lands on the requested frame.
function seekToFrame(player: VideoPlayer, frame: number, fps: number) {
  player.currentTime = frameToSeconds(frame, fps);
}

// The page says why (it can't decode the clip, the model won't start, iOS closed it): trying again comes first.
const READ_FAILED = localized({ what: '没分析完', advice: '点「重新点选」再分析一次，分析时别切到别的 App；还不行就换一段视频。' });

/** Keeps the screen on while it is shown: nobody touches the phone during a read, and Auto-Lock would end the page. */
function StayAwake() {
  useKeepAwake('technique-analyse');
  return null;
}

function styleText(s: TechniqueResult['style']): string {
  return s.kind === 'two' ? tr('双脚起跳') : tr('单脚起跳（{p}脚）', { p: s.foot === 'left' ? tr('左') : tr('右') });
}

/**
 * Measures a run-up jump from a side-on clip (domain/technique.ts): the athlete scrubs to the jump and taps themselves,
 * then the two floor lines (the take-off spot and 3 m back), each on a zoomed picture. The pose page reads the clip
 * around the tap (domain/techniqueRead.ts) and the screen shows every figure with its error, beside the day's run-up
 * touch. It only measures: no diagnosis.
 */
export default function TechniqueAnalyse() {
  const params = useLocalSearchParams<{ uri: string; fps: string; source: TechniqueSource; session: string }>();
  const db = useSQLiteContext();
  const { current } = useAthlete();
  const camera = params.source === 'camera';
  const player = useVideoPlayer(params.uri, (p) => {
    p.muted = true;
    p.pause();
  });
  const reader = useRef<PoseReaderHandle>(null);

  const [duration, setDuration] = useState(0);
  const [detectedFps, setDetectedFps] = useState<number | null>(null);
  const [captureOverride, setCaptureOverride] = useState<number | null>(null);
  const [clip, setClip] = useState<ClipInfo | null>(null);
  const [frame, setFrame] = useState(0);
  const [view, setView] = useState({ w: 0, h: 0 });
  const [step, setStep] = useState<Step | null>('athlete');
  const [athlete, setAthlete] = useState<{ frame: number; at: Pt } | null>(null);
  const [lines, setLines] = useState<{ takeoff?: Pt; back?: Pt }>({});
  const [skipLines, setSkipLines] = useState(false);
  const [zoom, setZoom] = useState<Pt | null>(null);
  const [phase, setPhase] = useState<Phase>({ name: 'setup' });
  const [reach, setReach] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  /** Bumped to read the clip on a fresh page after the page failed: the clip wouldn't open, the model wouldn't start. */
  const [readerRun, setReaderRun] = useState(0);

  useEventListener(player, 'sourceLoad', ({ duration: d, availableVideoTracks }) => {
    setDuration(d);
    const rate = availableVideoTracks[0]?.frameRate;
    if (rate && rate > 0) setDetectedFps(Math.round(rate));
  });

  const athleteId = current?.id;
  useEffect(() => {
    if (athleteId != null) reachByDay(db, athleteId).then((days) => setReach(days[toISODate(new Date())] ?? null));
  }, [db, athleteId]);

  // A take filmed in the app is at its real rate; a clip from the library may be slow motion.
  const { file: fileFps, capture: fps } = markingRates({ detected: detectedFps, chosen: camera ? null : captureOverride, reported: Number(params.fps) || 0 });
  const total = frameCount(duration || clip?.duration || 0, fileFps);
  const looksSlowMo = !camera && detectedFps != null && detectedFps < 100;
  const fpsChoices = detectedFps == null ? FPS_CHOICES : [fileFps, ...FPS_CHOICES.filter((f) => f > fileFps)];
  const markers: Markers | null = !skipLines && lines.takeoff && lines.back ? { a: lines.back, b: lines.takeoff, distanceM: MARKER_GAP_M } : null;
  const linesDone = skipLines || markers != null;

  function show(f: number) {
    setFrame(f);
    seekToFrame(player, f, fileFps);
  }

  // Video pixels ↔ the video box on screen (the player letterboxes the picture).
  const fit = clip && view.w ? Math.min(view.w / clip.width, view.h / clip.height) : 0;
  const ox = clip ? (view.w - clip.width * fit) / 2 : 0;
  const oy = clip ? (view.h - clip.height * fit) / 2 : 0;
  const onScreen = (p: Pt) => ({ x: ox + p.x * fit, y: oy + p.y * fit });

  const nextStep = (a: typeof athlete, l: typeof lines, skip: boolean): Step | null =>
    !a ? 'athlete' : skip ? null : !l.takeoff ? 'takeoff' : !l.back ? 'back' : null;

  function tap(x: number, y: number) {
    if (!clip || !fit || phase.name !== 'setup' || !step) return;
    // On the zoomed picture, back to where it is on the whole one.
    const p = zoom ? { x: zoom.x + (x - view.w / 2) / ZOOM, y: zoom.y + (y - view.h / 2) / ZOOM } : { x, y };
    const v = { x: (p.x - ox) / fit, y: (p.y - oy) / fit };
    if (v.x < 0 || v.y < 0 || v.x > clip.width || v.y > clip.height) return;
    tick();
    if (step === 'athlete') {
      const a = { frame, at: v };
      setAthlete(a);
      return setStep(nextStep(a, lines, skipLines));
    }
    if (!zoom) return setZoom(p);
    setZoom(null);
    const l = { ...lines, [step]: v };
    setLines(l);
    setStep(nextStep(athlete, l, skipLines));
  }

  function pick(s: Step) {
    setZoom(null);
    if (s !== 'athlete') setSkipLines(false);
    setStep(s);
  }

  function skip() {
    setZoom(null);
    setSkipLines(true);
    setLines({});
    setStep(nextStep(athlete, {}, true));
  }

  async function analyse() {
    const r = reader.current;
    if (!clip || !r || !athlete) return;
    const { width, height } = clip;
    const { forward, backward } = coarseFrames(athlete.frame, total, coarseStep(fps), Math.round(TAP_REACH_S * fps));
    const coarseCount = forward.length + backward.length;
    // The close reading usually asks for the window's frames the coarse pass skipped; the bar is honest once it is known.
    const guess = coarseCount + Math.round((JUMP_WINDOW.before + JUMP_WINDOW.after) * fps * (1 - 1 / coarseStep(fps)));
    const label1 = tr('跟住运动员，粗扫前后 3 秒');
    setPhase({ name: 'running', done: 0, total: guess, label: label1 });
    try {
      const ahead = await r.follow(forward, athlete.at, (n) => setPhase({ name: 'running', done: n, total: guess, label: label1 }));
      const behind = await r.follow(backward, athlete.at, (n) => setPhase({ name: 'running', done: forward.length + n, total: guess, label: label1 }));
      const coarseWire = [...ahead, ...behind];
      const coarse = framesFromWire(coarseWire, width, height, fps);
      const plan = planWindow(coarse, fps, athlete.at);
      if (!plan.ok) return setPhase({ name: 'failed', problem: plan.problem });
      const dense = denseFrames(plan.win, total, coarse.map((f) => f.frame));
      const sum = coarseCount + dense.length;
      const label2 = tr('逐帧读起跳前后');
      const fine = dense.length ? await r.crops(dense, denseSquares(coarse, plan.win.target, dense), (n) => setPhase({ name: 'running', done: coarseCount + n, total: sum, label: label2 })) : [];
      const frames = windowOf(framesFromWire([...coarseWire, ...fine], width, height, fps), plan.win);
      const res = analyseTechnique({ frames, captureFps: fps, markers, target: plan.win.target });
      if (!res.ok) return setPhase({ name: 'failed', problem: res.problem });
      setPhase({ name: 'done', result: res.result });
      show(res.result.events.takeoff);
    } catch (e) {
      setPhase({ name: 'failed', problem: 'error', message: e instanceof Error ? e.message : String(e) });
    }
  }

  async function save() {
    if (phase.name !== 'done' || !current) return;
    setSaving(true);
    try {
      await addTechniqueTake(db, current.id, { sessionId: params.session, result: phase.result, captureFps: fps, source: camera ? 'camera' : 'import', markers, videoUri: camera ? params.uri : null });
      router.back();
    } catch (e) {
      Alert.alert(tr('保存失败'), String(e));
      setSaving(false);
    }
  }

  const running = phase.name === 'running';
  const result = phase.name === 'done' ? phase.result : null;
  const ready = clip != null && total > 0 && athlete != null && linesDone;
  const startLabel = !clip ? tr('正在读取视频…') : !athlete ? tr('先点运动员') : !linesDone ? tr('先点两条线，或者跳过') : tr('开始分析');
  const failure = phase.name === 'failed' ? (phase.problem === 'error' ? READ_FAILED : PROBLEM_TEXT[phase.problem]) : null;
  const marks = [
    ...(athlete ? [{ key: 'athlete', at: athlete.at, color: colors.accent, label: '' }] : []),
    ...(!skipLines && lines.takeoff ? [{ key: 'takeoff', at: lines.takeoff, color: colors.rim, label: tr('起跳线') }] : []),
    ...(!skipLines && lines.back ? [{ key: 'back', at: lines.back, color: colors.purple, label: tr('3 米') }] : []),
  ];

  return (
    <SafeAreaView style={styles.screen} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        <View
          accessibilityLabel={tr('视频')}
          style={[styles.video, { aspectRatio: clip ? Math.max(0.75, clip.width / clip.height) : 16 / 9 }]}
          onLayout={(e: LayoutChangeEvent) => setView({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}
        >
          <View
            style={[
              StyleSheet.absoluteFill,
              // Zoomed in around the rough tap, which moves to the middle of the box.
              zoom && { transform: [{ translateX: -ZOOM * (zoom.x - view.w / 2) }, { translateY: -ZOOM * (zoom.y - view.h / 2) }, { scale: ZOOM }] },
            ]}
          >
            <VideoView player={player} nativeControls={false} contentFit="contain" style={StyleSheet.absoluteFill} />
          </View>
          {/* The page that reads poses: hidden until it runs, then it shows each frame it reads with the athlete's skeleton. */}
          <View style={[StyleSheet.absoluteFill, { opacity: running ? 1 : 0.01 }]} pointerEvents="none">
            <PoseReader
              key={readerRun}
              ref={reader}
              uri={params.uri}
              fileFps={fileFps}
              onReady={setClip}
              onError={(message) => setPhase((p) => (p.name === 'done' ? p : { name: 'failed', problem: 'error', message }))}
              style={StyleSheet.absoluteFill}
            />
          </View>
          {!zoom &&
            !running &&
            fit > 0 &&
            marks.map((m) => {
              const s = onScreen(m.at);
              return m.key === 'athlete' ? (
                <View key={m.key} pointerEvents="none" style={[styles.target, { left: s.x - 18, top: s.y - 18, borderColor: m.color }]} />
              ) : (
                <View key={m.key} pointerEvents="none" style={[styles.line, { left: s.x - 1, top: s.y - 24, backgroundColor: m.color }]}>
                  <Text style={[styles.lineText, { backgroundColor: m.color }]}>{m.label}</Text>
                </View>
              );
            })}
          {zoom && <View pointerEvents="none" style={[styles.cross, { left: view.w / 2 - 14, top: view.h / 2 - 14 }]} />}
          {phase.name === 'setup' && (
            <Pressable accessibilityRole="button" accessibilityLabel={tr('点画面')} style={StyleSheet.absoluteFill} onPress={(e) => tap(e.nativeEvent.locationX, e.nativeEvent.locationY)} />
          )}
          {!running && (
            <View style={styles.badge} pointerEvents="none">
              <Text style={styles.badgeText}>#{frame}</Text>
              <Text style={styles.badgeTime}>{(frame / fps).toFixed(2)} s</Text>
            </View>
          )}
        </View>

        {!running && (
          <Slider
            accessibilityLabel={tr('画面位置')}
            minimumValue={0}
            maximumValue={Math.max(1, total - 1)}
            step={1}
            value={frame}
            onValueChange={(v) => {
              setZoom(null);
              show(Math.round(v));
            }}
            minimumTrackTintColor={colors.accent}
            maximumTrackTintColor={colors.border}
            thumbTintColor={colors.text}
          />
        )}

        {phase.name === 'setup' && (
          <>
            <View style={styles.steps}>
              {STEPS.map((s) => {
                const placed = s.key === 'athlete' ? athlete != null : !skipLines && lines[s.key] != null;
                return <Chip key={s.key} label={`${placed ? '✓ ' : ''}${s.label}`} selected={step === s.key} color={s.color} onPress={() => pick(s.key)} />;
              })}
            </View>
            <Text style={styles.lead}>
              {zoom
                ? tr('放大了：点准胶带上运动员跑过的那一点。')
                : step === 'athlete'
                  ? tr('拖动进度条到起跳前后，点一下运动员。')
                  : step === 'takeoff'
                    ? tr('点起跳线：先点胶带大概的位置，放大后再点准运动员跑过的那一点。')
                    : step === 'back'
                      ? tr('点 3 米线（起跳线往回 3 米的那条），一样点两下。')
                      : skipLines
                        ? tr('没点地上的线：不测助跑速度，长度按重力换算。')
                        : tr('都点好了。分析要读几百帧，大约半分钟到一分钟。')}
            </Text>
            {!skipLines && <Button label={tr('没贴线，跳过')} variant="ghost" onPress={skip} />}
            {!camera && (
              <View style={styles.fpsRow}>
                <Text style={styles.muted}>{tr('拍摄帧率{p}', { p: detectedFps ? tr('（视频 {detectedFps} fps）', { detectedFps }) : '' })}</Text>
                <View style={{ flexDirection: 'row', gap: 6 }}>
                  {fpsChoices.map((f) => (
                    <Chip key={f} label={String(f)} selected={f === fps} onPress={() => setCaptureOverride(f)} />
                  ))}
                </View>
              </View>
            )}
            {looksSlowMo && fps <= fileFps && <Text style={styles.warn}>{tr('这个视频是 {detectedFps} fps。如果是用 iPhone「慢动作」拍的，拍摄帧率选 240（120 fps 慢动作选 120）。', { detectedFps })}</Text>}
          </>
        )}

        {running && <PulseProgress progress={phase.done / phase.total} label={phase.label} />}
        {running && <StayAwake />}

        {failure && phase.name === 'failed' && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>{failure.what}</Text>
            {phase.message && <Text style={styles.muted}>{phase.message}</Text>}
            <Text style={styles.muted}>{tr('建议：{advice}', { advice: failure.advice })}</Text>
          </View>
        )}

        {result && (
          <>
            <Rise>
              <Summary result={result} fps={fps} reach={reach} />
            </Rise>
            <Rise index={1}>
              <View style={styles.card}>
                {METRIC_ORDER.filter((k) => result.metrics[k]).map((k) => (
                  <View key={k} accessibilityLabel={METRIC_TEXT[k].name} style={styles.metricRow}>
                    <View style={styles.metricHead}>
                      <Text style={styles.metricName}>{METRIC_TEXT[k].name}</Text>
                      <Text style={[styles.metricValue, result.metrics[k]!.status !== 'ok' && { color: colors.textMuted }]}>{formatMeasured(k, result.metrics[k]!)}</Text>
                    </View>
                    <Text style={styles.muted}>{METRIC_TEXT[k].hint}</Text>
                  </View>
                ))}
              </View>
            </Rise>
            <View style={styles.events}>
              {[
                ...(result.events.plantDown != null ? [{ name: tr('最后一步落地'), f: result.events.plantDown }] : []),
                { name: tr('起跳'), f: result.events.takeoff },
                ...(result.events.landing != null ? [{ name: tr('落地'), f: result.events.landing }] : []),
              ].map((e) => (
                <Chip key={e.name} label={`${e.name} #${e.f}`} selected={frame === e.f} onPress={() => show(e.f)} />
              ))}
            </View>
            {result.flags.map((f) => (
              <Text key={f} style={styles.warn}>
                {FLAG_TEXT[f]}
              </Text>
            ))}
          </>
        )}
      </ScrollView>

      <View style={styles.footer}>
        {phase.name === 'setup' && <Button label={startLabel} onPress={analyse} disabled={!ready} />}
        {result && <Button label={tr('保存')} onPress={save} busy={saving} />}
        {(result || phase.name === 'failed') && (
          <Button
            label={tr('重新点选')}
            variant="secondary"
            onPress={() => {
              if (phase.name === 'failed' && phase.problem === 'error') setReaderRun((n) => n + 1);
              setPhase({ name: 'setup' });
            }}
          />
        )}
      </View>
    </SafeAreaView>
  );
}

function Summary({ result, fps, reach }: { result: TechniqueResult; fps: number; reach: number | null }) {
  const cells = (['vz', 'angle', 'approach'] as const).filter((k) => result.metrics[k]);
  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>{tr('{style} · {fps} 帧/秒', { style: styleText(result.style), fps })}</Text>
      <View style={styles.cells}>
        {cells.map((k, i) => {
          const m = result.metrics[k]!;
          const t = METRIC_TEXT[k];
          return (
            <View key={k} style={styles.cell}>
              <Text style={styles.muted}>{t.name}</Text>
              <Text style={[styles.cellValue, i === 0 && { color: colors.accent }, m.status !== 'ok' && { color: colors.textMuted }]}>
                {m.value.toFixed(t.decimals)}
                <Text style={styles.unit}> {t.unit}</Text>
              </Text>
              <Text style={styles.muted}>
                ± {formatError(k, m.error)}
                {m.status !== 'ok' ? tr(' 不够准') : ''}
              </Text>
            </View>
          );
        })}
      </View>
      <Text style={styles.reach}>{reach != null ? tr('今天助跑摸高 {reach} cm', { reach: reach.toFixed(APPROACH_TOUCH.decimals) }) : tr('今天还没测助跑摸高')}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 16, gap: 12 },
  video: { width: '100%', borderRadius: radius.card, overflow: 'hidden', backgroundColor: '#000' },
  target: { position: 'absolute', width: 36, height: 36, borderRadius: 18, borderWidth: 2, backgroundColor: 'rgba(35,64,200,0.15)' },
  line: { position: 'absolute', width: 2, height: 30 },
  lineText: { position: 'absolute', top: -18, left: -16, color: '#FFFFFF', fontSize: 10, fontWeight: '700', paddingHorizontal: 4, paddingVertical: 1, borderRadius: 4, overflow: 'hidden' },
  cross: { position: 'absolute', width: 28, height: 28, borderRadius: 14, borderWidth: 1.5, borderColor: '#FFFFFF' },
  badge: { position: 'absolute', left: 10, top: 10, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10, backgroundColor: 'rgba(23,19,14,0.8)', alignItems: 'center' },
  badgeText: { color: '#FFFFFF', fontFamily: fonts.numeric, fontSize: 16 },
  badgeTime: { color: 'rgba(255,255,255,0.7)', fontFamily: fonts.numeric, fontSize: 12 },
  steps: { flexDirection: 'row', gap: 8 },
  lead: { color: colors.textSoft, fontSize: 13, lineHeight: 19 },
  fpsRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  muted: { color: colors.textMuted, fontSize: 12, lineHeight: 18 },
  warn: { color: colors.warn, fontSize: 12, lineHeight: 18 },
  card: { backgroundColor: colors.surface, borderRadius: radius.card, padding: 14, gap: 10 },
  cardTitle: { color: colors.text, fontSize: 15, fontWeight: '700' },
  cells: { flexDirection: 'row', justifyContent: 'space-around' },
  cell: { alignItems: 'center', gap: 2 },
  cellValue: { color: colors.text, fontFamily: fonts.numericBold, fontSize: 32 },
  unit: { color: colors.textMuted, fontSize: 13 },
  reach: { color: colors.rim, fontSize: 13, fontWeight: '700', textAlign: 'center' },
  metricRow: { gap: 2 },
  metricHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  metricName: { color: colors.text, fontSize: 14, fontWeight: '600' },
  metricValue: { color: colors.text, fontFamily: fonts.numeric, fontSize: 17 },
  events: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  footer: { paddingHorizontal: 16, paddingTop: 8, gap: 6 },
});
