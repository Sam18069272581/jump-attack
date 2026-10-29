import { Paths, type File } from 'expo-file-system';
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { type StyleProp, type ViewStyle } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';

import { tr } from '@/i18n';
import { CAMERA_BITRATE, MAX_TAKE_S, poseCameraHtml } from '@/media/poseCameraHtml';
import { stagePosePage, unstagePosePage } from '@/media/poseLib';
import { dropTake, newTakeFile } from '@/media/takes';
import { colors } from '@/theme';

// The library's class defaults its extra-props parameter to `undefined`, which leaves no props at all under React 19's types.
type Web = WebView<Record<never, never>>;

/** Room kept free while filming: about two takes (20 s at 60 fps is some 25 MB), so the phone isn't filled to the brim. */
const RESERVE_BYTES = 50e6;
/** A whole take at the page's bit rate: 20 s × 1.25 MB/s = 25 MB. */
const takeBytes = (seconds: number) => (seconds * CAMERA_BITRATE) / 8;

export type CameraInfo = { label: string; physical: boolean; fps: number | null; maxFps: number | null; width: number; height: number };
/** One picture the page read: its people (132 numbers each), brightness, and the count of the latest whole-picture search. */
export type CameraFrame = { width: number; height: number; luma: number; lumas: number[]; poses: number[][]; crowd: number };
export type Recorded = { uri: string; size: number; seconds: number; mime: string };
export type CameraErrorStage = 'camera' | 'model' | 'record' | 'page';

type Msg =
  | ({ type: 'camera' } & CameraInfo)
  | { type: 'model'; delegate: string; source: string }
  | ({ type: 'frame' } & CameraFrame)
  | { type: 'recording'; mime: string }
  | { type: 'chunk'; seq: number; data: string }
  | { type: 'recorded'; chunks: number; size: number; mime: string; seconds: number }
  | { type: 'error'; stage: CameraErrorStage; name: string; message: string };

export type PoseCameraHandle = {
  startRecording: () => void;
  stopRecording: () => void;
  /** Lets the camera go, before leaving for a screen that plays a video. */
  stopCamera: () => void;
};

type Props = {
  /** Without the pose model (default with): a test that only needs the take (jumps, VBT), whose takes are kept apart. */
  pose?: boolean;
  /** The longest take, s. */
  maxSeconds?: number;
  onCamera: (info: CameraInfo) => void;
  onFrame?: (frame: CameraFrame) => void;
  onRecording: () => void;
  onRecorded: (r: Recorded) => void;
  onError: (stage: CameraErrorStage, message: string, name: string) => void;
  style?: StyleProp<ViewStyle>;
};

/**
 * The phone's camera with the pose model on it (media/poseCameraHtml.ts in a WebView): its picture and skeletons, a
 * report of each picture read for the setup checks, and the takes it records, written to a file of their own piece by
 * piece as the page sends them (media/takes.ts). With `pose={false}` it is the camera and the recorder only.
 */
