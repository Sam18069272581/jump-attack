import { useKeepAwake } from 'expo-keep-awake';
import { router, useLocalSearchParams } from 'expo-router';
import * as ScreenOrientation from 'expo-screen-orientation';
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { captureGuide } from '@/components/capture/guides';
import { Icon } from '@/components/Icon';
import { PoseCamera, type CameraErrorStage, type CameraInfo, type PoseCameraHandle, type Recorded } from '@/components/PoseCamera';
import { Button } from '@/components/ui';
import { getMetric } from '@/domain/metrics';
import { tr } from '@/i18n';
import { dropTake, dropTestTakes } from '@/media/takes';
import { colors, fonts, radius } from '@/theme';

/** The screens a take goes on to: jump analysis, frame marking (jumps logged one at a time), VBT bar tracking. */
const NEXT = ['/measure/analyse', '/measure/mark', '/vbt/track'] as const;
type Next = (typeof NEXT)[number];

/** Time to start, walk into place, jump and land; a VBT set takes longer. */
const JUMP_TAKE_S = 30;
const LIFT_TAKE_S = 60;

type Rec =
  | { name: 'live' }
  | { name: 'starting' }
  | { name: 'recording'; since: number }
  | { name: 'stopping' }
  /** `lost`: the camera page went after the take was saved, so filming again needs a fresh one. */
  | { name: 'recorded'; take: Recorded; lost?: boolean }
  | { name: 'failed'; stage: CameraErrorStage; message: string };

function errorText(stage: CameraErrorStage, message: string, name: string): string {
  if (stage === 'camera') {
    if (name === 'NotAllowedError') return tr('没有相机权限：到 iPhone「设置」里找到 Expo Go，打开「相机」，再回来点重试。');
    if (name === 'NotFoundError' || name === 'OverconstrainedError') return tr('找不到能用的后置相机。');
    if (name === 'NotSupportedError') return tr('这台手机的系统不能在 App 里用网页相机（要 iOS 14.3 以上）。可以用相机 App 拍，再导入。');
    return tr('相机打不开：{message}', { message });
  }
  return message;
}

const clockText = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

/**
 * Films a jump test or a VBT set with the phone's own camera (components/PoseCamera.tsx without the pose model), held
 * upright or on its side, and hands the take on to the screen that measures it, in this one's place: the jump analysis
 * finds the take-off and landing frames, the bar tracking follows the plate. A web page gets at most 60 frames a
 * second, so the slow-motion import stays the way to film a jump for the most accurate numbers.
 */
