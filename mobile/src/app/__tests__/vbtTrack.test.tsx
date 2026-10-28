// Drives the automatic bar-tracking screen: the page in the WebView is replaced by messages a real tracking run sends.
import { ScrollView, Text } from 'react-native';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';

import { migrate } from '@/db/migrations';
import { listTrials } from '@/db/repo';
import { openMemoryDb } from '@/db/testing/memoryDb';
import { listVbtSets } from '@/db/vbt';

import TrackSet from '../vbt/track';

const mockDb = openMemoryDb();
const mockRouter = { push: jest.fn(), back: jest.fn(), replace: jest.fn() };
const mockWeb: { props: Record<string, any> | null; inject: jest.Mock } = { props: null, inject: jest.fn() };
/** Frame rate the next picked clip reports. */
const mockClip = { fps: 60 };

jest.mock('expo-sqlite', () => ({ useSQLiteContext: () => mockDb }));
jest.mock('@/state/athlete', () => ({ useAthlete: () => ({ current: { id: 1, name: '我自己' } }) }));
jest.mock('expo-haptics', () => ({ selectionAsync: jest.fn(), notificationAsync: jest.fn(), NotificationFeedbackType: { Success: 'success' } }));
jest.mock('react-native-safe-area-context', () => jest.requireActual('react-native-safe-area-context/jest/mock').default);
jest.mock('expo-router', () => ({
  get router() {
    return mockRouter;
  },
  useLocalSearchParams: () => ({ lift: 'vbt_squat', session: 'set-1', load: '120' }),
  Stack: { Screen: () => null },
}));
let mockPicked = 0;
jest.mock('expo-image-picker', () => ({
  launchImageLibraryAsync: async () => ({ canceled: false, assets: [{ uri: `file:///picked/IMG_000${++mockPicked}.MOV` }] }),
  UIImagePickerPreferredAssetRepresentationMode: { Current: 'current' },
}));
jest.mock('expo-video', () => ({ useVideoPlayer: (uri: string | null) => jest.requireActual('react').useMemo(() => ({ uri }), [uri]) }));
jest.mock('expo', () => {
  const React = jest.requireActual('react');
  return {
    ...jest.requireActual('expo'),
    // Every clip reports its frame rate as soon as it loads.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- like the real hook, it listens per player, not per callback
    useEventListener: (p: unknown, _e: string, cb: (x: unknown) => void) => React.useEffect(() => cb({ availableVideoTracks: [{ frameRate: mockClip.fps }] }), [p]),
  };
});
jest.mock('@/media/videos', () => ({
  stageForTracking: async () => ({ page: 'file:///cache/bar-track/track.html', dir: 'file:///cache/bar-track/' }),
  persistVideo: async () => 'file:///docs/videos/set-1.mov',
}));
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

beforeAll(async () => {
  await migrate(mockDb);
});

beforeEach(() => {
  mockClip.fps = 60;
  mockWeb.inject.mockClear();
});

function texts(root: ReactTestInstance): string {
  return root
    .findAllByType(Text)
    .map((t) => [t.props.children].flat(Infinity).filter((c) => typeof c === 'string' || typeof c === 'number').join(''))
    .join('\n');
}

function pressable(root: ReactTestInstance, label: string): ReactTestInstance {
  return root.find((n) => typeof n.props.onPress === 'function' && (n.props.accessibilityLabel === label || n.findAllByType(Text).some((t) => [t.props.children].flat().join('') === label)));
}

async function press(root: ReactTestInstance, label: string) {
  await act(async () => pressable(root, label).props.onPress());
}

async function send(message: unknown) {
  await act(async () => mockWeb.props!.onMessage({ nativeEvent: { data: JSON.stringify(message) } }));
}

/**
 * A tracked clip at 60 fps of squats with the given concentric times (s), 55 cm deep, plate 200 px across, cut off
 * at `until` s if given.
 */
function squatClip(concentric: number[], until = Infinity): [number, number, number, number][] {
  const px = 200 / 45;
  const phases: [number, number][] = [[0.6, 0], ...concentric.flatMap((c): [number, number][] => [[1, -55], [c, 0], [1, 0]])];
  const total = phases.reduce((s, p) => s + p[0], 0);
  const out: [number, number, number, number][] = [];
  for (let i = 0; i <= Math.min(total, until) * 60; i++) {
    const t = i / 60;
    let from = 0;
    let at = 0;
    let h = phases[phases.length - 1][1];
    for (const [dur, to] of phases) {
      if (t <= at + dur) {
        h = from + (to - from) * (1 - Math.cos((Math.PI * (t - at)) / dur)) / 2;
        break;
      }
      at += dur;
      from = to;
    }
    out.push([t, 360, 800 - h * px, 0.95]);
  }
  return out;
}

