// Pre-workout CMJ as a 3-jump mean and trackload-style session load, end to end against an in-memory database.
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { Alert, Text, TextInput } from 'react-native';

import { migrate } from '@/db/migrations';
import { addTrial, ensureSession, getAthlete, type Athlete } from '@/db/repo';
import { openMemoryDb } from '@/db/testing/memoryDb';
import { getWorkout, startPlan } from '@/db/training';

import Train from '../(tabs)/train';
import WorkoutScreen from '../workout/[date]';

const mockDb = openMemoryDb();
const mockRouter = { push: jest.fn(), back: jest.fn(), replace: jest.fn() };
let mockParams: Record<string, string> = {};
const mockAthlete: { current: Athlete | null } = { current: null };

jest.mock('expo-sqlite', () => ({ useSQLiteContext: () => mockDb }));
jest.mock('@/state/athlete', () => ({ useAthlete: () => mockAthlete }));
jest.mock('expo-haptics', () => ({ selectionAsync: jest.fn() }));
jest.mock('react-native-safe-area-context', () => jest.requireActual('react-native-safe-area-context/jest/mock').default);
jest.mock('expo-router', () => {
  const React = jest.requireActual('react');
  return {
    get router() {
      return mockRouter;
    },
    useLocalSearchParams: () => mockParams,
    useFocusEffect: (cb: () => void) => React.useEffect(cb, [cb]),
    Stack: { Screen: () => null },
  };
});

// Monday 2026-11-02.
jest.useFakeTimers({
  now: new Date(2026, 10, 2, 17),
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

async function cmj(day: number, values: number[]) {
  const id = `cmj-${day}`;
  await ensureSession(mockDb, id, 1, 'cmj');
  await mockDb.runAsync('UPDATE test_session SET started_at = ? WHERE id = ?', new Date(2026, 10, day, 16).toISOString(), id);
  for (const value of values) await addTrial(mockDb, { session_id: id, value });
}

beforeAll(async () => {
  await migrate(mockDb);
  mockAthlete.current = await getAthlete(mockDb, 1);
  await startPlan(mockDb, 1, { templateCode: 'jump-4-1', startDate: '2026-11-02', weekdays: [1, 3, 5] });
  // Three days averaging 42 cm.
  for (const day of [-1, 0, 1]) await cmj(day, [41, 42, 43]);
});

it('reads today’s CMJ as the mean of 3 jumps, so one good jump does not hide fatigue', async () => {
  // Best 44 is above the usual 42, but the mean 39.3 is 6% below it (Claudino 2017).
  await cmj(2, [44, 37, 37]);
  const r = await render(<Train />);
  const t = texts(r.root);
  expect(t).toContain('今日 CMJ 均值');
  expect(t).toContain('39.3');
  expect(t).toContain('疲劳信号');
  // CMJ attempts are jumps too; nothing has been given an RPE yet.
  expect(t).toContain('跳跃负荷：记满 28 天后，再和你习惯的负荷比');
  expect(t).not.toContain('整体负荷');
});

it('asks for the session RPE and minutes after training and keeps the load', async () => {
  const train = await render(<Train />);
  await act(async () => pressable(train.root, '开始训练').props.onPress());
  mockParams = { date: '2026-11-02' };
  const r = await render(<WorkoutScreen />);
  jest.spyOn(Alert, 'alert').mockImplementation((_t, _m, buttons) => buttons?.find((b) => b.text === '结束')?.onPress?.());
  await act(async () => pressable(r.root, '完成训练').props.onPress());
  await act(async () => {});

  const minutes = r.root.find((n) => n.type === TextInput && n.props.accessibilityLabel === '训练时长（分钟）');
  await act(async () => minutes.props.onChangeText('60'));
  await act(async () => minutes.props.onEndEditing());
  await act(async () => pressable(r.root, '整节课多累（RPE） 7 分').props.onPress());
  await act(async () => {});
  const plan = await mockDb.getFirstAsync<{ id: number }>('SELECT id FROM plan');
  expect(await getWorkout(mockDb, plan!.id, '2026-11-02')).toMatchObject({ sessionRpe: 7, durationMin: 60 });
  expect(texts(r.root)).toContain('这节负荷 420（RPE × 分钟）');
});
