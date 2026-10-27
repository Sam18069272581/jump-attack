import { analyseBarPath, smoothPath, summariseReps, trackWarnings, turningPoints, type TrackSample } from '../barPath';

/**
 * Move from 0 to 1 over u ∈ [0, 1] with a half-sine velocity: the bar reverses out of the bottom with a bounce and
 * decelerates into lockout, peaking at π/2 × its mean velocity.
 */
const halfSine = (u: number) => (1 - Math.cos(Math.PI * u)) / 2;

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

/** A tracked video of `phases` at `fps`, plate 200 px across, with ±`jitter` px of tracking noise. */
function film(phases: Phase[], fps = 60, jitter = 1.5): TrackSample[] {
  const total = phases.reduce((s, p) => s + p.dur, 0);
  const rnd = noise(7);
  const px = 200 / 45;
  const out: TrackSample[] = [];
  for (let i = 0; i <= total * fps; i++) {
    const t = i / fps;
    out.push({ t, x: 300 + rnd() * jitter, y: 800 - heightAt(phases, t) * px + rnd() * jitter, c: 0.95 });
  }
  return out;
}

const ROM = 55;
/** Stand, then for each concentric time: descend over 1 s, drive up over that time, stand 1 s. */
function squats(...concentric: number[]): Phase[] {
  return [{ dur: 0.6, to: 0 }, ...concentric.flatMap((c) => [{ dur: 1, to: -ROM }, { dur: c, to: 0 }, { dur: 1, to: 0 }])];
}

describe('bar path analysis', () => {
  it('finds each squat and its mean concentric velocity', () => {
    const a = analyseBarPath(film(squats(0.8, 1.0, 1.4)), 200);
    expect(a.reps).toHaveLength(3);
    const expected = [0.8, 1.0, 1.4].map((c) => ROM / 100 / c);
    a.reps.forEach((r, i) => {
      expect(r.mv).toBeGreaterThan(expected[i] * 0.97);
      expect(r.mv).toBeLessThan(expected[i] * 1.03);
      expect(r.romCm).toBeGreaterThan(ROM - 2);
      expect(r.pv).toBeGreaterThan(expected[i] * 1.45);
      expect(r.pv).toBeLessThan(expected[i] * 1.75);
    });
    expect(a.rate).toBeCloseTo(60, 0);
  });

  it('stays as close at the 30 fps an iPhone films by default', () => {
    const a = analyseBarPath(film(squats(0.6, 1.0), 30), 200);
    expect(a.reps.map((r) => r.mv / (ROM / 100))).toEqual([expect.closeTo(1 / 0.6, 1), expect.closeTo(1 / 1.0, 1)]);
    a.reps.forEach((r, i) => expect(Math.abs(r.mv / (ROM / 100 / [0.6, 1.0][i]) - 1)).toBeLessThan(0.03));
  });

  it('measures a slow grinder with a sticking point without cutting it short', () => {
    // Fast out of the hole, nearly stalls at 40 % of the way, then grinds up: 2.2 s in all.
    const grind = (u: number) => (u < 0.3 ? 0.4 * halfSine(u / 0.3) : u < 0.55 ? 0.4 + 0.03 * ((u - 0.3) / 0.25) : 0.43 + 0.57 * halfSine((u - 0.55) / 0.45));
    const phases: Phase[] = [{ dur: 0.6, to: 0 }, { dur: 1.2, to: -ROM }, { dur: 2.2, to: 0, shape: grind }, { dur: 1, to: 0 }];
    const a = analyseBarPath(film(phases), 200);
    expect(a.reps).toHaveLength(1);
    expect(a.reps[0].mv).toBeGreaterThan((ROM / 100 / 2.2) * 0.95);
    expect(a.reps[0].mv).toBeLessThan((ROM / 100 / 2.2) * 1.05);
  });

  it('turns slow-motion media time into real time', () => {
    // A 240 fps capture played back at 30 fps: every media second is 1/8 of a real second.
    const real = film(squats(0.9), 240);
    const slowMo = real.map((s) => ({ ...s, t: s.t * 8 }));
    const a = analyseBarPath(slowMo, 200, 30 / 240);
    expect(a.reps).toHaveLength(1);
    expect(a.reps[0].mv).toBeCloseTo(ROM / 100 / 0.9, 1);
  });

  it('ignores the walk-out, re-rack wiggles and frames it was unsure of', () => {
    const phases: Phase[] = [{ dur: 0.5, to: 4 }, { dur: 0.5, to: 0 }, ...squats(1.0).slice(1), { dur: 0.6, to: 5 }];
    const samples = film(phases).map((s, i) => (i % 25 === 0 ? { ...s, y: s.y - 300, c: 0.2 } : s));
    const a = analyseBarPath(samples, 200);
    expect(a.reps).toHaveLength(1);
    expect(a.reps[0].mv).toBeCloseTo(0.55, 1);
    expect(a.unsure).toBeGreaterThan(0);
  });

  it('warns when nothing was found, tracking was shaky or the video is slow', () => {
    expect(trackWarnings(analyseBarPath(film([{ dur: 2, to: 0 }]), 200))[0]).toContain('没有找到');
    const shaky = film(squats(1)).map((s, i) => (i % 3 === 0 ? { ...s, c: 0.1 } : s));
    expect(trackWarnings(analyseBarPath(shaky, 200)).join()).toContain('没认准');
    expect(trackWarnings(analyseBarPath(film(squats(1), 30), 200)).join()).toContain('60 fps');
  });
});

describe('path helpers', () => {
  it('smooths without lagging a steady rise', () => {
    const pts = Array.from({ length: 61 }, (_, i) => ({ t: i / 60, h: 50 * (i / 60) }));
    const p = smoothPath(pts);
    expect(p[30].v).toBeCloseTo(0.5, 3);
    expect(p[30].h).toBeCloseTo(25, 3);
    expect(p[0].v).toBeCloseTo(0.5, 2);
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
