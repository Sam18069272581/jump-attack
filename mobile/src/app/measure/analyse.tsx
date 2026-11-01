import { useEventListener } from 'expo';
import { router, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useVideoPlayer, VideoView, type VideoPlayer, type VideoThumbnail } from 'expo-video';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { FrameReader, type ClipInfo, type FrameReaderHandle } from '@/components/FrameReader';
import { PoseReader, type PoseReaderHandle } from '@/components/PoseReader';
import { Rise, tick } from '@/components/motion';
import { PulseProgress } from '@/components/PulseProgress';
import { TrendChart } from '@/components/TrendChart';
import { TrimBar } from '@/components/TrimBar';
import { Button, Chip, Empty } from '@/components/ui';
import { analysisHistory, saveAnalysedTrials } from '@/db/analysis';
import { touchOffsetFor } from '@/db/touch';
import { realChange, type RealChange } from '@/domain/agreement';
import { analyseCoarse, analyseFine, analysePoseFine, coarseRequest, planFromPose, type CoarseOptions, type DetectedJump, type DetectProblem, type Rect, type VideoInfo } from '@/domain/autoMark';
import { analysisKindFor, analysisTrials } from '@/domain/analysisTrials';
import { frameCount, frameToSeconds, markingRates } from '@/domain/jump';
import { analyseJumps, FLAG_TEXT, type JumpEvents, type JumpResult } from '@/domain/jumpAnalysis';
import { nextClip, queuedCount } from '@/domain/importQueue';
import { returnsToLogger } from '@/domain/marking';
import { findPoseJumps, poseCoarseFrames, splitAt, startFrom } from '@/domain/poseJump';
import { framesFromWire } from '@/domain/techniqueRead';
import { stripTimes } from '@/domain/trim';
import { best as bestOf, getMetric, type MetricDef } from '@/domain/metrics';
import { decimal, localized, tr } from '@/i18n';
import { useAthlete } from '@/state/athlete';
import { colors, fonts, radius } from '@/theme';

const FPS_CHOICES = [60, 120, 240];
/** Pictures in the filmstrip of the trim bar. */
const STRIP_CELLS = 10;
/** How long after a trim handle is let go the analysis starts by itself: time to reach for the other end first. */
const AUTO_START_MS = 2000;

// AVPlayer seeks exactly by default (zero tolerance), so this lands on the requested frame.
function seekToFrame(player: VideoPlayer, frame: number, fps: number) {
  player.currentTime = frameToSeconds(frame, fps);
}

type Problem = DetectProblem | 'error' | 'no-pose';

const PROBLEMS: Record<Problem, { what: string; advice: string }> = localized({
  shaky: { what: '画面在晃，没法分析', advice: '下次把手机放在地上或三脚架上，别手持' },
  'no-jump': { what: '选中的片段里没认出跳跃', advice: '把片段拉宽到起跳前、落地后；旁边有人在动的话，点一下运动员再试' },
  unsure: { what: '认出了跳，但没把握定准起跳和落地帧', advice: '光线暗、脚被挡住或拍得太远时容易这样；可以手动逐帧标' },
  error: { what: '读不到视频画面', advice: '可以手动逐帧标' },
  'no-pose': { what: '脚下没认出跳跃，骨架识别没能启动', advice: '第一次用骨架识别要联网下载模型，联网后再试；也可以手动逐帧标' },
});

type Phase = { name: 'setup' } | { name: 'running'; done: number; total: number; label: string } | { name: 'done' } | { name: 'failed'; problem: Problem };

/**
 * Analyses a jump clip the way Arcus does: the athlete picks the part of the clip to look at and taps themselves, the
 * app finds every jump in it (domain/autoMark), works out each one's numbers with their error (domain/jumpAnalysis),
 * leaves out the ones it can't count fairly and says why, and compares the set with the athlete's history. Every key
 * frame can be nudged a frame at a time before saving.
 */
