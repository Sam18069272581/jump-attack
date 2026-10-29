import { useKeepAwake } from 'expo-keep-awake';
import { router, useLocalSearchParams } from 'expo-router';
import * as ScreenOrientation from 'expo-screen-orientation';
import * as Speech from 'expo-speech';
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Icon } from '@/components/Icon';
import { PoseCamera, type CameraErrorStage, type CameraFrame, type CameraInfo, type PoseCameraHandle, type Recorded } from '@/components/PoseCamera';
import { Button } from '@/components/ui';
import { decodePose } from '@/domain/pose';
import { checkSetup, SETUP_CHECKS, type GravitySample, type SetupCheck, type SetupFrame, type SetupState } from '@/domain/poseSetup';
import { speechLanguage, tr } from '@/i18n';
import { startGravity, type Vec } from '@/media/gravity';
import { MAX_TAKE_S } from '@/media/poseCameraHtml';
import { dropTake } from '@/media/takes';
import { colors, fonts, radius } from '@/theme';

/** The checks must have passed for this long before the record button wakes: one good picture isn't a setup. */
const HOLD_S = 1;
/** Readings kept for the checks, s (they read the last second). */
const KEEP_S = 3;
/** Least time between two spoken hints, s, so the phone doesn't chatter while the athlete moves into place. */
const SPEAK_GAP_S = 2.5;
const READY_LINE = '好了，可以拍了';
const GO_LINE = '开始录了，去助跑吧';

type Rec =
  | { name: 'live' }
  | { name: 'starting' }
  | { name: 'recording'; since: number }
  | { name: 'stopping' }
  /** `lost`: the camera page went after the take was saved, so filming again needs a fresh one. */
  | { name: 'recorded'; take: Recorded; lost?: boolean }
  | { name: 'failed'; stage: CameraErrorStage; message: string };

const STATE_COLOR: Record<SetupCheck['state'], string> = { ok: colors.good, warn: colors.warn, fix: colors.record, wait: colors.textFaint };

function errorText(stage: CameraErrorStage, message: string, name: string): string {
  if (stage === 'camera') {
    if (name === 'NotAllowedError') return tr('没有相机权限：到 iPhone「设置」里找到 Expo Go，打开「相机」，再回来点重试。');
    if (name === 'NotFoundError' || name === 'OverconstrainedError') return tr('找不到能用的后置相机。');
    if (name === 'NotSupportedError') return tr('这台手机的系统不能在 App 里用网页相机（要 iOS 14.3 以上）。可以用相机 App 拍慢动作，再导入。');
    return tr('相机打不开：{message}', { message });
  }
  if (stage === 'model') return tr('骨架识别启动不了：{message}', { message });
  return message;
}

const clockText = (s: number) => `00:${String(Math.floor(s)).padStart(2, '0')}`;

/**
 * Films a run-up jump with the phone's own camera, side-on and landscape: the pose model reads the picture as it comes
 * (components/PoseCamera.tsx), the setup checks (domain/poseSetup.ts) say what to change, aloud too, and the record
 * button wakes once they have held. A take goes on to the analysis screen in this one's place.
 */
