// Drives the technique camera screen: the camera page in the WebView is replaced by messages like the page's, the
// accelerometer by readings of a phone on its side, so the flow runs from the setup checks to a take handed on to the
// analysis.
import * as ScreenOrientation from 'expo-screen-orientation';
import * as Speech from 'expo-speech';
import { Text } from 'react-native';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';

import type { Pose } from '@/domain/pose';
import { standing, type Stand } from '@/domain/testing/standing';
import { dropTake } from '@/media/takes';

import TechniqueCamera from '../technique/camera';

const mockRouter = { push: jest.fn(), back: jest.fn(), replace: jest.fn() };
const mockWeb: { props: Record<string, any> | null; inject: jest.Mock } = { props: null, inject: jest.fn() };
const mockGravity: { cb: ((v: { x: number; y: number; z: number }) => void) | null } = { cb: null };
const mockStaged = jest.fn();
const mockDisk = { full: false, free: 64e9 };
let mockParams: Record<string, string> = { session: 'cam-1' };

jest.mock('expo-router', () => ({
  get router() {
    return mockRouter;
  },
  useLocalSearchParams: () => mockParams,
}));
jest.mock('expo-haptics', () => ({ selectionAsync: jest.fn(), notificationAsync: jest.fn(), NotificationFeedbackType: { Success: 'success' } }));
jest.mock('react-native-safe-area-context', () => jest.requireActual('react-native-safe-area-context/jest/mock').default);
jest.mock('expo-screen-orientation', () => ({
  lockAsync: jest.fn(async () => {}),
  OrientationLock: { LANDSCAPE: 'LANDSCAPE', PORTRAIT_UP: 'PORTRAIT_UP' },
}));
jest.mock('expo-keep-awake', () => ({ useKeepAwake: jest.fn() }));
jest.mock('expo-speech', () => ({ speak: jest.fn(), stop: jest.fn() }));
jest.mock('@/media/gravity', () => ({
  startGravity: async (cb: (v: { x: number; y: number; z: number }) => void) => {
    mockGravity.cb = cb;
    return { remove: () => (mockGravity.cb = null) };
  },
}));
jest.mock('@/media/poseLib', () => ({
  ...jest.requireActual('@/media/poseLib'),
  stagePosePage: async () => {
    mockStaged();
    return { page: 'file:///app/Documents/pose/run-1/page.html', dir: 'file:///app/Documents/pose/run-1', root: 'file:///app/Documents/pose' };
  },
  unstagePosePage: jest.fn(),
}));
jest.mock('expo-file-system', () => ({
  Paths: {
    get availableDiskSpace() {
      return mockDisk.free;
    },
  },
}));
jest.mock('@/media/takes', () => {
  let n = 0;
  return {
    // A take's file, as big as the bytes written to it.
    newTakeFile: () => {
      const f = {
        uri: `file:///app/Documents/technique/take-${++n}.mp4`,
        size: 0,
        async write(data: string) {
          if (mockDisk.full) throw new Error('No space left on device');
          f.size += Buffer.from(data, 'base64').length;
        },
      };
      return f;
    },
    dropTake: jest.fn(),
  };
});
jest.mock('react-native-webview', () => {
  const React = jest.requireActual('react');
  const { View } = jest.requireActual('react-native');
  const WebView = React.forwardRef((props: Record<string, any>, ref: unknown) => {
    mockWeb.props = props;
    React.useImperativeHandle(ref, () => ({ injectJavaScript: mockWeb.inject, reload: jest.fn() }));
    return <View />;
  });
  WebView.displayName = 'WebView';
  return { WebView };
});

const W = 1280;
const H = 720;
/** The athlete on the take-off spot, side-on, as the setup checks want them (domain/__tests__/poseSetup.test.ts). */
const GOOD: Stand = { x: 0.58 * W, floor: 498, stature: 255, facing: 1 };
const asShares = (p: Pose) => p.flatMap((l) => [l.x / W, l.y / H, l.z, l.v]);

let clock = 1_000_000;
let r: ReactTestRenderer;

function texts(root: ReactTestInstance): string {
  return root
    .findAllByType(Text)
    .map((t) => [t.props.children].flat(Infinity).filter((c) => typeof c === 'string' || typeof c === 'number').join(''))
    .join('\n');
}

const byLabel = (label: string) =>
  r.root.find((x) => typeof x.props.onPress === 'function' && (x.props.accessibilityLabel === label || x.findAllByType(Text).some((t) => t.props.children === label)));

async function press(label: string) {
  await act(async () => byLabel(label).props.onPress({ nativeEvent: {} }));
}

async function post(m: unknown) {
  await act(async () => mockWeb.props!.onMessage({ nativeEvent: { data: JSON.stringify(m) } }));
}

