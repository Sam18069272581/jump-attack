import { countedResults } from '../assess';
import { addDays } from '../dates';
import type { RecoveryDay } from '../recovery';
import { allowanceText, checkSet, poorDays, readDay, selfSignal, setTarget, usualWarmupLoad, warmupOn, type DayInputs, type VelocitySet } from '../target';

const today = '2026-10-22';
const at = (date: string) => `${date}T10:00:00`;
const set = (daysAgo: number, load: number, v: number): VelocitySet => ({ started_at: at(addDays(today, -daysAgo)), load, v });

// Four warm-ups at 60 kg in the last month, one too old to count, and a heavier set.
const history = [set(40, 60, 1.2), set(20, 60, 1.0), set(14, 60, 1.02), set(7, 60, 0.98), set(3, 60, 1.0), set(3, 80, 0.8)];

describe('warm-up', () => {
  it('compares the day’s fastest set with the same load over the last 30 days', () => {
    const w = warmupOn([...history, set(0, 60, 0.92), set(0, 60, 0.93)], today)!;
    expect(w).toMatchObject({ load: 60, v: 0.93, mean: 1, n: 4, state: 'fair' });
    expect(w.pct).toBeCloseTo(0.93);
    expect(warmupOn([...history, set(0, 60, 0.85)], today)!.state).toBe('poor');
    expect(warmupOn([...history, set(0, 60, 0.99)], today)!.state).toBe('good');
  });

  it('needs history at the same load', () => {
    expect(warmupOn(history, today)).toBeNull();
    expect(warmupOn([...history, set(0, 70, 0.9)], today)).toBeNull();
    // A single earlier set at 80 kg is too little to judge.
    expect(warmupOn([...history, set(0, 80, 0.7)], today)!.state).toBe('unknown');
  });

  it('suggests the load warmed up with most often', () => {
    expect(usualWarmupLoad(history, today)).toBe(60);
    expect(usualWarmupLoad([], today)).toBeNull();
  });
});

const recovery = (sleepToday: number | null, hrvToday = 65): RecoveryDay[] => [
  ...[1, 2, 3, 4, 5].map((i) => ({ date: addDays(today, -i), hrv: 64 + (i % 3), rhr: 52, sleep: 7.5, resp: null })),
  { date: today, hrv: hrvToday, rhr: 52, sleep: sleepToday, resp: null },
];
const cmj = (todayCm: number) => [
  ...[3, 2, 1].map((i) => ({ started_at: at(addDays(today, -i)), best: 40 })),
  { started_at: at(today), best: todayCm },
];

describe('the day’s state', () => {
  it('takes the worst of recovery, CMJ and the warm-up', () => {
    const base: DayInputs = { cmj: cmj(40), recovery: recovery(7.5), warmups: history };
    expect(readDay(base, today).state).toBe('good');

    const shortNight = { ...base, recovery: recovery(5.5) };
    expect(readDay(shortNight, today)).toMatchObject({ state: 'fair', reasons: ['睡眠只有 5.5 小时'] });

    const slowWarmup = { ...shortNight, warmups: [...history, set(0, 60, 0.85)] };
    const r = readDay(slowWarmup, today);
    expect(r.state).toBe('poor');
    expect(r.reasons).toContain('热身 60 kg 速度 0.85 m/s，是 30 天均值的 85%');
    // The squat's own trend is not judged by the warm-up.
    expect(readDay(slowWarmup, today, 'warmup').state).toBe('fair');

    expect(readDay({ ...base, cmj: cmj(36) }, today).state).toBe('poor');
    expect(readDay({ ...base, cmj: cmj(36) }, today, 'cmj').state).toBe('good');
  });

  it('lists the poor days among the given dates', () => {
    const inputs: DayInputs = { cmj: [], recovery: recovery(7.5, 40), warmups: [] };
    expect([...poorDays(inputs, [today, addDays(today, -1), today])]).toEqual([today]);
  });

  it('knows which signal belongs to which test', () => {
    expect(selfSignal('cmj', ['vbt_squat'])).toBe('cmj');
    expect(selfSignal('vbt_squat', ['vbt_squat'])).toBe('warmup');
    expect(selfSignal('sj', ['vbt_squat'])).toBeUndefined();
  });

  it('leaves poor days out of the trend', () => {
    const rows = [{ started_at: at(addDays(today, -1)), best: 40 }, { started_at: at(today), best: 35 }];
    expect(countedResults(rows, new Set([today]))).toEqual([rows[0]]);
    expect(countedResults(rows)).toBe(rows);
  });
});

describe('set targets', () => {
  // 1.5 m/s with an empty bar, 0.01 m/s slower per kg.
  const profile = { intercept: 1.5, slope: -0.01, r2: 1, n: 2 };

  it('keeps the plan on a good day', () => {
    expect(setTarget(100, profile, 'good', null)).toMatchObject({ kg: 100, loadFactor: 1, velocityTolerance: 0 });
    expect(setTarget(100, profile, 'good', null).minV).toBeCloseTo(0.5);
  });

  it('keeps the load and accepts a slower bar in a strength block', () => {
    const t = setTarget(100, profile, 'poor', 'strength');
    expect(t).toMatchObject({ kg: 100, velocityTolerance: 0.1 });
    expect(t.targetV).toBeCloseTo(0.5);
    expect(t.minV).toBeCloseTo(0.45);
  });

  it('takes weight off to keep the speed elsewhere', () => {
    const t = setTarget(100, profile, 'poor', null);
    expect(t).toMatchObject({ kg: 90, baseKg: 100, velocityTolerance: 0 });
    expect(t.minV).toBeCloseTo(0.6);
    expect(setTarget(100, profile, 'fair', 'reactive').kg).toBe(95);
  });

  it('eases only the load without a velocity profile', () => {
    expect(setTarget(100, null, 'poor', 'strength')).toMatchObject({ kg: 90, targetV: null, minV: null });
  });

  it('stops below the line or past 20 % velocity loss', () => {
    expect(checkSet(0.44, 0.45, null)).toEqual({ stop: true, why: '这组 0.44 m/s，低于今天的达标线 0.45 m/s' });
    expect(checkSet(0.46, 0.45, 0.5).stop).toBe(false);
    expect(checkSet(0.6, null, 0.8)).toEqual({ stop: true, why: '比今天最快的一组（0.80 m/s）慢了 25%' });
  });

  it('explains the day’s allowance', () => {
    expect(allowanceText('good', null)).toBeNull();
    expect(allowanceText('poor', 'strength')).toBe('今天状态差：推荐重量减 10%；测了速度的组保持重量，速度低 10% 以内仍算完成。');
    expect(allowanceText('fair', null)).toBe('今天状态一般：推荐重量减 5%；测了速度的组减重 5%，速度要达到目标。');
  });
});