export default function Analyse() {
  const params = useLocalSearchParams<{ metric: string; session: string; uri: string; fps: string; from?: string; box?: string; asset?: string; queue?: string }>();
  const db = useSQLiteContext();
  const { current } = useAthlete();
  const def = getMetric(params.metric);
  const kind = def ? analysisKindFor(def) : null;
  const player = useVideoPlayer(params.uri, (p) => {
    p.muted = true;
    p.pause();
  });
  const reader = useRef<FrameReaderHandle>(null);
  // The pose page, loaded only when the strip under the feet finds nothing (it copies the clip and starts a model).
  const poseReader = useRef<PoseReaderHandle>(null);
  const [posing, setPosing] = useState(false);
  const [poseShown, setPoseShown] = useState(false);
  const poseMounted = useRef<(() => void) | null>(null);

  const [duration, setDuration] = useState(0);
  const [detectedFps, setDetectedFps] = useState<number | null>(null);
  const [captureOverride, setCaptureOverride] = useState<number | null>(null);
  const [clip, setClip] = useState<ClipInfo | null>(null);
  const [range, setRange] = useState<{ from: number; to: number } | null>(null);
  const [thumbnails, setThumbnails] = useState<VideoThumbnail[]>([]);
  /** Set when a trim handle is let go: the analysis starts by itself a moment later, unless the trim is touched again. */
  const [armed, setArmed] = useState<number | null>(null);
  const [target, setTarget] = useState<{ x: number; y: number; frame: number } | null>(null);
  const [phase, setPhase] = useState<Phase>({ name: 'setup' });
  const [events, setEvents] = useState<JumpEvents[]>([]);
  const [box, setBox] = useState<Rect | null>(null);
  const [keep, setKeep] = useState<number[]>([]);
  const [open, setOpen] = useState<number | null>(null);
  const [frame, setFrame] = useState(0);
  const [view, setView] = useState({ w: 0, h: 0 });
  const [history, setHistory] = useState<{ previous: number[]; te: number | null } | null>(null);
  const [offset, setOffset] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);

  useEventListener(player, 'sourceLoad', ({ duration: d, availableVideoTracks }) => {
    setDuration(d);
    const rate = availableVideoTracks[0]?.frameRate;
    if (rate && rate > 0) setDetectedFps(Math.round(rate));
    filmstrip(d);
  });

  /** The trim bar's pictures; the bar works without them, as a plain strip. */
  async function filmstrip(d: number) {
    try {
      setThumbnails(await player.generateThumbnailsAsync(stripTimes(d, STRIP_CELLS), { maxWidth: 160 }));
    } catch {
      // No pictures: the strip stays plain.
    }
  }

  const athleteId = current?.id;
  useEffect(() => {
    if (def?.plusReach && athleteId != null) touchOffsetFor(db, athleteId).then(setOffset);
  }, [db, athleteId, def]);

  const { file: fileFps, capture: fps } = markingRates({ detected: detectedFps, chosen: captureOverride, reported: Number(params.fps) || 0 });
  const total = frameCount(duration || clip?.duration || 0, fileFps);
  const span = range ?? { from: 0, to: Math.max(0, total - 1) };
  const looksSlowMo = detectedFps != null && detectedFps < 100;
  const fpsChoices = detectedFps == null ? FPS_CHOICES : [fileFps, ...FPS_CHOICES.filter((f) => f > fileFps)];

  const analysis = useMemo(
    () => (kind ? analyseJumps(events, { kind, captureFps: fps, boxCm: Number(params.box) || undefined, keep }) : null),
    [events, kind, fps, params.box, keep],
  );
  const trials = useMemo(
    () => (def && analysis ? analysisTrials(def, analysis, { captureFps: fps, context: params, reachCm: current?.standing_reach_cm ?? undefined, offsetCm: offset }) : []),
    [def, analysis, fps, params, current, offset],
  );
  const today = def ? bestOf(def, trials.map((t) => t.value)) : null;
  const verdict = history && today != null && def ? realChange(history.previous, today, history.te, def.lowerIsBetter) : null;

  useEffect(() => {
    if (phase.name !== 'done' || !def || athleteId == null) return;
    const boxCm = kind === 'drop' ? Number(params.box) || undefined : undefined;
    analysisHistory(db, athleteId, def, params.session, { boxCm }).then(setHistory);
  }, [phase.name, db, def, kind, athleteId, params.session, params.box]);

  function show(f: number) {
    setFrame(f);
    seekToFrame(player, f, fileFps);
  }

  // The analysis the timer starts is the one of the render it fires after.
  const startAnalysis = useRef(analyse);
  useEffect(() => {
    startAnalysis.current = analyse;
  });
  useEffect(() => {
    if (armed == null || phase.name !== 'setup' || !clip) return;
    const timer = setTimeout(() => startAnalysis.current(), AUTO_START_MS);
    return () => clearTimeout(timer);
  }, [armed, phase.name, clip]);

  // Video pixels ↔ the video box on screen (the player letterboxes the picture).
  const fit = clip && view.w ? Math.min(view.w / clip.width, view.h / clip.height) : 0;
  const ox = clip ? (view.w - clip.width * fit) / 2 : 0;
  const oy = clip ? (view.h - clip.height * fit) / 2 : 0;
  const onScreen = (r: Rect) => ({ left: ox + r.x * fit, top: oy + r.y * fit, width: r.w * fit, height: r.h * fit });

  function tap(x: number, y: number) {
    if (!clip || !fit || phase.name !== 'setup') return;
    const vx = (x - ox) / fit;
    const vy = (y - oy) / fit;
    if (vx < 0 || vy < 0 || vx > clip.width || vy > clip.height) return;
    tick();
    setTarget({ x: vx, y: vy, frame });
    // Tapping the athlete after trimming: the countdown starts over.
    setArmed((a) => (a == null ? a : a + 1));
  }

  useEffect(() => {
    if (posing && poseMounted.current) {
      poseMounted.current();
      poseMounted.current = null;
    }
  }, [posing]);

  /** The pose page, loaded the first time it is needed. */
  async function poseReaderReady(): Promise<PoseReaderHandle> {
    if (!poseReader.current) await new Promise<void>((resolve) => ((poseMounted.current = resolve), setPosing(true)));
    return poseReader.current!;
  }

  /**
   * When the strip under the feet finds no jump, or can't time the one it finds: the skeleton finds the athlete, each
   * flight and where the feet stood before and after it (domain/poseJump), and each event is timed in a strip of its
   * own there (domain/autoMark `planFromPose`). Gives back what to show: the jumps, or why there are none.
   */
  async function byPose(video: VideoInfo, before: DetectProblem): Promise<DetectedJump[] | Problem> {
    if (!clip || !reader.current) return before;
    const detectKind = kind === 'drop' ? 'drop' : 'jump';
    const coarse = poseCoarseFrames(video, { range: span, rebound: kind === 'repeat' });
    const step = coarse.length > 1 ? coarse[1] - coarse[0] : 1;
    const guess = coarse.length * 2;
    const label1 = tr('脚下没认出，换骨架找人和起跳');
    setPhase({ name: 'running', done: 0, total: guess, label: label1 });
    let pose: PoseReaderHandle;
    let wire;
    let start: { frame: number; at: { x: number; y: number } } | null;
    try {
      pose = await poseReaderReady();
      setPoseShown(true);
      if (target) start = { frame: target.frame, at: target };
      else {
        // Nobody tapped: the biggest person in the middle of the stretch, or a quarter in either side.
        const look = [0.5, 0.25, 0.75].map((u) => coarse[Math.floor(u * (coarse.length - 1))]);
        start = startFrom(framesFromWire(await pose.everyone(look), clip.width, clip.height, fps), clip);
      }
      if (!start) return before;
      const { forward, backward } = splitAt(coarse, start.frame);
      const ahead = await pose.follow(forward, start.at, (n) => setPhase({ name: 'running', done: n, total: guess, label: label1 }));
      const behind = await pose.follow(backward, start.at, (n) => setPhase({ name: 'running', done: forward.length + n, total: guess, label: label1 }));
      wire = [...ahead, ...behind];
    } catch {
      return 'no-pose';
    } finally {
      setPoseShown(false);
    }
    const found = findPoseJumps(framesFromWire(wire, clip.width, clip.height, fps), fps, { kind: detectKind, target: start.at });
    if (!found.ok) return before;
    const plan = planFromPose(video, found.flights, detectKind, step, span);
    const read = wire.length;
    const sum = read + plan.events.reduce((n, e) => n + e.request.frames.length, 0);
    const label2 = tr('骨架认出 {length} 跳，逐帧定起跳和落地', { length: found.flights.length });
    const got = [];
    let done = read;
    for (const e of plan.events) {
      got.push(await reader.current.read(e.request, (n) => setPhase({ name: 'running', done: done + n, total: sum, label: label2 })));
      done += e.request.frames.length;
    }
    const r = analysePoseFine(plan, got);
    if (!r.ok) return r.problem;
    // The athlete where they took off the first time, for the "locked" box.
    const s0 = found.flights[0].takeoff.spot;
    setBox({ x: s0.left - 0.2 * s0.stature, y: s0.y - s0.stature, w: s0.right - s0.left + 0.4 * s0.stature, h: s0.stature });
    return r.jumps;
  }

  async function analyse() {
    if (!clip || !reader.current || !kind) return;
    setArmed(null);
    const video = { width: clip.width, height: clip.height, frames: total, captureFps: fps };
    const opts: CoarseOptions = { range: span, ...(target ? { target } : {}), rebound: kind === 'repeat' };
    const req = coarseRequest(video, opts);
    // The fine pass usually asks for about as many frames again; the bar is honest once it is known.
    const guess = req.frames.length * 2;
    const label0 = target ? tr('锁定运动员，粗扫整段') : tr('找运动员，粗扫整段');
    setPhase({ name: 'running', done: 0, total: guess, label: label0 });
    try {
      const coarseFrames = await reader.current.read(req, (n) => setPhase({ name: 'running', done: n, total: guess, label: label0 }));
      const c = analyseCoarse(video, req, coarseFrames, kind === 'drop' ? 'drop' : 'jump', opts);
      let jumps: DetectedJump[] | Problem;
      if (!c.ok) jumps = c.problem === 'shaky' ? c.problem : await byPose(video, c.problem);
      else {
        setBox(c.plan.box);
        const sum = req.frames.length + c.plan.request.frames.length;
        const label = tr('认出 {length} 跳，逐帧定起跳和落地', { length: c.plan.jumps.length });
        const fine = await reader.current.read(c.plan.request, (n) => setPhase({ name: 'running', done: req.frames.length + n, total: sum, label }));
        const r = analyseFine(c.plan, fine);
        jumps = r.ok ? r.jumps : await byPose(video, r.problem);
      }
      if (typeof jumps === 'string') return setPhase({ name: 'failed', problem: jumps });
      setEvents(
        jumps.map((j) =>
          j.marks.length === 3 ? { touchdown: j.marks[0], takeoff: j.marks[1], landing: j.marks[2], flags: j.flags } : { takeoff: j.marks[0], landing: j.marks[1], flags: j.flags },
        ),
      );
      setKeep([]);
      setPhase({ name: 'done' });
      show(jumps[0].marks[0]);
    } catch {
      setPhase({ name: 'failed', problem: 'error' });
    }
  }

  function nudge(i: number, key: 'touchdown' | 'takeoff' | 'landing', by: number) {
    tick();
    setEvents((es) => es.map((e, k) => (k === i && e[key] != null ? { ...e, [key]: e[key]! + by } : e)));
    const e = events[i];
    if (e[key] != null) show(e[key]! + by);
  }

  async function save() {
    if (!def || !current || !trials.length) return;
    setSaving(true);
    try {
      await saveAnalysedTrials(db, current.id, params.session, def.code, trials);
      // A drop-jump ladder logs every box height on its own screen, two screens up.
      if (returnsToLogger(params.from)) return router.dismiss(2);
      // More clips picked with this one: on to the next, and to the result after the last.
      const next = nextClip(params);
      if (next) return router.replace(next);
      router.replace({ pathname: '/measure/result', params: { metric: def.code, session: params.session, ...(params.from ? { from: params.from } : {}) } });
    } catch (e) {
      Alert.alert(tr('保存失败'), String(e));
      setSaving(false);
    }
  }

  function markByHand() {
    // In this screen's place, so the marking screen's way back (to the logger, or on to the result) is the same as from the import.
    router.replace({ pathname: '/measure/mark', params: { metric: params.metric, session: params.session, uri: params.uri, fps: params.fps, ...(params.from ? { from: params.from } : {}), ...(params.box ? { box: params.box } : {}), ...(params.asset ? { asset: params.asset } : {}), ...(params.queue ? { queue: params.queue } : {}) } });
  }

  function skip() {
    const next = nextClip(params);
    if (next) router.replace(next);
  }

  function replay() {
    if (!analysis || !def) return;
    router.push({
      pathname: '/measure/replay',
      params: {
        uri: params.uri,
        metric: def.code,
        fileFps: String(fileFps),
        captureFps: String(fps),
        from: String(span.from),
        to: String(span.to),
        events: JSON.stringify(analysis.jumps.map((j) => ({ ...j.events, counted: j.counted }))),
        ...(box ? { focus: JSON.stringify(box) } : {}),
        ...(params.box ? { box: params.box } : {}),
      },
    });
  }

  if (!def || !kind) return <Empty title={tr('这个项目不能自动分析')} />;
  const queued = queuedCount(params.queue);
  const running = phase.name === 'running';
  const s = analysis?.summary;

  return (
    <SafeAreaView style={styles.screen} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.video} onLayout={(e: LayoutChangeEvent) => setView({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}>
          <VideoView player={player} nativeControls={false} contentFit="contain" style={StyleSheet.absoluteFill} />
          {/* The page that reads frames: hidden until it runs, then it shows each frame it reads and the strip it reads. */}
          <View style={[StyleSheet.absoluteFill, { opacity: running ? 1 : 0.01 }]} pointerEvents="none">
            <FrameReader ref={reader} uri={params.uri} fileFps={fileFps} onReady={setClip} onError={() => setPhase((p) => (p.name === 'done' ? p : { name: 'failed', problem: 'error' }))} style={StyleSheet.absoluteFill} />
          </View>
          {posing && (
            // Over the frame page while it reads, showing each frame with the athlete's skeleton. Its failures reach the
            // analysis through the read that fails.
            <View style={[StyleSheet.absoluteFill, { opacity: running && poseShown ? 1 : 0.01 }]} pointerEvents="none">
              <PoseReader ref={poseReader} uri={params.uri} fileFps={fileFps} onReady={() => {}} onError={() => {}} style={StyleSheet.absoluteFill} />
            </View>
          )}
          {phase.name === 'setup' && (
            <Pressable accessibilityRole="button" accessibilityLabel={tr('点一下运动员')} style={StyleSheet.absoluteFill} onPress={(e) => tap(e.nativeEvent.locationX, e.nativeEvent.locationY)} />
          )}
          {target && fit > 0 && phase.name === 'setup' && <View pointerEvents="none" style={[styles.target, { left: ox + target.x * fit - 18, top: oy + target.y * fit - 18 }]} />}
          {box && fit > 0 && phase.name === 'done' && (
            <View pointerEvents="none" style={[styles.lock, onScreen(box)]}>
              <Text style={styles.lockText}>{tr('已锁定')}</Text>
            </View>
          )}
          {phase.name !== 'running' && (
            <View style={styles.badge}>
              <Text style={styles.badgeText}>#{frame}</Text>
              <Text style={styles.badgeTime}>{Math.round((frame / fps) * 1000)} ms</Text>
            </View>
          )}
        </View>

        {phase.name === 'setup' && (
          <>
            <TrimBar
              total={total}
              span={span}
              frame={frame}
              fps={fps}
              thumbnails={thumbnails}
              onChange={(next, moved) => {
                setArmed(null);
                setRange(next);
                show(next[moved]);
              }}
              onScrub={show}
              onRelease={() => setArmed((a) => (a ?? 0) + 1)}
            />
            <Text style={styles.lead}>
              {armed != null
                ? tr('马上自动开始分析…')
                : tr('{p}再拖两头的黄色把手，截到第一次起跳前、最后一次落地后，松手后自动开始分析。', { p: target ? tr('已点选运动员。') : tr('点一下画面里的运动员（旁边有人在动时一定要点）。') })}
            </Text>
            <View style={styles.fpsRow}>
              <Text style={styles.muted}>{tr('拍摄帧率{p}', { p: detectedFps ? tr('（视频 {detectedFps} fps）', { detectedFps }) : '' })}</Text>
              <View style={{ flexDirection: 'row', gap: 6 }}>
                {fpsChoices.map((f) => (
                  <Chip key={f} label={String(f)} selected={f === fps} onPress={() => setCaptureOverride(f)} />
                ))}
              </View>
            </View>
            {looksSlowMo && fps <= fileFps && <Text style={styles.warn}>{tr('这个视频是 {detectedFps} fps。如果是用 iPhone「慢动作」拍的，拍摄帧率选 240（120 fps 慢动作选 120）。', { detectedFps })}</Text>}
          </>
        )}

        {running && <PulseProgress progress={phase.done / phase.total} label={phase.label} />}

        {phase.name === 'failed' && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>{PROBLEMS[phase.problem].what}</Text>
            <Text style={styles.muted}>{tr('建议：{advice}', { advice: PROBLEMS[phase.problem].advice })}</Text>
          </View>
        )}

        {phase.name === 'done' && analysis && s && (
          <>
            <Rise>
              <Summary def={def} kind={kind} analysis={analysis} fps={fps} />
            </Rise>
            {analysis.jumps.map((j, i) => (
              <Rise key={i} index={i + 1}>
                <JumpCard
                  jump={j}
                  kind={kind}
                  open={open === i}
                  onToggle={() => setOpen(open === i ? null : i)}
                  onKeep={() => setKeep((k) => (k.includes(i) ? k.filter((x) => x !== i) : [...k, i]))}
                  kept={keep.includes(i)}
                  onShow={show}
                  onNudge={(key, by) => nudge(i, key, by)}
                />
              </Rise>
            ))}
            {verdict && <HistoryCard def={def} previous={history!.previous} today={today!} verdict={verdict} te={history!.te} />}
            {def.plusReach && current?.standing_reach_cm == null && <Text style={styles.warn}>{tr('先在「我的」填站立摸高，才能把跳高换算成摸高并保存。')}</Text>}
          </>
        )}
      </ScrollView>

      <View style={styles.footer}>
        {queued > 0 && <Text style={styles.queued}>{tr('还有 {queued} 段视频，保存后接着分析下一段', { queued })}</Text>}
        {phase.name === 'setup' && <Button label={clip ? tr('开始分析') : tr('正在读取视频…')} onPress={analyse} disabled={!clip || total === 0} />}
        {phase.name === 'done' && (
          <>
            <Button label={trials.length ? tr('保存{p}', { p: kind === 'repeat' ? tr('这一组') : tr(' {length} 跳', { length: trials.length }) }) : tr('没有能保存的跳')} onPress={save} disabled={!trials.length} busy={saving} />
            <Button label={tr('回放 · 导出视频')} variant="secondary" onPress={replay} />
          </>
        )}
        {phase.name === 'failed' && <Button label={tr('重新选片段')} variant="secondary" onPress={() => setPhase({ name: 'setup' })} />}
        {phase.name !== 'running' && def.capture.some((c) => c === 'flight' || c === 'contact') && (
          <Button label={tr('手动逐帧标')} variant="ghost" onPress={markByHand} />
        )}
        {queued > 0 && phase.name !== 'running' && <Button label={tr('跳过这段，看下一段')} variant="ghost" onPress={skip} />}
      </View>
    </SafeAreaView>
  );
}

