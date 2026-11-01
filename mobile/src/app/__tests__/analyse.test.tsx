// Drives the analysis screen end to end: the page in the WebView is replaced by one that answers each frame request with
// frames of a synthetic clip, so the flow runs from picking the athlete to the saved trials.
import { Text } from 'react-native';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';

import { migrate } from '@/db/migrations';
import { listTrials } from '@/db/repo';
import { openMemoryDb } from '@/db/testing/memoryDb';
import { analyseJumps } from '@/domain/jumpAnalysis';
import { defaultScene, renderScene, sceneEvents, type SceneOptions } from '@/domain/testing/jumpScene';
import { standing } from '@/domain/testing/standing';

import Analyse from '../measure/analyse';

const mockDb = openMemoryDb();
const mockRouter = { push: jest.fn(), back: jest.fn(), replace: jest.fn(), dismiss: jest.fn() };
const mockWeb: { props: Record<string, any> | null; inject: jest.Mock; reload: jest.Mock } = { props: null, inject: jest.fn(), reload: jest.fn() };
// The pose page, loaded only when the strip under the feet finds nothing.
const mockPose: { props: Record<string, any> | null; inject: jest.Mock; reload: jest.Mock; ready: boolean } = { props: null, inject: jest.fn(), reload: jest.fn(), ready: false };
const mockState: { scene: SceneOptions; params: Record<string, string> } = { scene: defaultScene('cmj'), params: {} };