/** `count` pictures the page read, 120 ms apart, each with a reading of the phone on its side and level. */
async function see(people: Stand[], count: number) {
  for (let i = 0; i < count; i++) {
    clock += 60;
    await act(async () => mockGravity.cb?.({ x: -1, y: 0, z: 0 }));
    clock += 60;
    const poses = people.map((s) => asShares(standing(s)));
    await post({ type: 'frame', width: W, height: H, luma: 120, lumas: poses.map(() => 120), poses, crowd: people.length });
  }
}

const recordDisabled = () => byLabel('开始录像').props.disabled === true;

async function open() {
  await act(async () => {
    r = create(<TechniqueCamera />);
  });
  await act(async () => {});
  await post({ type: 'camera', label: 'Back Camera', physical: true, fps: 60, maxFps: 60, width: W, height: H });
  await post({ type: 'model', delegate: 'GPU', source: 'local' });
}

beforeEach(() => {
  jest.spyOn(Date, 'now').mockImplementation(() => clock);
  mockWeb.inject.mockClear();
  mockRouter.replace.mockClear();
  (Speech.speak as jest.Mock).mockClear();
  (dropTake as jest.Mock).mockClear();
});

afterEach(async () => {
  await act(async () => r?.unmount());
});

it('says what to change until the picture will do, then films a take and hands it on to the analysis', async () => {
  await open();
  expect(ScreenOrientation.lockAsync).toHaveBeenLastCalledWith(ScreenOrientation.OrientationLock.LANDSCAPE);
  expect(texts(r.root)).toContain('60 fps');

  await see([], 4);
  expect(texts(r.root)).toContain('没看到人');
  expect(recordDisabled()).toBe(true);
  expect(Speech.speak).toHaveBeenLastCalledWith(expect.stringContaining('没看到人'), expect.objectContaining({ language: 'zh-CN' }));

  // Everything right, but only just: the button waits until it has held for a moment.
  await see([GOOD], 4);
  expect(recordDisabled()).toBe(true);
  await see([GOOD], 10);
  expect(recordDisabled()).toBe(false);
  expect(texts(r.root)).toContain('可以拍了');
  expect(Speech.speak).toHaveBeenLastCalledWith(expect.stringContaining('可以拍了'), expect.anything());

  await press('开始录像');
  expect(mockWeb.inject).toHaveBeenLastCalledWith('window.startRecording(); true;');
  await post({ type: 'recording', mime: 'video/mp4' });
  expect(texts(r.root)).toContain('录像中');
  expect(Speech.speak).toHaveBeenLastCalledWith(expect.stringContaining('开始录'), expect.anything());

  // Each piece is written before the page is told to send the next.
  const piece = Buffer.alloc(1000, 7);
  await post({ type: 'chunk', seq: 0, data: piece.toString('base64') });
  expect(mockWeb.inject).toHaveBeenLastCalledWith('window.ack(0); true;');
  await post({ type: 'chunk', seq: 1, data: piece.toString('base64') });
  expect(mockWeb.inject).toHaveBeenLastCalledWith('window.ack(1); true;');

  clock += 6500;
  await press('停止录像');
  expect(mockWeb.inject).toHaveBeenLastCalledWith('window.stopRecording(); true;');
  await post({ type: 'recorded', chunks: 2, size: 2000, mime: 'video/mp4', seconds: 6.5 });
  expect(texts(r.root)).toContain('录好了');
  // The athlete walks back to the phone: nothing to set up until the next take.
  (Speech.speak as jest.Mock).mockClear();
  await see([], 4);
  expect(Speech.speak).not.toHaveBeenCalled();

  await press('分析这一段');
  expect(mockWeb.inject).toHaveBeenLastCalledWith('window.stopCamera(); true;');
  expect(mockRouter.replace).toHaveBeenCalledWith({
    pathname: '/technique/analyse',
    params: { uri: expect.stringMatching(/technique\/take-\d+\.mp4$/), fps: '60', source: 'camera', session: 'cam-1' },
  });

  await act(async () => r.unmount());
  expect(ScreenOrientation.lockAsync).toHaveBeenLastCalledWith(ScreenOrientation.OrientationLock.PORTRAIT_UP);
});

it('says a hint once, not on every picture, and keeps quiet when muted', async () => {
  await open();
  await see([], 12);
  expect((Speech.speak as jest.Mock).mock.calls.filter(([s]) => s.includes('没看到人'))).toHaveLength(1);

  await press('语音提示：开');
  expect(texts(r.root)).toContain('语音提示：关');
  (Speech.speak as jest.Mock).mockClear();
  await see([GOOD], 14);
  expect(Speech.speak).not.toHaveBeenCalled();
});

