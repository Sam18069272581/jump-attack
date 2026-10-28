import { getMetric, METRICS } from '../metrics';
import { personalRecord, recordable } from '../record';

describe('personal record', () => {
  it('is a record only when it beats every earlier session', () => {
    expect(personalRecord([312, 315], 318)).toEqual({ previous: 315, by: 3 });
    expect(personalRecord([312, 318], 318)).toBeNull();
    expect(personalRecord([320], 318)).toBeNull();
  });

  it('counts lower as better for times', () => {
    // 30 m sprint: 4.36 s before, 4.30 s now is 0.06 s faster.
    const r = personalRecord([4.42, 4.36], 4.3, true)!;
    expect(r.previous).toBe(4.36);
    expect(r.by).toBeCloseTo(0.06);
    expect(personalRecord([4.36], 4.4, true)).toBeNull();
  });

  it('needs an earlier session to beat', () => {
    expect(personalRecord([], 318)).toBeNull();
  });
});

describe('which results can be a record', () => {
  it('celebrates jumps, touches and sprints, not loads, recovery readings or set averages', () => {
    expect(recordable(getMetric('approach_touch')!)).toBe(true);
    expect(recordable(getMetric('cmj')!)).toBe(true);
    expect(recordable(getMetric('sprint_30')!)).toBe(true);
    // A bar speed only means something at its load; recovery readings are not performances.
    expect(recordable(getMetric('vbt_squat')!)).toBe(false);
    expect(recordable(getMetric('rec_hrv')!)).toBe(false);
    expect(recordable(getMetric('rec_resp')!)).toBe(false);
    // Repeated sprints are scored as a set mean.
    expect(recordable(METRICS.find((m) => m.aggregate === 'mean')!)).toBe(false);
  });
});
