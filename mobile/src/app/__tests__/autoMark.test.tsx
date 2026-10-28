// Drives the marking screen with automatic detection: the page in the WebView is replaced by one that answers each
// frame request with frames of a synthetic CMJ clip, so the whole flow runs, from loading the clip to the saved trial.
import { Text } from 'react-native';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';

import { migrate } from '@/db/migrations';
import { listTrials } from '@/db/repo';
import { openMemoryDb } from '@/db/testing/memoryDb';
import { defaultScene, renderScene, sceneTruth } from '@/domain/testing/jumpScene';

import Mark from '../measure/mark';

const mockDb = openMemoryDb();
const mockRouter = { push: jest.fn(), back: jest.fn(), replace: jest.fn(), dismiss: jest.fn() };
const mockWeb: { props: Record<string, any> | null; inject: jest.Mock } = { props: null, inject: jest.fn() };
const scene = defaultScene('cmj', { shadow: 0.4 });
const mockClip = { frames: Math.floor(scene.durationS * scene.fps), fps: scene.fps };
const mockRuntime = { isWeb: false };

jest.mock('@/media/runtime', () => ({
  get isWeb() {
    return mockRuntime.isWeb;
  },
}));
jest.mock('expo-sqlite', () => ({ useSQLiteContext: () => mockDb }));
jest.mock('@/state/athlete', () => ({ useAthlete: () => ({ current: { id: 1, name: '我自己' } }) }));
jest.mock('expo-haptics', () => ({ selectionAsync: jest.fn() }));
jest.mock('react-native-safe-area-context', () => jest.requireActual('react-native-safe-area-context/jest/mock').default);
jest.mock('expo-router', () => ({
  get router() {
    return mockRouter;
  },
  useLocalSearchParams: () => ({ metric: 'cmj', session: 'cmj-1', uri: 'file:///picked/IMG_0002.MOV', fps: '0' }),
}));
jest.mock('expo-video', () => ({
  useVideoPlayer: (uri: string) => jest.requireActual('react').useMemo(() => ({ uri, currentTime: 0 }), [uri]),
  VideoView: () => null,
}));
jest.mock('expo', () => {
  const React = jest.requireActual('react');
  return {
    ...jest.requireActual('expo'),
    // The clip reports its length and a 240 fps track as soon as it loads.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- like the real hook, it listens per player, not per callback
    useEventListener: (p: unknown, _e: string, cb: (x: unknown) => void) => React.useEffect(() => cb({ duration: mockClip.frames / mockClip.fps, availableVideoTracks: [{ frameRate: mockClip.fps }] }), [p]),
  };
});
jest.mock('@/media/frameGrabber', () => ({
  ...jest.requireActual('@/media/frameGrabber'),
  stageForGrabbing: async () => ({ page: 'file:///cache/jump-detect/grab.html', dir: 'file:///cache/jump-detect/' }),
}));
jest.mock('@/media/videos', () => ({ persistVideo: async () => 'file:///docs/videos/cmj-1.mov' }));
jest.mock('react-native-webview', () => {
  const React = jest.requireActual('react');
  const { View } = jest.requireActual('react-native');
  const WebView = React.forwardRef((props: Record<string, any>, ref: unknown) => {
    mockWeb.props = props;
    React.useImperativeHandle(ref, () => ({ injectJavaScript: mockWeb.inject }));
    return <View />;
  });
  WebView.displayName = 'WebView';
  return { WebView };
});

function texts(root: ReactTestInstance): string {
  return root
    .findAllByType(Text)
    .map((t) => [t.props.children].flat(Infinity).filter((c) => typeof c === 'string' || typeof c === 'number').join(''))
    .join('\n');
}

async function post(m: unknown) {
  await act(async () => mockWeb.props!.onMessage({ nativeEvent: { data: JSON.stringify(m) } }));
}

/** Answers each `window.grab(...)` the screen injected, the way the page does: grey frames, base64, in batches. */
async function answerGrabs() {
  for (let n = 0; n < mockWeb.inject.mock.calls.length; n++) {
    const call = JSON.parse(/window\.grab\((.*)\); true;/.exec(mockWeb.inject.mock.calls[n][0])![1]);
    for (let i = 0; i < call.frames.length; i += 20) {
      const batch = call.frames.slice(i, i + 20).map((f: number) => renderScene(scene, f, call.rect, call.w, call.h).data);
      const bytes = Buffer.concat(batch.map((b: Uint8Array) => Buffer.from(b)));
      await post({ type: 'frames', id: call.id, from: i, w: call.w, h: call.h, data: bytes.toString('base64') });
    }
    await post({ type: 'done', id: call.id });
  }
}

let r: ReactTestRenderer;

beforeAll(async () => {
  await migrate(mockDb);
});

it('marks take-off and landing by itself, and saves them once checked', async () => {
  await act(async () => {
    r = create(<Mark />);
  });
  await act(async () => {});
  expect(texts(r.root)).toContain('正在自动找起跳和落地');

  await post({ type: 'ready', duration: mockClip.frames / mockClip.fps, width: scene.width, height: scene.height });
  await answerGrabs();

  const truth = sceneTruth(scene);
  const shown = texts(r.root);
  expect(shown).toContain('已自动标好');
  const marks = [...shown.matchAll(/^#(\d+)$/gm)].map((m) => Number(m[1]));
  // The badge on the video shows the take-off frame; the two mark buttons show both frames.
  expect(marks).toHaveLength(3);
  expect(Math.abs(marks[1] - truth.takeoff)).toBeLessThanOrEqual(1);
  expect(Math.abs(marks[2] - truth.landing)).toBeLessThanOrEqual(1);
  expect(marks[0]).toBe(marks[1]);

  const save = r.root.find((n) => typeof n.props.onPress === 'function' && n.findAllByType(Text).some((t) => t.props.children === '保存这一次'));
  await act(async () => save.props.onPress());
  const [trial] = await listTrials(mockDb, 'cmj-1');
  expect(trial).toMatchObject({ takeoff_frame: marks[1], landing_frame: marks[2], fps: 240 });
  expect(mockRouter.replace).toHaveBeenCalledWith({ pathname: '/measure/result', params: { metric: 'cmj', session: 'cmj-1' } });
});

it('says so when the clip cannot be read, and leaves marking to the athlete', async () => {
  mockWeb.inject.mockClear();
  await act(async () => {
    r = create(<Mark />);
  });
  await act(async () => {});
  await post({ type: 'error', message: '视频打不开' });
  expect(texts(r.root)).toContain('读不到视频画面，请手动标');
  expect(texts(r.root)).toContain('未设');
});

it('leaves marking to the athlete in the web version, which has no frame reader', async () => {
  mockRuntime.isWeb = true;
  mockWeb.props = null;
  await act(async () => {
    r = create(<Mark />);
  });
  await act(async () => {});
  expect(texts(r.root)).not.toContain('正在自动找起跳和落地');
  expect(mockWeb.props).toBeNull();
  mockRuntime.isWeb = false;
});
