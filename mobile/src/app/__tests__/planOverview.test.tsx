// Drives the plan overview against an in-memory database: the weeks of a block plan, then ending the plan.
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { Alert, Text, type AlertButton } from 'react-native';

import { migrate } from '@/db/migrations';
import { openMemoryDb } from '@/db/testing/memoryDb';
import { getActivePlan, startPlan } from '@/db/training';
import { toISODate } from '@/domain/dates';
import { BLOCK_PLAN_CODE } from '@/domain/templates';

import PlanOverview from '../plan/index';

const mockDb = openMemoryDb();
const mockRouter = { push: jest.fn(), back: jest.fn(), replace: jest.fn() };
jest.mock('expo-sqlite', () => ({ useSQLiteContext: () => mockDb }));
const mockAthlete = { current: { id: 1, name: '我自己' } };
jest.mock('@/state/athlete', () => ({ useAthlete: () => mockAthlete }));
jest.mock('react-native-safe-area-context', () => jest.requireActual('react-native-safe-area-context/jest/mock').default);
jest.mock('expo-router', () => {
  const React = jest.requireActual('react');
  return {
    get router() {
      return mockRouter;
    },
    useFocusEffect: (cb: () => void) => React.useEffect(cb, [cb]),
  };
});

// A fixed Monday, so the plan's first week is this week. Only Date is faked.
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

async function render(): Promise<ReactTestRenderer> {
  let r!: ReactTestRenderer;
  await act(async () => {
    r = create(<PlanOverview />);
  });
  await act(async () => {});
  return r;
}

beforeAll(async () => {
  await migrate(mockDb);
});

it('says so when there is no plan', async () => {
  const r = await render();
  expect(texts(r.root)).toContain('还没有训练计划');
});

it('lists a block plan week by week and ends it after confirming', async () => {
  await startPlan(mockDb, 1, { templateCode: BLOCK_PLAN_CODE, startDate: today, weekdays: [1, 3, 5], blocks: [{ start: today, type: 'reactive' }] });
  const r = await render();
  const t = texts(r.root);
  expect(t).toContain('第 1 周 · 反应块 1/4');
  expect(t).toContain('第 4 周 · 反应块 4/4 · 减量复测');
  expect(t).toContain('R1 · 跳深');

  const alert = jest.spyOn(Alert, 'alert').mockImplementation((_t, _m, buttons?: AlertButton[]) => {
    buttons?.find((b) => b.style === 'destructive')?.onPress?.();
  });
  await act(async () => pressable(r.root, '结束计划').props.onPress());
  await act(async () => {});
  expect(alert).toHaveBeenCalled();
  expect(await getActivePlan(mockDb, 1)).toBeNull();
  expect(mockRouter.back).toHaveBeenCalled();
});
