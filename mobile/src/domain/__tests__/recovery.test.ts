import { addDays } from '../dates';
import { dayReadiness, fatigueStreak } from '../readiness';
import { baseline, hrvBaseline, readRecovery, type RecoveryDay } from '../recovery';

const day = (date: string, v: Partial<RecoveryDay>): RecoveryDay => ({ date, hrv: null, rhr: null, sleep: null, resp: null, ...v });
const TODAY = '2026-10-20';
// A steady week: HRV 60–70, resting HR ~52.
const week = [62, 66, 70, 64, 68, 60, 65].map((hrv, i) => day(addDays(TODAY, i - 7), { hrv, rhr: 52 + (i % 2), sleep: 7.5 }));

describe('baseline', () => {
  it('is the previous 7 days, and needs at least 3', () => {
    const b = baseline(week, 'hrv', TODAY)!;
    expect(b.n).toBe(7);
    expect(b.mean).toBeCloseTo(65);
    expect(b.low).toBeLessThan(62);
    expect(baseline(week.slice(-2), 'hrv', TODAY)).toBeNull();
  });
});

// Three steady weeks of HRV up to the day before yesterday, for the 30-day baseline.
const threeWeeks = [...[62, 66, 70, 64, 68, 60, 65], ...[62, 66, 70, 64, 68, 60, 65], ...[62, 66, 70, 64, 68, 60, 65]].map((hrv, i) =>
  day(addDays(TODAY, i - 22), { hrv, rhr: 52, sleep: 7.5 }),
);

describe('hrvBaseline', () => {
  it('is the log-mean ± 1 SD of up to 30 days before, shown in ms', () => {
    // ln of the week: mean 4.1732, SD 0.0526 → e^4.1732 = 64.9 ms, e^(4.1732 ∓ 0.0526) = 61.6–68.4 ms.
    const b = hrvBaseline(week, TODAY)!;
    expect(b.n).toBe(7);
    expect(b.mean).toBeCloseTo(64.92, 1);
    expect(b.low).toBeCloseTo(61.59, 1);
    expect(b.high).toBeCloseTo(68.43, 1);
    // A reading 31 days back is left out, one 30 days back counts.
    expect(hrvBaseline([day(addDays(TODAY, -31), { hrv: 20 }), ...week], TODAY)!.n).toBe(7);
    expect(hrvBaseline([day(addDays(TODAY, -30), { hrv: 20 }), ...week], TODAY)!.n).toBe(8);
    expect(hrvBaseline(week.slice(-2), TODAY)).toBeNull();
  });
});

describe('HRV over days, not one day (Plews 2012, 2013)', () => {
  it('only takes a single low reading as a soft sign', () => {
    // Baseline ln mean 4.1732, SD 0.0499. 57 ms: ln 4.0431 is under 4.1732 − 0.0499, but the 7-day log-mean 4.1564 stays
    // above the smallest worthwhile change, 4.1732 − 0.5 × 0.0499 = 4.1482.
    const r = readRecovery([...threeWeeks, day(TODAY, { hrv: 57, rhr: 52, sleep: 7.5 })], TODAY);
    expect(r.status).toBe('fair');
    expect(r.warnings[0]).toContain('HRV 57 ms');
  });

  it('is poor when the low reading comes with another sign', () => {
    expect(readRecovery([...threeWeeks, day(TODAY, { hrv: 57, sleep: 5 })], TODAY).status).toBe('poor');
  });

  it('is poor once the 7-day mean drops too', () => {
    // Yesterday and today at 55 ms: the baseline (yesterday included) is 4.1657 ± 0.0602, and the 7-day log-mean 4.1300
    // is under 4.1657 − 0.5 × 0.0602 = 4.1356.
    const r = readRecovery([...threeWeeks, day(addDays(TODAY, -1), { hrv: 55 }), day(TODAY, { hrv: 55, rhr: 52, sleep: 7.5 })], TODAY);
    expect(r.status).toBe('poor');
    expect(r.warnings[0]).toContain('7 天平均也偏低');
  });
});

