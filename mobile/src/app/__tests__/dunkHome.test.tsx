// Drives the home screen's state row, the history tab's touch chart and limiter tiles, and the approach-touch
// history against an in-memory database.
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { Text } from 'react-native';

import { migrate } from '@/db/migrations';
import { saveRecoveryDay } from '@/db/recovery';
import { addTrial, ensureSession, getAthlete, updateAthlete, type Athlete } from '@/db/repo';
import { openMemoryDb } from '@/db/testing/memoryDb';
import { addVbtSet } from '@/db/vbt';
import { addDays, toISODate } from '@/domain/dates';
import { TouchChart } from '@/components/TouchChart';

import Home from '../(tabs)/index';
import History from '../(tabs)/history';
import MetricHistory from '../history/[metric]';

const mockDb = openMemoryDb();
const mockRouter = { push: jest.fn(), back: jest.fn(), navigate: jest.fn() };
let mockParams: Record<string, string> = {};

jest.mock('expo-sqlite', () => ({ useSQLiteContext: () => mockDb }));
const mockAthlete: { current: Athlete | null } = { current: null };
jest.mock('@/state/athlete', () => ({ useAthlete: () => mockAthlete }));
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

const today = toISODate(new Date());

function texts(root: ReactTestInstance): string {
  return root
    .findAllByType(Text)
    .map((t) => [t.props.children].flat(Infinity).filter((c) => typeof c === 'string' || typeof c === 'number').join(''))
    .join('\n');
}

async function press(root: ReactTestInstance, label: string) {
  await act(async () => root.find((n) => typeof n.props.onPress === 'function' && n.props.accessibilityLabel === label).props.onPress());
}

async function render(el: React.ReactElement): Promise<ReactTestRenderer> {
  let r!: ReactTestRenderer;
  await act(async () => {
    r = create(el);
  });
  await act(async () => {});
  return r;
}

async function result(metric: string, session: string, values: number[], at?: string) {
  await ensureSession(mockDb, session, 1, metric);
  if (at) await mockDb.runAsync('UPDATE test_session SET started_at = ? WHERE id = ?', at, session);
  for (const value of values) await addTrial(mockDb, { session_id: session, value });
}

async function setAthlete(changes: Partial<Athlete>) {
  await updateAthlete(mockDb, { ...(await getAthlete(mockDb, 1))!, ...changes });
  mockAthlete.current = await getAthlete(mockDb, 1);
}

beforeAll(async () => {
  await migrate(mockDb);
  mockAthlete.current = await getAthlete(mockDb, 1);
});

beforeEach(() => {
  for (const f of Object.values(mockRouter)) f.mockClear();
});

describe('before any test', () => {
  it('asks for a CMJ or recovery data to judge today, at the top of the training modules', async () => {
    const r = await render(<Home />);
    const t = texts(r.root);
    expect(t).toContain('训练和测试\n测一次 CMJ 或记录恢复数据，判断今天的状态');
  });

  it('folds mobility and conditioning under 辅助, since they add little to the jump itself', async () => {
    const r = await render(<Home />);
    const shown = (name: string) => r.root.findAll((n) => n.props.accessibilityLabel === name).length > 0;
    for (const name of ['跳跃测试', '速度训练', 'VBT 训练', '恢复', '辅助']) expect(shown(name)).toBe(true);
    expect(shown('灵活度')).toBe(false);
    expect(shown('体能耐力')).toBe(false);

    await press(r.root, '辅助');
    expect(shown('灵活度')).toBe(true);
    expect(shown('体能耐力')).toBe(true);
  });

  it('keeps the history tab empty but tells how to get a touch curve', async () => {
    const r = await render(<History />);
    const t = texts(r.root);
    expect(t).toContain('还没有记录');
    expect(t).toContain('在「我的」填站立摸高，摸高曲线就会出现在这里。');
  });
});

