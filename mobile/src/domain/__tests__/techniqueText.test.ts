import { PASS_LINE } from '../technique';
import { FLAG_TEXT, flagText, formatError, formatMeasured, METRIC_ORDER, METRIC_TEXT, shownFlags } from '../techniqueText';

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

it('says the lines are off in words a player knows, and that the take-off’s horizontal velocity is less sure too', () => {
  // A scale isn't something to set against gravity, and "进板速度" is no term of the game. Off the line, the horizontal
  // take-off velocity's error takes in the gap as well.
  expect(FLAG_TEXT['off-line']).not.toMatch(/进板速度|比例和重力/);
  expect(FLAG_TEXT['off-line']).toMatch(/起跳水平速度.*误差|误差.*起跳水平速度/);
  // A hand on the rim: what was cut short, in the words of the court.
  expect(FLAG_TEXT['short-fall']).not.toMatch(/截短|比例/);
});

it('off the line, says the take-off angle is less sure too, but not after a hand on the rim cut the fall short', () => {
  // Over a whole flight the scales apart can mean the parabola is bent, which moves the angle: its error takes in the gap.
  // After a short fall the fit's own errors already take that in, and the angle's error doesn't widen.
  expect(FLAG_TEXT['off-line']).toMatch(/起跳角度.*误差|误差.*起跳角度/);
  expect(FLAG_TEXT['short-fall']).not.toMatch(/角度/);
});

it('when the scales disagree, says the vertical take-off velocity is less sure too', () => {
  // It rests on the parabola's curvature as gravity's scale does, off the line and after a short fall alike.
  expect(FLAG_TEXT['off-line']).toMatch(/垂直速度.*误差/);
  expect(FLAG_TEXT['short-fall']).toMatch(/垂直速度.*误差/);
});

it('on a run-up that came at the camera, says its slant puts the two apart rather than that the lines are off, and that the run-up speed stays on their 3 m', () => {
  // Lines laid on such a run-up are one nearer the phone than the other: that alone puts their scale apart from gravity's.
  const curvedOff = flagText('off-line', ['curved', 'off-line']);
  expect(curvedOff).toMatch(/斜/);
  expect(curvedOff).not.toMatch(/没点在|不是相隔|贴错|点错/);
  expect(curvedOff).toMatch(/助跑速度.*3 米/);
  expect(curvedOff).toMatch(/步长.*刹车.*重力/);
  expect(curvedOff).not.toMatch(/助跑速度[^；]*重力/);
  expect(flagText('off-line', ['off-line'])).toBe(FLAG_TEXT['off-line']);
  expect(flagText('hang', ['curved', 'hang'])).toBe(FLAG_TEXT.hang);
  // Nor does the slant's own line say which way they are off: in the synthetic clips the last step and braking read a
  // little high on gravity's scale or without lines, and low on lines laid on such a run-up.
  expect(FLAG_TEXT.curved).not.toMatch(/偏小|偏大/);
  expect(FLAG_TEXT.curved).toMatch(/误差/);
});

it('when a hand on the rim cut the fall short, says so rather than that the lines are off, and that the lengths stay on the lines', () => {
  // Gravity's scale then rests on the rise alone: apart from the lines', it is no sign they were laid or tapped wrong.
  expect(FLAG_TEXT['short-fall']).toMatch(/挂筐|篮筐/);
  expect(FLAG_TEXT['short-fall']).toMatch(/步长.*助跑速度.*刹车.*两条线/);
  expect(FLAG_TEXT['short-fall']).toMatch(/误差/);
  expect(shownFlags(['low-fps', 'hang', 'off-line', 'short-fall'])).toEqual(['low-fps', 'hang', 'short-fall']);
  expect(shownFlags(['off-line'])).toEqual(['off-line']);
});
