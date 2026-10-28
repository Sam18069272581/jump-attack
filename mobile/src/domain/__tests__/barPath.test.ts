import { analyseBarPath, countsByDefault, lowPass, REP_FLAG_REASONS, summariseReps, trackedSet, trackTimeScale, trackWarnings, turningPoints, type Rep, type TrackSample } from '../barPath';

/**
 * Move from 0 to 1 over u ∈ [0, 1] with a half-sine velocity: the bar reverses out of the bottom with a bounce and
 * decelerates into lockout, peaking at π/2 × its mean velocity.
 */
const halfSine = (u: number) => (1 - Math.cos(Math.PI * u)) / 2;
/** Minimum jerk: force builds up from nothing and fades out again, so the bar creeps off the bottom and into lockout. */
const minJerk = (u: number) => u * u * u * (10 - 15 * u + 6 * u * u);

type Phase = { dur: number; to: number; shape?: (u: number) => number };

/** Bar height (cm) over time from a list of phases, each moving from the previous height to `to`. */
function heightAt(phases: Phase[], t: number): number {
  let from = 0;
  let at = 0;
  for (const p of phases) {
    if (t <= at + p.dur) return from + (p.to - from) * (p.shape ?? halfSine)((t - at) / p.dur);
    at += p.dur;
    from = p.to;
  }
  return from;
}

/** Deterministic noise so the test never flakes. */
function noise(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) % 2 ** 31;
    return s / 2 ** 31 - 0.5;
  };
}

type Film = { fps?: number; jitter?: number; times?: (i: number, fps: number) => number; sideways?: (t: number) => number };

/**
 * A tracked video of `phases`, plate 200 px across, with ±`jitter` px of tracking noise. `times` gives each frame's
 * real timestamp (evenly spaced by default) and `sideways` moves the plate horizontally (cm).
 */
function film(phases: Phase[], { fps = 60, jitter = 1.5, times = (i, f) => i / f, sideways = () => 0 }: Film = {}): TrackSample[] {
  const total = phases.reduce((s, p) => s + p.dur, 0);
  const rnd = noise(7);
  const px = 200 / 45;
  const out: TrackSample[] = [];
  for (let i = 0; times(i, fps) <= total; i++) {
    const t = times(i, fps);
    out.push({ t, x: 300 + sideways(t) * px + rnd() * jitter, y: 800 - heightAt(phases, t) * px + rnd() * jitter, c: 0.95 });
  }
  return out;
}

const ROM = 55;
/** Stand, then for each concentric time: descend over 1 s, drive up over that time, stand 1 s. */
function squats(...concentric: number[]): Phase[] {
  return [{ dur: 0.6, to: 0 }, ...concentric.flatMap((c) => [{ dur: 1, to: -ROM }, { dur: c, to: 0 }, { dur: 1, to: 0 }])];
}

/** Relative error of each rep's mean velocity against `rom` cm in each of `times` seconds. */
const errors = (reps: Rep[], times: number[], rom = ROM) => reps.map((r, i) => r.mv / (rom / 100 / times[i]) - 1);