const cm = (x: number) => decimal(x, 1);
const ms = (s: number) => String(Math.round(s * 1000));

function Summary({ def, kind, analysis, fps }: { def: MetricDef; kind: 'jump' | 'drop' | 'repeat'; analysis: ReturnType<typeof analyseJumps>; fps: number }) {
  const s = analysis.summary;
  const counted = analysis.jumps.filter((j) => j.counted);
  // A jump with a contact, so the contact's error can be shown too: in a set, the first jump has none.
  const err = (counted.find((j) => j.gctS != null) ?? counted[0])?.error;
  const cells: { label: string; value: string; unit: string; main?: boolean }[] = [];
  if (kind === 'repeat') {
    if (s.rsi105 != null) cells.push({ label: '10/5 RSI', value: decimal(s.rsi105, 2), unit: '', main: true });
    if (s.gctCv != null) cells.push({ label: 'GCT-CV', value: decimal(s.gctCv, 1), unit: '%' });
    if (s.driCv != null) cells.push({ label: 'DRI-CV', value: decimal(s.driCv, 1), unit: '%' });
  } else if (kind === 'drop') {
    if (s.rsi) cells.push({ label: tr('最好 RSI'), value: decimal(s.rsi.best, 2), unit: '', main: true });
    if (s.gctS) cells.push({ label: tr('最短触地'), value: ms(s.gctS.best), unit: 'ms' });
  } else if (s.jhCm) {
    cells.push({ label: tr('最高'), value: cm(s.jhCm.best), unit: 'cm', main: true });
    if (s.counted > 1) cells.push({ label: tr('平均'), value: cm(s.jhCm.mean), unit: 'cm' });
  }
  if (kind !== 'jump' && s.jhCm) cells.push({ label: tr('平均跳高'), value: cm(s.jhCm.mean), unit: 'cm' });
  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>{tr('{name} · 认出 {total} 跳，计入 {counted} 跳', { name: def.name, total: s.total, counted: s.counted })}</Text>
      <View style={styles.cells}>
        {cells.map((c) => (
          <View key={c.label} style={styles.cell}>
            <Text style={styles.muted}>{c.label}</Text>
            <Text style={[styles.cellValue, c.main && { color: colors.accent }]}>
              {c.value}
              <Text style={styles.unit}> {c.unit}</Text>
            </Text>
          </View>
        ))}
      </View>
      {kind === 'repeat' && s.rsi105 == null && (
        <Text style={styles.muted}>{tr('计入的反弹只有 {length} 次，10/5 RSI 要至少 5 次。把片段拉到整组 10 跳，或核对被剔除的跳。', { length: counted.filter((j) => j.rsi != null).length })}</Text>
      )}
      {kind !== 'jump' && (s.rsr || s.dri) && (
        <Text style={styles.muted}>
          {s.rsr ? tr('平均 RSR {mean}', { mean: decimal(s.rsr.mean, 2) }) : ''}
          {s.dri ? tr(' · 平均 DRI {mean}（新指标，还没有常模，只看自己的变化）', { mean: decimal(s.dri.mean, 2) }) : ''}
        </Text>
      )}
      {err && (
        <Text style={styles.muted}>{tr('误差：每个关键帧 ±1 帧（{p} ms），跳高约 ±{jhCm} cm{p2}', { p: Math.round(1000 / fps), jhCm: decimal(err.jhCm, 1), p2: err.gctS ? tr('，触地 ±{gctS} ms', { gctS: Math.round(err.gctS * 1000) }) : '' })}</Text>
      )}
    </View>
  );
}