describe('with results', () => {
  beforeAll(async () => {
    await setAthlete({ body_mass_kg: 80, standing_reach_cm: 240 });
    await result('cmj', 'cmj-1', [43], '2026-09-01T10:00:00.000Z');
    await result('cmj', 'cmj-2', [45], '2026-09-15T10:00:00.000Z');
    await result('approach_touch', 'touch-1', [288, 292], '2026-09-15T10:30:00.000Z');
    // 60 kg @ 1.0 m/s and 100 kg @ 0.6 m/s put the 1RM at 130 kg: 1.63× body mass.
    await addVbtSet(mockDb, 1, 'vbt-1', 'vbt_squat', { load: 60, v: 1.0, reps: 3, source: 'manual' });
    await addVbtSet(mockDb, 1, 'vbt-1', 'vbt_squat', { load: 100, v: 0.6, reps: 2, source: 'manual' });
    await result('sprint_10', 'sp-1', [1.82], '2026-09-01T11:00:00.000Z');
    await result('sprint_10', 'sp-2', [1.78], '2026-09-15T11:00:00.000Z');
    await ensureSession(mockDb, 'dj-1', 1, 'dj_rsi');
    await addTrial(mockDb, { session_id: 'dj-1', value: 1.6, detail: { box_cm: 40, contact_ms: 230, height_cm: 30 } });
  });

  it('says how far a poor day relaxes the strength targets, and opens today’s training', async () => {
    // HRV well under a steady week: a poor day.
    for (let i = 5; i >= 1; i--) await saveRecoveryDay(mockDb, 1, { date: addDays(today, -i), hrv: 65, rhr: 52, sleep: 7.5, resp: null });
    await saveRecoveryDay(mockDb, 1, { date: today, hrv: 45, rhr: 52, sleep: 7.5, resp: null });

    const r = await render(<Home />);
    expect(texts(r.root)).toContain('今天状态差 · 力量达标线放宽 10%');
    await press(r.root, '今日状态');
    expect(mockRouter.push).toHaveBeenCalledWith('/train');
  });

  it('leads the history tab with touch height and the three limiter tiles', async () => {
    const r = await render(<History />);
    const t = texts(r.root);
    expect(t).toContain('离扣篮线还差 28.0 cm');
    expect(r.root.findByProps({ accessibilityRole: 'image' }).props.accessibilityLabel).toBe('摸高趋势，助跑实测 1 次，原地估算 2 次，扣篮线 320 cm');
    expect(t).toContain('1.63×');
    expect(t).toContain('深蹲 ÷ 体重 · 目标 2.0×');
    expect(t).toContain('跳深 RSI · 目标 2.0');
    expect(t).toContain('1.78 s');
    expect(t).toContain('10 m 冲刺 · −0.04 s');
    // Every other metric is still listed below.
    expect(t).toContain('CMJ 反向跳');

    await press(r.root, '摸高历史');
    expect(mockRouter.push).toHaveBeenLastCalledWith({ pathname: '/history/[metric]', params: { metric: 'approach_touch' } });
    await press(r.root, '反应');
    expect(mockRouter.push).toHaveBeenLastCalledWith({ pathname: '/history/[metric]', params: { metric: 'dj_rsi' } });
  });

  it('draws the dunk line on the approach-touch history, at the athlete’s own rim and clearance', async () => {
    await setAthlete({ dunk_clearance_cm: 20 });
    mockParams = { metric: 'approach_touch' };
    const r = await render(<MetricHistory />);
    expect(texts(r.root)).toContain('离扣篮线 325 cm 还差 33.0 cm');
    expect(texts(r.root)).toContain('扣篮线 325');
  });
});

describe('after a wall-reading calibration', () => {
  it('moves the standing estimates onto the wall scale', async () => {
    // Filmed touch: 240 reach + 50 cm flight-time jump = 290 from video, the wall read 300, so the offset is 10 cm.
    await ensureSession(mockDb, 'touch-2', 1, 'approach_touch');
    await mockDb.runAsync('UPDATE test_session SET started_at = ? WHERE id = ?', '2026-09-20T10:00:00.000Z', 'touch-2');
    await addTrial(mockDb, { session_id: 'touch-2', value: 300, detail: { source: 'video', jump_cm: 50, standing_reach_cm: 240, touched_cm: 300 } });

    const r = await render(<History />);
    // CMJ 43 and 45: 240 + 43 + 10 and 240 + 45 + 10.
    expect(r.root.findByType(TouchChart).props.standing.map((p: { value: number }) => p.value)).toEqual([293, 295]);
  });
});

describe('a sprint timed another way', () => {
  it('shows the new time on the speed tile without a change against the filmed ones', async () => {
    await ensureSession(mockDb, 'sp-hand', 1, 'sprint_10');
    await mockDb.runAsync('UPDATE test_session SET started_at = ? WHERE id = ?', '2026-09-25T11:00:00.000Z', 'sp-hand');
    await addTrial(mockDb, { session_id: 'sp-hand', value: 1.6, detail: { source: 'manual', timing: 'stopwatch' } });

    const t = texts((await render(<History />)).root);
    expect(t).toContain('1.60 s');
    expect(t).not.toContain('10 m 冲刺 · −0.18 s');
    expect(t).toContain('10 m 冲刺 · 秒表计时');
  });
});
