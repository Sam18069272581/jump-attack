// Drives the training screens against a real (in-memory) database: plan → CMJ readiness → reduced session → logged sets → report.
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { Alert, Text } from 'react-native';

import { addDropJump } from '@/db/jumps';
import { migrate } from '@/db/migrations';
import { addTrial, ensureSession } from '@/db/repo';
import { openMemoryDb } from '@/db/testing/memoryDb';
import { getWorkout, listSets, startPlan } from '@/db/training';
import { addVbtSet } from '@/db/vbt';
import { addDays, toISODate, weekday, WEEKDAY_NAMES } from '@/domain/dates';

import Train from '../(tabs)/train';
import WorkoutScreen from '../workout/[date]';

const mockDb = openMemoryDb();
const mockRouter = { push: jest.fn(), back: jest.fn(), replace: jest.fn() };
let mockParams: Record<string, string> = {};

jest.mock('expo-sqlite', () => ({ useSQLiteContext: () => mockDb }));
const mockAthlete = { current: { id: 1, name: '我自己' } }; // stable, like the real provider's state
jest.mock('@/state/athlete', () => ({ useAthlete: () => mockAthlete }));
jest.mock('expo-haptics', () => ({ selectionAsync: jest.fn() }));
jest.mock('react-native-safe-area-context', () => jest.requireActual('react-native-safe-area-context/jest/mock').default);
jest.mock('expo-router', () => {
  const React = jest.requireActual('react');
  return {
    // Read lazily: this factory runs while the screens are imported, before mockRouter is assigned.
    get router() {
      return mockRouter;
    },
    useLocalSearchParams: () => mockParams,
    useFocusEffect: (cb: () => void) => React.useEffect(cb, [cb]),
    Stack: { Screen: () => null },
  };
});

// A fixed Monday, so the session for "today" doesn't depend on when the test runs. Only Date is faked.
jest.useFakeTimers({
  now: new Date(2026, 9, 19, 10),
  doNotFake: ['nextTick', 'setImmediate', 'clearImmediate', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'queueMicrotask', 'hrtime', 'performance', 'requestAnimationFrame', 'cancelAnimationFrame', 'requestIdleCallback', 'cancelIdleCallback'],
});
const today = toISODate(new Date());

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
  await act(async () => {}); // let focus-effect loads settle
  return r;
}

async function cmjOn(daysAgo: number, value: number) {
  const id = `cmj-${daysAgo}`;
  await ensureSession(mockDb, id, 1, 'cmj');
  await mockDb.runAsync('UPDATE test_session SET started_at = ? WHERE id = ?', new Date(Date.now() - daysAgo * 86_400_000).toISOString(), id);
  await addTrial(mockDb, { session_id: id, value, flight_ms: null, fps: 240, takeoff_frame: 0, landing_frame: 1, video_uri: null });
}

beforeAll(async () => {
  await migrate(mockDb);
  // Monday is the first training day of a 4+1 plan, so today is session A.
  await startPlan(mockDb, 1, { templateCode: 'jump-4-1', startDate: today, weekdays: [1, 3, 5] });
  for (const [d, v] of [[3, 40], [2, 41], [1, 40.5]] as const) await cmjOn(d, v);
});

it('shows a training tab with no fatigue before CMJ is tested', async () => {
  const r = await render(<Train />);
  const t = texts(r.root);
  expect(t).toContain('垂直弹跳 · 4+1 周期');
  expect(t).toContain('练之前测一次 CMJ');
  expect(t).toContain('A · 力量 + 跳跃');
  expect(t).toContain('4 × 5 · RPE 7.5');
});

it('cuts the session when today’s CMJ is more than 5% down, and freezes that when started', async () => {
  await cmjOn(0, 37.5);
  const r = await render(<Train />);
  const t = texts(r.root);
  expect(t).toContain('疲劳信号');
  expect(t).toContain('已按疲劳信号减量');
  expect(t).toContain('杠铃后蹲：4 组 → 3 组，RPE 7.5 → 6.5');
  expect(t).toContain('3 × 5 · RPE 6.5');

  await act(async () => pressable(r.root, '开始训练').props.onPress());
  expect(mockRouter.push).toHaveBeenCalledWith({ pathname: '/workout/[date]', params: { date: today } });
  const plan = await mockDb.getFirstAsync<{ id: number }>('SELECT id FROM plan');
  expect(await getWorkout(mockDb, plan!.id, today)).toMatchObject({ readiness: 'fatigued', sessionCode: 'A' });
});

