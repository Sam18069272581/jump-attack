import { addDays } from '../dates';
import { dayReadiness, fatigueStreak } from '../readiness';
import { baseline, readRecovery, type RecoveryDay } from '../recovery';

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
