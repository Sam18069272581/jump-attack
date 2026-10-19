import { cmjReadiness, judgeChange, mean, sd, smallestWorthwhileChange } from '../assess';

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
