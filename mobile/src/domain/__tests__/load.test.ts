import { addDays } from '../dates';
import { acwrOn, ACWR_HIGH, ACUTE_LAMBDA, CHRONIC_LAMBDA, ewma, jumpLoads, loadNote, MIN_LOAD_DAYS, sessionLoad, workoutMinutes, type DailyLoad } from '../load';
import { BLOCK_PLAN_CODE, exerciseIn } from '../templates';

const start = '2026-10-01';
const days = (loads: number[]): DailyLoad[] => loads.map((load, i) => ({ date: addDays(start, i), load }));

describe('ewma (trackload: λ = 2 ÷ (N + 1), first day = its own load)', () => {
  it('uses 7- and 28-day constants', () => {
    expect(ACUTE_LAMBDA).toBe(0.25);
    expect(CHRONIC_LAMBDA).toBeCloseTo(0.069, 3);
  });

  it('carries each day forward: EWMA = load × λ + yesterday × (1 − λ)', () => {
    // 100, then 0.25 × 0 + 0.75 × 100 = 75, then 0.25 × 200 + 0.75 × 75 = 106.25.
    expect(ewma([100, 0, 200], ACUTE_LAMBDA)).toEqual([100, 75, 106.25]);
  });
});

describe('acwrOn', () => {
  it('needs 28 days from the first load before the chronic load means anything', () => {
    expect(MIN_LOAD_DAYS).toBe(28);
    const steady = days(Array(27).fill(100));
    expect(acwrOn(steady, addDays(start, 26))).toBeNull();
    expect(acwrOn([...steady, ...days([100]).map((d) => ({ ...d, date: addDays(start, 27) }))], addDays(start, 27))).toBeCloseTo(1, 6);
  });

  it('fills days without training with zero load', () => {
    // 100 a day for four weeks, then a week off: the acute load falls faster than the chronic.
    const loads = days(Array(28).fill(100));
    const ratio = acwrOn(loads, addDays(start, 34))!;
    expect(ratio).toBeCloseTo(0.75 ** 7 / (1 - 2 / 29) ** 7, 6);
  });

  it('adds up two sessions on one day', () => {
    const loads = [...days(Array(28).fill(100)), { date: addDays(start, 27), load: 300 }];
    // Day 28 is 400 instead of 100: acute 100 + 0.25 × 300, chronic 100 + 2/29 × 300.
    expect(acwrOn(loads, addDays(start, 27))).toBeCloseTo((100 + 0.25 * 300) / (100 + (2 / 29) * 300), 6);
  });
});

describe('sessionLoad', () => {
  it('is minutes × session RPE, in arbitrary units', () => {
    expect(sessionLoad(60, 7)).toBe(420);
    expect(sessionLoad(null, 7)).toBeNull();
  });

  it('takes the minutes from start to finish when they are believable', () => {
    expect(workoutMinutes('2026-11-02T17:00:00Z', '2026-11-02T18:05:20Z')).toBe(65);
    expect(workoutMinutes('2026-11-02T17:00:00Z', null)).toBeNull();
    // Started and ticked off the next day: not a real duration.
    expect(workoutMinutes('2026-11-02T17:00:00Z', '2026-11-03T09:00:00Z')).toBeNull();
  });
});

describe('loadNote', () => {
  it('compares this week with last until there are 28 days', () => {
    const loads = days([...Array(7).fill(100), ...Array(7).fill(150)]);
    expect(loadNote('整体负荷', loads, addDays(start, 13))).toEqual({ text: '整体负荷：最近 7 天比之前 7 天高 50%', high: false });
    expect(loadNote('整体负荷', days([300]), start)).toEqual({ text: '整体负荷：记满 28 天后，再和你习惯的负荷比', high: false });
    expect(loadNote('整体负荷', [], start)).toBeNull();
  });

  it('says how far this week is from what the athlete is used to, never “injury risk”', () => {
    expect(ACWR_HIGH).toBe(1.5);
    // A month at 100, then a week at 300.
    const loads = days([...Array(28).fill(100), ...Array(7).fill(300)]);
    const note = loadNote('跳跃负荷', loads, addDays(start, 34))!;
    const ratio = acwrOn(loads, addDays(start, 34))!;
    expect(ratio).toBeGreaterThan(ACWR_HIGH);
    expect(note).toEqual({ text: `跳跃负荷：这周比你习惯的高 ${Math.round((ratio - 1) * 100)}%`, high: true });
    expect(note.text).not.toContain('伤');
    expect(loadNote('跳跃负荷', days(Array(30).fill(100)), addDays(start, 29))).toEqual({ text: '跳跃负荷：这周和你习惯的差不多', high: false });
  });
});

describe('jumpLoads', () => {
  it('counts ticked jump sets (single-leg twice) and jump-test attempts per day', () => {
    const ex = (code: string) => exerciseIn(BLOCK_PLAN_CODE, code);
    expect(ex('single_leg_hop')).toMatchObject({ perSide: true, kind: 'reactive' });
    const sets = [
      { date: '2026-11-02', reps: 15, exercise: ex('pogo') },
      { date: '2026-11-02', reps: 5, exercise: ex('single_leg_hop') },
      { date: '2026-11-02', reps: 5, exercise: ex('back_squat') },
      { date: '2026-11-04', reps: 3, exercise: ex('approach_jump') },
      { date: '2026-11-04', reps: 3, exercise: undefined }, // no longer in any template
    ];
    expect(jumpLoads(sets, [{ date: '2026-11-02', jumps: 3 }, { date: '2026-11-03', jumps: 6 }])).toEqual([
      { date: '2026-11-02', load: 15 + 10 + 3 },
      { date: '2026-11-03', load: 6 },
      { date: '2026-11-04', load: 3 },
    ]);
  });
});
