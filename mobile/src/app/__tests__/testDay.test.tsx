// The test-day wizard against an in-memory database: CMJ, drop jumps and run-up touches in order, several clips picked
// from the photo library in one go, and each result screen's 完成 going back to the wizard.
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { Text } from 'react-native';
import * as ImagePicker from 'expo-image-picker';

import { addDropJump } from '@/db/jumps';
import { migrate } from '@/db/migrations';
import { addTrial, ensureSession, getAthlete, type Athlete } from '@/db/repo';
import { openMemoryDb } from '@/db/testing/memoryDb';

import JumpTests from '../jumps/index';
import Capture from '../measure/capture';
import Result from '../measure/result';
import TestDay from '../test-day';

const mockDb = openMemoryDb();
const mockRouter = { push: jest.fn(), back: jest.fn(), replace: jest.fn(), dismissTo: jest.fn(), dismissAll: jest.fn(), canGoBack: () => true };
let mockParams: Record<string, string> = {};
const mockAthlete: { current: Athlete | null } = { current: null };

jest.mock('expo-sqlite', () => ({ useSQLiteContext: () => mockDb }));
jest.mock('@/state/athlete', () => ({ useAthlete: () => mockAthlete }));
jest.mock('expo-haptics', () => ({ selectionAsync: jest.fn(), notificationAsync: jest.fn(), NotificationFeedbackType: { Success: 'success' } }));
jest.mock('react-native-safe-area-context', () => jest.requireActual('react-native-safe-area-context/jest/mock').default);
jest.mock('expo-image-picker', () => ({
  launchImageLibraryAsync: jest.fn(),
  UIImagePickerPreferredAssetRepresentationMode: { Current: 'current' },
}));
jest.mock('expo-router', () => {
  const React = jest.requireActual('react');
  return {
    get router() {
      return mockRouter;
    },
    useLocalSearchParams: () => mockParams,
    useFocusEffect: (cb: () => void) => React.useEffect(cb, [cb]),
  };
});

jest.useFakeTimers({
  now: new Date(2026, 10, 7, 10),
  doNotFake: ['nextTick', 'setImmediate', 'clearImmediate', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'queueMicrotask', 'hrtime', 'performance', 'requestAnimationFrame', 'cancelAnimationFrame', 'requestIdleCallback', 'cancelIdleCallback'],
});

function texts(root: ReactTestInstance): string {
  return root
    .findAllByType(Text)
    .map((t) => [t.props.children].flat(Infinity).filter((c) => typeof c === 'string' || typeof c === 'number').join(''))
    .join('\n');
}

const pressable = (root: ReactTestInstance, label: string) =>
  root.find((n) => typeof n.props.onPress === 'function' && (n.props.accessibilityLabel === label || n.findAllByType(Text).some((t) => [t.props.children].flat().join('') === label)));

async function render(el: React.ReactElement): Promise<ReactTestRenderer> {
  let r!: ReactTestRenderer;
  await act(async () => {
    r = create(el);
  });
  await act(async () => {});
  return r;
}

async function record(session: string, metric: string, values: number[]) {
  await ensureSession(mockDb, session, 1, metric);
  for (const value of values) await addTrial(mockDb, { session_id: session, value });
}

beforeAll(async () => {
  await migrate(mockDb);
  mockAthlete.current = await getAthlete(mockDb, 1);
  // An earlier ladder that peaked at 40 cm, a week ago.
  jest.setSystemTime(new Date(2026, 9, 31, 10));
  for (const [boxCm, rsi] of [
    [30, 1.9],
    [40, 2.1],
    [50, 2.0],
  ])
    await addDropJump(mockDb, 1, 'ladder', { boxCm, rsi, contactMs: 200, heightCm: 30, flightS: 0.5 });
  jest.setSystemTime(new Date(2026, 10, 7, 10));
});

beforeEach(() => jest.clearAllMocks());

it('lists the three tests in order and starts with CMJ', async () => {
  const r = await render(<TestDay />);
  const shown = texts(r.root);
  expect(shown.indexOf('CMJ 反向跳')).toBeLessThan(shown.indexOf('DJ 跳深'));
  expect(shown.indexOf('DJ 跳深')).toBeLessThan(shown.indexOf('助跑摸高'));
  expect(shown).toContain('从 40 cm 的箱子跳下');

  await act(async () => pressable(r.root, '下一项：CMJ 反向跳').props.onPress());
  expect(mockRouter.push).toHaveBeenCalledWith({ pathname: '/measure/capture', params: { metric: 'cmj', session: expect.any(String), from: 'testday' } });
});

