import Slider from '@react-native-community/slider';
import { useEventListener } from 'expo';
import * as Haptics from 'expo-haptics';
import { router, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useVideoPlayer, VideoView, type VideoPlayer } from 'expo-video';
import { useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button, Chip, Empty } from '@/components/ui';
import { addTrial, ensureSession } from '@/db/repo';
import { frameCount, frameToSeconds, markingRates } from '@/domain/jump';
import { markProfile, returnsToLogger } from '@/domain/marking';
import { getMetric } from '@/domain/metrics';
import { persistVideo } from '@/media/videos';
import { useAthlete } from '@/state/athlete';
import { colors, fonts, radius } from '@/theme';

const FPS_CHOICES = [60, 120, 240];

// AVPlayer seeks exactly by default (zero tolerance), so this lands on the requested frame.
function seekToFrame(player: VideoPlayer, frame: number, fps: number) {
  player.currentTime = frameToSeconds(frame, fps);
}

export default function Mark() {
  const params = useLocalSearchParams<{ metric: string; session: string; uri: string; fps: string; from?: string; load?: string; reps?: string; rom?: string; box?: string }>();
  const db = useSQLiteContext();
  const { current } = useAthlete();
  const def = getMetric(params.metric);
  const profile = def ? markProfile(def, { romCm: Number(params.rom) || undefined }) : null;
  const player = useVideoPlayer(params.uri, (p) => {
    p.muted = true;
    p.pause();
  });

  const [duration, setDuration] = useState(0);
  const [detectedFps, setDetectedFps] = useState<number | null>(null);
  const [captureOverride, setCaptureOverride] = useState<number | null>(null);
  const [frame, setFrame] = useState(0);
  // The marks, in the profile's order: take-off/landing for a jump, start/finish for a sprint, touch-down/take-off/landing for a drop jump.
  const [marks, setMarks] = useState<(number | null)[]>([]);
  const [saving, setSaving] = useState(false);

  useEventListener(player, 'sourceLoad', ({ duration: d, availableVideoTracks }) => {
    setDuration(d);
    const rate = availableVideoTracks[0]?.frameRate;
    if (rate && rate > 0) setDetectedFps(Math.round(rate));
  });

  // Frames are stepped at the file's own rate and measured at the rate they were captured.
  const { file: fileFps, capture: fps } = markingRates({ detected: detectedFps, chosen: captureOverride, reported: Number(params.fps) || 0 });
  const looksSlowMo = detectedFps != null && detectedFps < 100;
  const fpsChoices = detectedFps == null ? FPS_CHOICES : [fileFps, ...FPS_CHOICES.filter((f) => f > fileFps)];
  const total = frameCount(duration, fileFps);
  const last = Math.max(0, total - 1);

  function show(f: number, rate = fileFps) {
    setFrame(f);
    seekToFrame(player, f, rate);
  }

  const go = (n: number) => show(Math.max(0, Math.min(last, Math.round(n))));

  function changeFps(next: number) {
    setCaptureOverride(next);
    if (detectedFps != null) return;
    // Without a detected file rate the choice also sets the frame step: keep the same moment.
    show(Math.round((frame / fileFps) * next), next);
    setMarks([]);
  }

  function mark(i: number) {
    Haptics.selectionAsync();
    setMarks((m) => profile!.marks.map((_, j) => (j === i ? frame : (m[j] ?? null))));
  }

  if (!profile) return <Empty title="这个项目不能用录像测量" />;
  const marked = profile.marks.map((_, i) => marks[i] ?? null);
  const result = profile.measure(marked, fps);

  async function save() {
    if (!result.ok || !current) return;
    setSaving(true);
    try {
      const videoUri = await persistVideo(params.uri, params.session).catch(() => params.uri);
      await ensureSession(db, params.session, current.id, params.metric);
      await addTrial(db, {
        session_id: params.session,
        value: result.value,
        flight_ms: result.elapsedS * 1000,
        fps,
        // The last two marks; a drop jump's touch-down frame goes in the detail.
        takeoff_frame: marked.at(-2),
        landing_frame: marked.at(-1),
        video_uri: videoUri,
        ...(params.from === 'vbt'
          ? { load_kg: Number(params.load) || 0, detail: { source: 'video', rom_cm: Number(params.rom), ...(Number(params.reps) ? { reps: Number(params.reps) } : {}) } }
          : params.load != null
            ? { load_kg: Number(params.load) || 0 }
            : {}),
        ...(result.detail || params.box ? { detail: { ...result.detail, ...(params.box ? { box_cm: Number(params.box) } : {}) } } : {}),
      });
      // A VBT set or a profile jump goes straight back to its log (capture and marking are the two screens above it).
      if (returnsToLogger(params.from)) return router.dismiss(2);
      router.replace({ pathname: '/measure/result', params: { metric: params.metric, session: params.session, ...(params.from ? { from: params.from } : {}) } });
    } catch (e) {
      Alert.alert('保存失败', String(e));
      setSaving(false);
    }
  }

  // Past every mark that is set and not after the current frame.
  const firstAhead = marked.findIndex((m) => m == null || frame < m);
  const phaseIndex = firstAhead === -1 ? marked.length : firstAhead;
  const phase = profile.phases[phaseIndex];
  const markColors = marked.length === 3 ? [colors.purple, colors.blue, colors.warn] : [colors.blue, colors.warn];
  const phaseColor = [colors.textMuted, ...(marked.length === 3 ? [colors.purple, colors.accent] : [colors.accent]), colors.warn][phaseIndex];

  return (
    <SafeAreaView style={styles.screen} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.video}>
          <VideoView player={player} nativeControls={false} contentFit="contain" style={StyleSheet.absoluteFill} />
          <View style={styles.frameBadge}>
            <Text style={styles.frameText}>#{frame}</Text>
            <Text style={styles.frameTime}>{Math.round((frame / fps) * 1000)} ms</Text>
          </View>
          <View style={[styles.phase, { borderColor: phaseColor }]}>
            <Text style={[styles.phaseText, { color: phaseColor }]}>{phase}</Text>
          </View>
        </View>

        <View style={styles.fpsRow}>
          <Text style={styles.label}>拍摄帧率{detectedFps ? `（视频 ${detectedFps} fps）` : ''}</Text>
          <View style={{ flexDirection: 'row', gap: 6 }}>
            {fpsChoices.map((f) => (
              <Chip key={f} label={String(f)} selected={f === fps} onPress={() => changeFps(f)} />
            ))}
          </View>
        </View>
        {looksSlowMo && (
          <Text style={[styles.slowMoHint, fps > fileFps && { color: colors.accent }]}>
            {fps > fileFps
              ? `按慢动作计算：每帧 = 1/${fps} 秒`
              : `这个视频是 ${detectedFps} fps。如果是用 iPhone「慢动作」拍的，拍摄帧率选 240（120 fps 慢动作选 120）。`}
          </Text>
        )}

        <Slider
          accessibilityLabel="逐帧拖动"
          minimumValue={0}
          maximumValue={last || 1}
          step={1}
          value={frame}
          onValueChange={go}
          minimumTrackTintColor={colors.accent}
          maximumTrackTintColor={colors.border}
          thumbTintColor={colors.text}
        />

        <View style={styles.stepRow}>
          {[-10, -1, 1, 10].map((d) => (
            <Pressable key={d} accessibilityRole="button" accessibilityLabel={`${d > 0 ? '前进' : '后退'} ${Math.abs(d)} 帧`} onPress={() => go(frame + d)} style={styles.step}>
              <Text style={styles.stepText}>{d > 0 ? `+${d}` : d}</Text>
            </Pressable>
          ))}
        </View>

        <View style={styles.markRow}>
          {profile.marks.map((m, i) => (
            <MarkButton key={m.title} {...m} value={marked[i]} color={markColors[i]} onMark={() => mark(i)} onJump={() => marked[i] != null && go(marked[i]!)} />
          ))}
        </View>

        <View style={styles.result}>
          {result.ok ? (
            result.cells.map((c) => (
              <View key={c.label} style={styles.resultCell}>
                <Text style={styles.label}>{c.label}</Text>
                <Text style={[styles.resultValue, c.main && { color: colors.accent }]}>
                  {c.value} <Text style={styles.unit}>{c.unit}</Text>
                </Text>
              </View>
            ))
          ) : (
            <Text style={styles.problem}>{result.message}</Text>
          )}
        </View>
      </ScrollView>
      <View style={styles.footer}>
        <Button label="保存这一次" onPress={save} disabled={!result.ok} busy={saving} />
      </View>
    </SafeAreaView>
  );
}

