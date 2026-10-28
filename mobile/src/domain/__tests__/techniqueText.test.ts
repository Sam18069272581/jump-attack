import { PASS_LINE } from '../technique';
import { formatMeasured, METRIC_ORDER, METRIC_TEXT } from '../techniqueText';

describe('formatMeasured', () => {
  it('writes the figure with its 95 % error, to the figure’s own precision', () => {
    expect(formatMeasured('vz', { value: 3.304, error: 0.041, status: 'ok' })).toBe('3.30 ± 0.04 m/s');
    expect(formatMeasured('plant', { value: 181.4, error: 9.6, status: 'ok' })).toBe('181 ± 10 ms');
    expect(formatMeasured('angle', { value: 45.2, error: 2.1, status: 'ok' })).toBe('45 ± 2°');
  });

  it('says when the error is wider than the change worth acting on', () => {
    expect(formatMeasured('plant', { value: 180, error: 34, status: 'imprecise' })).toBe('180 ± 34 ms（不够准）');
  });
});

it('names every figure the analysis reports, the take-off first', () => {
  expect(METRIC_ORDER).toEqual(expect.arrayContaining(Object.keys(PASS_LINE)));
  expect(METRIC_ORDER[0]).toBe('vz');
  // Enough decimals to show each pass line: a figure must be able to show a change of that size.
  for (const k of METRIC_ORDER) expect(10 ** -METRIC_TEXT[k].decimals).toBeLessThanOrEqual(PASS_LINE[k]);
});
