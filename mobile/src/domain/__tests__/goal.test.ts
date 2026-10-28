import { addDays } from '../dates';
import {
  defersStrength,
  forecastLine,
  FORECAST_MIN_SPAN_DAYS,
  FORECAST_MIN_TESTS,
  FORECAST_WINDOW_DAYS,
  goalDay,
  goalSummary,
  NO_STRENGTH_DAYS,
  parseGoalDate,
  TAPER_DAYS,
  type TouchResult,
} from '../goal';

const start = '2026-10-01';
const tests = (values: number[], every = 7): TouchResult[] => values.map((value, i) => ({ date: addDays(start, i * every), value }));

describe('forecastLine', () => {
  it('extends a clean weekly trend to the dunk line', () => {
    // +1 cm a week from 314: 320 is 6 weeks after the first test.
    const f = forecastLine(tests([314, 315, 316, 317]), 320, addDays(start, 21));
    expect(f).toEqual({ kind: 'date', date: addDays(start, 42), earliest: addDays(start, 42), latest: addDays(start, 42), cmPerWeek: 1 });
  });

  it('gives the range the slope’s 95% interval allows, open-ended when it could be flat', () => {
    // x̄ = 10.5 d, ȳ = 315.5, Sxx = 245, Sxy = 28 → b = 0.1143 cm/day (0.8 cm/week), SSE = 1.8, se(b) = √(0.9 / 245) = 0.0606.
    // t(2) = 4.303: b ± 0.261 → 0.375 at best, below zero at worst. Crossing = x̄ + (320 − ȳ) / b.
    const f = forecastLine(tests([314, 316, 315, 317]), 320, addDays(start, 21));
    expect(f).toEqual({ kind: 'date', date: addDays(start, 50), earliest: addDays(start, 23), latest: null, cmPerWeek: 0.8 });
  });

  it('only reads the last 6 weeks', () => {
    const old = tests([300, 300, 300, 300], 1); // a month before the window
    const recent = tests([314, 315, 316, 317]).map((r) => ({ ...r, date: addDays(r.date, 60) }));
    const f = forecastLine([...old, ...recent], 320, addDays(start, 81));
    expect(f).toMatchObject({ kind: 'date', cmPerWeek: 1, date: addDays(start, 102) });
    expect(FORECAST_WINDOW_DAYS).toBe(42);
  });

  it('does not forecast from fewer than 4 tests or less than 2 weeks', () => {
    expect(FORECAST_MIN_TESTS).toBe(4);
    expect(FORECAST_MIN_SPAN_DAYS).toBe(14);
    expect(forecastLine(tests([314, 315, 316]), 320, addDays(start, 14))).toEqual({ kind: 'few', tests: 3 });
    expect(forecastLine(tests([314, 315, 316, 317], 3), 320, addDays(start, 9))).toEqual({ kind: 'few', tests: 4 });
  });

  it('says so when the trend is already at the line or not going up', () => {
    expect(forecastLine(tests([318, 319, 320, 321]), 320, addDays(start, 21))).toEqual({ kind: 'reached' });
    expect(forecastLine(tests([317, 316, 317, 316]), 320, addDays(start, 21))).toEqual({ kind: 'flat', cmPerWeek: -0.2 });
  });

  it('never puts the earliest day before today', () => {
    // Fast and noisy: the steepest slope in range would have crossed already.
    const f = forecastLine(tests([310, 318, 312, 319]), 320, addDays(start, 21));
    expect(f.kind).toBe('date');
    if (f.kind === 'date') expect(f.earliest >= addDays(start, 21)).toBe(true);
  });
});

describe('goalDay', () => {
  const goal = '2026-12-01';
  it('is the dunk test on the goal day and the taper in the 10 days before it', () => {
    expect(TAPER_DAYS).toBe(10);
    expect(goalDay(goal, goal)).toBe('test');
    expect(goalDay(goal, '2026-11-30')).toBe('taper');
    expect(goalDay(goal, '2026-11-21')).toBe('taper');
    expect(goalDay(goal, '2026-11-20')).toBeNull();
    expect(goalDay(goal, '2026-12-02')).toBeNull();
    expect(goalDay(null, goal)).toBeNull();
  });
});

