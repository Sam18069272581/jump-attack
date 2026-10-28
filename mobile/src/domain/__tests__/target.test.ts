import { onPoorDay, trendBaseline } from '../assess';
import { addDays } from '../dates';
import type { RecoveryDay } from '../recovery';
import { allowanceText, checkSet, poorDays, readDay, selfSignal, setTarget, usualWarmupLoad, warmupOn, type DayInputs, type VelocitySet } from '../target';

// Sources for the numbers below:
// - Allowances good/unknown 0, fair 5 %, poor 10 %, and "strength blocks keep the load and accept a slower bar,
//   other blocks take weight off to keep the speed": section 4 of the dunk plan
//   (https://claude.ai/artifact/UJFWkuiY7Rm5oKGZ8aSP8G), confirmed by the user on 2026-10-22.
// - Warm-up traffic light: bar speed ≥ 95 % of the 30-day mean at the same load is normal, 90–95 % ease off,
//   < 90 % cut load and volume (GymAware, https://gymaware.com/autoregulation-in-strength-training/).
// - 20 % velocity loss ends a set: STOP_LOSS in domain/vbt.ts, already used on the VBT screen.

const today = '2026-10-22';
const at = (date: string) => `${date}T10:00:00`;
const set = (daysAgo: number, load: number, v: number): VelocitySet => ({ started_at: at(addDays(today, -daysAgo)), load, v });

// Four warm-ups at 60 kg in the last month, one too old to count, and a heavier set.
const history = [set(40, 60, 1.2), set(20, 60, 1.0), set(14, 60, 1.02), set(7, 60, 0.98), set(3, 60, 1.0), set(3, 80, 0.8)];

describe('warm-up', () => {
  it('compares the day’s fastest set with the same load over the last 30 days', () => {
    // 30-day mean at 60 kg = (1.0 + 1.02 + 0.98 + 1.0) / 4 = 1.00 (the 1.2 from 40 days ago is out).
    // Today's fastest 0.93 → 93 %: fair. 0.85 → 85 %: poor. 0.99 → 99 %: good.
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

  it('counts a red knee as a poor day, a yellow one not', () => {
    const base: DayInputs = { cmj: cmj(40), recovery: recovery(7.5), warmups: history };
    const red = readDay({ ...base, pain: [{ date: addDays(today, -1), kind: 'session', score: 6 }] }, today);
    expect(red.state).toBe('poor');
    expect(red.reasons).toContain('训练中膝盖 6 分，超过 5 分：这次跳跃减半，不做跳深');
    expect(readDay({ ...base, pain: [{ date: addDays(today, -1), kind: 'session', score: 4 }] }, today).state).toBe('good');
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

  it('leaves poor days out of the baseline a result is judged against', () => {
    const row = (id: string, daysAgo: number, best: number) => ({ session_id: id, started_at: at(addDays(today, -daysAgo)), best });
    const rows = [row('a', 3, 40), row('b', 2, 34), row('c', 1, 41), row('d', 0, 35)];
    const poor = new Set([addDays(today, -2), today]);
    // b (2 days ago) was a poor day: the baseline for d is a and c only. d itself is on a poor day.
    expect(trendBaseline(rows, 'd', poor)).toEqual({ previous: [40, 41], poorDay: true });
    expect(trendBaseline(rows, 'c', poor)).toEqual({ previous: [40], poorDay: false });
    expect(trendBaseline(rows, 'd')).toEqual({ previous: [40, 34, 41], poorDay: false });
    expect(onPoorDay(rows[1], poor)).toBe(true);
  });
});

describe('set targets', () => {
  // 1.5 m/s with an empty bar, 0.01 m/s slower per kg.
  const profile = { intercept: 1.5, slope: -0.01, r2: 1, n: 2 };

  // Planned 100 kg. On this profile 100 kg moves at 1.5 − 0.01 × 100 = 0.50 m/s, 90 kg at 0.60 m/s.
  it('keeps the plan on a good day', () => {
    expect(setTarget(100, profile, 'good', null)).toMatchObject({ kg: 100, loadFactor: 1, velocityTolerance: 0 });
    expect(setTarget(100, profile, 'good', null).minV).toBeCloseTo(0.5);
  });

  it('keeps the load and accepts a slower bar in a strength block', () => {
    const t = setTarget(100, profile, 'poor', 'strength');
    expect(t).toMatchObject({ kg: 100, velocityTolerance: 0.1 });
    expect(t.targetV).toBeCloseTo(0.5);
    // Poor day: 0.50 × (1 − 10 %) = 0.45 m/s still counts as done.
    expect(t.minV).toBeCloseTo(0.45);
  });

  it('takes weight off to keep the speed elsewhere', () => {
    const t = setTarget(100, profile, 'poor', null);
    expect(t).toMatchObject({ kg: 90, baseKg: 100, velocityTolerance: 0 });
    // 100 × 0.9 = 90 kg, which must still move at the 0.60 m/s the profile predicts for it.
    expect(t.minV).toBeCloseTo(0.6);
    // Fair day: 100 × 0.95 = 95 kg.
    expect(setTarget(100, profile, 'fair', 'reactive').kg).toBe(95);
  });

  it('eases only the load without a velocity profile', () => {
    expect(setTarget(100, null, 'poor', 'strength')).toMatchObject({ kg: 90, targetV: null, minV: null });
  });

  it('stops below the line or past 20 % velocity loss', () => {
    expect(checkSet(0.44, 0.45, null)).toEqual({ stop: true, why: '这组 0.44 m/s，低于今天的达标线 0.45 m/s' });
    expect(checkSet(0.46, 0.45, 0.5).stop).toBe(false);
    // (0.80 − 0.60) / 0.80 = 25 % > 20 %.
    expect(checkSet(0.6, null, 0.8)).toEqual({ stop: true, why: '比今天最快的一组（0.80 m/s）慢了 25%' });
  });

  it('explains the day’s allowance', () => {
    expect(allowanceText('good', null)).toBeNull();
    expect(allowanceText('poor', 'strength')).toBe('今天状态差：推荐重量减 10%；测了速度的组保持重量，速度低 10% 以内仍算完成。');
    expect(allowanceText('fair', null)).toBe('今天状态一般：推荐重量减 5%；测了速度的组减重 5%，速度要达到目标。');
  });
});