jest.mock('expo-sqlite', () => ({ useSQLiteContext: () => mockDb }));
jest.mock('@/state/athlete', () => ({ useAthlete: () => ({ current: { id: 1, name: '我自己', standing_reach_cm: null } }) }));
jest.mock('expo-haptics', () => ({ selectionAsync: jest.fn() }));
jest.mock('react-native-safe-area-context', () => jest.requireActual('react-native-safe-area-context/jest/mock').default);
jest.mock('expo-router', () => ({
  get router() {
    return mockRouter;
  },
  useLocalSearchParams: () => mockState.params,
}));
// Each filmstrip picture stands for the moment it was taken at.
const mockThumbnails = jest.fn(async (times: number[]) => times.map((t) => ({ requestedTime: t })));
jest.mock('expo-video', () => ({
  useVideoPlayer: (uri: string) => jest.requireActual('react').useMemo(() => ({ uri, currentTime: 0, generateThumbnailsAsync: mockThumbnails }), [uri]),
  VideoView: () => null,
}));
jest.mock('expo', () => {
  const React = jest.requireActual('react');
  return {
    ...jest.requireActual('expo'),
    // The clip reports its length and its real frame rate as soon as it loads.
    useEventListener: (p: unknown, _e: string, cb: (x: unknown) => void) =>
      // eslint-disable-next-line react-hooks/exhaustive-deps -- like the real hook, it listens per player, not per callback
      React.useEffect(() => cb({ duration: mockState.scene.durationS, availableVideoTracks: [{ frameRate: mockState.scene.fps }] }), [p]),
  };
});
jest.mock('@/media/frameGrabber', () => ({
  ...jest.requireActual('@/media/frameGrabber'),
  stageForGrabbing: async () => ({ page: 'file:///cache/jump-detect/grab.html', dir: 'file:///cache/jump-detect/' }),
  unstage: jest.fn(),
}));
jest.mock('@/media/poseLib', () => ({
  ...jest.requireActual('@/media/poseLib'),
  stagePosePage: async () => ({ page: 'file:///app/Documents/pose/run-1/page.html', dir: 'file:///app/Documents/pose/run-1', root: 'file:///app/Documents/pose' }),
  unstagePosePage: jest.fn(),
}));
jest.mock('react-native-webview', () => {
  const React = jest.requireActual('react');
  const { View } = jest.requireActual('react-native');
  const WebView = React.forwardRef((props: Record<string, any>, ref: unknown) => {
    const page = String(props.source?.uri).includes('/pose/') ? mockPose : mockWeb;
    page.props = props;
    React.useImperativeHandle(ref, () => ({ injectJavaScript: page.inject, reload: page.reload }));
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

function press(root: ReactTestInstance, label: string) {
  const n = root.find((x) => typeof x.props.onPress === 'function' && (x.props.accessibilityLabel === label || x.findAllByType(Text).some((t) => t.props.children === label)));
  // Not waiting for what the press starts: analysis waits for frames that `answerGrabs` hands in.
  return act(async () => {
    n.props.onPress({ nativeEvent: {} });
  });
}

async function post(m: unknown) {
  await act(async () => mockWeb.props!.onMessage({ nativeEvent: { data: JSON.stringify(m) } }));
}

/** Answers the n-th `window.grab(...)` the screen injected, the way the page does. */
async function answerGrab(n: number) {
  const call = JSON.parse(/window\.grab\((.*)\); true;/.exec(mockWeb.inject.mock.calls[n][0])![1]);
  for (let i = 0; i < call.frames.length; i += 20) {
    const batch = call.frames.slice(i, i + 20).map((f: number) => renderScene(mockState.scene, f, call.rect, call.w, call.h).data);
    const bytes = Buffer.concat(batch.map((b: Uint8Array) => Buffer.from(b)));
    await post({ type: 'frames', id: call.id, from: i, w: call.w, h: call.h, data: bytes.toString('base64') });
  }
  await post({ type: 'done', id: call.id });
}

/** Answers each `window.grab(...)` the screen injects, the way the page does, until it stops asking. */
async function answerGrabs() {
  for (let n = 0; n < mockWeb.inject.mock.calls.length; n++) await answerGrab(n);
}

/**
 * The pose model's reading of the scene's athlete at file frame f: standing on the scene's floor (lower in the picture
 * as `landShiftPx` carries them nearer the lens), lifted by the flight, side-on, 580 px tall (≈ 1.74 m at 3 mm a px).
 */
function scenePose(o: SceneOptions, f: number): number[] {
  const tau = f / o.fps - o.takeoffS;
  const liftMm = tau > 0 && tau < o.flightS ? (9810 / 2) * tau * (o.flightS - tau) : 0;
  const shift = (o.landShiftPx ?? 0) * Math.max(0, Math.min(1, tau / o.flightS));
  const p = standing({ x: (-160 - o.originX) / o.mmPerPx, floor: o.floorRow + shift - liftMm / o.mmPerPx, stature: 580 });
  return p.flatMap((q) => [q.x / o.width, q.y / o.height, q.z, q.v]);
}

/** Answers the frame page's grabs and the pose page's reads, the way the pages do, until neither is asked anything more. */
async function answerAll() {
  let g = 0;
  let q = 0;
  for (;;) {
    if (mockPose.props && !mockPose.ready) {
      mockPose.ready = true;
      await act(async () => mockPose.props!.onMessage({ nativeEvent: { data: JSON.stringify({ type: 'ready', duration: mockState.scene.durationS, width: mockState.scene.width, height: mockState.scene.height }) } }));
      continue;
    }
    if (g < mockWeb.inject.mock.calls.length) {
      await answerGrab(g++);
      continue;
    }
    if (q < mockPose.inject.mock.calls.length) {
      const call = /window\.(follow|everyone|crops)\((.*)\); true;/.exec(mockPose.inject.mock.calls[q++][0]);
      if (!call) continue;
      const req = JSON.parse(call[2]);
      const items = req.frames.map((f: number) => [f, f / req.fps, scenePose(mockState.scene, f)]);
      const say = (m: unknown) => act(async () => mockPose.props!.onMessage({ nativeEvent: { data: JSON.stringify(m) } }));
      for (let i = 0; i < items.length; i += 40) await say({ type: 'poses', id: req.id, items: items.slice(i, i + 40) });
      await say({ type: 'done', id: req.id });
      continue;
    }
    await act(async () => {});
    if (g === mockWeb.inject.mock.calls.length && q === mockPose.inject.mock.calls.length && !(mockPose.props && !mockPose.ready)) break;
  }
}

async function open(scene: SceneOptions, params: Record<string, string>) {
  mockState.scene = scene;
  mockState.params = { uri: 'file:///picked/IMG_0003.MOV', fps: '0', ...params };
  mockWeb.inject.mockClear();
  mockPose.inject.mockClear();
  mockPose.props = null;
  mockPose.ready = false;
  await act(async () => {
    r = create(<Analyse />);
  });
  await act(async () => {});
  await post({ type: 'ready', duration: scene.durationS, width: scene.width, height: scene.height });
}

let r: ReactTestRenderer;

beforeAll(async () => {
  await migrate(mockDb);
});

afterEach(async () => {
  await act(async () => r?.unmount());
  mockRouter.replace.mockClear();
});

it('analyses a 10/5 set: every rebound, its contact, and one saved trial with the 10/5 RSI', async () => {
  const scene = defaultScene('repeat', { shadow: 0.4 });
  await open(scene, { metric: 'rj_rsi', session: 'rj-1' });
  await press(r.root, '开始分析');
  await answerGrabs();

  const shown = texts(r.root);
  const truth = sceneEvents(scene);
  expect(shown).toContain(`认出 ${truth.length} 跳，计入 ${truth.length} 跳`);
  expect(shown).toContain('10/5 RSI');
  expect(shown).toContain('GCT-CV');
  expect(shown).toMatch(/误差：每个关键帧 ±1 帧（4 ms），跳高约 ±\d\.\d cm，触地 ±\d+ ms/);

  // iOS ends the hidden page while the results are on screen (memory, or the app in the background): the results stay,
  // and the page is loaded again for the next clip.
  await act(async () => mockWeb.props!.onContentProcessDidTerminate());
  expect(texts(r.root)).toContain(`认出 ${truth.length} 跳，计入 ${truth.length} 跳`);
  expect(mockWeb.reload).toHaveBeenCalled();

  await press(r.root, '保存这一组');
  const [t] = await listTrials(mockDb, 'rj-1');
  // Within what one frame on each mark allows of the true 10/5 RSI.
  const exact = analyseJumps(truth, { kind: 'repeat', captureFps: scene.fps }).summary.rsi105!;
  expect(Math.abs(t.value - exact)).toBeLessThan(0.08);
  expect(t.detail).toMatchObject({ source: 'video', auto: true });
  expect(mockRouter.replace).toHaveBeenCalledWith({ pathname: '/measure/result', params: { metric: 'rj_rsi', session: 'rj-1' } });
});

it('trims the clip like the Photos app, and analyses the part kept by itself once the handles are let go', async () => {
  const scene = defaultScene('cmj', { shadow: 0.4 });
  await open(scene, { metric: 'cmj', session: 'cmj-trim' });
  // A filmstrip of the whole clip under the video.
  expect(mockThumbnails).toHaveBeenCalledWith(expect.any(Array), expect.objectContaining({ maxWidth: expect.any(Number) }));
  expect(mockThumbnails.mock.calls[0][0].length).toBeGreaterThan(4);

  // 2.6 s at 240 fps is frames 0…623; a VoiceOver step is 31 frames. Three steps in from each end keeps 93…530.
  const handle = (label: string) => r.root.find((n) => n.props.accessibilityLabel === label && typeof n.props.onAccessibilityAction === 'function');
  jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] });
  try {
    for (let i = 0; i < 3; i++) {
      await act(async () => handle('片段开始').props.onAccessibilityAction({ nativeEvent: { actionName: 'increment' } }));
      await act(async () => handle('片段结束').props.onAccessibilityAction({ nativeEvent: { actionName: 'decrement' } }));
    }
    expect(texts(r.root)).toContain('已选 1.82 s');
    // Nothing starts while the athlete may still be adjusting the other end.
    await act(async () => jest.advanceTimersByTime(1500));
    expect(mockWeb.inject).not.toHaveBeenCalled();
    await act(async () => jest.advanceTimersByTime(500));
  } finally {
    jest.useRealTimers();
  }
  const grab = JSON.parse(/window\.grab\((.*)\); true;/.exec(mockWeb.inject.mock.calls[0][0])![1]);
  expect(grab.frames[0]).toBe(93);
  expect(Math.max(...grab.frames)).toBeLessThanOrEqual(530);

  await answerGrabs();
  expect(texts(r.root)).toContain('认出 1 跳，计入 1 跳');
});

it('scores no 10/5 from a set cut short, and says why nothing can be saved', async () => {
  const full = defaultScene('repeat', { shadow: 0.4 });
  const scene = { ...full, hops: full.hops!.slice(0, 2), durationS: 3 };
  await open(scene, { metric: 'rj_rsi', session: 'rj-2' });
  await press(r.root, '开始分析');
  await answerGrabs();
  const shown = texts(r.root);
  expect(shown).toContain('认出 3 跳');
  expect(shown).toContain('计入的反弹只有 2 次，10/5 RSI 要至少 5 次');
  expect(shown).toContain('没有能保存的跳');
});

it('follows the athlete tapped when someone else moves more, and lets a key frame be nudged before saving', async () => {
  const scene = defaultScene('cmj', { width: 1080, bystander: { x: 1800, swayMm: 250 }, shadow: 0.4 });
  await open(scene, { metric: 'cmj', session: 'cmj-1' });
  // The video box is 360 × 640 on screen, the clip 1080 × 640: a third the size, letterboxed top and bottom.
  const box = r.root.find((n) => typeof n.props.onLayout === 'function' && n.props.style?.height === 380);
  await act(async () => box.props.onLayout({ nativeEvent: { layout: { width: 360, height: 380 } } }));
  const fit = 360 / 1080;
  const oy = (380 - 640 * fit) / 2;
  const feet = { x: (0 - scene.originX) / scene.mmPerPx - 40, y: scene.floorRow - 20 };
  const tapArea = r.root.find((n) => n.props.accessibilityLabel === '点一下运动员' && typeof n.props.onPress === 'function');
  await act(async () => tapArea.props.onPress({ nativeEvent: { locationX: feet.x * fit, locationY: oy + feet.y * fit } }));
  expect(texts(r.root)).toContain('已点选运动员');

  await press(r.root, '开始分析');
  await answerGrabs();
  const truth = sceneEvents(scene)[0];
  const shown = texts(r.root);
  expect(shown).toContain('认出 1 跳，计入 1 跳');
  expect(shown).toContain('已锁定');

  await press(r.root, '第 1 跳');
  const frameOf = (name: string) => Number(new RegExp(`^${name}\\n#(\\d+)$`, 'm').exec(texts(r.root))?.[1]);
  const takeoff = frameOf('起跳');
  expect(Math.abs(takeoff - truth.takeoff)).toBeLessThanOrEqual(1);
  await press(r.root, '起跳后移一帧');
  expect(frameOf('起跳')).toBe(takeoff + 1);

  await press(r.root, '保存 1 跳');
  const [t] = await listTrials(mockDb, 'cmj-1');
  expect(t.takeoff_frame).toBe(takeoff + 1);
  expect(t.detail).toMatchObject({ source: 'video', auto: true });
});

it('says why nothing was found and what to change', async () => {
  await open(defaultScene('cmj', { takeoffS: 9, durationS: 2 }), { metric: 'cmj', session: 'cmj-2' });
  await press(r.root, '开始分析');
  // The strip finds nothing, and then neither does the skeleton.
  await answerAll();
  const shown = texts(r.root);
  expect(shown).toContain('选中的片段里没认出跳跃');
  expect(shown).toContain('建议：');
  expect(shown).toContain('手动逐帧标');

  // Marking by hand takes this screen's place, so the marking screen goes back to wherever it would from the import.
  await press(r.root, '手动逐帧标');
  expect(mockRouter.push).not.toHaveBeenCalledWith(expect.objectContaining({ pathname: '/measure/mark' }));
  expect(mockRouter.replace).toHaveBeenCalledWith(expect.objectContaining({ pathname: '/measure/mark' }));
});

it('falls back to the skeleton when the strip under the feet finds no jump: a landing nearer a phone set above the ankles', async () => {
  // The clip that started this (2026-10-31): the landing 50 px lower in the picture than the take-off, so the one strip
  // the coarse pass places misses the take-off (domain/autoMark tests). Nobody tapped: the pose page searches for them.
  const scene = defaultScene('cmj', { landShiftPx: 50 });
  await open(scene, { metric: 'cmj', session: 'cmj-pose' });
  await press(r.root, '开始分析');
  await answerAll();
  expect(mockPose.inject.mock.calls.some(([js]) => js.startsWith('window.everyone('))).toBe(true);
  const shown = texts(r.root);
  expect(shown).toContain('认出 1 跳，计入 1 跳');

  await press(r.root, '第 1 跳');
  const frameOf = (name: string) => Number(new RegExp(`^${name}\\n#(\\d+)$`, 'm').exec(texts(r.root))?.[1]);
  const truth = sceneEvents(scene)[0];
  expect(Math.abs(frameOf('起跳') - truth.takeoff)).toBeLessThanOrEqual(1);
  expect(Math.abs(frameOf('落地') - truth.landing)).toBeLessThanOrEqual(1);
});

it('says the skeleton could not start when the strip finds nothing and the pose page fails', async () => {
  await open(defaultScene('cmj', { landShiftPx: 50 }), { metric: 'cmj', session: 'cmj-pose-2' });
  await press(r.root, '开始分析');
  await answerGrabs();
  // The model can't be fetched (offline, the first time).
  await act(async () => {});
  await act(async () => mockPose.props!.onMessage({ nativeEvent: { data: JSON.stringify({ type: 'error', stage: 'model', message: 'Failed to fetch' }) } }));
  const shown = texts(r.root);
  expect(shown).toContain('骨架识别没能启动');
  expect(shown).toContain('手动逐帧标');
});

describe('several clips picked at once', () => {
  const queue = JSON.stringify({ screen: 'analyse', clips: [{ uri: 'file:///picked/IMG_0004.MOV', asset: 'A4' }] });

  it('moves on to the next clip of the same test after saving', async () => {
    await open(defaultScene('cmj', { shadow: 0.4 }), { metric: 'cmj', session: 'cmj-q', from: 'testday', asset: 'A3', queue });
    expect(texts(r.root)).toContain('还有 1 段视频');
    await press(r.root, '开始分析');
    await answerGrabs();
    await press(r.root, '保存 1 跳');
    expect(await listTrials(mockDb, 'cmj-q')).toHaveLength(1);
    expect(mockRouter.replace).toHaveBeenCalledWith({
      pathname: '/measure/analyse',
      params: { metric: 'cmj', session: 'cmj-q', from: 'testday', uri: 'file:///picked/IMG_0004.MOV', fps: '0', asset: 'A4' },
    });
  });

  it('skips a clip with nothing to save, and hands the rest on when marking by hand', async () => {
    await open(defaultScene('cmj', { takeoffS: 9, durationS: 2 }), { metric: 'cmj', session: 'cmj-q2', queue });
    await press(r.root, '开始分析');
    await answerAll();
    await press(r.root, '跳过这段，看下一段');
    expect(mockRouter.replace).toHaveBeenLastCalledWith(expect.objectContaining({ pathname: '/measure/analyse', params: expect.objectContaining({ uri: 'file:///picked/IMG_0004.MOV' }) }));

    await press(r.root, '手动逐帧标');
    expect(mockRouter.replace).toHaveBeenLastCalledWith({ pathname: '/measure/mark', params: expect.objectContaining({ uri: 'file:///picked/IMG_0003.MOV', queue }) });
  });
});