describe('defersStrength', () => {
  const goal = '2026-12-01';
  it('puts off a strength block that would start less than 6 weeks before the goal', () => {
    expect(NO_STRENGTH_DAYS).toBe(42);
    expect(defersStrength('strength', '2026-10-21', goal)).toBe(true); // 6 weeks minus a day
    expect(defersStrength('strength', '2026-10-20', goal)).toBe(false); // a full 6 weeks
    expect(defersStrength('reactive', '2026-11-02', goal)).toBe(false);
    expect(defersStrength('strength', '2026-12-07', goal)).toBe(false); // after the goal, train strength again
    expect(defersStrength('strength', '2026-11-02', null)).toBe(false);
  });
});

describe('parseGoalDate', () => {
  it('takes a calendar date, or nothing to clear it', () => {
    expect(parseGoalDate('2026-12-01')).toEqual({ ok: true, date: '2026-12-01' });
    expect(parseGoalDate(' 2026-12-1 ')).toEqual({ ok: true, date: '2026-12-01' });
    expect(parseGoalDate('')).toEqual({ ok: true, date: null });
  });

  it('refuses what is not a date', () => {
    expect(parseGoalDate('12月1日')).toEqual({ ok: false, problem: '日期写成 2026-12-01 这样' });
    expect(parseGoalDate('2026-02-30')).toEqual({ ok: false, problem: '日期写成 2026-12-01 这样' });
  });
});

describe('goalSummary', () => {
  const today = '2026-10-28';
  const base = { goalDate: '2026-12-01', today, forecast: { kind: 'few', tests: 2 } as const, strengthLimited: false };

  it('counts down to the goal and says why there is no forecast yet', () => {
    expect(goalSummary(base)).toEqual({ title: '目标日 12/1 周二 · 还有 34 天', lines: ['近 6 周测满 4 次摸高、跨 2 周以上才能预测哪天过线（现在 2 次）'] });
  });

  it('gives the forecast day with its range, and how it sits against the goal', () => {
    const f = { kind: 'date', date: '2026-12-08', earliest: '2026-11-20', latest: null, cmPerWeek: 0.8 } as const;
    expect(goalSummary({ ...base, forecast: f }).lines).toEqual(['预计 12/8 周二 过线，比目标日晚 7 天（最早 11/20 周五，最晚说不准）']);
    const early = { kind: 'date', date: '2026-11-25', earliest: '2026-11-20', latest: '2026-11-30', cmPerWeek: 1 } as const;
    expect(goalSummary({ ...base, forecast: early }).lines).toEqual(['预计 11/25 周三 过线（最早 11/20 周五，最晚 11/30 周一）']);
    expect(goalSummary({ ...base, forecast: { kind: 'reached' } }).lines).toEqual(['按近 6 周的趋势，已经摸到扣篮线']);
    expect(goalSummary({ ...base, forecast: { kind: 'flat', cmPerWeek: -0.2 } }).lines).toEqual(['近 6 周摸高没有往上走（每周 -0.2 cm），按这个趋势预测不出过线日']);
  });

  it('says strength waits until after the goal, and when the taper and the test day come', () => {
    expect(goalSummary({ ...base, strengthLimited: true }).lines).toContain('力量还是短板，目标日后再练');
    expect(goalSummary({ ...base, today: '2026-10-01', strengthLimited: true }).lines).not.toContain('力量还是短板，目标日后再练');
    expect(goalSummary({ ...base, today: '2026-11-25' }).lines).toContain('赛前减量：训练量减半，强度不变');
    expect(goalSummary({ ...base, today: '2026-12-01' }).title).toBe('今天是扣篮测试日');
    expect(goalSummary({ ...base, today: '2026-12-05' }).title).toBe('目标日 12/1 周二 已过 4 天');
  });

  it('asks for a goal date when there is none', () => {
    expect(goalSummary({ ...base, goalDate: null })).toEqual({ title: '设一个扣篮目标日', lines: ['计划会按它倒推：最后 10 天减量，当天测摸高、试扣'] });
  });
});
