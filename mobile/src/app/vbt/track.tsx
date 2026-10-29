import { useEventListener } from 'expo';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useVideoPlayer } from 'expo-video';
import { useEffect, useRef, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';

import { BarPathChart } from '@/components/BarPathChart';
import { LIFT_SETUP } from '@/components/capture/guides';
import { Button, Card, Chip, Empty } from '@/components/ui';
import { addVbtSet } from '@/db/vbt';
import { analyseBarPath, countsByDefault, REP_FLAG_REASONS, trackedSet, trackTimeScale, trackWarnings, type BarAnalysis, type TrackSample } from '@/domain/barPath';
import { roundTo } from '@/domain/interval';
import { getCategory, getMetric } from '@/domain/metrics';
import { STOP_LOSS, zoneOf } from '@/domain/vbt';
import { tr } from '@/i18n';
import { barTrackerHtml } from '@/media/barTrackerHtml';
import { isWeb } from '@/media/runtime';
import { persistVideo, stageForTracking } from '@/media/videos';
import { useAthlete } from '@/state/athlete';
import { colors, fonts, radius, text } from '@/theme';

const COLOR = getCategory('vbt').color;
// The library's class defaults its extra-props parameter to `undefined`, which leaves no props at all under React 19's types.
type Web = WebView<Record<never, never>>;
/** Slow-motion capture rates offered when the file itself is a normal-speed export. */
const SLOW_MO = [120, 240];

type Tracked = { samples: TrackSample[]; diameter: number; lost: boolean; analysis: BarAnalysis };
type Message =
  | { type: 'ready'; duration: number; width: number; height: number }
  | { type: 'progress'; done: number }
  | { type: 'done'; samples: [number, number, number, number][]; diameter: number; lost: boolean }
  | { type: 'error'; message: string };

/**
 * Measures a VBT set from video with no frame marking: the athlete puts a circle over the outer 45 cm plate once,
 * the page in the WebView follows the plate through every frame, and the app finds each rep and its mean velocity.
 */
export default function TrackSet() {
  // `uri` and `fps`: a set filmed in the app (measure/camera.tsx), whose recording reports no frame rate of its own.
  const params = useLocalSearchParams<{ lift: string; session: string; load: string; uri?: string; fps?: string }>();
  const { lift, session, load } = params;
  const def = getMetric(lift);
  const db = useSQLiteContext();
  const { current } = useAthlete();
  const web = useRef<Web>(null);
  const { height: screenH } = useWindowDimensions();

  const [uri, setUri] = useState<string | null>(params.uri ?? null);
  const filmed = uri != null && uri === params.uri;
  const filmedFps = filmed ? Number(params.fps) || 0 : 0;
  const [detectedFps, setDetectedFps] = useState<number | null>(null);
  const [stage, setStage] = useState<{ page: string; dir: string } | null>(null);
  const [ready, setReady] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [tracked, setTracked] = useState<Tracked | null>(null);
  const [slowMo, setSlowMo] = useState<number | null>(null);
  /** Whether each rep of the analysis counts; reset whenever the reps are found again. */
  const [included, setIncluded] = useState<boolean[]>([]);
  const [saving, setSaving] = useState(false);

  // Only to read the clip's frame rate; the WebView does the decoding.
  const player = useVideoPlayer(uri, (p) => {
    p.muted = true;
  });
  useEventListener(player, 'sourceLoad', ({ availableVideoTracks }) => {
    const rate = availableVideoTracks[0]?.frameRate;
    setDetectedFps(rate && rate > 0 ? Math.round(rate) : filmedFps);
  });

  // Stage the clip and page once the frame rate is known (or not reported within a couple of seconds).
  useEffect(() => {
    if (!uri) return;
    let gone = false;
    const timer = setTimeout(() => setDetectedFps((f) => f ?? filmedFps), 2500);
    if (detectedFps != null && !stage) {
      stageForTracking(uri, (video) =>
        barTrackerHtml({ video, fps: detectedFps, accent: COLOR, bg: colors.bg, text: colors.text, muted: colors.textMuted }),
      )
        .then((s) => !gone && setStage(s))
        .catch((e) => Alert.alert(tr('视频准备失败'), String(e)));
    }
    return () => {
      gone = true;
      clearTimeout(timer);
    };
  }, [uri, detectedFps, stage, filmedFps]);

  if (!def) return <Empty title={tr('找不到这个动作')} />;

  const analysis = tracked?.analysis ?? null;
  const set = analysis ? trackedSet(analysis.reps, included) : null;
  const summary = set?.summary ?? null;
  const warnings = analysis ? [...(tracked?.lost ? [tr('中途跟丢了杠铃片，后面的次数没有算进去。')] : []), ...trackWarnings(analysis)] : [];

  /** Finds the reps again (on new tracking, or a new slow-motion rate) and starts from the default choice of reps. */
  function analyse(t: Omit<Tracked, 'analysis'>, chosen: number | null) {
    const a = analyseBarPath(t.samples, t.diameter, trackTimeScale(detectedFps, chosen));
    setTracked({ ...t, analysis: a });
    setIncluded(a.reps.map(countsByDefault));
  }

  function chooseSlowMo(f: number | null) {
    setSlowMo(f);
    if (tracked) analyse(tracked, f);
  }

  async function pick() {
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['videos'],
      preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Current,
    });
    if (res.canceled || !res.assets[0]) return;
    setStage(null);
    setReady(false);
    setProgress(null);
    setTracked(null);
    setIncluded([]);
    setSlowMo(null);
    setDetectedFps(null);
    setUri(res.assets[0].uri);
  }

  /** The camera opens in this screen's place and hands the take back to a fresh one. */
  function film() {
    router.replace({ pathname: '/measure/camera', params: { to: '/vbt/track', lift, session, load } });
  }

  function onMessage(e: WebViewMessageEvent) {
    let m: Message;
    try {
      m = JSON.parse(e.nativeEvent.data);
    } catch {
      return;
    }
    if (m.type === 'ready') setReady(true);
    else if (m.type === 'progress') setProgress(m.done);
    else if (m.type === 'error') {
      setProgress(null);
      Alert.alert(tr('分析不了这段视频'), m.message);
    } else if (m.type === 'done') {
      setProgress(null);
      const samples = m.samples.map(([t, x, y, c]) => ({ t, x, y, c }));
      analyse({ samples, diameter: m.diameter, lost: m.lost }, slowMo);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }
  }

  function start() {
    setTracked(null);
    setProgress(0);
    web.current?.injectJavaScript(`window.startTrack(${detectedFps ?? 0}); true;`);
  }

  /** The page died (iOS reclaims a WebView's memory) or failed to load: start it over. */
  function restartPage() {
    setProgress(null);
    setReady(false);
    web.current?.reload();
  }

  async function save() {
    if (!current || !set) return;
    setSaving(true);
    try {
      const videoUri = uri ? await persistVideo(uri, session).catch(() => undefined) : undefined;
      await addVbtSet(db, current.id, session, lift, {
        load: Number(load) || 0,
        v: roundTo(set.summary.best, 2),
        reps: set.kept.length,
        source: 'video',
        romCm: roundTo(set.best.romCm, 1),
        repV: set.kept.map((r) => roundTo(r.mv, 3)),
        repMpv: set.kept.map((r) => roundTo(r.mpv, 3)),
        peakV: roundTo(set.peakV, 2),
        videoUri,
      });
      router.back();
    } catch (e) {
      Alert.alert(tr('保存失败'), String(e));
      setSaving(false);
    }
  }

  const title = `${def.name} · ${Number(load) || 0} kg`;

  if (!uri) {
    return (
      <SafeAreaView style={styles.screen} edges={['bottom']}>
        <Stack.Screen options={{ title }} />
        <ScrollView contentContainerStyle={styles.content}>
          <Text style={text.muted}>{tr('拍一整组（在 App 里直接拍，或从相册导入），再圈一下杠铃片，App 自动跟踪杠铃、分出每一次，算出平均速度。不用逐帧标记。')}</Text>
          {LIFT_SETUP.map((s, i) => (
            <View key={s.title} style={styles.step}>
              <Text style={styles.stepNo}>{i + 1}</Text>
              <View style={{ flex: 1, gap: 4 }}>
                <Text style={styles.stepTitle}>{s.title}</Text>
                <Text style={styles.stepText}>{s.text}</Text>
              </View>
            </View>
          ))}
        </ScrollView>
        <View style={styles.footer}>
          {/* The app's camera is a web page in a WebView, which the web version has none of. */}
          {!isWeb && <Button label={tr('App 里直接拍')} onPress={film} />}
          <Button label={tr('从相册选这一组的视频')} variant={isWeb ? 'primary' : 'secondary'} onPress={pick} />
        </View>
      </SafeAreaView>
    );
  }

  const busy = progress != null;
  return (
    <SafeAreaView style={styles.screen} edges={['bottom']}>
      <Stack.Screen options={{ title }} />
      {/* Still while the circle is dragged onto the plate, or the drag scrolls the screen instead. */}
      <ScrollView contentContainerStyle={styles.content} scrollEnabled={analysis != null} alwaysBounceVertical={false}>
        <Text style={text.muted}>
          {analysis ? tr('可以点某一次把它去掉（比如起杠、放杠被误算）。') : tr('拖动圆圈套住外侧那片 45 cm 杠铃片，双指缩放，松手后会自动贴合杠铃片边缘。下面的进度条拖到这一组开始前。')}
        </Text>
        <View style={[styles.web, { height: Math.min(460, Math.round(screenH * 0.55)) }]}>
          {stage ? (
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
              onContentProcessDidTerminate={restartPage}
              onError={restartPage}
              style={{ backgroundColor: colors.bg }}
            />
          ) : (
            <Text style={[text.muted, { textAlign: 'center', marginTop: 40 }]}>{tr('正在准备视频…')}</Text>
          )}
        </View>

        {!filmed && detectedFps != null && detectedFps > 0 && detectedFps <= 30 && (
          <View style={styles.fpsRow}>
            <Text style={text.caption}>{tr('视频 {detectedFps} fps，用慢动作拍的选拍摄帧率', { detectedFps })}</Text>
            <View style={{ flexDirection: 'row', gap: 6 }}>
              <Chip label={tr('普通')} selected={slowMo == null} onPress={() => chooseSlowMo(null)} color={COLOR} />
              {SLOW_MO.map((f) => (
                <Chip key={f} label={String(f)} selected={slowMo === f} onPress={() => chooseSlowMo(f)} color={COLOR} />
              ))}
            </View>
          </View>
        )}

        {busy && <Text style={[text.muted, { textAlign: 'center' }]}>{tr('正在逐帧跟踪 {progress}%', { progress: Math.round((progress ?? 0) * 100) })}</Text>}

        {analysis && (
          <Card style={{ gap: 10 }}>
            <BarPathChart path={analysis.path} reps={analysis.reps} included={analysis.reps.map((_, i) => included[i] ?? false)} color={COLOR} />
            {analysis.reps.map((r, i) => {
              const on = included[i] ?? false;
              const n = analysis.reps.slice(0, i + 1).filter((_, j) => included[j]).length;
              const loss = set?.loss[i] ?? 0;
              return (
                <Pressable
                  key={i}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: on }}
                  accessibilityLabel={tr('第 {i} 次，{mv} 米每秒', { i: i + 1, mv: r.mv.toFixed(2) })}
                  onPress={() => setIncluded((inc) => analysis.reps.map((_, j) => (j === i ? !on : (inc[j] ?? false))))}
                  style={[styles.rep, !on && { opacity: 0.4 }]}
                >
                  <Text style={styles.repNo}>{on ? n : '–'}</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.repV}>
                      {r.mv.toFixed(2)} <Text style={styles.unit}>m/s</Text>
                    </Text>
                    <Text style={text.caption}>{tr('MPV {mpv} · 峰值 {pv} m/s · 行程 {romCm} cm · {end} ms', { mpv: r.mpv.toFixed(2), pv: r.pv.toFixed(2), romCm: Math.round(r.romCm), end: Math.round((r.end - r.start) * 1000) })}</Text>
                    {r.flags.map((f) => (
                      <Text key={f} style={[text.caption, { color: colors.warn }]}>
                        {REP_FLAG_REASONS[f]}
                      </Text>
                    ))}
                  </View>
                  <Text style={[text.caption, loss >= STOP_LOSS && { color: colors.warn }]}>{on ? (loss >= STOP_LOSS ? tr('慢了 {loss}%', { loss: Math.round(loss * 100) }) : zoneOf(r.mv).name) : tr('已去掉')}</Text>
                </Pressable>
              );
            })}
            {summary && (
              <Text style={text.caption}>{tr('记录最快一次 {best} m/s，共 {count} 次{p}。', { best: summary.best.toFixed(2), count: summary.count, p: summary.count > 1 ? tr('，最后一次比最快慢了 {loss}%', { loss: Math.round(summary.loss * 100) }) : '' })}</Text>
            )}
            {warnings.map((w) => (
              <Text key={w} style={styles.warn}>
                {w}
              </Text>
            ))}
          </Card>
        )}
      </ScrollView>
      <View style={styles.footer}>
        {analysis && summary ? (
          <>
            <Button label={tr('保存这一组 · {best} m/s', { best: summary.best.toFixed(2) })} onPress={save} busy={saving} />
            <Button label={tr('重新圈选再分析')} variant="secondary" onPress={() => setTracked(null)} />
          </>
        ) : (
          <>
            <Button label={busy ? tr('分析中…') : tr('开始分析')} onPress={start} disabled={!ready || busy} busy={busy} />
            <Button label={tr('换一个视频')} variant="ghost" onPress={pick} />
          </>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 16, gap: 12 },
  step: { flexDirection: 'row', gap: 12, padding: 14, borderRadius: radius.card, backgroundColor: colors.surface },
  stepNo: { width: 28, color: COLOR, fontFamily: fonts.numericBold, fontSize: 24, textAlign: 'center' },
  stepTitle: { color: colors.text, fontSize: 15, fontWeight: '700' },
  stepText: { color: colors.textMuted, fontSize: 13, lineHeight: 19 },
  web: { height: 460, borderRadius: radius.card, overflow: 'hidden', backgroundColor: colors.bg },
  fpsRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  rep: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.divider },
  repNo: { width: 18, color: colors.textMuted, fontFamily: fonts.numeric, fontSize: 16 },
  repV: { color: COLOR, fontFamily: fonts.numericBold, fontSize: 22 },
  unit: { color: colors.textMuted, fontSize: 12 },
  warn: { color: colors.warn, fontSize: 13, lineHeight: 19 },
  footer: { paddingHorizontal: 16, paddingTop: 8, gap: 8 },
});
