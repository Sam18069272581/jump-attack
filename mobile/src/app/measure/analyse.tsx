import Slider from '@react-native-community/slider';
import { useEventListener } from 'expo';
import { router, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { FrameReader, type ClipInfo, type FrameReaderHandle } from '@/components/FrameReader';
import { Rise, tick } from '@/components/motion';
import { PulseProgress } from '@/components/PulseProgress';
import { TrendChart } from '@/components/TrendChart';
import { Button, Chip, Empty } from '@/components/ui';
import { analysisHistory, saveAnalysedTrials } from '@/db/analysis';
import { touchOffsetFor } from '@/db/touch';
import { realChange, type RealChange } from '@/domain/agreement';
import { analyseCoarse, analyseFine, coarseRequest, type CoarseOptions, type DetectProblem, type Rect } from '@/domain/autoMark';
import { analysisKindFor, analysisTrials } from '@/domain/analysisTrials';
import { frameCount, frameToSeconds, markingRates } from '@/domain/jump';
import { analyseJumps, FLAG_TEXT, type JumpEvents, type JumpResult } from '@/domain/jumpAnalysis';
import { returnsToLogger } from '@/domain/marking';
import { best as bestOf, getMetric, type MetricDef } from '@/domain/metrics';
import { useAthlete } from '@/state/athlete';
import { colors, fonts, radius } from '@/theme';

const FPS_CHOICES = [60, 120, 240];

const PROBLEMS: Record<DetectProblem | 'error', { what: string; advice: string }> = {
  shaky: { what: '画面在晃，没法分析', advice: '下次把手机放在地上或三脚架上，别手持' },
  'no-jump': { what: '选中的片段里没认出跳跃', advice: '把片段拉宽到起跳前、落地后；旁边有人在动的话，点一下运动员再试' },
  unsure: { what: '认出了跳，但没把握定准起跳和落地帧', advice: '光线暗、脚被挡住或拍得太远时容易这样；可以手动逐帧标' },
  error: { what: '读不到视频画面', advice: '可以手动逐帧标' },
};

type Phase = { name: 'setup' } | { name: 'running'; done: number; total: number; label: string } | { name: 'done' } | { name: 'failed'; problem: DetectProblem | 'error' };

/**
 * Analyses a jump clip the way Arcus does: the athlete picks the part of the clip to look at and taps themselves, the
 * app finds every jump in it (domain/autoMark), works out each one's numbers with their error (domain/jumpAnalysis),
 * leaves out the ones it can't count fairly and says why, and compares the set with the athlete's history. Every key
 * frame can be nudged a frame at a time before saving.
 */
export default function Analyse() {
  const params = useLocalSearchParams<{ metric: string; session: string; uri: string; fps: string; from?: string; box?: string; asset?: string }>();
  const db = useSQLiteContext();
  const { current } = useAthlete();
  const def = getMetric(params.metric);
  const kind = def ? analysisKindFor(def) : null;
  const player = useVideoPlayer(params.uri, (p) => {
    p.muted = true;
    p.pause();
  });
  const reader = useRef<FrameReaderHandle>(null);

  const [duration, setDuration] = useState(0);
  const [detectedFps, setDetectedFps] = useState<number | null>(null);
  const [captureOverride, setCaptureOverride] = useState<number | null>(null);
  const [clip, setClip] = useState<ClipInfo | null>(null);
  const [range, setRange] = useState<{ from: number; to: number } | null>(null);
  const [target, setTarget] = useState<{ x: number; y: number } | null>(null);
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
  });

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
    analysisHistory(db, athleteId, def, params.session).then(setHistory);
  }, [phase.name, db, def, athleteId, params.session]);

  function show(f: number) {
    setFrame(f);
    player.currentTime = frameToSeconds(f, fileFps);
  }

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
    setTarget({ x: vx, y: vy });
  }

  async function analyse() {
    if (!clip || !reader.current || !kind) return;
    const video = { width: clip.width, height: clip.height, frames: total, captureFps: fps };
    const opts: CoarseOptions = { range: span, ...(target ? { target } : {}), rebound: kind === 'repeat' };
    const req = coarseRequest(video, opts);
    // The fine pass usually asks for about as many frames again; the bar is honest once it is known.
    let sum = req.frames.length * 2;
    setPhase({ name: 'running', done: 0, total: sum, label: target ? '锁定运动员，粗扫整段' : '找运动员，粗扫整段' });
    try {
      const coarseFrames = await reader.current.read(req, (n) => setPhase({ name: 'running', done: n, total: sum, label: '找运动员，粗扫整段' }));
      const c = analyseCoarse(video, req, coarseFrames, kind === 'drop' ? 'drop' : 'jump', opts);
      if (!c.ok) return setPhase({ name: 'failed', problem: c.problem });
      setBox(c.plan.box);
      sum = req.frames.length + c.plan.request.frames.length;
      const label = `认出 ${c.plan.jumps.length} 跳，逐帧定起跳和落地`;
      const fine = await reader.current.read(c.plan.request, (n) => setPhase({ name: 'running', done: req.frames.length + n, total: sum, label }));
      const r = analyseFine(c.plan, fine);
      if (!r.ok) return setPhase({ name: 'failed', problem: r.problem });
      setEvents(
        r.jumps.map((j) =>
          j.marks.length === 3 ? { touchdown: j.marks[0], takeoff: j.marks[1], landing: j.marks[2], flags: j.flags } : { takeoff: j.marks[0], landing: j.marks[1], flags: j.flags },
        ),
      );
      setKeep([]);
      setPhase({ name: 'done' });
      show(r.jumps[0].marks[0]);
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
      router.replace({ pathname: '/measure/result', params: { metric: def.code, session: params.session, ...(params.from ? { from: params.from } : {}) } });
    } catch (e) {
      Alert.alert('保存失败', String(e));
      setSaving(false);
    }
  }

  function markByHand() {
    router.push({ pathname: '/measure/mark', params: { metric: params.metric, session: params.session, uri: params.uri, fps: params.fps, ...(params.from ? { from: params.from } : {}), ...(params.box ? { box: params.box } : {}), ...(params.asset ? { asset: params.asset } : {}) } });
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
        ...(params.box ? { box: params.box } : {}),
      },
    });
  }

  if (!def || !kind) return <Empty title="这个项目不能自动分析" />;
  const running = phase.name === 'running';
  const s = analysis?.summary;

  return (
    <SafeAreaView style={styles.screen} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.video} onLayout={(e: LayoutChangeEvent) => setView({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}>
          <VideoView player={player} nativeControls={false} contentFit="contain" style={StyleSheet.absoluteFill} />
          {/* The page that reads frames: hidden until it runs, then it shows each frame it reads and the strip it reads. */}
          <View style={[StyleSheet.absoluteFill, { opacity: running ? 1 : 0.01 }]} pointerEvents="none">
            <FrameReader ref={reader} uri={params.uri} fileFps={fileFps} onReady={setClip} onError={() => setPhase({ name: 'failed', problem: 'error' })} style={StyleSheet.absoluteFill} />
          </View>
          {phase.name === 'setup' && (
            <Pressable accessibilityRole="button" accessibilityLabel="点一下运动员" style={StyleSheet.absoluteFill} onPress={(e) => tap(e.nativeEvent.locationX, e.nativeEvent.locationY)} />
          )}
          {target && fit > 0 && phase.name === 'setup' && <View pointerEvents="none" style={[styles.target, { left: ox + target.x * fit - 18, top: oy + target.y * fit - 18 }]} />}
          {box && fit > 0 && phase.name === 'done' && (
            <View pointerEvents="none" style={[styles.lock, onScreen(box)]}>
              <Text style={styles.lockText}>已锁定</Text>
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
            <Text style={styles.lead}>{target ? '已点选运动员。' : '点一下画面里的运动员（旁边有人在动时一定要点）。'}再把片段拉到第一次起跳前、最后一次落地后。</Text>
            <RangeRow
              label="开始"
              value={span.from}
              max={Math.max(1, total - 1)}
              fps={fps}
              onChange={(f) => {
                setRange({ from: Math.min(f, span.to - 1), to: span.to });
                show(f);
              }}
            />
            <RangeRow
              label="结束"
              value={span.to}
              max={Math.max(1, total - 1)}
              fps={fps}
              onChange={(f) => {
                setRange({ from: span.from, to: Math.max(f, span.from + 1) });
                show(f);
              }}
            />
            <View style={styles.fpsRow}>
              <Text style={styles.muted}>拍摄帧率{detectedFps ? `（视频 ${detectedFps} fps）` : ''}</Text>
              <View style={{ flexDirection: 'row', gap: 6 }}>
                {fpsChoices.map((f) => (
                  <Chip key={f} label={String(f)} selected={f === fps} onPress={() => setCaptureOverride(f)} />
                ))}
              </View>
            </View>
            {looksSlowMo && fps <= fileFps && <Text style={styles.warn}>这个视频是 {detectedFps} fps。如果是用 iPhone「慢动作」拍的，拍摄帧率选 240（120 fps 慢动作选 120）。</Text>}
          </>
        )}

        {running && <PulseProgress progress={phase.done / phase.total} label={phase.label} />}

        {phase.name === 'failed' && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>{PROBLEMS[phase.problem].what}</Text>
            <Text style={styles.muted}>建议：{PROBLEMS[phase.problem].advice}</Text>
          </View>
        )}

        {phase.name === 'done' && analysis && s && (
          <>
            <Rise>
              <Summary def={def} kind={kind} analysis={analysis} />
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
            {def.plusReach && current?.standing_reach_cm == null && <Text style={styles.warn}>先在「我的」填站立摸高，才能把跳高换算成摸高并保存。</Text>}
          </>
        )}
      </ScrollView>

      <View style={styles.footer}>
        {phase.name === 'setup' && <Button label={clip ? '开始分析' : '正在读取视频…'} onPress={analyse} disabled={!clip || total === 0} />}
        {phase.name === 'done' && (
          <>
            <Button label={trials.length ? `保存${kind === 'repeat' ? '这一组' : ` ${trials.length} 跳`}` : '没有能保存的跳'} onPress={save} disabled={!trials.length} busy={saving} />
            <Button label="回放 · 导出视频" variant="secondary" onPress={replay} />
          </>
        )}
        {phase.name === 'failed' && <Button label="重新选片段" variant="secondary" onPress={() => setPhase({ name: 'setup' })} />}
        {phase.name !== 'running' && def.capture.some((c) => c === 'flight' || c === 'contact') && (
          <Button label="手动逐帧标" variant="ghost" onPress={markByHand} />
        )}
      </View>
    </SafeAreaView>
  );
}

