// Knee pain end to end against an in-memory database: finish a jump session and score the knee, answer the next
// morning on the home screen, then the next session comes with fewer jumps.
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { Alert, Text } from 'react-native';

import { migrate } from '@/db/migrations';
import { listPain } from '@/db/pain';
import { addTrial, ensureSession, getAthlete, type Athlete } from '@/db/repo';
import { openMemoryDb } from '@/db/testing/memoryDb';
import { getWorkout, startPlan } from '@/db/training';
import { BLOCK_PLAN_CODE } from '@/domain/templates';
import { beginWorkout, loadTraining } from '@/state/training';

import Home from '../(tabs)/index';
import Train from '../(tabs)/train';
import WorkoutScreen from '../workout/[date]';

const mockDb = openMemoryDb();
const mockRouter = { push: jest.fn(), back: jest.fn(), replace: jest.fn(), navigate: jest.fn() };
let mockParams: Record<string, string> = {};
const mockAthlete: { current: Athlete | null } = { current: null };

jest.mock('expo-sqlite', () => ({ useSQLiteContext: () => mockDb }));
jest.mock('@/state/athlete', () => ({ useAthlete: () => mockAthlete }));
jest.mock('expo-haptics', () => ({ selectionAsync: jest.fn(), notificationAsync: jest.fn(), NotificationFeedbackType: { Success: 'success' } }));
jest.mock('react-native-safe-area-context', () => jest.requireActual('react-native-safe-area-context/jest/mock').default);
jest.mock('expo-router', () => {
  const React = jest.requireActual('react');
  return {
    get router() {
      return mockRouter;
    },
    Link: ({ children }: { children: React.ReactNode }) => children,
    useLocalSearchParams: () => mockParams,
    useFocusEffect: (cb: () => void) => React.useEffect(cb, [cb]),
    Stack: { Screen: () => null },
  };
});

// Monday 2026-11-02, a reactive block on Monday / Wednesday / Friday.
jest.useFakeTimers({
  now: new Date(2026, 10, 2, 18),
  doNotFake: ['nextTick', 'setImmediate', 'clearImmediate', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'queueMicrotask', 'hrtime', 'performance', 'requestAnimationFrame', 'cancelAnimationFrame', 'requestIdleCallback', 'cancelIdleCallback'],
});

function texts(root: ReactTestInstance): string {
  return root
    .findAllByType(Text)
    .map((t) => [t.props.children].flat(Infinity).filter((c) => typeof c === 'string' || typeof c === 'number').join(''))
    .join('\n');
}

const byLabel = (root: ReactTestInstance, label: string) => root.find((n) => typeof n.props.onPress === 'function' && n.props.accessibilityLabel === label);

async function render(el: React.ReactElement): Promise<ReactTestRenderer> {
  let r!: ReactTestRenderer;
  await act(async () => {
    r = create(el);
  });
  await act(async () => {});
  return r;
}

beforeAll(async () => {
  await migrate(mockDb);
  mockAthlete.current = await getAthlete(mockDb, 1);
  await startPlan(mockDb, 1, { templateCode: BLOCK_PLAN_CODE, startDate: '2026-11-02', weekdays: [1, 3, 5], blocks: [{ start: '2026-11-02', type: 'reactive' }] });
});

it('counts the day’s jumps after training and asks how the knee was', async () => {
  // Three approach-touch attempts before training count too.
  await ensureSession(mockDb, 'touch', 1, 'approach_touch');
  for (const v of [310, 312, 314]) await addTrial(mockDb, { session_id: 'touch', value: v });
  await beginWorkout(mockDb, (await loadTraining(mockDb, 1))!, '2026-11-02');
  mockParams = { date: '2026-11-02' };
  const r = await render(<WorkoutScreen />);
  // Two sets of pogo jumps (15 each) ticked off.
  const pogo = r.root.findAll((n) => n.props.accessibilityRole === 'checkbox' && typeof n.props.onPress === 'function' && n.props.accessibilityLabel?.startsWith('Pogo 跳'));
  for (const c of pogo.slice(0, 2)) await act(async () => c.props.onPress());
  jest.spyOn(Alert, 'alert').mockImplementation((_t, _m, buttons) => buttons?.find((b) => b.text === '结束')?.onPress?.());
  await act(async () => r.root.find((n) => typeof n.props.onPress === 'function' && n.findAllByType(Text).some((t) => t.props.children === '完成训练')).props.onPress());
  await act(async () => {});

  expect(texts(r.root)).toContain('今天跳了 33 次（NSCA 每节参考：初级 80–100，中级 100–120，高级 120–140）');
  await act(async () => byLabel(r.root, '训练中膝盖最疼几分 6 分').props.onPress());
  expect(await listPain(mockDb, 1)).toEqual([{ date: '2026-11-02', kind: 'session', score: 6 }]);
});

it('asks about the knee the next morning on the home screen', async () => {
  jest.setSystemTime(new Date(2026, 10, 3, 8));
  const r = await render(<Home />);
  expect(texts(r.root)).toContain('今早膝盖几分');
  await act(async () => byLabel(r.root, '今早膝盖几分 1 分').props.onPress());
  await act(async () => {});
  expect(texts(r.root)).toContain('训练中膝盖 6 分，超过 5 分：这次跳跃减半，不做跳深');
});

it('halves the next session’s jumps and says why', async () => {
  jest.setSystemTime(new Date(2026, 10, 4, 17)); // Wednesday
  const r = await render(<Train />);
  const t = texts(r.root);
  expect(t).toContain('膝盖疼，已减跳跃');
  expect(t).toContain('连续跨栏跳：4 组 → 2 组');

  await act(async () => r.root.find((n) => typeof n.props.onPress === 'function' && n.findAllByType(Text).some((x) => x.props.children === '开始训练')).props.onPress());
  const plan = await mockDb.getFirstAsync<{ id: number }>('SELECT id FROM plan');
  const workout = await getWorkout(mockDb, plan!.id, '2026-11-04');
  expect(workout?.adjustments.filter((a) => a.cause === 'knee').length).toBeGreaterThan(0);
  expect(workout?.reason).toContain('训练中膝盖 6 分');
});
