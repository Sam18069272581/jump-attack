// Drives the in-app camera for jump tests and VBT sets: the camera page in the WebView is replaced by messages like the
// page's, so the flow runs from the camera coming up to a take handed on to the jump analysis or the bar tracking.
import * as ScreenOrientation from 'expo-screen-orientation';
import { Text } from 'react-native';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';

import { dropTake, dropTestTakes } from '@/media/takes';

import TestCamera from '../measure/camera';

const mockRouter = { push: jest.fn(), back: jest.fn(), replace: jest.fn() };
const mockWeb: { props: Record<string, any> | null; inject: jest.Mock } = { props: null, inject: jest.fn() };
let mockParams: Record<string, string> = {};
const mockPages: string[] = [];

jest.mock('expo-router', () => ({
  get router() {
    return mockRouter;
  },
  useLocalSearchParams: () => mockParams,
}));
jest.mock('react-native-safe-area-context', () => jest.requireActual('react-native-safe-area-context/jest/mock').default);
jest.mock('expo-screen-orientation', () => ({
  lockAsync: jest.fn(async () => {}),
  OrientationLock: { DEFAULT: 'DEFAULT', PORTRAIT_UP: 'PORTRAIT_UP' },
}));
jest.mock('expo-keep-awake', () => ({ useKeepAwake: jest.fn() }));
jest.mock('@/media/poseLib', () => ({
  ...jest.requireActual('@/media/poseLib'),
  stagePosePage: async (page: (clip: string | null) => string) => {
    mockPages.push(page(null));
    return { page: 'file:///app/Documents/pose/run-1/page.html', dir: 'file:///app/Documents/pose/run-1', root: 'file:///app/Documents/pose' };
  },
  unstagePosePage: jest.fn(),
}));
jest.mock('expo-file-system', () => ({ Paths: { availableDiskSpace: 64e9 } }));
jest.mock('@/media/takes', () => {
  let n = 0;
  return {
    newTakeFile: (_ext: string, kind: string) => {
      const f = {
        uri: `file:///app/Caches/${kind}-takes/take-${++n}.mp4`,
        size: 0,
        async write(data: string) {
          f.size += Buffer.from(data, 'base64').length;
        },
      };
      return f;
    },
    dropTake: jest.fn(),
    dropTestTakes: jest.fn(),
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

async function open(params: Record<string, string>, fps = 60) {
  mockParams = params;
  await act(async () => {
    r = create(<TestCamera />);
  });
  await act(async () => {});
  await post({ type: 'camera', label: 'Back Camera', physical: true, fps, maxFps: fps, width: 1280, height: 720 });
}

/** Films one take of `seconds`, a single piece of 1000 bytes. */
async function film(seconds: number) {
  await press('开始录像');
  expect(mockWeb.inject).toHaveBeenLastCalledWith('window.startRecording(); true;');
  await post({ type: 'recording', mime: 'video/mp4' });
  expect(texts(r.root)).toContain('录像中');
  await post({ type: 'chunk', seq: 0, data: Buffer.alloc(1000, 7).toString('base64') });
  expect(mockWeb.inject).toHaveBeenLastCalledWith('window.ack(0); true;');
  await press('停止录像');
  await post({ type: 'recorded', chunks: 1, size: 1000, mime: 'video/mp4', seconds });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockPages.length = 0;
});

afterEach(async () => {
  await act(async () => r?.unmount());
});

it('films a jump in the app and hands the take on to the automatic analysis, with its frame rate', async () => {
  await open({ to: '/measure/analyse', metric: 'cmj', session: 'cmj-1', from: 'testday' });
  // Only the camera and the recorder: no pose model to download, and takes of up to 30 s.
  expect(mockPages[0]).toContain('"pose":false');
  expect(mockPages[0]).toContain('"maxSeconds":30');
  // Each filming starts clean: the takes before it were only needed until they were measured.
  expect(dropTestTakes).toHaveBeenCalled();
  // Upright or on its side, whichever the tripod holds.
  expect(ScreenOrientation.lockAsync).toHaveBeenLastCalledWith(ScreenOrientation.OrientationLock.DEFAULT);
  const shown = texts(r.root);
  expect(shown).toContain('CMJ 反向跳');
  expect(shown).toContain('60 fps');
  expect(shown).toContain('慢动作');

  await film(6.5);
  expect(texts(r.root)).toContain('录好了 · 6.5 秒');
  await press('用这一段');
  expect(mockWeb.inject).toHaveBeenLastCalledWith('window.stopCamera(); true;');
  expect(mockRouter.replace).toHaveBeenCalledWith({
    pathname: '/measure/analyse',
    params: { metric: 'cmj', session: 'cmj-1', from: 'testday', uri: expect.stringMatching(/test-takes\/take-\d+\.mp4$/), fps: '60' },
  });

  await act(async () => r.unmount());
  expect(ScreenOrientation.lockAsync).toHaveBeenLastCalledWith(ScreenOrientation.OrientationLock.PORTRAIT_UP);
});

it('films a VBT set of up to a minute and hands it on to the bar tracking', async () => {
  await open({ to: '/vbt/track', lift: 'vbt_squat', session: 'set-1', load: '120' });
  expect(mockPages[0]).toContain('"maxSeconds":60');
  expect(texts(r.root)).toContain('深蹲 · 120 kg');
  await film(24);
  await press('用这一段');
  expect(mockRouter.replace).toHaveBeenCalledWith({
    pathname: '/vbt/track',
    params: { lift: 'vbt_squat', session: 'set-1', load: '120', uri: expect.stringMatching(/test-takes\/take-\d+\.mp4$/), fps: '60' },
  });
});

it('drops a take filmed again, and says when the camera is too slow for the test', async () => {
  await open({ to: '/measure/analyse', metric: 'dj_rsi', session: 'dj-1', from: 'dj', box: '40' }, 30);
  expect(texts(r.root)).toContain('只有 30 帧');
  await film(3);
  await press('重拍');
  expect(dropTake).toHaveBeenCalledWith(expect.stringMatching(/test-takes\/take-\d+\.mp4$/));
  expect(byLabel('开始录像')).toBeTruthy();
});

it('says how to let the app use the camera', async () => {
  await open({ to: '/measure/analyse', metric: 'cmj', session: 'cmj-1' });
  await post({ type: 'error', stage: 'camera', name: 'NotAllowedError', message: 'denied' });
  expect(texts(r.root)).toContain('相机权限');
  await press('返回');
  expect(mockRouter.back).toHaveBeenCalled();
});