describe('bar path analysis', () => {
  it('finds each squat and its mean concentric velocity', () => {
    const a = analyseBarPath(film(squats(0.8, 1.0, 1.4)), 200);
    expect(a.reps).toHaveLength(3);
    const expected = [0.8, 1.0, 1.4].map((c) => ROM / 100 / c);
    a.reps.forEach((r, i) => {
      expect(r.mv).toBeGreaterThan(expected[i] * 0.97);
      expect(r.mv).toBeLessThan(expected[i] * 1.03);
      expect(r.romCm).toBeGreaterThan(ROM - 1);
      expect(r.romCm).toBeLessThan(ROM + 1);
      expect(r.pv).toBeGreaterThan(expected[i] * 1.45);
      expect(r.pv).toBeLessThan(expected[i] * 1.75);
      // These never brake harder than gravity, so the whole concentric phase is propulsive.
      expect(r.mpv).toBe(r.mv);
      expect(r.flags).toEqual([]);
    });
    expect(a.rate).toBeCloseTo(60, 0);
  });

  it('stays as close at the 30 fps an iPhone films by default', () => {
    const a = analyseBarPath(film(squats(0.6, 1.0), { fps: 30 }), 200);
    expect(a.reps).toHaveLength(2);
    errors(a.reps, [0.6, 1.0]).forEach((e) => expect(Math.abs(e)).toBeLessThan(0.03));
  });

  it('times reps whose force builds up and fades out gradually', () => {
    // Paused at the bottom, then a minimum-jerk drive: the bar creeps off the floor and into lockout.
    const phases: Phase[] = [{ dur: 0.6, to: 0 }];
    for (const c of [0.6, 1.2]) phases.push({ dur: 1, to: -ROM }, { dur: 0.8, to: -ROM }, { dur: c, to: 0, shape: minJerk }, { dur: 1, to: 0 });
    const a = analyseBarPath(film(phases, { jitter: 1 }), 200);
    expect(a.reps).toHaveLength(2);
    // The hardest case: for the first and last few hundredths of a second the bar moves less than the jitter.
    errors(a.reps, [0.6, 1.2]).forEach((e) => expect(Math.abs(e)).toBeLessThan(0.04));
  });

  it('does not trim a fast rep whose acceleration ramps up from zero', () => {
    // Velocity 0 → 1.3 m/s over 0.15 s → 1.1 at 0.3 s → 0 at 0.5 s, smoothstep between: 38.7 cm at 0.775 m/s.
    const knots = [[0, 0], [0.15, 1.3], [0.3, 1.1], [0.5, 0]];
    const v = (t: number) => {
      for (let k = 0; k < 3; k++) {
        const [t0, v0] = knots[k];
        const [t1, v1] = knots[k + 1];
        if (t <= t1) {
          const f = (t - t0) / (t1 - t0);
          return v0 + (v1 - v0) * f * f * (3 - 2 * f);
        }
      }
      return 0;
    };
    const table = [0];
    for (let i = 1; i <= 500; i++) table.push(table[i - 1] + v((i - 0.5) / 1000) * 0.1);
    const rom = table[500];
    const shape = (u: number) => table[Math.round(u * 500)] / rom;
    const phases: Phase[] = [{ dur: 0.6, to: 0 }, { dur: 1, to: -rom }, { dur: 0.5, to: 0, shape }, { dur: 1, to: 0 }];
    const a = analyseBarPath(film(phases, { jitter: 1 }), 200);
    expect(a.reps).toHaveLength(1);
    expect(Math.abs(errors(a.reps, [0.5], rom)[0])).toBeLessThan(0.05);
  });

  it('is not thrown off by tracking noise near the ends of a rep', () => {
    // Gaussian-ish jitter of about 0.15 cm (0.7 px), what the tracker shows on a clean video, over three sets.
    const e = [11, 12, 13].flatMap((seed) => {
      const rnd = noise(seed);
      const noisy = film(squats(0.5, 1.0, 2.0), { jitter: 0 }).map((s) => ({ ...s, y: s.y + (rnd() + rnd() + rnd() + rnd()) * 1.15 }));
      return errors(analyseBarPath(noisy, 200).reps, [0.5, 1.0, 2.0]);
    });
    expect(e).toHaveLength(9);
    expect(Math.abs(e.reduce((s, x) => s + x, 0) / e.length)).toBeLessThan(0.02);
    e.forEach((x) => expect(Math.abs(x)).toBeLessThan(0.05));
  });

  it('works on the real, uneven timestamps of a variable frame rate video', () => {
    // Frames land up to a quarter frame early or late, and every 13th frame is dropped.
    const rnd = noise(3);
    const times = (i: number, fps: number) => (i + Math.floor(i / 12) + rnd() * 0.5) / fps;
    const a = analyseBarPath(film(squats(0.7, 1.1), { times }), 200);
    expect(a.reps).toHaveLength(2);
    errors(a.reps, [0.7, 1.1]).forEach((e) => expect(Math.abs(e)).toBeLessThan(0.03));
    a.reps.forEach((r) => expect(r.flags).toEqual([]));
    expect(a.rate).toBeCloseTo(60, -1);
  });

  it('keeps reps whole where the camera drops to half its frame rate and skips a frame', () => {
    // iPhones in dim light record at 30 fps for a while in a 60 fps video: from 3.5 s to 6 s, through rep 2's rise
    // (4.3 s to 5.4 s), every other frame is missing, and one more is dropped, a 67 ms gap.
    const times = (i: number, fps: number) => i / fps;
    const set = film(squats(0.7, 1.1), { times }).filter((s, i) => !(s.t > 3.5 && s.t < 6 && (i % 2 || i === 301)));
    const a = analyseBarPath(set, 200);
    expect(a.reps).toHaveLength(2);
    errors(a.reps, [0.7, 1.1]).forEach((e) => expect(Math.abs(e)).toBeLessThan(0.03));
    a.reps.forEach((r) => expect(r.flags).toEqual([]));
  });

  it('gives the propulsive velocity of a fast rep that brakes harder than gravity', () => {
    // 55 cm in 0.4 s with a half-sine profile decelerates at up to 17 m/s² into lockout.
    const T = 0.4;
    const A = ROM / 100;
    const up = Math.acos((-2 * 9.81 * T * T) / (A * Math.PI * Math.PI)) / Math.PI;
    const truth = (A * halfSine(up)) / (up * T);
    const a = analyseBarPath(film(squats(T, 1.2), { fps: 120, jitter: 1 }), 200);
    expect(a.reps).toHaveLength(2);
    const [fast, slow] = a.reps;
    expect(fast.mpv).toBeGreaterThan(fast.mv * 1.05);
    expect(fast.mpv / truth).toBeGreaterThan(0.95);
    expect(fast.mpv / truth).toBeLessThan(1.05);
    expect(slow.mpv).toBe(slow.mv);
  });

  it('keeps a grinder with a sticking point as one rep without cutting it short', () => {
    // Fast out of the hole, nearly stalls at 40 % of the way, then grinds up: 2.2 s in all.
    const grind = (u: number) => (u < 0.3 ? 0.4 * halfSine(u / 0.3) : u < 0.55 ? 0.4 + 0.03 * ((u - 0.3) / 0.25) : 0.43 + 0.57 * halfSine((u - 0.55) / 0.45));
    const phases: Phase[] = [{ dur: 0.6, to: 0 }, { dur: 1.2, to: -ROM }, { dur: 2.2, to: 0, shape: grind }, { dur: 1, to: 0 }];
    const a = analyseBarPath(film(phases), 200);
    expect(a.reps).toHaveLength(1);
    expect(Math.abs(errors(a.reps, [2.2])[0])).toBeLessThan(0.03);
  });

  it('keeps a grinder that sinks at the sticking point as one rep', () => {
    // Up 25 cm, sinks 4 cm, then grinds to lockout: 3 s in all, after a normal rep and on its own.
    const sink = (u: number) => (u < 0.3 ? (25 / ROM) * halfSine(u / 0.3) : u < 0.45 ? (25 - 4 * halfSine((u - 0.3) / 0.15)) / ROM : (21 + 34 * halfSine((u - 0.45) / 0.55)) / ROM);
    const grinder = (before: number[]): Phase[] => [...squats(...before), { dur: 1, to: -ROM }, { dur: 3, to: 0, shape: sink }, { dur: 1, to: 0 }];
    const after = analyseBarPath(film(grinder([1.0])), 200);
    expect(after.reps).toHaveLength(2);
    expect(Math.abs(errors(after.reps, [1.0, 3.0])[1])).toBeLessThan(0.03);
    const alone = analyseBarPath(film(grinder([])), 200);
    expect(alone.reps).toHaveLength(1);
    expect(Math.abs(errors(alone.reps, [3.0])[0])).toBeLessThan(0.03);
  });

  it('measures touch-and-go reps to the top of each rep, so identical reps read the same', () => {
    // Bench: four identical 35 cm reps in 0.6 s, each straight back down, a pause only after the last.
    const phases: Phase[] = [{ dur: 0.8, to: 0 }];
    for (let i = 0; i < 4; i++) phases.push({ dur: 0.5, to: -35 }, { dur: 0.6, to: 0 });
    phases.push({ dur: 1, to: 0 });
    const a = analyseBarPath(film(phases), 200);
    expect(a.reps).toHaveLength(4);
    a.reps.forEach((r) => expect(Math.abs(r.romCm - 35)).toBeLessThan(0.5));
    // The last one, which comes to rest at the top, is the hardest to time.
    errors(a.reps, [0.6, 0.6, 0.6, 0.6], 35).forEach((e, i) => expect(Math.abs(e)).toBeLessThan(i < 3 ? 0.02 : 0.04));
    expect(summariseReps(a.reps.map((r) => r.mv))!.loss).toBeLessThan(0.04);
  });

  it('measures a pull that starts from the floor in the first frames', () => {
    // A deadlift: the clip opens with the bar on the floor, pulled 50 cm in 0.9 s.
    const phases: Phase[] = [{ dur: 0.4, to: 0 }, { dur: 0.9, to: 50, shape: minJerk }, { dur: 1, to: 50 }, { dur: 1, to: 0 }];
    const a = analyseBarPath(film(phases, { jitter: 1 }), 200);
    expect(a.reps).toHaveLength(1);
    expect(a.reps[0].flags).toEqual([]);
    expect(Math.abs(errors(a.reps, [0.9], 50)[0])).toBeLessThan(0.03);
  });

  it('turns slow-motion media time into real time', () => {
    // A 240 fps capture played back at 30 fps: every media second is 1/8 of a real second.
    const real = film(squats(0.9), { fps: 240 });
    const slowMo = real.map((s) => ({ ...s, t: s.t * 8 }));
    const a = analyseBarPath(slowMo, 200, 30 / 240);
    expect(a.reps).toHaveLength(1);
    expect(Math.abs(errors(a.reps, [0.9])[0])).toBeLessThan(0.03);
    expect(a.rate).toBeCloseTo(240, 0);
  });

  it('ignores the walk-out, re-rack wiggles and frames it was unsure of', () => {
    const phases: Phase[] = [{ dur: 0.5, to: 4 }, { dur: 0.5, to: 0 }, ...squats(1.0).slice(1), { dur: 0.6, to: 5 }];
    const samples = film(phases).map((s, i) => (i % 25 === 0 ? { ...s, y: s.y - 300, c: 0.2 } : s));
    const a = analyseBarPath(samples, 200);
    expect(a.reps).toHaveLength(1);
    expect(a.reps[0].mv).toBeCloseTo(0.55, 1);
    expect(a.reps[0].flags).toEqual([]);
    expect(a.unsure).toBeGreaterThan(0);
  });

  it('warns when nothing was found, tracking was shaky or the video is slow', () => {
    expect(trackWarnings(analyseBarPath(film([{ dur: 2, to: 0 }]), 200))[0]).toContain('没有找到');
    const shaky = film(squats(1)).map((s, i) => (i % 3 === 0 ? { ...s, c: 0.1 } : s));
    expect(trackWarnings(analyseBarPath(shaky, 200)).join()).toContain('没认准');
    expect(trackWarnings(analyseBarPath(film(squats(1), { fps: 30 }), 200)).join()).toContain('60 fps');
  });

  it('reads the frame rate from every frame, not just the confident ones', () => {
    const samples = film(squats(1)).map((s, i) => (i % 5 === 0 ? { ...s, c: 0.2 } : s));
    const a = analyseBarPath(samples, 200);
    expect(a.rate).toBeCloseTo(60, 0);
    expect(trackWarnings(a).join()).not.toContain('fps');
  });
});