export default function TestCamera() {
  const { to, ...pass } = useLocalSearchParams<{ to: string; metric?: string; lift?: string; session: string; load?: string }>();
  const next: Next = NEXT.find((n) => n === to) ?? '/measure/analyse';
  const lift = next === '/vbt/track';
  const def = getMetric(pass.lift ?? pass.metric ?? '');
  const guide = captureGuide(def?.category ?? 'jump', def?.code);
  const maxSeconds = lift ? LIFT_TAKE_S : JUMP_TAKE_S;
  const title = lift ? `${def?.name ?? ''} · ${Number(pass.load) || 0} kg` : (def?.name ?? '');
  useKeepAwake();
  const { width, height } = useWindowDimensions();
  const landscape = width > height;
  const camera = useRef<PoseCameraHandle>(null);
  const [info, setInfo] = useState<CameraInfo | null>(null);
  const [rec, setRec] = useState<Rec>({ name: 'live' });
  const [now, setNow] = useState(0);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    // Takes filmed before this one were needed only until they were measured.
    dropTestTakes();
    ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.DEFAULT).catch(() => {});
    return () => {
      ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(() => {});
    };
  }, []);

  useEffect(() => {
    if (rec.name !== 'recording') return;
    const id = setInterval(() => setNow(Date.now() / 1000), 250);
    return () => clearInterval(id);
  }, [rec.name]);

  function onError(stage: CameraErrorStage, message: string, name: string) {
    // A take already saved is still good to measure.
    setRec((r) => (r.name === 'recorded' ? { ...r, lost: true } : { name: 'failed', stage, message: errorText(stage, message, name) }));
  }

  function record() {
    setRec({ name: 'starting' });
    camera.current?.startRecording();
  }

  function stop() {
    setRec({ name: 'stopping' });
    camera.current?.stopRecording();
  }

  function retry() {
    setInfo(null);
    setRec({ name: 'live' });
    setAttempt((n) => n + 1);
  }

  function retake() {
    if (rec.name === 'recorded') dropTake(rec.take.uri);
    if (rec.name === 'recorded' && rec.lost) return retry();
    setRec({ name: 'live' });
  }

  function use(take: Recorded) {
    camera.current?.stopCamera();
    const params = Object.fromEntries(Object.entries(pass).filter((e): e is [string, string] => e[1] != null));
    router.replace({ pathname: next, params: { ...params, uri: take.uri, fps: String(Math.round(info?.fps ?? 30)) } });
  }

  const live = rec.name === 'live';
  const canRecord = live && info != null;
  const recording = rec.name === 'recording' || rec.name === 'stopping';
  const fatal = rec.name === 'failed' && rec.stage !== 'record';
  const slow = info?.fps != null && info.fps < 50;

  return (
    <View style={styles.screen}>
      <PoseCamera
        key={attempt}
        ref={camera}
        pose={false}
        maxSeconds={maxSeconds}
        onCamera={setInfo}
        onRecording={() => {
          const t = Date.now() / 1000;
          setRec({ name: 'recording', since: t });
          setNow(t);
        }}
        onRecorded={(take) => setRec({ name: 'recorded', take })}
        onError={onError}
        style={StyleSheet.absoluteFill}
      />
      <SafeAreaView style={StyleSheet.absoluteFill} edges={['left', 'right', 'top', 'bottom']} pointerEvents="box-none">
        <View style={styles.top} pointerEvents="box-none">
          <Pressable accessibilityRole="button" accessibilityLabel={tr('关闭')} onPress={() => router.back()} style={styles.close}>
            <Icon name="close" size={22} color="#FFFFFF" />
          </Pressable>
          <View style={styles.topRight}>
            <Text style={styles.title}>{title}</Text>
            {info && (
              <Text style={styles.info}>
                {info.fps ? `${Math.round(info.fps)} fps` : tr('帧率未知')}
                {info.physical ? '' : tr(' · 录的时候别缩放')}
              </Text>
            )}
          </View>
        </View>

        {live && (
          <View style={[styles.checks, landscape ? styles.checksSide : styles.checksTop]} pointerEvents="none">
            {guide.checks.map((c) => (
              <Text key={c} style={styles.checkText}>
                · {c}
              </Text>
            ))}
            {slow && <Text style={styles.warn}>{tr('这台手机的网页相机只有 {fps} 帧，测得会粗；用相机 App 拍了再导入更准。', { fps: Math.round(info!.fps!) })}</Text>}
            <Text style={styles.note}>
              {lift
                ? tr('App 里拍是 60 帧，测杠铃速度够用。')
                : tr('App 里最多 60 帧：起跳或落地差一帧，跳高差约 2–3 cm、触地时间差 17 ms。要测准，用 iPhone 慢动作（240 帧）拍了再导入。')}
            </Text>
          </View>
        )}

        <View style={[styles.controls, landscape ? styles.controlsSide : styles.controlsBottom]} pointerEvents="box-none">
          {(live || rec.name === 'starting') && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={tr('开始录像')}
              accessibilityState={{ disabled: !canRecord }}
              disabled={!canRecord}
              onPress={record}
              style={[styles.shutter, !canRecord && { opacity: 0.35 }]}
            >
              <View style={styles.shutterDot} />
            </Pressable>
          )}
          {recording && (
            <>
              <Pressable accessibilityRole="button" accessibilityLabel={tr('停止录像')} disabled={rec.name === 'stopping'} onPress={stop} style={styles.shutter}>
                <View style={styles.stopSquare} />
              </Pressable>
              <Text style={styles.timer}>
                {clockText(rec.name === 'recording' ? now - rec.since : 0)} / {clockText(maxSeconds)}
              </Text>
            </>
          )}
        </View>

        {recording && (
          <View style={[styles.banner, landscape ? styles.bannerSide : styles.bannerBottom]} pointerEvents="none">
            <Text style={styles.bannerText}>{tr('录像中：{hint}（最长 {maxSeconds} 秒）', { hint: guide.recordingHint, maxSeconds })}</Text>
          </View>
        )}

        {rec.name === 'recorded' && (
          <View style={styles.panelWrap}>
            <View style={styles.panel}>
              <Text style={styles.panelTitle}>{tr('录好了 · {seconds} 秒', { seconds: rec.take.seconds.toFixed(1) })}</Text>
              <Button label={tr('用这一段')} onPress={() => use(rec.take)} />
              <Button label={tr('重拍')} variant="secondary" onPress={retake} />
            </View>
          </View>
        )}

        {rec.name === 'failed' && (
          <View style={styles.panelWrap}>
            <View style={styles.panel}>
              <Text style={styles.panelText}>{rec.message}</Text>
              {/* After a failed take the page may still be holding it: a fresh page films the next one. */}
              <Button label={fatal ? tr('重试') : tr('重拍')} onPress={retry} />
              {fatal && <Button label={tr('返回')} variant="secondary" onPress={() => router.back()} />}
            </View>
          </View>
        )}
      </SafeAreaView>
    </View>
  );
}

