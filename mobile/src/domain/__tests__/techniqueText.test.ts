import { PASS_LINE } from '../technique';
import { FLAG_TEXT, formatError, formatMeasured, METRIC_ORDER, METRIC_TEXT, shownFlags } from '../techniqueText';

describe('formatMeasured', () => {
  it('writes the figure with its 95 % error, to the figure’s own precision', () => {
    expect(formatMeasured('vz', { value: 3.304, error: 0.041, status: 'ok' })).toBe('3.30 ± 0.04 m/s');
    expect(formatMeasured('plant', { value: 181.4, error: 9.6, status: 'ok' })).toBe('181 ± 10 ms');
    expect(formatMeasured('angle', { value: 45.2, error: 2.1, status: 'ok' })).toBe('45 ± 2°');
  });

  it('says when the error is wider than the change worth acting on', () => {
    expect(formatMeasured('plant', { value: 180, error: 34, status: 'imprecise' })).toBe('180 ± 34 ms（不够准）');
  });

  it('never writes a real error as ± 0: at least one unit of the last digit shown', () => {
    // A take-off angle known to 0.47° rounds to "± 0°", which would claim it exact.
    expect(formatMeasured('angle', { value: 45.3, error: 0.467, status: 'ok' })).toBe('45 ± 1°');
    expect(formatMeasured('vz', { value: 3.3, error: 0.004, status: 'ok' })).toBe('3.30 ± 0.01 m/s');
    expect(formatError('angle', 0.467)).toBe('1');
    expect(formatError('vz', 0.041)).toBe('0.04');
  });
});

it('names every figure the analysis reports, the take-off first', () => {
  expect(METRIC_ORDER).toEqual(expect.arrayContaining(Object.keys(PASS_LINE)));
  expect(METRIC_ORDER[0]).toBe('vz');
  // Enough decimals to show each pass line: a figure must be able to show a change of that size.
  for (const k of METRIC_ORDER) expect(10 ** -METRIC_TEXT[k].decimals).toBeLessThanOrEqual(PASS_LINE[k]);
});

it('says why the speeds, times and lengths are missing when the scales disagree, and what to do', () => {
  // With the frame rate or a line wrong, only the angles are given.
  expect(FLAG_TEXT['scale-broken']).toMatch(/速度.*时间.*长度.*不给/);
  expect(FLAG_TEXT['scale-broken']).toMatch(/再分析/);
});

it('says which figures go by gravity’s scale when it and the lines’ differ, and that their errors take in the gap', () => {
  // The last step, the run-up speed and the braking's run-in speed are all read on gravity's scale then.
  expect(FLAG_TEXT['off-line']).toMatch(/步长.*助跑速度.*刹车.*重力/);
  expect(FLAG_TEXT['off-line']).toMatch(/误差/);
});

it('when a hand on the rim cut the fall short, says so rather than that the lines are off, and that the lengths stay on the lines', () => {
  // Gravity's scale then rests on the rise alone: apart from the lines', it is no sign they were laid or tapped wrong.
  expect(FLAG_TEXT['short-fall']).toMatch(/挂筐|篮筐/);
  expect(FLAG_TEXT['short-fall']).toMatch(/步长.*助跑速度.*刹车.*两条线/);
  expect(FLAG_TEXT['short-fall']).toMatch(/误差/);
  expect(shownFlags(['low-fps', 'hang', 'off-line', 'short-fall'])).toEqual(['low-fps', 'hang', 'short-fall']);
  expect(shownFlags(['off-line'])).toEqual(['off-line']);
});