function RangeRow({ label, value, max, fps, onChange }: { label: string; value: number; max: number; fps: number; onChange: (f: number) => void }) {
  return (
    <View style={styles.rangeRow}>
      <Text style={styles.rangeLabel}>{label}</Text>
      <Slider
        accessibilityLabel={`片段${label}`}
        style={{ flex: 1 }}
        minimumValue={0}
        maximumValue={max}
        step={1}
        value={value}
        onValueChange={(v) => onChange(Math.round(v))}
        minimumTrackTintColor={colors.accent}
        maximumTrackTintColor={colors.border}
        thumbTintColor={colors.text}
      />
      <Text style={styles.rangeTime}>{(value / fps).toFixed(2)} s</Text>
    </View>
  );
}

const cm = (x: number) => x.toFixed(1);
const ms = (s: number) => String(Math.round(s * 1000));

function Summary({ def, kind, analysis }: { def: MetricDef; kind: 'jump' | 'drop' | 'repeat'; analysis: ReturnType<typeof analyseJumps> }) {
  const s = analysis.summary;
  const counted = analysis.jumps.filter((j) => j.counted);
  const err = counted[0]?.error;
  const cells: { label: string; value: string; unit: string; main?: boolean }[] = [];
  if (kind === 'repeat') {
    if (s.rsi105 != null) cells.push({ label: '10/5 RSI', value: s.rsi105.toFixed(2), unit: '', main: true });
    if (s.gctCv != null) cells.push({ label: 'GCT-CV', value: s.gctCv.toFixed(1), unit: '%' });
    if (s.driCv != null) cells.push({ label: 'DRI-CV', value: s.driCv.toFixed(1), unit: '%' });
  } else if (kind === 'drop') {
    if (s.rsi) cells.push({ label: '最好 RSI', value: s.rsi.best.toFixed(2), unit: '', main: true });
    if (s.gctS) cells.push({ label: '最短触地', value: ms(s.gctS.best), unit: 'ms' });
  } else if (s.jhCm) {
    cells.push({ label: '最高', value: cm(s.jhCm.best), unit: 'cm', main: true });
    if (s.counted > 1) cells.push({ label: '平均', value: cm(s.jhCm.mean), unit: 'cm' });
  }
  if (kind !== 'jump' && s.jhCm) cells.push({ label: '平均跳高', value: cm(s.jhCm.mean), unit: 'cm' });
  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>
        {def.name} · 认出 {s.total} 跳，计入 {s.counted} 跳
      </Text>
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
      {kind !== 'jump' && (s.rsr || s.dri) && (
        <Text style={styles.muted}>
          {s.rsr ? `平均 RSR ${s.rsr.mean.toFixed(2)}` : ''}
          {s.dri ? ` · 平均 DRI ${s.dri.mean.toFixed(2)}（新指标，还没有常模，只看自己的变化）` : ''}
        </Text>
      )}
      {err && (
        <Text style={styles.muted}>
          误差：每个关键帧 ±1 帧（{Math.round(err.ftS * 1000)} ms），跳高约 ±{err.jhCm.toFixed(1)} cm
          {err.gctS ? `，触地 ±${Math.round(err.gctS * 1000)} ms` : ''}
        </Text>
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
    ...(e.touchdown != null ? [{ key: 'touchdown' as const, name: '触地', color: colors.purple }] : []),
    { key: 'takeoff', name: '起跳', color: colors.accent },
    { key: 'landing', name: '落地', color: colors.rim },
  ];
  const line = [`${cm(jump.jhCm)} cm`, `滞空 ${ms(jump.ftS)} ms`, ...(jump.gctS != null ? [`触地 ${ms(jump.gctS)} ms`, `RSI ${jump.rsi!.toFixed(2)}`, `RSR ${jump.rsr!.toFixed(2)}`] : []), ...(jump.dri != null ? [`DRI ${jump.dri.toFixed(2)}`] : [])];
  const excludable = jump.flags.some((f) => f === 'edge' || f === 'outlier');
  return (
    <View style={[styles.card, !jump.counted && styles.dimmed]}>
      <Pressable accessibilityRole="button" accessibilityLabel={`第 ${jump.index + 1} 跳`} onPress={onToggle} style={styles.jumpHead}>
        <Text style={styles.jumpNo}>{jump.index + 1}</Text>
        <Text style={styles.jumpLine}>{line.join(' · ')}</Text>
        {!jump.counted && <Text style={styles.out}>未计入</Text>}
      </Pressable>
      {jump.flags.map((f) => (
        <Text key={f} style={styles.flag}>
          {FLAG_TEXT[f].what}。建议：{FLAG_TEXT[f].advice}
        </Text>
      ))}
      {open && (
        <View style={{ gap: 8 }}>
          {keys.map((k) => (
            <View key={k.key} style={styles.keyRow}>
              <Pressable accessibilityRole="button" accessibilityLabel={`看${k.name}帧`} onPress={() => onShow(e[k.key]!)} style={[styles.keyChip, { borderColor: k.color }]}>
                <Text style={[styles.keyName, { color: k.color }]}>{k.name}</Text>
                <Text style={styles.keyFrame}>#{e[k.key]}</Text>
              </Pressable>
              {[-1, 1].map((by) => (
                <Pressable key={by} accessibilityRole="button" accessibilityLabel={`${k.name}${by > 0 ? '后' : '前'}移一帧`} onPress={() => onNudge(k.key, by)} style={styles.nudge}>
                  <Text style={styles.nudgeText}>{by > 0 ? '+1' : '−1'}</Text>
                </Pressable>
              ))}
            </View>
          ))}
          {excludable && <Chip label={kept ? '已手动计入' : '核对过了，计入'} selected={kept} onPress={onKeep} />}
          {kind === 'repeat' && jump.gctS == null && <Text style={styles.muted}>第一跳之前没有触地，不算 RSI。</Text>}
        </View>
      )}
    </View>
  );
}

function HistoryCard({ def, previous, today, verdict, te }: { def: MetricDef; previous: number[]; today: number; verdict: RealChange; te: number | null }) {
  const d = def.decimals;
  const u = def.unit ? ` ${def.unit}` : '';
  const delta = `${verdict.delta >= 0 ? '+' : '−'}${Math.abs(verdict.delta).toFixed(d)}${u}`;
  const text = {
    better: `比之前平均 ${delta}，超过最小可信变化 ${verdict.bar.toFixed(d)}${u}：是真进步`,
    worse: `比之前平均 ${delta}，超过最小可信变化 ${verdict.bar.toFixed(d)}${u}：确实下降了`,
    noise: `比之前平均 ${delta}，没超过最小可信变化 ${verdict.bar.toFixed(d)}${u}：还在噪声里`,
    unknown: '再测几次（至少 3 次）就能判断是不是真进步',
  }[verdict.verdict];
  const tone = verdict.verdict === 'better' ? colors.good : verdict.verdict === 'worse' ? colors.warn : colors.textSoft;
  const points = [...previous.slice(-7), today].map((v, i, a) => ({ label: i === a.length - 1 ? '这次' : '', value: v, display: v.toFixed(d) }));
  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>同动作历史</Text>
      {points.length > 1 && <TrendChart points={points} height={140} />}
      <Text style={[styles.verdict, { color: tone }]}>{text}</Text>
      {verdict.verdict !== 'unknown' && (
        <Text style={styles.muted}>
          {te == null ? '还没有一次测多跳的记录，测量噪声先按历史波动估。' : `测量噪声（同一次测多跳的波动）${te.toFixed(d)}${u}，单次重测要差 ${verdict.mdc!.toFixed(d)}${u} 以上才不是噪声。`}
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
  rangeRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  rangeLabel: { color: colors.textMuted, fontSize: 12, width: 28 },
  rangeTime: { color: colors.text, fontFamily: fonts.numeric, fontSize: 16, width: 56, textAlign: 'right' },
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
});
