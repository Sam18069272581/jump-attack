import { manualProblem, parseNumber } from '../entry';
import { intervalFromMarks, meanVelocity, sprintDistance, sprintLimits } from '../interval';
import { markProfile } from '../marking';
import { best, changeTone, getMetric, METRICS, sprintMetric } from '../metrics';
import { angleBetween, asymmetry, getMobilityTest, MOBILITY_PAIRS } from '../mobility';
import { estimate1rm, loadAt, lvProfile, pctOf1rm, roundLoad, velocityLoss, zoneOf } from '../vbt';

describe('metric registry', () => {
  it('has unique codes and finds custom sprint distances', () => {
    expect(new Set(METRICS.map((m) => m.code)).size).toBe(METRICS.length);
    expect(getMetric('sprint_30')).toMatchObject({ name: '30 m 冲刺', unit: 's', lowerIsBetter: true });
    expect(getMetric('sprint_40')).toMatchObject({ name: '40 m 冲刺', category: 'speed' });
    expect(getMetric('sprint_40')).toBe(getMetric('sprint_40')); // stable, so screens can depend on it
    expect(getMetric('nope')).toBeUndefined();
  });

  it('lets CMJ and SJ be typed in, so a daily readiness test needs no video', () => {
    for (const code of ['cmj', 'sj']) expect(getMetric(code)!.capture).toEqual(['flight', 'manual']);
  });

  it('picks the best value in the metric’s direction', () => {
    expect(best(getMetric('cmj')!, [40, 42, 41])).toBe(42);
    expect(best(sprintMetric(10), [1.9, 1.85, 1.95])).toBe(1.85);
    expect(best(sprintMetric(10), [])).toBeNull();
  });

  it('colours changes by direction, and never for neutral metrics', () => {
    expect(changeTone(sprintMetric(30), -0.05)).toBe('good');
    expect(changeTone(getMetric('cmj')!, -1)).toBe('bad');
    expect(changeTone(getMetric('rec_resp')!, 2)).toBe('flat');
    expect(changeTone(getMetric('cmj')!, 0)).toBe('flat');
  });
});

describe('typed values', () => {
  it('parses decimal commas and rejects junk', () => {
    expect(parseNumber(' 4,35 ')).toBe(4.35);
    expect(parseNumber('')).toBeNull();
    expect(parseNumber('abc')).toBeNull();
  });

  it('flags values outside the plausible range', () => {
    expect(manualProblem(sprintMetric(30), 4.3)).toBeNull();
    expect(manualProblem(sprintMetric(30), 1.2)).toContain('30 m 冲刺');
    expect(manualProblem(getMetric('rec_hrv')!, 0)).not.toBeNull();
    expect(manualProblem(getMetric('mob_thomas_l')!, -5)).toBeNull(); // below horizontal is fine
  });
});

describe('interval timing', () => {
  it('times the frames between two marks and rejects impossible gaps', () => {
    const limits = sprintLimits(30);
    expect(intervalFromMarks(100, 100 + 4.2 * 240, 240, limits)).toEqual({ ok: true, seconds: expect.closeTo(4.2, 6) });
    expect(intervalFromMarks(null, 10, 240, limits)).toEqual({ ok: false, problem: 'missing' });
    expect(intervalFromMarks(50, 40, 240, limits)).toEqual({ ok: false, problem: 'order' });
    expect(intervalFromMarks(0, 240, 240, limits)).toEqual({ ok: false, problem: 'too-short' }); // 1 s for 30 m
    expect(intervalFromMarks(0, 240 * 30, 240, limits)).toEqual({ ok: false, problem: 'too-long' });
  });

  it('reads distances from sprint codes and velocity from bar travel', () => {
    expect(sprintDistance('sprint_100')).toBe(100);
    expect(sprintDistance('cmj')).toBeNull();
    expect(meanVelocity(60, 0.8)).toBeCloseTo(0.75);
  });
});