describe('rep flags', () => {
  const flagsOf = (samples: TrackSample[]) => analyseBarPath(samples, 200).reps.map((r) => r.flags);

  it('flags a rep the clip starts or ends in the middle of as truncated', () => {
    const set = film(squats(1.0, 1.0, 1.0));
    // Rep 1 rises over 1.6–2.6 s and rep 3 over 7.6–8.6 s: cut off the first and last 30 % of the time.
    const cut = set.filter((s) => s.t >= 1.9 && s.t <= 8.3);
    const a = analyseBarPath(cut, 200);
    expect(a.reps.map((r) => r.flags)).toEqual([['truncated'], [], ['truncated']]);
    expect(Math.abs(errors(a.reps.slice(1, 2), [1.0])[0])).toBeLessThan(0.03);
    // With nothing left that was seen whole, the set gets the warning.
    expect(trackWarnings(analyseBarPath(set.filter((s) => s.t <= 2.1), 200))[0]).toContain('没有找到');
  });

  it('flags a rep the tracker lost the plate in as truncated, but bridges a frame or two', () => {
    const set = film(squats(1.0, 1.0));
    // Lose 0.2 s in the middle of rep 1's rise; drop just two frames from rep 2's.
    const lost = set.map((s) => (s.t > 2.0 && s.t < 2.2 ? { ...s, c: 0.1 } : s));
    expect(flagsOf(lost.filter((s) => !(s.t > 4.55 && s.t < 4.59)))).toEqual([['truncated'], []]);
    // A gap in the timestamps themselves is the same.
    expect(flagsOf(set.filter((s) => !(s.t > 2.0 && s.t < 2.2)))).toEqual([['truncated'], []]);
  });

  it('flags a rep clearly shorter than the rest of the set as partial', () => {
    const phases: Phase[] = [...squats(1.0, 1.0), { dur: 0.7, to: -0.65 * ROM }, { dur: 0.7, to: 0 }, { dur: 1, to: 0 }];
    expect(flagsOf(film(phases))).toEqual([[], [], ['partial']]);
  });

  it('flags a rep with many frames it was unsure of', () => {
    const set = film(squats(1.0, 1.0));
    // Every other frame of rep 2's rise is unsure: no long gap, but half the frames.
    const patchy = set.map((s, i) => (s.t > 4.4 && s.t < 5.8 && i % 2 ? { ...s, c: 0.3 } : s));
    expect(flagsOf(patchy)).toEqual([[], ['unsure']]);
  });

  it('flags a rep where the plate slides sideways as drift', () => {
    // A real bar path wanders a few cm; 30 cm sideways in one rep is the tracker sliding off the plate.
    const sideways = (t: number) => (t < 4.6 ? 3 * Math.sin(t) : t < 5.6 ? 3 * Math.sin(t) + 30 * halfSine(t - 4.6) : 30 + 3 * Math.sin(t));
    expect(flagsOf(film(squats(1.0, 1.0), { sideways }))).toEqual([[], ['drift']]);
  });
});

