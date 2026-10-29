// Drives the take-off technique analysis end to end: the pose page in the WebView is replaced by one that answers each
// request with the poses of a synthetic run-up jump, so the flow runs from tapping the athlete and the floor lines to
// the saved take.
import { Text } from 'react-native';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';

import { migrate } from '@/db/migrations';
import { addTrial, ensureSession, listTrials } from '@/db/repo';
import { listTechniqueTakes } from '@/db/technique';
import { openMemoryDb } from '@/db/testing/memoryDb';
import { LM, type Pt } from '@/domain/pose';
import { FLAG_TEXT, PROBLEM_TEXT } from '@/domain/techniqueText';
import { asWire, poseScene, type PoseScene } from '@/domain/testing/poseScene';

import TechniqueAnalyse from '../technique/analyse';

const mockDb = openMemoryDb();
const mockRouter = { push: jest.fn(), back: jest.fn(), replace: jest.fn(), dismiss: jest.fn() };
const mockWeb: { props: Record<string, any> | null; inject: jest.Mock; reload: jest.Mock } = { props: null, inject: jest.fn(), reload: jest.fn() };
const mockState: { scene: PoseScene | null; fileFps: number; params: Record<string, string> } = { scene: null, fileFps: 240, params: {} };
const mockAwake = jest.fn();
const mockStaged = jest.fn();
/** When set, the next page staged waits until the test settles it. */
const mockStage: { hold: null | { resolve: (v: unknown) => void; reject: (e: unknown) => void }; holdNext: boolean } = { hold: null, holdNext: false };