function JumpCard({
  jump,
  kind,
  open,
  kept,
  onToggle,
  onKeep,
  onShow,
  onNudge,
}: {
  jump: JumpResult;
  kind: 'jump' | 'drop' | 'repeat';
  open: boolean;
  kept: boolean;
  onToggle: () => void;
  onKeep: () => void;
  onShow: (f: number) => void;
  onNudge: (key: 'touchdown' | 'takeoff' | 'landing', by: number) => void;
}) {
  const e = jump.events;
  const keys: { key: 'touchdown' | 'takeoff' | 'landing'; name: string; color: string }[] = [
    ...(e.touchdown != null ? [{ key: 'touchdown' as const, name: tr('触地'), color: colors.purple }] : []),
    { key: 'takeoff', name: tr('起跳'), color: colors.accent },
    { key: 'landing', name: tr('落地'), color: colors.rim },
  ];
  const line = [`${cm(jump.jhCm)} cm`, tr('滞空 {ftS} ms', { ftS: ms(jump.ftS) }), ...(jump.gctS != null ? [tr('触地 {gctS} ms', { gctS: ms(jump.gctS) }), `RSI ${decimal(jump.rsi!, 2)}`, `RSR ${decimal(jump.rsr!, 2)}`] : []), ...(jump.dri != null ? [`DRI ${decimal(jump.dri, 2)}`] : [])];
  const excludable = jump.flags.some((f) => f === 'edge' || f === 'outlier');
  return (
    <View style={[styles.card, !jump.counted && styles.dimmed]}>
      <Pressable accessibilityRole="button" accessibilityLabel={tr('第 {index} 跳', { index: jump.index + 1 })} onPress={onToggle} style={styles.jumpHead}>
        <Text style={styles.jumpNo}>{jump.index + 1}</Text>
        <Text style={styles.jumpLine}>{line.join(' · ')}</Text>
        {!jump.counted && <Text style={styles.out}>{tr('未计入')}</Text>}
      </Pressable>
      {jump.flags.map((f) => (
        <Text key={f} style={styles.flag}>{tr('{what}。建议：{advice}', { what: FLAG_TEXT[f].what, advice: FLAG_TEXT[f].advice })}</Text>
      ))}
      {open && (
        <View style={{ gap: 8 }}>
          {keys.map((k) => (
            <View key={k.key} style={styles.keyRow}>
              <Pressable accessibilityRole="button" accessibilityLabel={tr('看{name}帧', { name: k.name })} onPress={() => onShow(e[k.key]!)} style={[styles.keyChip, { borderColor: k.color }]}>
                <Text style={[styles.keyName, { color: k.color }]}>{k.name}</Text>
                <Text style={styles.keyFrame}>#{e[k.key]}</Text>
              </Pressable>
              {[-1, 1].map((by) => (
                <Pressable key={by} accessibilityRole="button" accessibilityLabel={tr('{name}{p}移一帧', { name: k.name, p: by > 0 ? tr('后') : tr('前') })} onPress={() => onNudge(k.key, by)} style={styles.nudge}>
                  <Text style={styles.nudgeText}>{by > 0 ? '+1' : '−1'}</Text>
                </Pressable>
              ))}
            </View>
          ))}
          {excludable && <Chip label={kept ? tr('已手动计入') : tr('核对过了，计入')} selected={kept} onPress={onKeep} />}
          {kind === 'repeat' && jump.gctS == null && <Text style={styles.muted}>{tr('第一跳之前没有触地，不算 RSI。')}</Text>}
        </View>
      )}
    </View>
  );
}

