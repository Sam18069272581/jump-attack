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

jest.mock('expo-router', () => ({
  get router() {
    return mockRouter;
  },
  useLocalSearchParams: () => ({ session: 'cam-1' }),
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
jest.mock('@/media/takes', () => {
  let n = 0;
  return {
    // A take's file, as big as the bytes written to it.
    newTakeFile: () => {
      const f = {
        uri: `file:///app/Documents/technique/take-${++n}.mp4`,
        size: 0,
        async write(data: string) {
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