it('films without the checks when asked, and drops a take filmed again', async () => {
  await open();
  await see([], 3);
  expect(recordDisabled()).toBe(true);
  await press('不检查直接拍');
  expect(recordDisabled()).toBe(false);

  await press('开始录像');
  await post({ type: 'recording', mime: 'video/mp4' });
  await post({ type: 'chunk', seq: 0, data: Buffer.alloc(500, 1).toString('base64') });
  await post({ type: 'recorded', chunks: 1, size: 500, mime: 'video/mp4', seconds: 3 });
  await press('重拍');
  expect(dropTake).toHaveBeenCalledWith(expect.stringMatching(/technique\/take-\d+\.mp4$/));
  expect(byLabel('开始录像')).toBeTruthy();
});

it('says how to let the app use the camera, and opens it again', async () => {
  await open();
  const staged = mockStaged.mock.calls.length;
  await post({ type: 'error', stage: 'camera', name: 'NotAllowedError', message: 'denied' });
  expect(texts(r.root)).toContain('相机权限');
  await press('重试');
  await act(async () => {});
  expect(mockStaged.mock.calls.length).toBe(staged + 1);
});

it('says what went wrong with a take, and lets it be filmed again', async () => {
  await open();
  await press('不检查直接拍');
  await press('开始录像');
  await post({ type: 'recording', mime: 'video/mp4' });
  await post({ type: 'recorded', chunks: 0, size: 0, mime: 'video/mp4', seconds: 0 });
  expect(texts(r.root)).toContain('没录到画面');
  await press('重拍');
  expect(byLabel('开始录像')).toBeTruthy();
});

it('keeps the shutter off until the camera is up, even when filming without the checks', async () => {
  await act(async () => {
    r = create(<TechniqueCamera />);
  });
  await act(async () => {});
  await press('不检查直接拍');
  // The page can't record before it holds the camera, and wouldn't say so.
  expect(recordDisabled()).toBe(true);
  await post({ type: 'camera', label: 'Back Camera', physical: true, fps: 60, maxFps: 60, width: W, height: H });
  expect(recordDisabled()).toBe(false);
});

it('when a piece of the take can’t be written: says so, lets the page wind the take down, and films again on a fresh page', async () => {
  await open();
  await press('不检查直接拍');
  await press('开始录像');
  await post({ type: 'recording', mime: 'video/mp4' });
  const piece = Buffer.alloc(1000, 7).toString('base64');
  mockDisk.full = true;
  await post({ type: 'chunk', seq: 0, data: piece });
  mockDisk.full = false;
  expect(texts(r.root)).toContain('录像存不下来');
  // The page is told to stop, and each piece is still answered, so it can let the take go.
  expect(mockWeb.inject).toHaveBeenCalledWith('window.stopRecording(); true;');
  expect(mockWeb.inject).toHaveBeenLastCalledWith('window.ack(0); true;');
  await post({ type: 'chunk', seq: 1, data: piece });
  expect(mockWeb.inject).toHaveBeenLastCalledWith('window.ack(1); true;');
  await post({ type: 'recorded', chunks: 2, size: 2000, mime: 'video/mp4', seconds: 1 });
  expect(texts(r.root)).toContain('录像存不下来');

  const staged = mockStaged.mock.calls.length;
  await press('重拍');
  await act(async () => {});
  expect(mockStaged.mock.calls.length).toBe(staged + 1);
});

it('keeps saying the camera was lost mid-take when the take’s last pieces still arrive', async () => {
  await open();
  await press('不检查直接拍');
  await press('开始录像');
  await post({ type: 'recording', mime: 'video/mp4' });
  const piece = Buffer.alloc(1000, 7).toString('base64');
  await post({ type: 'chunk', seq: 0, data: piece });
  await post({ type: 'error', stage: 'camera', name: '', message: '相机断开了' });
  await post({ type: 'chunk', seq: 1, data: piece });
  expect(mockWeb.inject).toHaveBeenLastCalledWith('window.ack(1); true;');
  await post({ type: 'recorded', chunks: 2, size: 2000, mime: 'video/mp4', seconds: 2 });
  expect(texts(r.root)).toContain('相机断开了');
  expect(byLabel('重试')).toBeTruthy();
});

it('keeps a filmed take when the camera page goes afterwards, and films again on a fresh page', async () => {
  await open();
  await press('不检查直接拍');
  await press('开始录像');
  await post({ type: 'recording', mime: 'video/mp4' });
  await post({ type: 'chunk', seq: 0, data: Buffer.alloc(500, 1).toString('base64') });
  await post({ type: 'recorded', chunks: 1, size: 500, mime: 'video/mp4', seconds: 3 });
  await act(async () => mockWeb.props!.onContentProcessDidTerminate());
  expect(texts(r.root)).toContain('录好了');
  expect(byLabel('分析这一段')).toBeTruthy();
  expect(dropTake).not.toHaveBeenCalled();

  const staged = mockStaged.mock.calls.length;
  await press('重拍');
  await act(async () => {});
  expect(dropTake).toHaveBeenCalledWith(expect.stringMatching(/technique\/take-\d+\.mp4$/));
  expect(mockStaged.mock.calls.length).toBe(staged + 1);
});