const glass = 'rgba(23,19,14,0.72)';

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.text },
  top: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', padding: 12 },
  close: { width: 40, height: 40, borderRadius: 20, backgroundColor: glass, alignItems: 'center', justifyContent: 'center' },
  topRight: { alignItems: 'flex-end', gap: 6 },
  title: { color: '#FFFFFF', fontSize: 14, fontWeight: '700', backgroundColor: glass, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8, overflow: 'hidden' },
  info: { color: '#FFFFFF', fontFamily: fonts.numeric, fontSize: 15, backgroundColor: glass, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 8, overflow: 'hidden' },
  checks: { position: 'absolute', backgroundColor: glass, borderRadius: 14, padding: 10, gap: 5 },
  checksSide: { left: 12, top: 64, width: 230 },
  checksTop: { left: 12, right: 12, top: 64 },
  checkText: { color: '#FFFFFF', fontSize: 13, lineHeight: 18 },
  warn: { color: colors.warn, fontSize: 12, lineHeight: 16, marginTop: 4 },
  note: { color: 'rgba(255,255,255,0.75)', fontSize: 11, lineHeight: 15, marginTop: 4 },
  controls: { position: 'absolute', alignItems: 'center', justifyContent: 'center', gap: 10 },
  controlsSide: { right: 16, top: 0, bottom: 0 },
  controlsBottom: { left: 0, right: 0, bottom: 32 },
  shutter: { width: 72, height: 72, borderRadius: 36, borderWidth: 4, borderColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center' },
  shutterDot: { width: 54, height: 54, borderRadius: 27, backgroundColor: colors.record },
  stopSquare: { width: 28, height: 28, borderRadius: 6, backgroundColor: colors.record },
  timer: { color: '#FFFFFF', fontFamily: fonts.numeric, fontSize: 18, backgroundColor: glass, paddingHorizontal: 8, borderRadius: 8, overflow: 'hidden' },
  banner: { position: 'absolute', backgroundColor: glass, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 10 },
  bannerSide: { left: 24, right: 120, bottom: 16 },
  bannerBottom: { left: 16, right: 16, bottom: 150 },
  bannerText: { color: '#FFFFFF', fontSize: 16, lineHeight: 22, fontWeight: '600', textAlign: 'center' },
  panelWrap: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
  panel: { width: 320, maxWidth: '90%', backgroundColor: colors.surface, borderRadius: radius.card, padding: 16, gap: 10 },
  panelTitle: { color: colors.text, fontSize: 17, fontWeight: '700', textAlign: 'center' },
  panelText: { color: colors.text, fontSize: 14, lineHeight: 20 },
});