describe('a run of low HRV days with a short history', () => {
  it('is poor when the previous reading was low against its own baseline too', () => {
    // Only a week of history, so each low day pulls the baseline down with it: yesterday's 47 widens today's range to
    // 51–71 and the 7-day log-mean stays inside it. Yesterday was under its own range (55–71), so today counts as a run.
    const days = [...week.slice(0, 5), day(addDays(TODAY, -2), { hrv: 49 }), day(addDays(TODAY, -1), { hrv: 47 }), day(TODAY, { hrv: 48 })];
    const r = readRecovery(days, TODAY);
    expect(r.status).toBe('poor');
    expect(r.warnings[0]).toContain('前一次也偏低');
  });

  it('lets a skipped morning pass but not a gap of three days', () => {
    // 57 ms twice: first a single soft sign, then a run when the earlier one is two days back, not when it is three.
    const before = threeWeeks.filter((d) => d.date < addDays(TODAY, -3));
    const run = (gap: number) => readRecovery([...before, day(addDays(TODAY, -gap), { hrv: 57 }), day(TODAY, { hrv: 57 })], TODAY).status;
    expect(run(2)).toBe('poor');
    expect(run(3)).toBe('fair');
  });
});

describe('readRecovery', () => {
  it('is good with HRV inside the baseline', () => {
    const r = readRecovery([...week, day(TODAY, { hrv: 66, rhr: 51, sleep: 8 })], TODAY);
    expect(r.status).toBe('good');
    expect(r.warnings).toEqual([]);
  });

  it('is poor when HRV drops below the baseline', () => {
    const r = readRecovery([...week, day(TODAY, { hrv: 50, rhr: 52, sleep: 7 })], TODAY);
    expect(r.status).toBe('poor');
    expect(r.warnings[0]).toContain('HRV 50 ms');
  });

  it('is fair on one soft signal and poor on two', () => {
    expect(readRecovery([...week, day(TODAY, { hrv: 66, rhr: 59 })], TODAY).status).toBe('fair');
    expect(readRecovery([...week, day(TODAY, { hrv: 66, rhr: 59, sleep: 5 })], TODAY).status).toBe('poor');
  });

  it('is unknown without data for today', () => {
    expect(readRecovery(week, TODAY).status).toBe('unknown');
  });
});

describe('dayReadiness', () => {
  const cmj = [3, 2, 1].map((d, i) => ({ started_at: new Date(2026, 9, 20 - d, 9).toISOString(), best: [40, 41, 40.5][i] }));

  it('is fatigued on a low HRV even when CMJ is fine', () => {
    const r = dayReadiness([...cmj, { started_at: new Date(2026, 9, 20, 9).toISOString(), best: 40.6 }], [...week, day(TODAY, { hrv: 48 })], TODAY);
    expect(r.readiness).toBe('fatigued');
    expect(r.signals).toHaveLength(1);
    expect(r.signals[0]).toContain('HRV');
  });

  it('lists both signals when CMJ and HRV are down', () => {
    const r = dayReadiness([...cmj, { started_at: new Date(2026, 9, 20, 9).toISOString(), best: 37 }], [...week, day(TODAY, { hrv: 48 })], TODAY);
    expect(r.signals.map((s) => s.slice(0, 3))).toEqual(['CMJ', 'HRV']);
  });

  it('is ready on good recovery alone, unknown with nothing', () => {
    expect(dayReadiness([], [...week, day(TODAY, { hrv: 66 })], TODAY).readiness).toBe('ready');
    expect(dayReadiness([], [], TODAY).readiness).toBe('unknown');
  });
});

describe('fatigueStreak', () => {
  it('counts fatigued readings in a row, skipping days without data', () => {
    const tired = [day(addDays(TODAY, -3), { hrv: 45 }), day(addDays(TODAY, -1), { hrv: 46 }), day(TODAY, { hrv: 44 })];
    const base = week.map((d) => ({ ...d, date: addDays(d.date, -4) })); // baseline before the tired days
    expect(fatigueStreak([], [...base, ...tired], TODAY)).toBe(3);
    expect(fatigueStreak([], [...base, ...tired.slice(0, 2), day(TODAY, { hrv: 66 })], TODAY)).toBe(0);
  });
});
