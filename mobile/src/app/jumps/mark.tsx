import Slider from '@react-native-community/slider';
import { useEventListener } from 'expo';
import * as Haptics from 'expo-haptics';
import { router, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useVideoPlayer, VideoView, type VideoPlayer } from 'expo-video';
import { useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button, Chip } from '@/components/ui';
import { addTrial, ensureSession } from '@/db/repo';
import { frameCount, frameToSeconds, markingRates, measureFromMarks, type MarkProblem } from '@/domain/jump';
import { persistVideo } from '@/media/videos';
import { useAthlete } from '@/state/athlete';
import { colors, fonts, radius } from '@/theme';

const FPS_CHOICES = [60, 120, 240];

// AVPlayer seeks exactly by default (zero tolerance), so this lands on the requested frame.
function seekToFrame(player: VideoPlayer, frame: number, fps: number) {
  player.currentTime = frameToSeconds(frame, fps);
}

const PROBLEM_TEXT: Record<MarkProblem, string> = {
  missing: '标记起跳帧和落地帧后显示结果',
  order: '落地帧要在起跳帧之后',
  'too-short': '滞空不到 150 ms，检查是否标错帧',
  'too-long': '滞空超过 1.2 s：检查是否标错帧；慢动作视频要把拍摄帧率选成 240',
};

export default function Mark() {
  const params = useLocalSearchParams<{ metric: string; session: string; uri: string; fps: string }>();
  const db = useSQLiteContext();
  const { current } = useAthlete();
  const player = useVideoPlayer(params.uri, (p) => {
    p.muted = true;
    p.pause();
  });

  const [duration, setDuration] = useState(0);
  const [detectedFps, setDetectedFps] = useState<number | null>(null);
  const [captureOverride, setCaptureOverride] = useState<number | null>(null);
  const [frame, setFrame] = useState(0);
  const [takeoff, setTakeoff] = useState<number | null>(null);
  const [landing, setLanding] = useState<number | null>(null);
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
    setTakeoff(null);
    setLanding(null);
  }

  function mark(kind: 'takeoff' | 'landing') {
    Haptics.selectionAsync();
    if (kind === 'takeoff') setTakeoff(frame);
    else setLanding(frame);
  }

  const result = measureFromMarks({ takeoffFrame: takeoff, landingFrame: landing, fps });

  async function save() {
    if (!result.ok || !current) return;
    setSaving(true);
    try {
      const videoUri = await persistVideo(params.uri, params.session).catch(() => params.uri);
      await ensureSession(db, params.session, current.id, params.metric);
      await addTrial(db, {
        session_id: params.session,
        value: Math.round(result.value.heightCm * 10) / 10,
        flight_ms: result.value.flightS * 1000,
        fps,
        takeoff_frame: takeoff,
        landing_frame: landing,
        video_uri: videoUri,
      });
      router.replace({ pathname: '/jumps/result', params: { metric: params.metric, session: params.session } });
    } catch (e) {
      Alert.alert('保存失败', String(e));
      setSaving(false);
    }
  }

  const phase = takeoff == null || frame < takeoff ? '准备 / 下蹲' : landing == null || frame < landing ? '腾空' : '落地';
  const phaseColor = phase === '腾空' ? colors.accent : phase === '落地' ? colors.warn : colors.textMuted;

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
          <MarkButton title="起跳帧" hint="脚尖刚离地" value={takeoff} color={colors.blue} onMark={() => mark('takeoff')} onJump={() => takeoff != null && go(takeoff)} />
          <MarkButton title="落地帧" hint="脚尖刚触地" value={landing} color={colors.warn} onMark={() => mark('landing')} onJump={() => landing != null && go(landing)} />
        </View>

        <View style={styles.result}>
          {result.ok ? (
            <>
              <View style={styles.resultCell}>
                <Text style={styles.label}>滞空</Text>
                <Text style={styles.resultValue}>{Math.round(result.value.flightS * 1000)} <Text style={styles.unit}>ms</Text></Text>
              </View>
              <View style={styles.resultCell}>
                <Text style={styles.label}>跳高</Text>
                <Text style={[styles.resultValue, { color: colors.accent }]}>{result.value.heightCm.toFixed(1)} <Text style={styles.unit}>cm</Text></Text>
              </View>
            </>
          ) : (
            <Text style={styles.problem}>{PROBLEM_TEXT[result.problem]}</Text>
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