jest.mock('expo-sqlite', () => ({ useSQLiteContext: () => mockDb }));
jest.mock('@/state/athlete', () => ({ useAthlete: () => ({ current: { id: 1, name: '我自己', standing_reach_cm: 240 } }) }));
jest.mock('expo-haptics', () => ({ selectionAsync: jest.fn() }));
jest.mock('expo-keep-awake', () => ({ useKeepAwake: (tag?: string) => mockAwake(tag) }));
jest.mock('react-native-safe-area-context', () => jest.requireActual('react-native-safe-area-context/jest/mock').default);
jest.mock('expo-router', () => ({
  get router() {
    return mockRouter;
  },
  useLocalSearchParams: () => mockState.params,
}));
jest.mock('expo-video', () => ({
  useVideoPlayer: (uri: string) => jest.requireActual('react').useMemo(() => ({ uri, currentTime: 0 }), [uri]),
  VideoView: () => null,
}));
jest.mock('expo', () => {
  const React = jest.requireActual('react');
  return {
    ...jest.requireActual('expo'),
    // The clip reports its length and its own frame rate as soon as it loads.
    useEventListener: (p: unknown, _e: string, cb: (x: unknown) => void) =>
      // eslint-disable-next-line react-hooks/exhaustive-deps -- like the real hook, it listens per player, not per callback
      React.useEffect(() => cb({ duration: mockState.scene!.frames.length / mockState.fileFps, availableVideoTracks: [{ frameRate: mockState.fileFps }] }), [p]),
  };
});
jest.mock('@/media/poseLib', () => ({
  ...jest.requireActual('@/media/poseLib'),
  stagePosePage: async () => {
    mockStaged();
    if (mockStage.holdNext) {
      mockStage.holdNext = false;
      await new Promise((resolve, reject) => (mockStage.hold = { resolve, reject }));
    }
    return { page: 'file:///app/Documents/pose/run-1/page.html', dir: 'file:///app/Documents/pose/run-1', root: 'file:///app/Documents/pose' };
  },
  unstagePosePage: jest.fn(),
}));
jest.mock('react-native-webview', () => {
  const React = jest.requireActual('react');
  const { View } = jest.requireActual('react-native');
  const WebView = React.forwardRef((props: Record<string, any>, ref: unknown) => {
    mockWeb.props = props;
    React.useImperativeHandle(ref, () => ({ injectJavaScript: mockWeb.inject, reload: mockWeb.reload }));
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

const byLabel = (root: ReactTestInstance, label: string, prop = 'onPress') =>
  root.find((x) => typeof x.props[prop] === 'function' && (x.props.accessibilityLabel === label || x.findAllByType(Text).some((t) => t.props.children === label)));

function press(root: ReactTestInstance, label: string) {
  const n = byLabel(root, label);
  // Not waiting for what the press starts: the analysis waits for the poses `answerReads` hands in.
  return act(async () => {
    n.props.onPress({ nativeEvent: {} });
  });
}

async function post(m: unknown) {
  await act(async () => mockWeb.props!.onMessage({ nativeEvent: { data: JSON.stringify(m) } }));
}

/** Answers each read the screen asks of the page, the way the page does, until it stops asking. */
async function answerReads() {
  const wire = asWire(mockState.scene!);
  for (let n = 0; n < mockWeb.inject.mock.calls.length; n++) {
    const call = /window\.(follow|crops)\((.*)\); true;/.exec(mockWeb.inject.mock.calls[n][0]);
    if (!call) continue;
    const req = JSON.parse(call[2]);
    const items = req.frames.map((f: number) => [f, f / req.fps, ...(wire[f]?.values ?? [])]);
    for (let i = 0; i < items.length; i += 40) await post({ type: 'poses', id: req.id, items: items.slice(i, i + 40) });
    await post({ type: 'done', id: req.id });
  }
}

// The video box on screen: 360 pt wide, the clip's shape.
const BOX_W = 360;
const geometry = (scene: PoseScene) => {
  const fit = BOX_W / scene.width;
  return { fit, w: BOX_W, h: scene.height * fit, toScreen: (p: Pt) => ({ x: p.x * fit, y: p.y * fit }) };
};

async function open(scene: PoseScene, params: Record<string, string>, fileFps = scene.options.fps) {
  mockState.scene = scene;
  mockState.fileFps = fileFps;
  mockState.params = params;
  mockWeb.inject.mockClear();
  await act(async () => {
    r = create(<TechniqueAnalyse />);
  });
  await act(async () => {});
  await post({ type: 'ready', duration: scene.frames.length / fileFps, width: scene.width, height: scene.height });
  const g = geometry(scene);
  const box = r.root.find((n) => typeof n.props.onLayout === 'function' && n.props.accessibilityLabel === '视频');
  await act(async () => box.props.onLayout({ nativeEvent: { layout: { width: g.w, height: g.h } } }));
}

async function tapScreen(p: Pt) {
  const area = byLabel(r.root, '点画面');
  await act(async () => area.props.onPress({ nativeEvent: { locationX: p.x, locationY: p.y } }));
}

/** Scrubs to `frame` and taps the athlete's hips there. */
async function tapAthlete(scene: PoseScene, frame: number) {
  const slider = byLabel(r.root, '画面位置', 'onValueChange');
  await act(async () => slider.props.onValueChange(frame));
  const p = scene.frames[frame].poses[0];
  await tapScreen(geometry(scene).toScreen({ x: (p[LM.leftHip].x + p[LM.rightHip].x) / 2, y: (p[LM.leftHip].y + p[LM.rightHip].y) / 2 }));
}

/** Taps a floor line roughly, then on the zoomed picture exactly where it is. */
async function tapLine(scene: PoseScene, at: Pt) {
  const g = geometry(scene);
  const exact = g.toScreen(at);
  const rough = { x: exact.x + 2.5, y: exact.y - 1.5 };
  await tapScreen(rough);
  expect(texts(r.root)).toContain('放大了');
  // Zoomed 4× around the rough tap, which now sits in the middle of the box.
  const c = { x: g.w / 2, y: g.h / 2 };
  await tapScreen({ x: c.x + 4 * (exact.x - rough.x), y: c.y + 4 * (exact.y - rough.y) });
}

let r: ReactTestRenderer;

beforeAll(async () => {
  await migrate(mockDb);
  // Today's run-up touch, shown beside the take.
  await ensureSession(mockDb, 'touch-1', 1, 'approach_touch');
  for (const v of [316, 318, 317]) await addTrial(mockDb, { session_id: 'touch-1', value: v });
});

afterEach(async () => {
  await act(async () => r?.unmount());
  mockRouter.back.mockClear();
});

it('measures a slow-motion run-up jump from the athlete and the two floor lines tapped, and saves it beside the day’s touch', async () => {
  const scene = poseScene();
  await open(scene, { uri: 'file:///picked/IMG_0009.MOV', fps: '0', source: 'import', session: 'tt-1' });
  expect(texts(r.root)).toContain('拍摄帧率');

  await tapAthlete(scene, scene.truth.takeoffFrame - 30);
  await tapLine(scene, scene.markers!.b);
  await tapLine(scene, scene.markers!.a);

  await press(r.root, '开始分析');
  await answerReads();
  const shown = texts(r.root);
  expect(shown).toContain('单脚起跳（右脚）');
  for (const name of ['起跳垂直速度', '起跳角度', '助跑速度', '最后一步触地', '最后一步步长']) expect(shown).toContain(name);
  expect(shown).toMatch(/\d\.\d\d ± \d\.\d\d m\/s/);
  expect(shown).toContain('今天助跑摸高 317.0 cm');
  expect(shown).not.toContain(FLAG_TEXT['no-markers']);

  await press(r.root, '保存');
  const [take] = await listTechniqueTakes(mockDb, 1);
  expect(take).toMatchObject({ sessionId: 'tt-1', source: 'import', captureFps: 240, videoUri: null });
  expect(Math.abs(take.metrics.vz!.value - scene.truth.vz)).toBeLessThan(take.metrics.vz!.error);
  expect(Math.abs(take.metrics.approach!.value - scene.truth.approachSpeed!)).toBeLessThan(take.metrics.approach!.error);
  // The lines where they were tapped on the zoomed picture.
  const [trial] = await listTrials(mockDb, 'tt-1');
  const markers = (trial.detail as { markers: { a: Pt; b: Pt; distanceM: number } }).markers;
  expect(markers.distanceM).toBe(3);
  expect(markers.b.x).toBeCloseTo(scene.markers!.b.x, 3);
  expect(markers.a.y).toBeCloseTo(scene.markers!.a.y, 3);
  expect(mockRouter.back).toHaveBeenCalled();
});

it('asks for each line on the frame the athlete runs over it, tapped right at their feet', async () => {
  // Where along the tape the athlete ran is where the hips cross the line: a guess at it moves the line in the picture.
  const scene = poseScene();
  await open(scene, { uri: 'file:///picked/IMG_0015.MOV', fps: '0', source: 'import', session: 'tt-8' });
  await tapAthlete(scene, scene.truth.takeoffFrame - 30);
  expect(texts(r.root)).toContain('点起跳线：拖到运动员跑到这条胶带上的那一帧');
  const g = geometry(scene);
  await tapScreen(g.toScreen(scene.markers!.b));
  expect(texts(r.root)).toContain('放大了：点准运动员脚下的胶带。');
  await tapScreen({ x: g.w / 2, y: g.h / 2 });
  expect(texts(r.root)).toContain('点 3 米线');
  expect(texts(r.root)).toContain('同样拖到运动员跑到它上面的那一帧');
  await tapLine(scene, scene.markers!.a);

  // How far a tap a little off along the tape moves the line depends on where it is in the picture, and its size.
  await press(r.root, '开始分析');
  await answerReads();
  await press(r.root, '保存');
  const [trial] = await listTrials(mockDb, 'tt-8');
  expect((trial.detail as { markers: { picture: unknown } }).markers.picture).toEqual({ width: 1920, height: 1080 });
});

it.each([
  ['a 4K clip, whose px are smaller on screen: 8', 3840, 2160, 8, 'tt-9'],
  ['a 1080p clip: 4', 1920, 1080, 4, 'tt-10'],
])('sends how well the lines could be tapped, in the clip’s px, %s', async (_, width, height, tapPx, session) => {
  // The finger misses by as many screen points whatever the clip; across the 360-pt box zoomed 4×, a 3840-px clip
  // packs twice the px under it that a 1920-px one does.
  const scene = poseScene({ width, height, focalPx: (1370 * width) / 1920, fps: 120, noisePx: (1.5 * width) / 1920 });
  await open(scene, { uri: 'file:///picked/IMG_0016.MOV', fps: '0', source: 'import', session });
  await tapAthlete(scene, scene.truth.takeoffFrame - 30);
  await tapLine(scene, scene.markers!.b);
  await tapLine(scene, scene.markers!.a);
  await press(r.root, '开始分析');
  await answerReads();
  await press(r.root, '保存');
  const [trial] = await listTrials(mockDb, session);
  expect((trial.detail as { markers: { tapPx?: number } }).markers.tapPx).toBeCloseTo(tapPx, 6);
});

it('measures a take filmed in the app without the floor lines, says what that leaves out, and keeps its video', async () => {
  const scene = poseScene({ fps: 60 });
  const uri = 'file:///app/Documents/technique/take-1.mp4';
  await open(scene, { uri, fps: '60', source: 'camera', session: 'tt-2' });
  // The app's own camera films at its real rate: nothing to choose.
  expect(texts(r.root)).not.toContain('拍摄帧率');

  await tapAthlete(scene, scene.truth.takeoffFrame - 10);
  await press(r.root, '没贴线，跳过');
  await press(r.root, '开始分析');
  await answerReads();
  const shown = texts(r.root);
  expect(shown).toContain(FLAG_TEXT['low-fps']);
  expect(shown).toContain(FLAG_TEXT['no-markers']);
  expect(r.root.findAll((n) => n.props.accessibilityLabel === '助跑速度')).toHaveLength(0);
  expect(shown).toContain('（不够准）');

  await press(r.root, '保存');
  const takes = await listTechniqueTakes(mockDb, 1);
  expect(takes[0]).toMatchObject({ sessionId: 'tt-2', source: 'camera', captureFps: 60, videoUri: uri });
});

it('says when it never found the athlete, and what to change', async () => {
  const scene = poseScene();
  await open(scene, { uri: 'file:///picked/IMG_0010.MOV', fps: '0', source: 'import', session: 'tt-3' });
  await tapAthlete(scene, scene.truth.takeoffFrame - 30);
  await press(r.root, '没贴线，跳过');
  await press(r.root, '开始分析');
  // The page finds nobody in any frame.
  mockState.scene = { ...scene, frames: scene.frames.map((f) => ({ ...f, poses: [] })) };
  await answerReads();
  const shown = texts(r.root);
  expect(shown).toContain(PROBLEM_TEXT['no-athlete'].what);
  expect(shown).toContain(PROBLEM_TEXT['no-athlete'].advice);
  await press(r.root, '重新点选');
  expect(texts(r.root)).toContain('开始分析');
});

it('says so when the page can’t read the clip', async () => {
  const scene = poseScene();
  await open(scene, { uri: 'file:///picked/IMG_0011.MOV', fps: '0', source: 'import', session: 'tt-4' });
  await post({ type: 'error', stage: 'video', message: '视频打不开：格式不支持' });
  expect(texts(r.root)).toContain('视频打不开：格式不支持');
});

it('keeps the phone awake while it reads the clip, and no longer once it is done', async () => {
  const scene = poseScene();
  await open(scene, { uri: 'file:///picked/IMG_0012.MOV', fps: '0', source: 'import', session: 'tt-5' });
  await tapAthlete(scene, scene.truth.takeoffFrame - 30);
  await press(r.root, '没贴线，跳过');
  mockAwake.mockClear();
  await act(async () => byLabel(r.root, '画面位置', 'onValueChange').props.onValueChange(20));
  expect(mockAwake).not.toHaveBeenCalled();
  // Nobody touches the phone for the half minute to a minute it reads: Auto-Lock would end the page.
  await press(r.root, '开始分析');
  expect(mockAwake).toHaveBeenCalled();
  await answerReads();
  mockAwake.mockClear();
  await act(async () => byLabel(r.root, '画面位置', 'onValueChange').props.onValueChange(10));
  expect(mockAwake).not.toHaveBeenCalled();
});

it('says, in its own words, that the phone closed the reading page, and lets it be read again', async () => {
  const scene = poseScene();
  await open(scene, { uri: 'file:///picked/IMG_0013.MOV', fps: '0', source: 'import', session: 'tt-6' });
  await tapAthlete(scene, scene.truth.takeoffFrame - 30);
  await press(r.root, '没贴线，跳过');
  await press(r.root, '开始分析');
  await act(async () => mockWeb.props!.onContentProcessDidTerminate({ nativeEvent: {} }));
  const shown = texts(r.root);
  expect(shown).toContain('手机把识别页面关掉了');
  expect(shown).not.toContain('pose reader stopped');
  // The clip is fine: trying again is the advice, not another clip first.
  expect(shown).toContain('再分析一次');
  expect(mockWeb.reload).toHaveBeenCalled();
  await press(r.root, '重新点选');
  expect(texts(r.root)).toContain('开始分析');
});

it('reads the clip on a fresh page after the model wouldn’t start there, and waits for it before asking', async () => {
  const scene = poseScene();
  await open(scene, { uri: 'file:///picked/IMG_0014.MOV', fps: '0', source: 'import', session: 'tt-7' });
  // The page found the clip but couldn't start the model: every request it is sent fails the same way.
  await post({ type: 'error', stage: 'model', message: 'Failed to create WebGL canvas context' });
  expect(texts(r.root)).toContain('骨架识别启动不了');
  expect(texts(r.root)).toContain('再分析一次');
  const staged = mockStaged.mock.calls.length;
  await press(r.root, '重新点选');
  await act(async () => {});
  expect(mockStaged.mock.calls.length).toBe(staged + 1);

  await tapAthlete(scene, scene.truth.takeoffFrame - 30);
  await press(r.root, '没贴线，跳过');
  mockWeb.inject.mockClear();
  await press(r.root, '开始分析');
  // Nothing is sent to a page still loading: it would be lost.
  expect(mockWeb.inject).not.toHaveBeenCalled();
  await post({ type: 'ready', duration: scene.frames.length / scene.options.fps, width: scene.width, height: scene.height });
  await post({ type: 'model', delegate: 'CPU', source: 'local' });
  expect(mockWeb.inject).toHaveBeenCalled();
  await answerReads();
  expect(texts(r.root)).toContain('起跳垂直速度');
});

it('keeps saying why when the fresh page can’t be set up while an analysis waits for it', async () => {
  const scene = poseScene();
  await open(scene, { uri: 'file:///picked/IMG_0099.MOV', fps: '0', source: 'import', session: 'tt-99' });
  await tapAthlete(scene, scene.truth.takeoffFrame - 30);
  await press(r.root, '没贴线，跳过');
  await post({ type: 'error', stage: 'model', message: 'Failed to create WebGL canvas context' });
  jest.useFakeTimers();
  try {
    mockStage.holdNext = true;
    await press(r.root, '重新点选');
    await press(r.root, '开始分析');
    await act(async () => mockStage.hold!.reject(new Error('Unable to copy file: no space left on device')));
    expect(texts(r.root)).toContain('Unable to copy file');
    // The wait for a page that never came isn't then taken for a page gone quiet.
    await act(async () => {
      jest.advanceTimersByTime(30_000);
    });
    const shown = texts(r.root);
    expect(shown).toContain('Unable to copy file');
    expect(shown).not.toContain('识别页面没有反应了');
  } finally {
    jest.useRealTimers();
  }
});
