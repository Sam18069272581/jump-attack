// A block plan against a real (in-memory) database: retest week → switch suggestion → next block; and a new plan
// that starts with the block the diagnosis calls for.
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { Alert, Text } from 'react-native';

import { addDropJump } from '@/db/jumps';
import { migrate } from '@/db/migrations';
import { getAthlete, updateAthlete, type Athlete } from '@/db/repo';
import { openMemoryDb } from '@/db/testing/memoryDb';
import { getActivePlan, logSet, startPlan, startWorkout } from '@/db/training';
import { toISODate } from '@/domain/dates';
import { blockOn } from '@/domain/plan';
import { BLOCK_PLAN_CODE } from '@/domain/templates';

import Train from '../(tabs)/train';
import NewPlan from '../plan/new';

const mockDb = openMemoryDb();
const mockRouter = { push: jest.fn(), back: jest.fn(), replace: jest.fn() };
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
    useLocalSearchParams: () => ({}),
    useFocusEffect: (cb: () => void) => React.useEffect(cb, [cb]),
    Stack: { Screen: () => null },
  };
});

// Monday 2026-10-19: week 4 of a reactive block that began on 2026-09-28.
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

beforeAll(async () => {
  await migrate(mockDb);
  await updateAthlete(mockDb, { ...(await getAthlete(mockDb, 1))!, body_mass_kg: 80, standing_reach_cm: 240 });
  mockAthlete.current = await getAthlete(mockDb, 1);
  const planId = await startPlan(mockDb, 1, {
    templateCode: BLOCK_PLAN_CODE,
    startDate: '2026-09-28',
    weekdays: [1, 3, 5],
    blocks: [{ start: '2026-09-28', type: 'reactive', reason: '跳深 RSI 1.60，不到 2.0：练反应。' }],
  });
  // Squats logged in the block give a 1RM well over 1.5× body mass, twice; the retest drop jumps pass 2.0 twice.
  for (const date of ['2026-10-05', '2026-10-12']) {
    const w = await startWorkout(mockDb, { planId, date, sessionCode: 'R1', readiness: 'unknown', cmjDrop: null, adjustments: [] });
    await logSet(mockDb, w.id, { exercise_code: 'back_squat', set_no: 1, reps: 3, load_kg: 130, rpe: 9 });
  }
  for (const [i, rsi] of [2.1, 2.2].entries()) await addDropJump(mockDb, 1, `dj-${i}`, { boxCm: 40, rsi, contactMs: 200, heightCm: 40, flightS: 0.57 });
});

it('shows the block, its reason and the retest in week 4', async () => {
  const r = await render(<Train />);
  const t = texts(r.root);
  expect(t).toContain('反应块 · 第 4/4 周 · 减量复测周');
  expect(t).toContain('跳深 RSI 1.60，不到 2.0：练反应。');
  expect(t).toContain('本周复测');
  expect(t).toContain('测 DJ 跳深');
  expect(t).toContain('测 助跑摸高');
  expect(t).toContain('建议下一块换成转化块');
});

it('switches block only when accepted, from the Monday after the retest week', async () => {
  const r = await render(<Train />);
  await act(async () => pressable(r.root, '换块').props.onPress());
  await act(async () => {});
  const plan = (await getActivePlan(mockDb, 1))!;
  expect(blockOn(plan, today)).toBe('reactive');
  expect(blockOn(plan, '2026-10-26')).toBe('transfer');
  expect(plan.blocks![1].reason).toContain('两项都过线');
  expect(texts(r.root)).not.toContain('建议下一块换成');
});

it('starts a new block plan with the block the diagnosis calls for', async () => {
  const r = await render(<NewPlan />);
  const t = texts(r.root);
  expect(t).toContain('扣篮 · 4 周训练块');
  expect(t).toContain('转化块（诊断）');
  expect(t).toContain('两项都过线');

  jest.spyOn(Alert, 'alert').mockImplementation((_t, _m, buttons) => buttons?.find((b) => b.text === '更换')?.onPress?.());
  await act(async () => pressable(r.root, '开始这个计划').props.onPress());
  await act(async () => {});
  const plan = (await getActivePlan(mockDb, 1))!;
  expect(plan.templateCode).toBe(BLOCK_PLAN_CODE);
  expect(plan.blocks).toEqual([expect.objectContaining({ start: today, type: 'transfer' })]);
});