it('tracks a set from video, lets a rep be left out, and logs the fastest', async () => {
  let r!: ReactTestRenderer;
  await act(async () => {
    r = create(<TrackSet />);
  });
  expect(texts(r.root)).toContain('最外侧挂 45 cm 的标准片');
  await press(r.root, '从相册选这一组的视频');
  expect(mockWeb.props).toMatchObject({ source: { uri: 'file:///cache/bar-track/track.html' }, allowingReadAccessToURL: 'file:///cache/bar-track/' });

  await send({ type: 'ready', duration: 9, width: 720, height: 1280 });
  await press(r.root, '开始分析');
  // The page is told the clip's frame rate, so it steps through every frame.
  expect(mockWeb.inject).toHaveBeenCalledWith('window.startTrack(60); true;');
  await send({ type: 'progress', done: 0.5 });
  expect(texts(r.root)).toContain('正在逐帧跟踪 50%');

  // 0.55 m in 0.7, 0.9 and 1.2 s: 0.79, 0.61 and 0.46 m/s, read within 3 %.
  await send({ type: 'done', samples: squatClip([0.7, 0.9, 1.2]), diameter: 200, lost: false });
  let t = texts(r.root);
  expect(t).toMatch(/0\.7[78]/);
  expect(t).toMatch(/0\.(60|61)/);
  expect(t).toMatch(/0\.(45|46)/);
  expect(t).toMatch(/最后一次比最快慢了 4\d%/);

  // The first rep was a mistake: leave it out, and the set is logged at the second.
  await act(async () => r.root.find((n) => n.props.accessibilityRole === 'checkbox' && n.props.accessibilityLabel.startsWith('第 1 次')).props.onPress());
  t = texts(r.root);
  expect(t).toContain('已去掉');
  const second = t.match(/保存这一组 · (0\.\d\d) m\/s/)![1];
  expect(['0.60', '0.61']).toContain(second);
  await press(r.root, `保存这一组 · ${second} m/s`);

  const [set] = await listVbtSets(mockDb, 1, 'vbt_squat');
  expect(set).toMatchObject({ load: 120, v: Number(second), reps: 2 });
  const [trial] = await listTrials(mockDb, 'set-1');
  expect(trial.video_uri).toBe('file:///docs/videos/set-1.mov');
  expect(trial.detail).toMatchObject({ source: 'video', rep_v: [expect.closeTo(0.61, 1), expect.closeTo(0.46, 1)] });
  expect(mockRouter.back).toHaveBeenCalled();
  await act(async () => r.unmount());
});

it('says so when the plate was lost and nothing was found', async () => {
  let r!: ReactTestRenderer;
  await act(async () => {
    r = create(<TrackSet />);
  });
  await press(r.root, '从相册选这一组的视频');
  await send({ type: 'ready', duration: 3, width: 720, height: 1280 });
  await send({ type: 'done', samples: squatClip([]).concat([[0.7, 360, 800, 0.2]]), diameter: 200, lost: true });
  const t = texts(r.root);
  expect(t).toContain('中途跟丢了杠铃片');
  expect(t).toContain('没有找到完整的一次向心');
  await act(async () => r.unmount());
});

it('leaves out a rep the clip cut off and says why', async () => {
  let r!: ReactTestRenderer;
  await act(async () => {
    r = create(<TrackSet />);
  });
  await press(r.root, '从相册选这一组的视频');
  await send({ type: 'ready', duration: 8, width: 720, height: 1280 });
  // The third rep rises from 7.2 s to 8.4 s; the clip ends at 7.9 s, halfway up.
  await send({ type: 'done', samples: squatClip([0.7, 0.9, 1.2], 7.9), diameter: 200, lost: false });
  const t = texts(r.root);
  expect(t).toContain('没拍全');
  expect(t).toContain('已去掉');
  expect(t).toMatch(/共 2 次/);
  // Mean propulsive velocity next to the mean velocity: these reps never brake harder than gravity, so they match.
  expect(t).toMatch(/MPV 0\.7[78]/);
  // It can still be put back.
  await act(async () => r.root.find((n) => n.props.accessibilityRole === 'checkbox' && n.props.accessibilityLabel.startsWith('第 3 次')).props.onPress());
  expect(texts(r.root)).toMatch(/共 3 次/);
  await act(async () => r.unmount());
});

it('forgets the slow-motion rate chosen for the last clip', async () => {
  let r!: ReactTestRenderer;
  await act(async () => {
    r = create(<TrackSet />);
  });
  mockClip.fps = 30;
  await press(r.root, '从相册选这一组的视频');
  await press(r.root, '240');
  // The next clip is a normal 60 fps video: no slow-motion choice, and its speeds are read as they are.
  mockClip.fps = 60;
  await press(r.root, '换一个视频');
  await send({ type: 'ready', duration: 9, width: 720, height: 1280 });
  await send({ type: 'done', samples: squatClip([0.7, 0.9, 1.2]), diameter: 200, lost: false });
  expect(texts(r.root)).toMatch(/保存这一组 · 0\.7[78] m\/s/);
  await act(async () => r.unmount());
});

it('can start again after the page crashed mid-analysis', async () => {
  let r!: ReactTestRenderer;
  await act(async () => {
    r = create(<TrackSet />);
  });
  await press(r.root, '从相册选这一组的视频');
  await send({ type: 'ready', duration: 9, width: 720, height: 1280 });
  await press(r.root, '开始分析');
  expect(texts(r.root)).toContain('正在逐帧跟踪');
  await act(async () => mockWeb.props!.onContentProcessDidTerminate());
  expect(texts(r.root)).not.toContain('正在逐帧跟踪');
  expect(pressable(r.root, '换一个视频').props.disabled).toBeFalsy();
  await act(async () => r.unmount());
});

it('keeps the screen still while the circle is being placed, and scrolls the results', async () => {
  let r!: ReactTestRenderer;
  await act(async () => {
    r = create(<TrackSet />);
  });
  await press(r.root, '从相册选这一组的视频');
  await send({ type: 'ready', duration: 9, width: 720, height: 1280 });
  expect(r.root.findByType(ScrollView).props.scrollEnabled).toBe(false);
  await send({ type: 'done', samples: squatClip([0.7, 0.9, 1.2]), diameter: 200, lost: false });
  expect(r.root.findByType(ScrollView).props.scrollEnabled).toBe(true);
  await act(async () => r.unmount());
});
