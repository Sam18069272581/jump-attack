import { getMetric } from '../metrics';
import { assess } from '../verdict';

const cmj = getMetric('cmj')!;

describe('assess', () => {
  it('asks for more data with a short history', () => {
    const a = assess(cmj, [], 36);
    expect(a.change.verdict).toBe('unknown');
    expect(a.readiness).toBeUndefined();
  });

  it('reports improvement and readiness for CMJ', () => {
    const a = assess(cmj, [34.8, 35.2, 34.5, 36.0, 36.4], 38.2);
    expect(a.change.verdict).toBe('better');
    expect(a.change.text).toContain('+');
    expect(a.readiness?.readiness).toBe('ready');
  });

  it('flags fatigue when CMJ drops more than 5%', () => {
    const a = assess(cmj, [36, 36.4, 36.1, 37, 37.1], 33.5);
    expect(a.change.verdict).toBe('worse');
    expect(a.readiness?.readiness).toBe('fatigued');
  });

  it('skips readiness for other tests', () => {
    expect(assess(getMetric('sj')!, [31, 32, 33], 34).readiness).toBeUndefined();
  });
});