function HistoryCard({ def, previous, today, verdict, te }: { def: MetricDef; previous: number[]; today: number; verdict: RealChange; te: number | null }) {
  const d = def.decimals;
  const u = def.unit ? ` ${def.unit}` : '';
  const delta = `${verdict.delta >= 0 ? '+' : '−'}${decimal(Math.abs(verdict.delta), d)}${u}`;
  const text = {
    better: tr('比之前平均 {delta}，超过最小可信变化 {bar}{u}：是真进步', { delta, bar: decimal(verdict.bar, d), u }),
    worse: tr('比之前平均 {delta}，超过最小可信变化 {bar}{u}：确实下降了', { delta, bar: decimal(verdict.bar, d), u }),
    noise: tr('比之前平均 {delta}，没超过最小可信变化 {bar}{u}：还在噪声里', { delta, bar: decimal(verdict.bar, d), u }),
    unknown: tr('再测几次（至少 3 次）就能判断是不是真进步'),
  }[verdict.verdict];
  const tone = verdict.verdict === 'better' ? colors.good : verdict.verdict === 'worse' ? colors.warn : colors.textSoft;
  const points = [...previous.slice(-7), today].map((v, i, a) => ({ label: i === a.length - 1 ? tr('这次') : '', value: v, display: decimal(v, d) }));
  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>{tr('同动作历史')}</Text>
      {points.length > 1 && <TrendChart points={points} height={140} />}
      <Text style={[styles.verdict, { color: tone }]}>{text}</Text>
      {verdict.verdict !== 'unknown' && (
        <Text style={styles.muted}>
          {te == null ? tr('还没有一次测多跳的记录，测量噪声先按历史波动估。') : tr('测量噪声（同一次测多跳的波动）{te}{u}，单次重测要差 {mdc}{u} 以上才不是噪声。', { te: decimal(te, d), u, mdc: decimal(verdict.mdc!, d) })}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 16, gap: 12 },
  video: { height: 380, borderRadius: radius.card, overflow: 'hidden', backgroundColor: '#000' },
  target: { position: 'absolute', width: 36, height: 36, borderRadius: 18, borderWidth: 2, borderColor: colors.rim, backgroundColor: 'rgba(217,84,30,0.15)' },
  lock: { position: 'absolute', borderWidth: 2, borderColor: colors.rim, borderRadius: 10 },
  lockText: { position: 'absolute', top: -22, left: 0, color: '#FFFFFF', backgroundColor: colors.rim, fontSize: 11, fontWeight: '700', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6, overflow: 'hidden' },
  badge: { position: 'absolute', left: 12, top: 12, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 10, backgroundColor: 'rgba(23,19,14,0.8)', alignItems: 'center' },
  badgeText: { color: '#FFFFFF', fontFamily: fonts.numeric, fontSize: 18 },
  badgeTime: { color: 'rgba(255,255,255,0.7)', fontFamily: fonts.numeric, fontSize: 12 },
  lead: { color: colors.textSoft, fontSize: 13, lineHeight: 19 },
  fpsRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  muted: { color: colors.textMuted, fontSize: 12, lineHeight: 18 },
  warn: { color: colors.warn, fontSize: 12, lineHeight: 18 },
  card: { backgroundColor: colors.surface, borderRadius: radius.card, padding: 14, gap: 8 },
  dimmed: { opacity: 0.7 },
  cardTitle: { color: colors.text, fontSize: 15, fontWeight: '700' },
  cells: { flexDirection: 'row', justifyContent: 'space-around' },
  cell: { alignItems: 'center', gap: 2 },
  cellValue: { color: colors.text, fontFamily: fonts.numericBold, fontSize: 34 },
  unit: { color: colors.textMuted, fontSize: 14 },
  jumpHead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  jumpNo: { width: 22, color: colors.accent, fontFamily: fonts.numericBold, fontSize: 22 },
  jumpLine: { flex: 1, color: colors.text, fontSize: 13 },
  out: { color: colors.warn, fontSize: 11, fontWeight: '700' },
  flag: { color: colors.warn, fontSize: 12, lineHeight: 18 },
  keyRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  keyChip: { flex: 1, flexDirection: 'row', justifyContent: 'space-between', borderWidth: 1.5, borderRadius: radius.chip, paddingHorizontal: 12, paddingVertical: 8 },
  keyName: { fontSize: 13, fontWeight: '700' },
  keyFrame: { color: colors.text, fontFamily: fonts.numeric, fontSize: 16 },
  nudge: { width: 48, height: 38, borderRadius: 12, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center' },
  nudgeText: { color: colors.text, fontFamily: fonts.numeric, fontSize: 18 },
  verdict: { fontSize: 14, lineHeight: 20, fontWeight: '600' },
  footer: { paddingHorizontal: 16, paddingTop: 8, gap: 6 },
  queued: { color: colors.textMuted, fontSize: 12, textAlign: 'center' },
});