describe('path helpers', () => {
  it('low-passes without lag or bending a steady rise at the ends', () => {
    const xs = Array.from({ length: 61 }, (_, i) => 50 * (i / 60));
    const out = lowPass(xs, 60, 6);
    out.forEach((x, i) => expect(x).toBeCloseTo(xs[i], 3));
  });

  it('removes jitter faster than the cutoff and keeps slower movement', () => {
    const slow = (i: number) => 10 * Math.sin((2 * Math.PI * 1 * i) / 120);
    const xs = Array.from({ length: 240 }, (_, i) => slow(i) + (i % 2 ? 1 : -1));
    const out = lowPass(xs, 120, 6);
    for (let i = 20; i < 220; i++) expect(Math.abs(out[i] - slow(i))).toBeLessThan(0.1);
  });

  it('marks lows and highs past the reversal size only', () => {
    const h = [0, 1, 0, -10, -20, -19, -20, -5, 0, 1, 0.5];
    const turns = turningPoints(h.map((v, i) => ({ t: i, h: v, v: 0 })));
    expect(turns.map((x) => x.kind)).toEqual(['high', 'low', 'high']);
    expect(turns.map((x) => x.i)).toEqual([1, 4, 9]);
  });

  it('summarises a set by its fastest rep and the velocity lost by the last', () => {
    expect(summariseReps([0.6, 0.62, 0.55, 0.5])).toEqual({ best: 0.62, first: 0.6, last: 0.5, loss: expect.closeTo(0.1935, 3), count: 4 });
    expect(summariseReps([])).toBeNull();
  });
});

