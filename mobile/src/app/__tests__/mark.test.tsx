// Drives the frame-marking screen against a real (in-memory) database: step to take-off, mark it, step to landing, save.
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { Text } from 'react-native';

import { migrate } from '@/db/migrations';
import { listTrials } from '@/db/repo';
import { openMemoryDb } from '@/db/testing/memoryDb';

import { persistVideo } from '@/media/videos';

import Mark from '../measure/mark';

const mockDb = openMemoryDb();
const mockRouter = { push: jest.fn(), back: jest.fn(), replace: jest.fn(), dismiss: jest.fn() };
let mockParams: Record<string, string> = {};

jest.mock('expo-sqlite', () => ({ useSQLiteContext: () => mockDb }));
const mockAthlete = { current: { id: 1, name: '我自己', standing_reach_cm: 240 } };
jest.mock('@/state/athlete', () => ({ useAthlete: () => mockAthlete }));
jest.mock('expo-haptics', () => ({ selectionAsync: jest.fn() }));
jest.mock('react-native-safe-area-context', () => jest.requireActual('react-native-safe-area-context/jest/mock').default);
jest.mock('@react-native-community/slider', () => () => null);
jest.mock('@/media/videos', () => ({ persistVideo: jest.fn(async (uri: string) => uri) }));
jest.mock('expo-video', () => ({ useVideoPlayer: () => ({ currentTime: 0 }), VideoView: () => null }));
// The clip reports a 2 s, 240 fps track as soon as it loads.
jest.mock('expo', () => {
  const React = jest.requireActual('react');
  return {
    useEventListener: (_player: unknown, event: string, cb: (e: unknown) => void) =>
      React.useEffect(() => {
        if (event === 'sourceLoad') cb({ duration: 2, availableVideoTracks: [{ frameRate: 240 }] });
        // Once, like a real load event.
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, []),
  };
});
jest.mock('expo-router', () => ({
  get router() {
    return mockRouter;
  },
  useLocalSearchParams: () => mockParams,
}));

function texts(root: ReactTestInstance): string {
  return root
    .findAllByType(Text)
    .map((t) => [t.props.children].flat(Infinity).filter((c) => typeof c === 'string' || typeof c === 'number').join(''))
    .join('\n');
}

const byLabel = (root: ReactTestInstance, label: string) => root.find((n) => n.props.accessibilityLabel === label && typeof n.props.onPress === 'function');

function pressable(root: ReactTestInstance, label: string): ReactTestInstance {
  return root.find((n) => typeof n.props.onPress === 'function' && n.findAllByType(Text).some((t) => [t.props.children].flat().join('') === label));
}

async function press(node: ReactTestInstance) {
  await act(async () => {
    await node.props.onPress();
  });
}

/** Steps forward `n` frames with the ±10 and ±1 buttons. */
async function step(root: ReactTestInstance, n: number) {
  for (let i = 0; i < Math.floor(n / 10); i++) await press(byLabel(root, '前进 10 帧'));
  for (let i = 0; i < n % 10; i++) await press(byLabel(root, '前进 1 帧'));
}

async function render(): Promise<ReactTestRenderer> {
  let r!: ReactTestRenderer;
  await act(async () => {
    r = create(<Mark />);
  });
  return r;
}

beforeAll(async () => {
  await migrate(mockDb);
});

beforeEach(() => jest.clearAllMocks());

it('marks a CMJ frame by frame and saves it as a trial', async () => {
  mockParams = { metric: 'cmj', session: 'cmj-1', uri: 'file:///clip.mov', fps: '0' };
  const r = await render();
  expect(texts(r.root)).toContain('标记起跳帧和落地帧后显示结果');

  await step(r.root, 120);
  await press(byLabel(r.root, '把当前帧标为起跳帧'));
  await step(r.root, 132);
  await press(byLabel(r.root, '把当前帧标为落地帧'));
  // 132 frames at 240 fps: 550 ms of flight, 37.1 cm.
  expect(texts(r.root)).toContain('550');
  expect(texts(r.root)).toContain('37.1');

  await press(pressable(r.root, '保存这一次'));
  const [t] = await listTrials(mockDb, 'cmj-1');
  expect(t).toMatchObject({ value: 37.1, fps: 240, takeoff_frame: 120, landing_frame: 252, video_uri: null });
  // The clip stays in the photo library; the app keeps no copy of it.
  expect(persistVideo).not.toHaveBeenCalled();
  expect(mockRouter.replace).toHaveBeenCalledWith({ pathname: '/measure/result', params: { metric: 'cmj', session: 'cmj-1' } });
});

it('saves a drop jump with its box height and goes straight back to the box ladder', async () => {
  mockParams = { metric: 'dj_rsi', session: 'dj-1', uri: 'file:///dj.mov', fps: '0', from: 'dj', box: '40' };
  const r = await render();
  await press(byLabel(r.root, '把当前帧标为触地帧'));
  await step(r.root, 48);
  await press(byLabel(r.root, '把当前帧标为起跳帧'));
  await step(r.root, 120);
  await press(byLabel(r.root, '把当前帧标为落地帧'));
  await press(pressable(r.root, '保存这一次'));

  const [t] = await listTrials(mockDb, 'dj-1');
  expect(t).toMatchObject({ value: 1.53, takeoff_frame: 48, landing_frame: 168, detail: { source: 'video', contact_ms: 200, box_cm: 40 } });
  expect(mockRouter.dismiss).toHaveBeenCalledWith(2);
});