export const PoseCamera = forwardRef<PoseCameraHandle, Props>(function PoseCamera({ style, pose = true, maxSeconds = MAX_TAKE_S, ...props }, ref) {
  const web = useRef<Web>(null);
  const [stage, setStage] = useState<{ page: string; dir: string; root: string } | null>(null);
  const take = useRef<File | null>(null);
  /** Something failed since the take began: its remaining pieces are answered but not written, and its end is no take. */
  const broken = useRef(false);
  const handlers = useRef(props);
  useEffect(() => {
    handlers.current = props;
  });

  useEffect(() => {
    let gone = false;
    let dir: string | null = null;
    stagePosePage(() => poseCameraHtml({ bg: colors.text, accent: colors.rim, pose, maxSeconds }))
      .then((s) => {
        if (gone) return unstagePosePage(s.dir);
        dir = s.dir;
        setStage(s);
      })
      .catch((e) => !gone && handlers.current.onError('page', String(e), ''));
    return () => {
      gone = true;
      if (dir) unstagePosePage(dir);
      // A take still being written when the screen goes is no take.
      if (take.current) dropTake(take.current.uri);
    };
    // The page is made once: what it is (with the model or not, how long a take) doesn't change while it's open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const call = (js: string) => web.current?.injectJavaScript(`${js}; true;`);
  useImperativeHandle(ref, () => ({
    startRecording: () => {
      // A take the phone can't hold to the end isn't started: the athlete would run up for nothing.
      const free = Paths.availableDiskSpace;
      if (free != null && free < takeBytes(maxSeconds) + RESERVE_BYTES) return fail('record', tr('录像存不下来：手机存储空间不够了，清理一些再拍'));
      call('window.startRecording()');
    },
    stopRecording: () => call('window.stopRecording()'),
    stopCamera: () => call('window.stopCamera()'),
  }));

  function fail(stage: CameraErrorStage, message: string, name = '') {
    if (take.current) dropTake(take.current.uri);
    take.current = null;
    broken.current = true;
    // A take still being recorded is no take now: the page stops it (nothing happens when there is none).
    call('window.stopRecording()');
    handlers.current.onError(stage, message, name);
  }

  async function onMessage(e: WebViewMessageEvent) {
    let m: Msg;
    try {
      m = JSON.parse(e.nativeEvent.data);
    } catch {
      return;
    }
    const h = handlers.current;
    if (m.type === 'camera') return h.onCamera({ label: m.label, physical: m.physical, fps: m.fps, maxFps: m.maxFps, width: m.width, height: m.height });
    if (m.type === 'frame') return h.onFrame?.({ width: m.width, height: m.height, luma: m.luma, lumas: m.lumas, poses: m.poses, crowd: m.crowd });
    if (m.type === 'error') return fail(m.stage, m.stage === 'record' ? tr('录像出错：{message}', { message: m.message }) : m.message, m.name);
    if (m.type === 'recording') {
      // A take whose start comes after a failure belongs to it: the page was told to stop it, and the failure stays said.
      if (broken.current) return;
      if (take.current) dropTake(take.current.uri);
      take.current = null;
      return h.onRecording();
    }
    if (m.type === 'chunk') {
      if (!broken.current) {
        try {
          // Each piece is written before the page sends the next: base64 to bytes, with no copy of the whole take in memory.
          take.current ??= newTakeFile('mp4', pose ? 'technique' : 'test');
          // iOS's append can't say the phone is full (it raises, and the app is closed), so the room is checked first,
          // with enough left over for the camera's own copy of the take and for the phone itself.
          const free = Paths.availableDiskSpace;
          if (free != null && free < m.data.length + RESERVE_BYTES) throw new Error(tr('手机存储空间不够了'));
          await take.current.write(m.data, { encoding: 'base64', append: true });
        } catch (err) {
          fail('record', tr('录像存不下来：{p}', { p: err instanceof Error ? err.message : String(err) }));
        }
      }
      // Answered even when not written: the page holds the take until every piece is, and records nothing new meanwhile.
      return call(`window.ack(${m.seq})`);
    }
    if (m.type === 'recorded') {
      // The first failure says what went wrong; the end of the take it broke would only say it came out short.
      if (broken.current) return;
      const file = take.current;
      take.current = null;
      if (!file || m.chunks === 0) return fail('record', tr('没录到画面'));
      if (file.size !== m.size) {
        dropTake(file.uri);
        return fail('record', tr('录像不完整（{size} / {size2} 字节）', { size: file.size, size2: m.size }));
      }
      h.onRecorded({ uri: file.uri, size: m.size, seconds: m.seconds, mime: m.mime });
    }
  }

  if (!stage) return null;
  return (
    <WebView<Record<never, never>>
      ref={web}
      source={{ uri: stage.page }}
      originWhitelist={['*']}
      allowingReadAccessToURL={stage.root}
      allowFileAccess
      allowFileAccessFromFileURLs
      allowUniversalAccessFromFileURLs
      allowsInlineMediaPlayback
      mediaPlaybackRequiresUserAction={false}
      // The phone asks for the camera once; this spares the page WebKit's own question every time it opens.
      mediaCapturePermissionGrantType="grant"
      scrollEnabled={false}
      bounces={false}
      onMessage={onMessage}
      onError={() => fail('page', tr('相机页面打不开'))}
      onContentProcessDidTerminate={() => fail('page', tr('手机把相机页面关掉了'))}
      style={[{ backgroundColor: colors.text }, style]}
    />
  );
});