describe('logging a tracked set', () => {
  const rep = (mv: number, flags: Rep['flags'] = [], pv = mv * 1.6, romCm = 55): Rep => ({ start: 0, end: romCm / 100 / mv, mv, mpv: mv, pv, romCm, flags });

  it('leaves flagged reps out by default and says why', () => {
    expect([rep(0.6), rep(0.7, ['truncated']), rep(0.5, ['partial', 'unsure'])].map(countsByDefault)).toEqual([true, false, false]);
    for (const f of ['truncated', 'partial', 'unsure', 'drift'] as const) expect(REP_FLAG_REASONS[f]).toMatch(/[\u4e00-\u9fff]/);
  });

  it('logs the fastest kept rep, every kept rep and the loss of each against the fastest', () => {
    // Kept: 0.62, 0.55, 0.50 m/s. Loss of each = (0.62 − v) / 0.62: 0, 11.3 %, 19.4 %.
    const reps = [rep(0.8, ['truncated'], 1.5), rep(0.62, [], 1.0, 54), rep(0.55, [], 0.9), rep(0.5, [], 0.8)];
    const s = trackedSet(reps, [false, true, true, true])!;
    expect(s.kept.map((r) => r.mv)).toEqual([0.62, 0.55, 0.5]);
    expect(s.summary).toMatchObject({ best: 0.62, count: 3 });
    expect(s.best.romCm).toBe(54);
    // The peak of the left-out rep doesn't count.
    expect(s.peakV).toBe(1.0);
    expect(s.loss).toEqual([0, 0, expect.closeTo(0.113, 3), expect.closeTo(0.194, 3)]);
    expect(trackedSet(reps, [true, false, false, false])!.kept).toHaveLength(1);
    expect(trackedSet(reps, [false, false, false, false])).toBeNull();
  });

  it('only treats a clip as slow motion when the file is at most 30 fps', () => {
    // A 30 fps export of 240 fps slow motion: every media second is 30/240 of a real one.
    expect(trackTimeScale(30, 240)).toBe(0.125);
    expect(trackTimeScale(30, null)).toBe(1);
    // A real 60 fps clip is never slowed down, whatever was chosen for an earlier clip.
    expect(trackTimeScale(60, 240)).toBe(1);
    // Frame rate unknown: media time is real time.
    expect(trackTimeScale(0, 240)).toBe(1);
    expect(trackTimeScale(null, 120)).toBe(1);
  });
});