function MarkButton({ title, hint, value, color, onMark, onJump }: { title: string; hint: string; value: number | null; color: string; onMark: () => void; onJump: () => void }) {
  return (
    <View style={styles.markCard}>
      <Pressable accessibilityRole="button" accessibilityLabel={`把当前帧标为${title}`} onPress={onMark} style={[styles.markButton, { borderColor: color }]}>
        <Text style={[styles.markTitle, { color }]}>标为{title}</Text>
        <Text style={styles.markHint}>{hint}</Text>
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel={`跳到${title}`} onPress={onJump} disabled={value == null}>
        <Text style={styles.markValue}>{value == null ? '未设' : `#${value}`}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 16, gap: 14 },
  video: { height: 380, borderRadius: radius.card, overflow: 'hidden', backgroundColor: '#000' },
  frameBadge: { position: 'absolute', left: 12, top: 12, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 10, backgroundColor: 'rgba(15,17,21,0.85)', alignItems: 'center' },
  frameText: { color: colors.text, fontFamily: fonts.numeric, fontSize: 18 },
  frameTime: { color: colors.textMuted, fontFamily: fonts.numeric, fontSize: 12 },
  phase: { position: 'absolute', right: 12, top: 12, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 10, borderWidth: 1, backgroundColor: 'rgba(15,17,21,0.85)' },
  phaseText: { fontSize: 12, fontWeight: '700' },
  fpsRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  label: { color: colors.textMuted, fontSize: 12 },
  slowMoHint: { color: colors.warn, fontSize: 12, lineHeight: 18 },
  stepRow: { flexDirection: 'row', gap: 8 },
  step: { flex: 1, height: 44, borderRadius: 12, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  stepText: { color: colors.text, fontFamily: fonts.numeric, fontSize: 18 },
  markRow: { flexDirection: 'row', gap: 10 },
  markCard: { flex: 1, gap: 6, alignItems: 'center' },
  markButton: { alignSelf: 'stretch', height: 60, borderRadius: radius.chip, borderWidth: 1.5, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  markTitle: { fontSize: 15, fontWeight: '700' },
  markHint: { color: colors.textMuted, fontSize: 11 },
  markValue: { color: colors.textSoft, fontFamily: fonts.numeric, fontSize: 16, padding: 6 },
  result: { minHeight: 84, borderRadius: radius.card, backgroundColor: colors.surface, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around', padding: 12 },
  resultCell: { alignItems: 'center', gap: 2 },
  resultValue: { color: colors.text, fontFamily: fonts.numericBold, fontSize: 36 },
  unit: { color: colors.textMuted, fontSize: 15 },
  problem: { color: colors.textMuted, fontSize: 13, textAlign: 'center', flex: 1 },
  footer: { paddingHorizontal: 16, paddingTop: 8 },
});