export default function TechniqueCamera() {
  const { session } = useLocalSearchParams<{ session: string }>();
  useKeepAwake();
  const camera = useRef<PoseCameraHandle>(null);
  const frames = useRef<SetupFrame[]>([]);
  const gravity = useRef<GravitySample[]>([]);
  const readySince = useRef<number | null>(null);
  const voice = useRef({ text: '', at: -Infinity });
  const [setup, setSetup] = useState<SetupState>(() => checkSetup([], []));
  const [armed, setArmed] = useState(false);
  const [unchecked, setUnchecked] = useState(false);
  const [muted, setMuted] = useState(false);
  const [info, setInfo] = useState<CameraInfo | null>(null);
  const [rec, setRec] = useState<Rec>({ name: 'live' });
  const [now, setNow] = useState(0);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE).catch(() => {});
    return () => {
      Speech.stop();
      ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(() => {});
    };
  }, []);

  function speak(line: string | null, t: number, urgent = false) {
    const v = voice.current;
    if (!line || muted || line === v.text) return;
    if (!urgent && t - v.at < SPEAK_GAP_S) return;
    Speech.stop();
    Speech.speak(line, { language: speechLanguage(), rate: 1.05 });
    voice.current = { text: line, at: t };
  }

  function update(t: number) {
    const s = checkSetup(frames.current, gravity.current);
    readySince.current = s.ready ? (readySince.current ?? t) : null;
    const held = readySince.current != null && t - readySince.current >= HOLD_S;
    setSetup(s);
    setArmed(held);
    setNow(t);
    // The moment it is ready is worth saying at once; hints wait their turn, and "still looking" isn't one. After a
    // take the checks run on, but there is nothing to set up until it is filmed again.
    if (rec.name === 'live') speak(held ? tr(READY_LINE) : s.main && s.main.state !== 'wait' ? s.main.hint : null, t, held);
  }

  // The accelerometer's listener lives as long as the screen; what it calls is this render's.
  const onReading = useRef<(g: Vec) => void>(() => {});
  useEffect(() => {
    onReading.current = (g) => {
      const t = Date.now() / 1000;
      gravity.current = [...gravity.current.filter((s) => s.t >= t - KEEP_S), { t, x: g.x, y: g.y, z: g.z }];
      // Until the camera's first picture, the phone's own checks are all there is to show.
      if (!frames.current.length) update(t);
    };
  });
  useEffect(() => {
    let gone = false;
    let sub: { remove: () => void } | null = null;
    startGravity((g) => onReading.current(g)).then((s) => {
      if (gone) s?.remove();
      else sub = s;
    });
    return () => {
      gone = true;
      sub?.remove();
    };
  }, []);

  useEffect(() => {
    if (rec.name !== 'recording') return;
    const id = setInterval(() => setNow(Date.now() / 1000), 250);
    return () => clearInterval(id);
  }, [rec.name]);

  function onFrame(f: CameraFrame) {
    const t = Date.now() / 1000;
    const frame: SetupFrame = { t, width: f.width, height: f.height, poses: f.poses.map((v) => decodePose(v, f.width, f.height)), lumas: f.lumas, luma: f.luma, crowd: f.crowd };
    frames.current = [...frames.current.filter((x) => x.t >= t - KEEP_S), frame];
    update(t);
  }

  function onError(stage: CameraErrorStage, message: string, name: string) {
    // A take already saved is still good to analyse.
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

  function retake() {
    if (rec.name === 'recorded') dropTake(rec.take.uri);
    if (rec.name === 'recorded' && rec.lost) return retry();
    setRec({ name: 'live' });
  }

  function retry() {
    frames.current = [];
    readySince.current = null;
    setInfo(null);
    setRec({ name: 'live' });
    setAttempt((n) => n + 1);
  }

  function analyse(take: Recorded) {
    camera.current?.stopCamera();
    router.replace({ pathname: '/technique/analyse', params: { uri: take.uri, fps: String(Math.round(info?.fps ?? 30)), source: 'camera', session } });
  }

  const live = rec.name === 'live';
  // The page can record only once it holds the camera, which it says first.
  const canRecord = live && info != null && (armed || unchecked);
  const recording = rec.name === 'recording' || rec.name === 'stopping';
  const fatal = rec.name === 'failed' && rec.stage !== 'record';

  return (
    <View style={styles.screen}>
      <PoseCamera
        key={attempt}
        ref={camera}
        onCamera={setInfo}
        onFrame={onFrame}
        onRecording={() => {
          const t = Date.now() / 1000;
          setRec({ name: 'recording', since: t });
          setNow(t);
          speak(tr(GO_LINE), t, true);
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
            {info && (
              <Text style={styles.info}>
                {info.fps ? `${Math.round(info.fps)} fps` : tr('帧率未知')}
                {info.physical ? '' : tr(' · 录的时候别缩放')}
              </Text>
            )}
            <Pressable accessibilityRole="button" onPress={() => setMuted((m) => !m)} style={styles.pill}>
              <Text style={styles.pillText}>{muted ? tr('语音提示：关') : tr('语音提示：开')}</Text>
            </Pressable>
          </View>
        </View>

        {live && (
          <View style={styles.checks} pointerEvents="none">
            {SETUP_CHECKS.map(([key, name]) => {
              const c = setup.checks.find((x) => x.key === key);
              const level = key === 'phone' && setup.level ? ` ${Math.abs(setup.level.roll).toFixed(1)}° / ${Math.abs(setup.level.pitch).toFixed(1)}°` : '';
              return (
                <View key={key} style={styles.checkRow}>
                  <View style={[styles.dot, { backgroundColor: STATE_COLOR[c?.state ?? 'wait'] }]} />
                  <Text style={styles.checkText}>
                    {name}
                    {level}
                  </Text>
                </View>
              );
            })}
            {info?.fps != null && info.fps < 50 && <Text style={styles.note}>{tr('这台手机的网页相机只有 {fps} 帧：触地时间测不出来，起跳速度也粗。', { fps: Math.round(info.fps) })}</Text>}
            <Text style={styles.note}>{tr('App 里最多 60 帧：要测准触地时间，用 iPhone 慢动作拍了再导入。')}</Text>
          </View>
        )}

        <View style={styles.side} pointerEvents="box-none">
          {(live || rec.name === 'starting') && (
            <>
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
              {live && !armed && !unchecked && (
                <Pressable accessibilityRole="button" onPress={() => setUnchecked(true)}>
                  <Text style={styles.skip}>{tr('不检查直接拍')}</Text>
                </Pressable>
              )}
            </>
          )}
          {recording && (
            <>
              <Pressable accessibilityRole="button" accessibilityLabel={tr('停止录像')} disabled={rec.name === 'stopping'} onPress={stop} style={styles.shutter}>
                <View style={styles.stopSquare} />
              </Pressable>
              <Text style={styles.timer}>
                {clockText(rec.name === 'recording' ? now - rec.since : 0)} / {clockText(MAX_TAKE_S)}
              </Text>
            </>
          )}
        </View>

        {(live || recording) && (
          <View style={styles.banner} pointerEvents="none">
            <Text style={styles.bannerText}>
              {recording
                ? tr('录像中：助跑、起跳、落地，再回来点停（最长 {MAX_TAKE_S} 秒）', { MAX_TAKE_S })
                : armed
                  ? tr('可以拍了：点红色按钮开始录，助跑、起跳、落地后再点停。')
                  : unchecked
                    ? tr('没检查也可以拍：点红色按钮开始录。')
                    : (setup.main?.hint ?? tr('正在检查…'))}
            </Text>
          </View>
        )}

        {rec.name === 'recorded' && (
          <View style={styles.panelWrap}>
            <View style={styles.panel}>
              <Text style={styles.panelTitle}>{tr('录好了 · {seconds} 秒', { seconds: rec.take.seconds.toFixed(1) })}</Text>
              <Button label={tr('分析这一段')} onPress={() => analyse(rec.take)} />
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
  info: { color: '#FFFFFF', fontFamily: fonts.numeric, fontSize: 15, backgroundColor: glass, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 8, overflow: 'hidden' },
  pill: { backgroundColor: glass, borderRadius: 14, paddingHorizontal: 10, paddingVertical: 5 },
  pillText: { color: '#FFFFFF', fontSize: 12, fontWeight: '600' },
  checks: { position: 'absolute', left: 12, top: 64, width: 200, backgroundColor: glass, borderRadius: 14, padding: 10, gap: 5 },
  checkRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  checkText: { color: '#FFFFFF', fontSize: 13 },
  note: { color: 'rgba(255,255,255,0.75)', fontSize: 11, lineHeight: 15, marginTop: 4 },
  side: { position: 'absolute', right: 16, top: 0, bottom: 0, justifyContent: 'center', alignItems: 'center', gap: 10 },
  shutter: { width: 72, height: 72, borderRadius: 36, borderWidth: 4, borderColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center' },
  shutterDot: { width: 54, height: 54, borderRadius: 27, backgroundColor: colors.record },
  stopSquare: { width: 28, height: 28, borderRadius: 6, backgroundColor: colors.record },
  skip: { color: '#FFFFFF', fontSize: 12, textDecorationLine: 'underline', backgroundColor: glass, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8, overflow: 'hidden' },
  timer: { color: '#FFFFFF', fontFamily: fonts.numeric, fontSize: 18, backgroundColor: glass, paddingHorizontal: 8, borderRadius: 8, overflow: 'hidden' },
  banner: { position: 'absolute', left: 230, right: 110, bottom: 16, backgroundColor: glass, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 10 },
  bannerText: { color: '#FFFFFF', fontSize: 16, lineHeight: 22, fontWeight: '600', textAlign: 'center' },
  panelWrap: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
  panel: { width: 340, backgroundColor: colors.surface, borderRadius: radius.card, padding: 16, gap: 10 },
  panelTitle: { color: colors.text, fontSize: 17, fontWeight: '700', textAlign: 'center' },
  panelText: { color: colors.text, fontSize: 14, lineHeight: 20 },
});
