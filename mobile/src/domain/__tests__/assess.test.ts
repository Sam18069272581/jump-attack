import { cmjReadiness, judgeChange, mean, readinessOn, sd, smallestWorthwhileChange } from '../assess';

describe('stats', () => {
  it('mean and sample sd', () => {
    expect(mean([1, 2, 3])).toBe(2);
    expect(sd([2, 4, 4, 4, 5, 5, 7, 9])).toBeCloseTo(2.138, 3);
    expect(sd([5])).toBe(0);
  });

  it('SWC is 0.2 × SD', () => {
    expect(smallestWorthwhileChange([2, 4, 4, 4, 5, 5, 7, 9])).toBeCloseTo(0.4276, 3);
  });
});

describe('judgeChange', () => {
  const cmj = [34.8, 35.2, 34.5, 36.0, 36.4, 36.1, 37.0];

  it('needs three earlier results', () => {
    expect(judgeChange([35, 36], 37).verdict).toBe('unknown');
  });

  it('calls a change inside SWC trivial', () => {
    expect(judgeChange(cmj, mean(cmj) + 0.05).verdict).toBe('trivial');
  });

  it('detects real improvement and decline', () => {
    expect(judgeChange(cmj, 38).verdict).toBe('better');
    expect(judgeChange(cmj, 33).verdict).toBe('worse');
  });

  it('respects lower-is-better metrics', () => {
    const sprint = [4.45, 4.43, 4.4, 4.39, 4.36];
    expect(judgeChange(sprint, 4.2, true).verdict).toBe('better');
    expect(judgeChange(sprint, 4.6, true).verdict).toBe('worse');
  });
});

describe('cmjReadiness', () => {
  const previous = [36, 36.4, 36.1, 37, 37.1];

  it('flags more than 5% drop as fatigue', () => {
    const r = cmjReadiness(previous, 33.5);
    expect(r.readiness).toBe('fatigued');
    expect(r.dropPct).toBeGreaterThan(0.05);
  });

  it('is ready within normal range', () => {
    expect(cmjReadiness(previous, 36.2).readiness).toBe('ready');
  });

  it('is unknown without enough history', () => {
    expect(cmjReadiness([36], 30).readiness).toBe('unknown');
  });

  it('uses only the recent window', () => {
    // Old low values outside the window must not drag the baseline down.
    const r = cmjReadiness([20, 20, 20, 36, 36, 36], 33, 3);
    expect(r.readiness).toBe('fatigued');
  });
});

describe('readinessOn, one source at a time', () => {
  const at = (day: number) => `2026-11-0${day}T08:00:00.000Z`;
  it('judges a typed-in CMJ against typed-in ones, so a mis-marked video does not hide fatigue', () => {
    // The walkthrough: three typed-in days around 55, a video marked at 30.7, then 47 typed in.
    const results = [
      { started_at: at(1), best: 55.2, source: 'manual' as const },
      { started_at: at(2), best: 55.3, source: 'manual' as const },
      { started_at: at(3), best: 30.7, source: 'video' as const },
      { started_at: at(4), best: 55.7, source: 'manual' as const },
      { started_at: at(5), best: 47, source: 'manual' as const },
    ];
    const r = readinessOn(results, '2026-11-05');
    // 47 ÷ mean(55.2, 55.3, 55.7) = 47 ÷ 55.4 = 0.848: 15.2% down, past the 5% line. With the video in the baseline it read ready.
    expect(r.readiness).toBe('fatigued');
    expect(r.dropPct).toBeCloseTo(0.152, 3);
  });

  it('needs three earlier tests from the same source', () => {
    const results = [
      { started_at: at(1), best: 55, source: 'manual' as const },
      { started_at: at(2), best: 55, source: 'manual' as const },
      { started_at: at(3), best: 50, source: 'video' as const },
      { started_at: at(4), best: 40, source: 'video' as const },
    ];
    expect(readinessOn(results, '2026-11-04').readiness).toBe('unknown');
  });
});
