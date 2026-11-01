/**
 * A synthetic counter-movement jump with a known ground force, for testing the phases read from a clip
 * (domain/jumpPhases.ts) without a force plate. The force, in body weights, follows the usual shape of a CMJ on a plate
 * (quiet standing, unweighting, braking, propulsion; Linthorne 2001, Am J Phys 69:1198, fig. 2): it is integrated at
 * 2 kHz into the centre of mass's path, which is then sampled at the frame rate as a phone would film it, side-on, in
 * picture pixels (y down), with the pose model's jitter added if asked.
 */
import { G } from '../jump';

export type CmjOptions = {
  fps: number;
  /** Picture pixels per metre at the athlete. */
  pxPerM: number;
  /** Where the standing centre of mass sits in the picture, px. */
  standY: number;
  /** Quiet standing before the jump starts, s. */
  quietS: number;
  /** Unweighting: how long (s) and how low the force dips (× body weight under 1). */
  unweightS: number;
  unweightDip: number;
  /** Braking rise to the peak, s, and the peak (× body weight). */
  brakeS: number;
  peak: number;
  /** Propulsion, s. */
  pushS: number;
  /** After landing, s. */
  afterS: number;
  /** Jitter of the centre of mass, px (1 SD), and the seed for it. */
  noisePx: number;
  /** The segment model's centre of mass wandering off the parabola in flight as the legs tuck and reach (px, amplitude of one sine over the flight). */
  driftPx: number;
  seed: number;
};

export const defaultCmj = (over: Partial<CmjOptions> = {}): CmjOptions => ({
  fps: 240,
  pxPerM: 500,
  standY: 900,
  quietS: 0.4,
  unweightS: 0.28,
  unweightDip: 0.6,
  brakeS: 0.16,
  peak: 2.7,
  pushS: 0.24,
  afterS: 0.3,
  noisePx: 0,
  driftPx: 0,
  seed: 1,
  ...over,
});

export type CmjTruth = {
  /** Movement start, lowest point, take-off and landing, s from the start of the clip. */
  startS: number;
  lowS: number;
  takeoffS: number;
  landingS: number;
  peak: number;
  depthM: number;
  takeoffV: number;
  /** The force (× body weight) at every frame up to take-off. */
  force: number[];
};

export type CmjScene = { samples: { t: number; y: number }[]; truth: CmjTruth };

function rng(seed: number) {
  let s = seed >>> 0 || 1;
  const next = () => ((s = (s * 1664525 + 1013904223) >>> 0), s / 2 ** 32);
  return () => Math.sqrt(-2 * Math.log(next() + 1e-12)) * Math.cos(2 * Math.PI * next());
}

export function cmjScene(over: Partial<CmjOptions> = {}): CmjScene {
  const o = defaultCmj(over);
  const force = (t: number): number | null => {
    let tt = t;
    if (tt < o.quietS) return 1;
    tt -= o.quietS;
    if (tt < o.unweightS) return 1 - o.unweightDip * Math.sin((Math.PI * tt) / o.unweightS / 2);
    tt -= o.unweightS;
    const low = 1 - o.unweightDip;
    if (tt < o.brakeS) return low + (o.peak - low) * Math.sin(((Math.PI / 2) * tt) / o.brakeS);
    tt -= o.brakeS;
    if (tt < o.pushS) return o.peak - 0.15 * Math.sin((Math.PI * tt) / o.pushS) - o.peak * Math.max(0, (tt - o.pushS / 2) / (o.pushS / 2)) ** 1.6;
    return null;
  };
  const h = 1 / 2000;
  const path: { t: number; y: number; f: number }[] = [];
  let v = 0;
  let y = 0;
  let t = 0;
  for (;;) {
    const f = force(t);
    if (f == null) break;
    path.push({ t, y, f });
    v += (f - 1) * G * h;
    y += v * h;
    t += h;
  }
  const takeoffS = t;
  const flight = (2 * v) / G;
  const landingS = takeoffS + flight;
  const low = path.reduce((a, p) => (p.y < a.y ? p : a));
  const at = (tt: number) => path[Math.min(path.length - 1, Math.round(tt / h))];
  const noise = rng(o.seed);
  const samples: { t: number; y: number }[] = [];
  const truthForce: number[] = [];
  for (let i = 0; i / o.fps <= landingS + o.afterS; i++) {
    const tt = i / o.fps;
    let rise: number;
    if (tt < takeoffS) {
      rise = at(tt).y;
      truthForce.push(at(tt).f);
    } else if (tt < landingS) rise = y + v * (tt - takeoffS) - (G * (tt - takeoffS) ** 2) / 2;
    else rise = -0.1 * Math.sin(Math.min(1, (tt - landingS) / o.afterS) * Math.PI);
    samples.push({ t: tt, y: o.standY - rise * o.pxPerM + o.noisePx * noise() + (tt >= takeoffS && tt < landingS ? o.driftPx * Math.sin((2 * Math.PI * (tt - takeoffS)) / flight) : 0) });
  }
  return {
    samples,
    truth: { startS: o.quietS, lowS: low.t, takeoffS, landingS, peak: Math.max(...path.map((p) => p.f)), depthM: -low.y, takeoffV: v, force: truthForce },
  };
}