it('picks several clips at once and carries the rest along to the analysis', async () => {
  jest.mocked(ImagePicker.launchImageLibraryAsync).mockResolvedValue({
    canceled: false,
    assets: [
      { uri: 'file:///1.mov', assetId: 'A1', width: 0, height: 0 },
      { uri: 'file:///2.mov', assetId: 'A2', width: 0, height: 0 },
    ],
  });
  mockParams = { metric: 'cmj', session: 'cmj-today', from: 'testday' };
  const r = await render(<Capture />);
  await act(async () => pressable(r.root, '从相册导入视频').props.onPress());

  expect(ImagePicker.launchImageLibraryAsync).toHaveBeenCalledWith(expect.objectContaining({ allowsMultipleSelection: true, selectionLimit: 10, orderedSelection: true }));
  expect(mockRouter.push).toHaveBeenCalledWith({
    pathname: '/measure/analyse',
    params: { metric: 'cmj', session: 'cmj-today', from: 'testday', uri: 'file:///1.mov', fps: '0', asset: 'A1', queue: JSON.stringify({ screen: 'analyse', clips: [{ uri: 'file:///2.mov', asset: 'A2' }] }) },
  });
});

it('keeps picking one clip at a time for the box ladder, which needs a new box height for every jump', async () => {
  jest.mocked(ImagePicker.launchImageLibraryAsync).mockResolvedValue({ canceled: false, assets: [{ uri: 'file:///1.mov', assetId: 'A1', width: 0, height: 0 }] });
  mockParams = { metric: 'dj_rsi', session: 'ladder-2', from: 'dj', box: '40' };
  const r = await render(<Capture />);
  await act(async () => pressable(r.root, '从相册导入视频').props.onPress());
  expect(jest.mocked(ImagePicker.launchImageLibraryAsync).mock.calls[0][0]).not.toHaveProperty('allowsMultipleSelection');
});

it('goes back to the wizard when a test is done', async () => {
  await record('cmj-today', 'cmj', [40.2, 41.5, 39.8]);
  mockParams = { metric: 'cmj', session: 'cmj-today', from: 'testday' };
  const r = await render(<Result />);
  await act(async () => pressable(r.root, '完成').props.onPress());
  expect(mockRouter.dismissTo).toHaveBeenCalledWith('/test-day');
});

it('ticks off what was measured today and moves on to the drop jumps from the ladder’s best box', async () => {
  const r = await render(<TestDay />);
  expect(texts(r.root)).toContain('已测 3 跳 · 最好 41.5 cm');
  await act(async () => pressable(r.root, '下一项：DJ 跳深 RSI').props.onPress());
  expect(mockRouter.push).toHaveBeenCalledWith({ pathname: '/measure/capture', params: { metric: 'dj_rsi', session: expect.any(String), from: 'testday', box: '40' } });

  // Measuring CMJ again adds to today's session instead of starting a second one.
  await act(async () => pressable(r.root, '测 CMJ 反向跳').props.onPress());
  expect(mockRouter.push).toHaveBeenLastCalledWith({ pathname: '/measure/capture', params: { metric: 'cmj', session: 'cmj-today', from: 'testday' } });
});

it('says when every test is done and points to the diagnosis', async () => {
  await addDropJump(mockDb, 1, 'dj-today', { boxCm: 40, rsi: 2.2, contactMs: 190, heightCm: 31, flightS: 0.5 });
  await record('touch-today', 'approach_touch', [312, 315, 314, 316, 313, 311]);
  const r = await render(<TestDay />);
  const shown = texts(r.root);
  expect(shown).toContain('今天三项都测完了');
  expect(shown).toContain('已测 1 跳 · 最好 2.20');
  // Run-up touches count the mean of the best three (316, 315, 314), like the result screen.
  expect(shown).toContain('已测 6 跳 · 最好 3 跳均值 315.0 cm');
  await act(async () => pressable(r.root, '看扣篮诊断').props.onPress());
  expect(mockRouter.push).toHaveBeenCalledWith('/dunk');
});

it('opens from the jump tests', async () => {
  const r = await render(<JumpTests />);
  await act(async () => pressable(r.root, '测试日 · 按顺序测完三项').props.onPress());
  expect(mockRouter.push).toHaveBeenCalledWith('/test-day');
});