it('logs sets with the prescribed reps and finishes with a report', async () => {
  mockParams = { date: today };
  const r = await render(<WorkoutScreen />);
  expect(texts(r.root)).toContain('杠铃后蹲');

  const checks = r.root.findAll((n) => n.props.accessibilityRole === 'checkbox' && typeof n.props.onPress === 'function');
  expect(checks.length).toBe(2 + 3 + 2 + 2); // squat jump, back squat, RDL, calf raise after the 30% cut
  await act(async () => checks[0].props.onPress());
  await act(async () => {});

  const plan = await mockDb.getFirstAsync<{ id: number }>('SELECT id FROM plan');
  const workout = (await getWorkout(mockDb, plan!.id, today))!;
  expect(await listSets(mockDb, workout.id)).toEqual([{ exercise_code: 'squat_jump', set_no: 1, reps: 5, load_kg: null, rpe: null, mean_velocity: null }]);

  jest.spyOn(Alert, 'alert').mockImplementation((_t, _m, buttons) => buttons?.find((b) => b.text === '结束')?.onPress?.());
  await act(async () => pressable(r.root, '完成训练').props.onPress());
  await act(async () => {});
  const t = texts(r.root);
  expect(t).toContain('训练完成');
  expect(t).toContain('1/9');
  expect((await getWorkout(mockDb, plan!.id, today))!.finishedAt).not.toBeNull();
});

it('shows the next session on a rest day', async () => {
  const r = await render(<Train />);
  // Tuesday is a rest day.
  const tomorrow = `周${WEEKDAY_NAMES[weekday(addDays(today, 1)) - 1]}`;
  const day = r.root.find((n) => typeof n.props.onPress === 'function' && n.props.accessibilityLabel === `${tomorrow} 休息`);
  await act(async () => day.props.onPress());
  const t = texts(r.root);
  expect(t).toContain('休息日');
  expect(t).toContain('下次：');
});

it('shows the athlete’s own box height and trap-bar load in the exercise cards', async () => {
  // Drop-jump ladder: RSI peaks at the 40 cm box.
  for (const [boxCm, rsi] of [[30, 1.6], [40, 1.9], [50, 1.7]] as const) {
    await addDropJump(mockDb, 1, 'dj-ladder', { boxCm, rsi, contactMs: 200, heightCm: 38, flightS: 0.56 });
  }
  // 60 kg @ 1.0, 80 kg @ 0.8 and 100 kg @ 0.6 m/s put the squat 1RM at 130 kg (an estimate needs three loads).
  await addVbtSet(mockDb, 1, 'vbt-1', 'vbt_squat', { load: 60, v: 1.0, reps: 3, source: 'manual' });
  await addVbtSet(mockDb, 1, 'vbt-1', 'vbt_squat', { load: 80, v: 0.8, reps: 3, source: 'manual' });
  await addVbtSet(mockDb, 1, 'vbt-1', 'vbt_squat', { load: 100, v: 0.6, reps: 2, source: 'manual' });

  // Wednesday is session B with depth jumps, Friday session C with trap-bar jumps.
  mockParams = { date: addDays(today, 2) };
  expect(texts((await render(<WorkoutScreen />)).root)).toContain('你的最佳箱高 40 cm');
  mockParams = { date: addDays(today, 4) };
  expect(texts((await render(<WorkoutScreen />)).root)).toContain('建议 25–40 kg（后蹲 1RM 130 kg 的 20–30%）');
});

it('opens an exercise’s demo from its card', async () => {
  mockParams = { date: addDays(today, 2) };
  const r = await render(<WorkoutScreen />);
  await act(async () => r.root.find((n) => typeof n.props.onPress === 'function' && n.props.accessibilityLabel === '跌落跳怎么做').props.onPress());
  expect(mockRouter.push).toHaveBeenCalledWith({ pathname: '/exercise/[code]', params: { code: 'depth_jump' } });
});
