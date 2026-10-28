// The goal date end to end against an in-memory database: set it in 我的, see the countdown and forecast on the home
// screen, start a plan that counts back from it, then the taper and the dunk test day on the training tab.
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { Alert, Text, TextInput } from 'react-native';

import { migrate } from '@/db/migrations';
import { addTrial, ensureSession, getAthlete, type Athlete } from '@/db/repo';
import { openMemoryDb } from '@/db/testing/memoryDb';
import { getActivePlan } from '@/db/training';
import { DEFERRED_STRENGTH_REASON } from '@/domain/goal';

import Home from '../(tabs)/index';
import Me from '../(tabs)/me';
import Train from '../(tabs)/train';
import NewPlan from '../plan/new';

const mockDb = openMemoryDb();
const mockRouter = { push: jest.fn(), back: jest.fn(), replace: jest.fn(), navigate: jest.fn() };
const mockAthlete: { current: Athlete | null; athletes: Athlete[]; select: jest.Mock; reload: () => Promise<void> } = {
  current: null,
  athletes: [],
  select: jest.fn(),
  reload: async () => {
    mockAthlete.current = await getAthlete(mockDb, 1);
    mockAthlete.athletes = [mockAthlete.current!];
  },
};

jest.mock('expo-sqlite', () => ({ useSQLiteContext: () => mockDb }));
jest.mock('@/state/athlete', () => ({ useAthlete: () => mockAthlete }));
jest.mock('@/media/videos', () => ({ savedVideos: jest.fn(async () => ({ count: 0, bytes: 0 })), deleteSavedVideos: jest.fn(async () => {}) }));
jest.mock('expo-haptics', () => ({ selectionAsync: jest.fn(), notificationAsync: jest.fn(), NotificationFeedbackType: { Success: 'success' } }));
jest.mock('react-native-safe-area-context', () => jest.requireActual('react-native-safe-area-context/jest/mock').default);
jest.mock('expo-router', () => {
  const React = jest.requireActual('react');
  return {
    get router() {
      return mockRouter;
    },
    Link: ({ children }: { children: React.ReactNode }) => children,
    useLocalSearchParams: () => ({}),
    useFocusEffect: (cb: () => void) => React.useEffect(cb, [cb]),
    Stack: { Screen: () => null },
  };
});

// Wednesday 2026-10-28, five weeks before the goal.
jest.useFakeTimers({
  now: new Date(2026, 9, 28, 10),
  doNotFake: ['nextTick', 'setImmediate', 'clearImmediate', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'queueMicrotask', 'hrtime', 'performance', 'requestAnimationFrame', 'cancelAnimationFrame', 'requestIdleCallback', 'cancelIdleCallback'],
});

function texts(root: ReactTestInstance): string {
  return root
    .findAllByType(Text)
    .map((t) => [t.props.children].flat(Infinity).filter((c) => typeof c === 'string' || typeof c === 'number').join(''))
    .join('\n');
}

function pressable(root: ReactTestInstance, label: string): ReactTestInstance {
  return root.find((n) => typeof n.props.onPress === 'function' && n.findAllByType(Text).some((t) => [t.props.children].flat().join('') === label));
}

async function render(el: React.ReactElement): Promise<ReactTestRenderer> {
  let r!: ReactTestRenderer;
  await act(async () => {
    r = create(el);
  });
  await act(async () => {});
  return r;
}

async function touch(session: string, value: number, day: number) {
  await ensureSession(mockDb, session, 1, 'approach_touch');
  await mockDb.runAsync('UPDATE test_session SET started_at = ? WHERE id = ?', new Date(2026, 9, day, 18).toISOString(), session);
  await addTrial(mockDb, { session_id: session, value });
}

beforeAll(async () => {
  await migrate(mockDb);
  await mockAthlete.reload();
});

it('takes the goal date in 我的 and refuses one that is not a date', async () => {
  const r = await render(<Me />);
  const goal = r.root.find((n) => n.type === TextInput && n.props.accessibilityLabel === '目标日 · 哪天前要扣进');
  await act(async () => goal.props.onChangeText('12月1日'));
  expect(texts(r.root)).toContain('日期写成 2026-12-01 这样');
  await act(async () => goal.props.onChangeText('2026-12-01'));
  await act(async () => pressable(r.root, '保存').props.onPress());
  expect((await getAthlete(mockDb, 1))?.goal_date).toBe('2026-12-01');
});

it('counts down on the home screen and forecasts the day the touch reaches the line', async () => {
  let r = await render(<Home />);
  expect(texts(r.root)).toContain('目标日 12/1 周二 · 还有 34 天');
  expect(texts(r.root)).toContain('近 6 周测满 4 次摸高、跨 2 周以上才能预测哪天过线（现在 0 次）');

  // +1 cm a week from 314 on 10/7: 320 three weeks after the 317 on 10/28.
  for (const [i, day] of [7, 14, 21, 28].entries()) await touch(`touch-${i}`, 314 + i, day);
  r = await render(<Home />);
  expect(texts(r.root)).toContain('预计 11/18 周三 过线（最早 11/18 周三，最晚 11/18 周三）');
  await act(async () => pressable(r.root, '目标日 12/1 周二 · 还有 34 天').props.onPress());
  expect(mockRouter.push).toHaveBeenCalledWith('/me');
});

it('starts a new plan with transfer, not strength, this close to the goal', async () => {
  const r = await render(<NewPlan />);
  expect(texts(r.root)).toContain(DEFERRED_STRENGTH_REASON);
  jest.spyOn(Alert, 'alert').mockImplementation((_t, _m, buttons) => buttons?.find((b) => b.text === '更换')?.onPress?.());
  await act(async () => pressable(r.root, '开始这个计划').props.onPress());
  await act(async () => {});
  expect((await getActivePlan(mockDb, 1))?.blocks).toEqual([expect.objectContaining({ type: 'transfer', extras: ['heavy_squat'] })]);
});

it('tapers the last 10 days and makes the goal day the dunk test', async () => {
  jest.setSystemTime(new Date(2026, 10, 23, 10)); // Monday, 8 days out
  let r = await render(<Train />);
  expect(texts(r.root)).toContain('赛前减量：量减半，强度不变');

  jest.setSystemTime(new Date(2026, 11, 1, 10)); // the goal day, a Tuesday: no training planned otherwise
  r = await render(<Train />);
  expect(texts(r.root)).toContain('扣篮测试日');
  expect(texts(r.root)).not.toContain('开始训练');
  await act(async () => pressable(r.root, '测助跑摸高').props.onPress());
  expect(mockRouter.push).toHaveBeenLastCalledWith({ pathname: '/measure/capture', params: { metric: 'approach_touch', session: expect.any(String), from: 'train' } });
  await act(async () => pressable(r.root, '记扣篮尝试').props.onPress());
  expect(mockRouter.push).toHaveBeenLastCalledWith('/attempts');
});
