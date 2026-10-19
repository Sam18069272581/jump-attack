import * as ImagePicker from 'expo-image-picker';
import { router, useFocusEffect, useIsFocused, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Camera, CommonResolutions, useCameraDevice, useCameraPermission, useVideoOutput, type Recorder } from 'react-native-vision-camera';

import { Icon } from '@/components/Icon';
import { Button, Chip } from '@/components/ui';
import { listTrials } from '@/db/repo';
import { getMetric } from '@/domain/metrics';
import { toFileUri } from '@/media/videos';
import { colors, fonts } from '@/theme';

type Mode = 'idle' | 'recording' | 'done';

const FPS_OPTIONS = [120, 240];
const MAX_SECONDS = 15;

export default function Capture() {
  const { metric, session } = useLocalSearchParams<{ metric: string; session: string }>();
  const def = getMetric(metric);
  const db = useSQLiteContext();
  const focused = useIsFocused();
  const permission = useCameraPermission();
  const device = useCameraDevice('back');
  const videoOutput = useVideoOutput({ targetResolution: CommonResolutions.HD_16_9 });

  const supported = useMemo(() => FPS_OPTIONS.filter((f) => device?.supportsFPS(f)), [device]);
  const [preferredFps, setFps] = useState(240);
  // Fall back to the highest rate this camera supports.
  const fps = supported.includes(preferredFps) ? preferredFps : (supported.at(-1) ?? preferredFps);
  const [selectedFps, setSelectedFps] = useState<number | undefined>();
  const [mode, setMode] = useState<Mode>('idle');
  const [elapsed, setElapsed] = useState(0);
  const [videoUri, setVideoUri] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(1);
  const recorder = useRef<Recorder | null>(null);

  // Coming back from the result screen ("再测一次") starts a fresh attempt in the same session.
  useFocusEffect(
    useCallback(() => {
      setMode('idle');
      setVideoUri(null);
      listTrials(db, session).then((t) => setAttempt(t.length + 1));
    }, [db, session]),
  );

  useEffect(() => {
    if (mode !== 'recording') return;
    const started = Date.now();
    const timer = setInterval(() => setElapsed((Date.now() - started) / 1000), 100);
    return () => clearInterval(timer);
  }, [mode]);

  async function start() {
    try {
      const r = await videoOutput.createRecorder({ maxDuration: MAX_SECONDS });
      recorder.current = r;
      await r.startRecording(
        (path) => {
          setVideoUri(toFileUri(path));
          setMode('done');
        },
        (error) => {
          setMode('idle');
          Alert.alert('录制失败', error.message);
        },
      );
      setElapsed(0);
      setMode('recording');
    } catch (e) {
      Alert.alert('无法开始录制', String(e));
    }
  }

  async function stop() {
    await recorder.current?.stopRecording();
  }

  async function importVideo() {
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['videos'],
      // Keep the original high-frame-rate file instead of a re-encoded copy.
      preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Current,
    });
    if (res.canceled || !res.assets[0]) return;
    goMark(res.assets[0].uri, 0);
  }

  function goMark(uri: string, recordedFps: number) {
    router.push({ pathname: '/jumps/mark', params: { metric, session, uri, fps: String(recordedFps) } });
  }

  function retake() {
    setVideoUri(null);
    setMode('idle');
  }

  const close = () => (router.canGoBack() ? router.back() : router.replace('/jumps'));

  if (!permission.hasPermission) {
    return (
      <SafeAreaView style={[styles.screen, styles.center]}>
        <Text style={styles.permTitle}>需要相机权限</Text>
        <Text style={styles.permHint}>用高帧率录像来测量滞空时间。</Text>
        {permission.canRequestPermission ? (
          <Button label="允许使用相机" onPress={() => permission.requestPermission()} style={{ alignSelf: 'stretch' }} />
        ) : (
          <Text style={styles.permHint}>请在系统设置中为 Jump Attack 打开相机权限。</Text>
        )}
        <Button label="从相册导入视频" variant="secondary" onPress={importVideo} style={{ alignSelf: 'stretch' }} />
        <Button label="返回" variant="ghost" onPress={close} style={{ alignSelf: 'stretch' }} />
      </SafeAreaView>
    );
  }

  const shownFps = selectedFps ?? fps;

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.top}>
        <Pressable accessibilityRole="button" accessibilityLabel="关闭" onPress={close} style={styles.iconButton}>
          <Icon name="close" />
        </Pressable>
        <View style={{ alignItems: 'center' }}>
          <Text style={styles.title}>录制 · {def?.name ?? metric}</Text>
          <Text style={styles.subtitle}>第 {attempt} 次</Text>
        </View>
        <View style={styles.fpsRow}>
          {supported.map((f) => (
            <Chip key={f} label={String(f)} selected={f === fps} onPress={() => mode === 'idle' && setFps(f)} />
          ))}
        </View>
      </View>

      <View style={[styles.viewfinder, mode === 'recording' && { borderColor: colors.record }]}>
        {device ? (
          <Camera
            style={StyleSheet.absoluteFill}
            device={device}
            isActive={focused && mode !== 'done'}
            outputs={[videoOutput]}
            constraints={[{ fps }, { resolutionBias: videoOutput }]}
            onSessionConfigSelected={(c) => setSelectedFps(c.selectedFPS)}
            onError={(e) => Alert.alert('相机错误', e.message)}
          />
        ) : (
          <View style={[StyleSheet.absoluteFill, styles.center]}>
            <Text style={styles.permHint}>没有找到后置摄像头</Text>
          </View>
        )}

        <View pointerEvents="none" style={StyleSheet.absoluteFill}>
          <View style={styles.footBox} />
          <View style={styles.groundLine} />
          <Text style={styles.guide}>双脚放进框内 · 地面对齐虚线</Text>
        </View>

        {mode === 'recording' && (
          <View style={styles.recBadge}>
            <View style={styles.recDot} />
            <Text style={styles.recText}>REC {elapsed.toFixed(1)} s</Text>
          </View>
        )}
        {mode === 'idle' && (
          <View style={styles.checks}>
            <Text style={styles.check}>手机放稳（地面或三脚架），别手持</Text>
            <Text style={styles.check}>距离约 1.5 米，镜头对准脚踝</Text>
            <Text style={styles.check}>实际帧率 {shownFps} fps</Text>
          </View>
        )}
        {mode === 'done' && (
          <View style={styles.doneCard}>
            <Text style={styles.doneTitle}>录制完成</Text>
            <Text style={styles.doneText}>
              {elapsed.toFixed(1)} 秒 · 约 {Math.round(elapsed * shownFps)} 帧 · {shownFps} fps。下一步逐帧找到起跳和落地。
            </Text>
          </View>
        )}
      </View>

      <View style={styles.controls}>
        {mode === 'done' && videoUri ? (
          <View style={styles.doneButtons}>
            <Button label="重拍" variant="secondary" onPress={retake} style={{ flex: 1 }} />
            <Button label="去标记帧" onPress={() => goMark(videoUri, shownFps)} style={{ flex: 1 }} />
          </View>
        ) : (
          <>
            <View style={styles.recordRow}>
              <Pressable accessibilityRole="button" accessibilityLabel="从相册导入视频" onPress={importVideo} disabled={mode === 'recording'} style={styles.sideButton}>
                <Icon name="gallery" />
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={mode === 'recording' ? '停止录制' : '开始录制'}
                onPress={mode === 'recording' ? stop : start}
                disabled={!device}
                style={styles.shutter}
              >
                <View style={mode === 'recording' ? styles.shutterStop : styles.shutterDot} />
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="拍摄指引"
                onPress={() => Alert.alert('拍摄指引', '1. 手机横放或竖放在地面/三脚架上，镜头对准脚踝高度。\n2. 运动员站在框内，完成一次起跳并落地。\n3. 落地站稳后再停止录制。\n4. 优先用 240 fps，误差约 ±4 ms。')}
                style={styles.sideButton}
              >
                <Icon name="info" />
              </Pressable>
            </View>
            <Text style={styles.hint}>{mode === 'recording' ? '完成一次起跳并落地后，点击停止' : `最长录制 ${MAX_SECONDS} 秒`}</Text>
          </>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  center: { alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24 },
  permTitle: { color: colors.text, fontSize: 20, fontWeight: '700' },
  permHint: { color: colors.textMuted, fontSize: 13, textAlign: 'center' },
  top: { height: 64, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  iconButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  title: { color: colors.text, fontSize: 15, fontWeight: '700' },
  subtitle: { color: colors.textMuted, fontSize: 11 },
  fpsRow: { flexDirection: 'row', gap: 4 },
  viewfinder: { flex: 1, marginHorizontal: 12, borderRadius: 20, overflow: 'hidden', borderWidth: 2, borderColor: colors.surface, backgroundColor: '#16191E' },
  footBox: { position: 'absolute', alignSelf: 'center', bottom: 120, width: 190, height: 70, borderWidth: 2, borderStyle: 'dashed', borderColor: colors.accent, borderRadius: 12 },
  groundLine: { position: 'absolute', left: 0, right: 0, bottom: 136, borderTopWidth: 2, borderStyle: 'dashed', borderColor: colors.accent, opacity: 0.6 },
  guide: { position: 'absolute', alignSelf: 'center', bottom: 92, color: colors.accent, fontSize: 11 },
  recBadge: { position: 'absolute', top: 18, alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 12, backgroundColor: 'rgba(15,17,21,0.85)' },
  recDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.record },
  recText: { color: colors.text, fontFamily: fonts.numeric, fontSize: 18 },
  checks: { position: 'absolute', top: 16, left: 16, right: 16, gap: 6, alignItems: 'flex-start' },
  check: { color: colors.text, fontSize: 12, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 10, backgroundColor: 'rgba(15,17,21,0.82)', overflow: 'hidden' },
  doneCard: { position: 'absolute', top: 16, left: 16, right: 16, padding: 14, borderRadius: 14, backgroundColor: 'rgba(15,17,21,0.9)', gap: 4 },
  doneTitle: { color: colors.accent, fontSize: 14, fontWeight: '700' },
  doneText: { color: colors.textSoft, fontSize: 12 },
  controls: { paddingHorizontal: 20, paddingVertical: 20, gap: 14 },
  recordRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sideButton: { width: 52, height: 52, borderRadius: 14, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  shutter: { width: 84, height: 84, borderRadius: 42, borderWidth: 4, borderColor: colors.text, alignItems: 'center', justifyContent: 'center' },
  shutterDot: { width: 64, height: 64, borderRadius: 32, backgroundColor: colors.record },
  shutterStop: { width: 30, height: 30, borderRadius: 6, backgroundColor: colors.record },
  hint: { textAlign: 'center', color: colors.textMuted, fontSize: 12 },
  doneButtons: { flexDirection: 'row', gap: 10 },
});