it('keeps saying what went wrong when it fails as a take starts, whatever the page then says of that take', async () => {
  await open();
  await press('不检查直接拍');
  await press('开始录像');
  await post({ type: 'error', stage: 'camera', name: '', message: '相机断开了' });
  expect(mockWeb.inject).toHaveBeenLastCalledWith('window.stopRecording(); true;');
  // The recorder had already started: it still says so, then hands over what it had before it stopped.
  await post({ type: 'recording', mime: 'video/mp4' });
  await post({ type: 'chunk', seq: 0, data: Buffer.alloc(300, 1).toString('base64') });
  expect(mockWeb.inject).toHaveBeenLastCalledWith('window.ack(0); true;');
  await post({ type: 'recorded', chunks: 1, size: 300, mime: 'video/mp4', seconds: 0.2 });
  let shown = texts(r.root);
  expect(shown).toContain('相机断开了');
  expect(shown).not.toContain('录好了');
  const staged = mockStaged.mock.calls.length;
  await press('重试');
  await act(async () => {});
  expect(mockStaged.mock.calls.length).toBe(staged + 1);

  // Nothing recorded after a failure as the take starts: the failure still stands.
  await open();
  await press('不检查直接拍');
  await press('开始录像');
  await post({ type: 'error', stage: 'model', name: '', message: 'boom' });
  await post({ type: 'recording', mime: 'video/mp4' });
  await post({ type: 'recorded', chunks: 0, size: 0, mime: 'video/mp4', seconds: 0 });
  shown = texts(r.root);
  expect(shown).toContain('骨架识别启动不了');
  expect(shown).not.toContain('没录到画面');
});

it('stops the take before a piece the phone has no room for: iOS can’t say a write ran out of room, it closes the app', async () => {
  await open();
  await press('不检查直接拍');
  await press('开始录像');
  await post({ type: 'recording', mime: 'video/mp4' });
  mockDisk.free = 40e6;
  await post({ type: 'chunk', seq: 0, data: Buffer.alloc(30_000, 7).toString('base64') });
  mockDisk.free = 64e9;
  expect(texts(r.root)).toContain('录像存不下来：手机存储空间不够了');
  expect(mockWeb.inject).toHaveBeenCalledWith('window.stopRecording(); true;');
  expect(mockWeb.inject).toHaveBeenLastCalledWith('window.ack(0); true;');
});

it('doesn’t start a take the phone has no room for: says so before the athlete runs up', async () => {
  // 45 MB free: less than the 50 MB kept free; 70 MB: room for some 15 s of a take (1.25 MB/s), not all 20.
  for (const free of [45e6, 70e6]) {
    mockDisk.free = free;
    try {
      await open();
      await press('不检查直接拍');
      await press('开始录像');
      expect(mockWeb.inject).not.toHaveBeenCalledWith('window.startRecording(); true;');
      expect(texts(r.root)).toContain('手机存储空间不够了');
      expect(Speech.speak).not.toHaveBeenCalledWith('开始录了，去助跑吧', expect.anything());
    } finally {
      mockDisk.free = 64e9;
    }
  }
  // Room for the whole take and what is kept free: it starts.
  mockDisk.free = 80e6;
  try {
    await open();
    await press('不检查直接拍');
    await press('开始录像');
    expect(mockWeb.inject).toHaveBeenLastCalledWith('window.startRecording(); true;');
  } finally {
    mockDisk.free = 64e9;
  }
});

it('passes a dunk attempt’s rim and ball on to the analysis, to be saved with it', async () => {
  mockParams = { session: 'cam-2', rim: '300', ball: 'volleyball' };
  try {
    await open();
    await press('不检查直接拍');
    await press('开始录像');
    await post({ type: 'recording', mime: 'video/mp4' });
    await post({ type: 'chunk', seq: 0, data: Buffer.alloc(500, 1).toString('base64') });
    await post({ type: 'recorded', chunks: 1, size: 500, mime: 'video/mp4', seconds: 3 });
    await press('分析这一段');
    expect(mockRouter.replace).toHaveBeenLastCalledWith({
      pathname: '/technique/analyse',
      params: expect.objectContaining({ source: 'camera', session: 'cam-2', rim: '300', ball: 'volleyball' }),
    });
  } finally {
    mockParams = { session: 'cam-1' };
  }
});
