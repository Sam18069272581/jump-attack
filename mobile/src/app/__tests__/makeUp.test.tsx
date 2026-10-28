// Drives making up a missed session on a rest day against an in-memory database: a Monday plan, nothing done on
// Monday, the training tab on Tuesday.
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { Text } from 'react-native';

import { migrate } from '@/db/migrations';
import { addTrial, ensureSession } from '@/db/repo';
import { openMemoryDb } from '@/db/testing/memoryDb';
import { getWorkout, startPlan } from '@/db/training';
import { addDays, toISODate } from '@/domain/dates';

import Train from '../(tabs)/train';
import WorkoutScreen from '../workout/[date]';

const mockDb = openMemoryDb();
const mockRouter = { push: jest.fn(), back: jest.fn(), replace: jest.fn() };
let mockParams: Record<string, string> = {};

jest.mock('expo-sqlite', () => ({ useSQLiteContext: () => mockDb }));
const mockAthlete = { current: { id: 1, name: '我自己' } };
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

// Tuesday 2026-10-20, 10:00. Only Date is faked.
jest.useFakeTimers({
  now: new Date(2026, 9, 20, 10),
  doNotFake: ['nextTick', 'setImmediate', 'clearImmediate', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'queueMicrotask', 'hrtime', 'performance', 'requestAnimationFrame', 'cancelAnimationFrame', 'requestIdleCallback', 'cancelIdleCallback'],
});
const today = toISODate(new Date());
const monday = addDays(today, -1);

function texts(root: ReactTestInstance): string {
  return root
    .findAllByType(Text)
    .map((t) => [t.props.children].flat(Infinity).filter((c) => typeof c === 'string' || typeof c === 'number').join(''))
    .join('\n');
}

function pressable(root: ReactTestInstance, label: string): ReactTestInstance {
  return root.find((n) => typeof n.props.onPress === 'function' && n.findAllByType(Text).some((t) => [t.props.children].flat().includes(label)));
}

async function render(el: React.ReactElement): Promise<ReactTestRenderer> {
  let r!: ReactTestRenderer;
  await act(async () => {
    r = create(el);
  });
  await act(async () => {});
  return r;
}

async function cmjOn(date: Date, value: number) {
  const id = `cmj-${date.toISOString()}`;
  await ensureSession(mockDb, id, 1, 'cmj');
  await mockDb.runAsync('UPDATE test_session SET started_at = ? WHERE id = ?', date.toISOString(), id);
  await addTrial(mockDb, { session_id: id, value });
}

beforeAll(async () => {
  await migrate(mockDb);
  await startPlan(mockDb, 1, { templateCode: 'jump-4-1', startDate: monday, weekdays: [1, 3, 5] });
  // A steady baseline, then today's CMJ more than 5% down: today is a fatigued day.
  for (const [d, v] of [[4, 40], [3, 41], [2, 40.5]] as const) await cmjOn(new Date(2026, 9, 20 - d, 9), v);
  await cmjOn(new Date(2026, 9, 20, 9), 37.5);
});

it('offers Monday’s missed session on Tuesday’s rest day, judged by today’s readiness', async () => {
  const r = await render(<Train />);
  const t = texts(r.root);
  expect(t).toContain('休息日');
  expect(t).toContain('周一的 A · 力量 + 跳跃 还没练');

  await act(async () => pressable(r.root, '今天补练').props.onPress());
  expect(mockRouter.push).toHaveBeenCalledWith({ pathname: '/workout/[date]', params: { date: monday } });
  const plan = await mockDb.getFirstAsync<{ id: number }>('SELECT id FROM plan');
  // Done today, so today's fatigue cuts it, as it would a session planned for today.
  expect(await getWorkout(mockDb, plan!.id, monday)).toMatchObject({ sessionCode: 'A', readiness: 'fatigued' });

  mockParams = { date: monday };
  const w = await render(<WorkoutScreen />);
  expect(texts(w.root)).toContain('今天补上这节课');
});

it('stops offering it once started', async () => {
  const t = texts((await render(<Train />)).root);
  expect(t).not.toContain('还没练');
});