describe('marking profiles', () => {
  it('turns sprint marks into a time rounded to the hundredth', () => {
    const p = markProfile(sprintMetric(10))!;
    expect(p.marks[0].title).toBe('起跑帧');
    const r = p.measure([0, 437], 240); // 1.8208 s
    expect(r).toMatchObject({ ok: true, value: 1.82 });
  });

  it('keeps the jump profile for flight tests', () => {
    const r = markProfile(getMetric('cmj')!)!.measure([0, 132], 240); // 0.55 s → 37.1 cm
    expect(r).toMatchObject({ ok: true, value: 37.1 });
  });

  it('adds standing reach to a marked run-up jump for the touch height', () => {
    const touch = getMetric('approach_touch')!;
    const r = markProfile(touch, { reachCm: 240 })!.measure([0, 132], 240); // 37.1 cm jump
    expect(r).toMatchObject({ ok: true, value: 277.1, detail: { jump_cm: 37.1, standing_reach_cm: 240 } });
    expect(markProfile(touch)!.measure([0, 132], 240)).toMatchObject({ ok: false, message: expect.stringContaining('先在「我的」填站立摸高') });
    // A bad mark is still reported as a marking problem.
    expect(markProfile(touch, { reachCm: 240 })!.measure([10, 5], 240)).toMatchObject({ ok: false, message: '落地帧要在起跳帧之后' });
  });

  it('needs bar travel to mark a lift', () => {
    expect(markProfile(getMetric('vbt_squat')!)).toBeNull();
    const r = markProfile(getMetric('vbt_squat')!, { romCm: 55 })!.measure([0, 176], 240); // 0.733 s
    expect(r).toMatchObject({ ok: true, value: 0.75 });
  });
});

describe('mobility', () => {
  it('pairs every test left and right', () => {
    expect(MOBILITY_PAIRS).toHaveLength(7);
    expect(getMobilityTest('mob_ankle')).toMatchObject({ unit: 'cm', left: { code: 'mob_ankle_l' }, right: { code: 'mob_ankle_r' } });
  });

  it('flags a 10% left/right gap, and the Thomas test by degrees', () => {
    expect(asymmetry(getMobilityTest('mob_ankle')!, 11.5, 9.8)).toMatchObject({ flagged: true, pct: expect.closeTo(0.148, 3) });
    expect(asymmetry(getMobilityTest('mob_hip_er')!, 46, 45).flagged).toBe(false);
    expect(asymmetry(getMobilityTest('mob_thomas')!, 4, 6)).toEqual({ diff: 2, pct: null, flagged: false });
    expect(asymmetry(getMobilityTest('mob_thomas')!, -2, 8).flagged).toBe(true);
  });

  it('measures the angle between two phone orientations', () => {
    expect(angleBetween({ x: 0, y: -1, z: 0 }, { x: 0, y: 0, z: -1 })).toBeCloseTo(90);
    expect(angleBetween({ x: 0, y: -1, z: 0 }, { x: 0, y: -1, z: 0 })).toBeCloseTo(0);
    expect(angleBetween({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 })).toBe(0);
  });
});

describe('VBT', () => {
  it('maps velocity to the design’s zones', () => {
    expect(zoneOf(0.45).name).toBe('绝对力量');
    expect(zoneOf(0.62).name).toBe('加速力量');
    expect(zoneOf(1.0).name).toBe('速度-力量');
    expect(zoneOf(1.55).name).toBe('速度');
  });

  it('fits a load-velocity line and reads 1RM at the minimum velocity threshold', () => {
    // v = 1.5 − 0.01 × load: 1RM at 0.3 m/s is 120 kg.
    const p = lvProfile([60, 80, 100].map((load) => ({ load, v: 1.5 - 0.01 * load })))!;
    expect(p.slope).toBeCloseTo(-0.01);
    expect(p.r2).toBeCloseTo(1);
    expect(estimate1rm(p, 0.3)).toBeCloseTo(120);
    expect(loadAt(p, 0.75)).toBeCloseTo(75);
  });

  it('has no profile from one load or a rising line', () => {
    expect(lvProfile([{ load: 80, v: 0.6 }, { load: 80, v: 0.62 }])).toBeNull();
    expect(lvProfile([{ load: 60, v: 0.6 }, { load: 80, v: 0.7 }])).toBeNull();
  });

  it('works out velocity loss, %1RM and plate-friendly loads', () => {
    expect(velocityLoss(0.8, 0.62)).toBeCloseTo(0.225);
    expect(velocityLoss(0.8, 0.85)).toBe(0);
    expect(pctOf1rm(5, 7.5)).toBeCloseTo(0.8);
    expect(roundLoad(96.4)).toBe(97.5);
  });
});
