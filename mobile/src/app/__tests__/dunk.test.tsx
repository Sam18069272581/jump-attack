// Drives the dunk diagnosis on the home and diagnosis screens, and the jump list's dunk section, against an in-memory database.
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { Text } from 'react-native';

import { addDropJump } from '@/db/jumps';
import { migrate } from '@/db/migrations';
import { addTrial, ensureSession } from '@/db/repo';
import { openMemoryDb } from '@/db/testing/memoryDb';
import { addVbtSet } from '@/db/vbt';

import Home from '../(tabs)/index';
import Dunk from '../dunk';
import JumpTests from '../jumps/index';

const mockDb = openMemoryDb();
const mockRouter = { push: jest.fn(), back: jest.fn(), navigate: jest.fn() };

jest.mock('expo-sqlite', () => ({ useSQLiteContext: () => mockDb }));
const mockAthlete: { current: Record<string, unknown> } = { current: { id: 1, name: '我自己', body_mass_kg: 75, standing_reach_cm: 240 } };
jest.mock('@/state/athlete', () => ({ useAthlete: () => mockAthlete }));
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
    Link: ({ children }: { children: React.ReactNode }) => children,
  };
});

function texts(root: ReactTestInstance): string {
  return root
    .findAllByType(Text)
    .map((t) => [t.props.children].flat(Infinity).filter((c) => typeof c === 'string' || typeof c === 'number').join(''))
    .join('\n');
}

function pressable(root: ReactTestInstance, label: string): ReactTestInstance {
  return root.find((n) => typeof n.props.onPress === 'function' && (n.props.accessibilityLabel === label || n.findAllByType(Text).some((t) => [t.props.children].flat().includes(label))));
}

async function press(root: ReactTestInstance, label: string) {
  await act(async () => pressable(root, label).props.onPress());
}

async function render(el: React.ReactElement): Promise<ReactTestRenderer> {
  let r!: ReactTestRenderer;
  await act(async () => {
    r = create(el);
  });
  await act(async () => {});
  return r;
}

async function jumps(metric: string, session: string, values: number[]) {
  await ensureSession(mockDb, session, 1, metric);
  for (const value of values) await addTrial(mockDb, { session_id: session, value });
}

beforeAll(async () => {
  await migrate(mockDb);
});

beforeEach(() => {
  for (const f of Object.values(mockRouter)) f.mockClear();
});

describe('before any test', () => {
  it('marks the run-up touch as the test to do and links to the diagnosis', async () => {
    const r = await render(<JumpTests />);
    const touchRow = pressable(r.root, '助跑摸高');
    expect(texts(touchRow)).toContain('建议测');
    expect(texts(r.root)).toContain('离扣篮还差多少、缺哪一块');
    await press(r.root, '助跑摸高');
    expect(mockRouter.push).toHaveBeenCalledWith({ pathname: '/measure/capture', params: { metric: 'approach_touch', session: expect.any(String) } });
    await press(r.root, '扣篮诊断');
    expect(mockRouter.push).toHaveBeenCalledWith('/dunk');
  });

  it('says what to measure first', async () => {
    const r = await render(<Dunk />);
    const t = texts(r.root);
    expect(t).toContain('扣篮线 320 cm');
    expect(t).toContain('还不知道离扣篮多远');
    expect(t).toContain('在 VBT 页测一次后蹲（两个以上重量），估出 1RM');
    expect(t).toContain('测一次助跑摸高');
    await press(r.root, '在 VBT 页测一次后蹲（两个以上重量），估出 1RM');
    expect(mockRouter.push).toHaveBeenCalledWith({ pathname: '/vbt/[lift]', params: { lift: 'vbt_squat', session: expect.any(String) } });
  });

  it('opens the home screen on the dunk goal, above the modules', async () => {
    const r = await render(<Home />);
    const t = texts(r.root);
    expect(t).toContain('扣篮线 320 cm');
    expect(t).toContain('测一次助跑摸高');
    expect(t.indexOf('还不知道离扣篮多远')).toBeLessThan(t.indexOf('训练和测试'));
  });
});

describe('with results', () => {
  beforeAll(async () => {
    await jumps('cmj', 'cmj-1', [44, 45]);
    await jumps('sj', 'sj-1', [40]);
    await jumps('approach_touch', 'touch-1', [290, 292]);
    // 60 kg @ 1.0 m/s and 100 kg @ 0.6 m/s: 130 kg at 0.3 m/s, 1.73× body mass.
    await addVbtSet(mockDb, 1, 'vbt-1', 'vbt_squat', { load: 60, v: 1.0, reps: 3, source: 'manual' });
    await addVbtSet(mockDb, 1, 'vbt-1', 'vbt_squat', { load: 100, v: 0.6, reps: 2, source: 'manual' });
    await addDropJump(mockDb, 1, 'dj-1', { boxCm: 30, rsi: 1.6, contactMs: 210, heightCm: 34, flightS: 0.53 });
  });

  it('shows the gap to the dunk line and the limiter with its reasons', async () => {
    const r = await render(<Dunk />);
    const t = texts(r.root);
    expect(t).toContain('还差');
    expect(t).toContain('28.0');
    expect(t).toContain('助跑摸高 292.0 cm（最近一次）');
    expect(t).toContain('反应块');
    expect(t).toContain('再测一次确认');
    expect(t).toContain('深蹲是体重的 1.73 倍，力量够了；跳深 RSI 1.60，不到 2.0：练反应。');
    expect(t).toContain('1.73×');
    expect(t).toContain('目标 ≤ 250 ms');
    await press(r.root, '跳深 RSI');
    expect(mockRouter.push).toHaveBeenCalledWith({ pathname: '/jumps/dj', params: { session: expect.any(String) } });
  });

  it('shows the same gap, limiter and metrics on the home screen, with the run-up touch one tap away', async () => {
    const r = await render(<Home />);
    const t = texts(r.root);
    expect(t).toContain('28.0');
    expect(t).toContain('反应块');
    expect(t).toContain('1.73×');
    expect(t).not.toContain('还不知道离扣篮多远');
    await press(r.root, '测助跑摸高');
    expect(mockRouter.push).toHaveBeenCalledWith({ pathname: '/measure/capture', params: { metric: 'approach_touch', session: expect.any(String) } });
  });

  it('keeps the reasons and targets folded on the home screen until asked for', async () => {
    const r = await render(<Home />);
    const reason = '深蹲是体重的 1.73 倍，力量够了；跳深 RSI 1.60，不到 2.0：练反应。';
    expect(texts(r.root)).not.toContain(reason);
    expect(texts(r.root)).not.toContain('目标 ≤ 250 ms');
    await press(r.root, '展开诊断详情');
    expect(texts(r.root)).toContain(reason);
    expect(texts(r.root)).toContain('目标 ≤ 250 ms');
    await press(r.root, '收起诊断详情');
    expect(texts(r.root)).not.toContain(reason);
  });

  it('puts the drop-jump ladder first in the jump list while reactive strength is the limiter', async () => {
    const r = await render(<JumpTests />);
    const t = texts(r.root);
    expect(t).toContain('还差 28.0 cm · 短板：反应块');
    expect(t.indexOf('DJ 跳深 · 找最佳箱高')).toBeLessThan(t.indexOf('力-速度曲线'));
    expect(texts(pressable(r.root, 'DJ 跳深 · 找最佳箱高'))).toContain('建议测');
    expect(texts(pressable(r.root, '助跑摸高'))).not.toContain('建议测');
  });
});
