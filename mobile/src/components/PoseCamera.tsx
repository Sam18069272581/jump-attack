import type { File } from 'expo-file-system';
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { type StyleProp, type ViewStyle } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';

import { poseCameraHtml } from '@/media/poseCameraHtml';
import { stagePosePage, unstagePosePage } from '@/media/poseLib';
import { dropTake, newTakeFile } from '@/media/takes';
import { colors } from '@/theme';

// The library's class defaults its extra-props parameter to `undefined`, which leaves no props at all under React 19's types.
type Web = WebView<Record<never, never>>;

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
  onCamera: (info: CameraInfo) => void;
  onFrame: (frame: CameraFrame) => void;
  onRecording: () => void;
  onRecorded: (r: Recorded) => void;
  onError: (stage: CameraErrorStage, message: string, name: string) => void;
  style?: StyleProp<ViewStyle>;
};

/**
 * The phone's camera with the pose model on it (media/poseCameraHtml.ts in a WebView): its picture and skeletons, a
 * report of each picture read for the setup checks, and the takes it records, written to a file of their own piece by
 * piece as the page sends them (media/takes.ts).
 */
export const PoseCamera = forwardRef<PoseCameraHandle, Props>(function PoseCamera({ style, ...props }, ref) {
  const web = useRef<Web>(null);
  const [stage, setStage] = useState<{ page: string; dir: string; root: string } | null>(null);
  const take = useRef<File | null>(null);
  const handlers = useRef(props);
  useEffect(() => {
    handlers.current = props;
  });

  useEffect(() => {
    let gone = false;
    let dir: string | null = null;
    stagePosePage(() => poseCameraHtml({ bg: colors.text, accent: colors.rim }))
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
  }, []);

  const call = (js: string) => web.current?.injectJavaScript(`${js}; true;`);
  useImperativeHandle(ref, () => ({
    startRecording: () => call('window.startRecording()'),
    stopRecording: () => call('window.stopRecording()'),
    stopCamera: () => call('window.stopCamera()'),
  }));

  function fail(stage: CameraErrorStage, message: string, name = '') {
    if (take.current) dropTake(take.current.uri);
    take.current = null;
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
    if (m.type === 'frame') return h.onFrame({ width: m.width, height: m.height, luma: m.luma, lumas: m.lumas, poses: m.poses, crowd: m.crowd });
    if (m.type === 'error') return fail(m.stage, m.stage === 'record' ? `录像出错：${m.message}` : m.message, m.name);
    if (m.type === 'recording') {
      if (take.current) dropTake(take.current.uri);
      take.current = null;
      return h.onRecording();
    }
    if (m.type === 'chunk') {
      try {
        // Each piece is written before the page sends the next: base64 to bytes, with no copy of the whole take in memory.
        take.current ??= newTakeFile('mp4');
        await take.current.write(m.data, { encoding: 'base64', append: true });
      } catch (err) {
        return fail('record', `录像存不下来：${err instanceof Error ? err.message : String(err)}`);
      }
      return call(`window.ack(${m.seq})`);
    }
    if (m.type === 'recorded') {
      const file = take.current;
      take.current = null;
      if (!file || m.chunks === 0) return fail('record', '没录到画面');
      if (file.size !== m.size) {
        dropTake(file.uri);
        return fail('record', `录像不完整（${file.size} / ${m.size} 字节）`);
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
      onError={() => fail('page', '相机页面打不开')}
      onContentProcessDidTerminate={() => fail('page', '手机把相机页面关掉了')}
      style={[{ backgroundColor: colors.text }, style]}
    />
  );
});
