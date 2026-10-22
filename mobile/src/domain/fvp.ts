/**
 * Vertical force-velocity profile from loaded squat jumps (Samozino's simple method), compared with the profile
 * that would jump highest for the same power. Forces are per kg of body mass (N/kg).
 *
 * References: Samozino et al. 2008 / 2012; Jiménez-Reyes et al. 2017 (IJSPP 12:36, Front Physiol 7:677).
 */
import { G } from './jump';

/** Push-off distance (m): extended leg length (greater trochanter to tiptoe) minus trochanter height at the 90° start. */
export function pushOff(legLengthCm: number, squatHeightCm: number): number | null {
  const hpo = (legLengthCm - squatHeightCm) / 100;
  // Shorter than 15 cm or longer than 70 cm is a typo, not a leg.
  return hpo >= 0.15 && hpo <= 0.7 ? hpo : null;
}

/** Mean push-off force (N per kg of body mass) and velocity (m/s) of one jump. */
export function jumpForceVelocity(massKg: number, loadKg: number, heightM: number, hpoM: number): { f: number; v: number } {
  return { f: (((massKg + loadKg) * G) / massKg) * (heightM / hpoM + 1), v: Math.sqrt((G * heightM) / 2) };
}

/** Highest jump a profile allows: constant mean force along the push-off, falling linearly with velocity. */
export function maxJumpHeight(f0: number, v0: number, hpoM: number): number {
  const a = (hpoM * f0) / v0;
  const disc = a * a + 8 * hpoM * (f0 - G);
  if (f0 <= G || disc <= 0) return 0;
  const takeoff = (-a + Math.sqrt(disc)) / 2;
  return (takeoff * takeoff) / (2 * G);
}

/** F0 and v0 of the line with power `pmax` (W/kg) and slope `sfv` (N·s/m/kg, negative). */
export function profileFromPower(pmax: number, sfv: number): { f0: number; v0: number } {
  return { f0: 2 * Math.sqrt(-pmax * sfv), v0: 2 * Math.sqrt(-pmax / sfv) };
}

/** The slope that jumps highest for this power and push-off distance, by golden-section search. */
export function optimalSlope(pmax: number, hpoM: number): number {
  const height = (s: number) => {
    const { f0, v0 } = profileFromPower(pmax, s);
    return maxJumpHeight(f0, v0, hpoM);
  };
  let lo = -200;
  let hi = -0.5;
  const r = (Math.sqrt(5) - 1) / 2;
  for (let i = 0; i < 120; i++) {
    const c = hi - r * (hi - lo);
    const d = lo + r * (hi - lo);
    if (height(c) > height(d)) hi = d;
    else lo = c;
  }
  return (lo + hi) / 2;
}

export type FvJump = { loadKg: number; heightCm: number };

export type FvProfile = {
  /** Force at zero velocity, N/kg. */
  f0: number;
  /** Velocity at zero force, m/s. */
  v0: number;
  /** Maximal power, W/kg. */
  pmax: number;
  /** Slope of the line, N·s/m/kg. */
  sfv: number;
  sfvOpt: number;
  /** Actual slope as a share of the optimal one; 100 is balanced, lower lacks force, higher lacks velocity. */
  fvPct: number;
  r2: number;
  /** One point per load: what the line was fitted through. */
  points: { loadKg: number; heightCm: number; f: number; v: number }[];
  /** Unloaded jump height the optimal profile would reach with the same power, cm. */
  optimalHeightCm: number;
};

/** One height per load: the mean of the best two jumps, so one lucky or sloppy jump moves the line less. */
export function heightPerLoad(jumps: FvJump[]): { loadKg: number; heightCm: number }[] {
  const byLoad = new Map<number, number[]>();
  for (const j of jumps) byLoad.set(j.loadKg, [...(byLoad.get(j.loadKg) ?? []), j.heightCm]);
  return [...byLoad.entries()]
    .sort(([a], [b]) => a - b)
    .map(([loadKg, hs]) => {
      const top = [...hs].sort((a, b) => b - a).slice(0, 2);
      return { loadKg, heightCm: top.reduce((s, h) => s + h, 0) / top.length };
    });
}

/**
 * Least-squares force-velocity line through the jumps of one test. Needs two or more loads and force falling as
 * velocity rises; returns null otherwise.
 */
export function fvProfile(massKg: number, hpoM: number, jumps: FvJump[]): FvProfile | null {
  if (massKg <= 0 || hpoM <= 0) return null;
  const points = heightPerLoad(jumps)
    .filter((p) => p.heightCm > 0)
    .map((p) => ({ ...p, ...jumpForceVelocity(massKg, p.loadKg, p.heightCm / 100, hpoM) }));
  const n = points.length;
  if (n < 2) return null;
  const mv = points.reduce((s, p) => s + p.v, 0) / n;
  const mf = points.reduce((s, p) => s + p.f, 0) / n;
  const svv = points.reduce((s, p) => s + (p.v - mv) ** 2, 0);
  const svf = points.reduce((s, p) => s + (p.v - mv) * (p.f - mf), 0);
  const sff = points.reduce((s, p) => s + (p.f - mf) ** 2, 0);
  if (svv === 0) return null;
  const sfv = svf / svv;
  if (sfv >= 0) return null;
  const f0 = mf - sfv * mv;
  const v0 = -f0 / sfv;
  const pmax = (f0 * v0) / 4;
  const sfvOpt = optimalSlope(pmax, hpoM);
  const opt = profileFromPower(pmax, sfvOpt);
  return {
    f0,
    v0,
    pmax,
    sfv,
    sfvOpt,
    fvPct: (sfv / sfvOpt) * 100,
    r2: sff === 0 ? 1 : (svf * svf) / (svv * sff),
    points,
    optimalHeightCm: maxJumpHeight(opt.f0, opt.v0, hpoM) * 100,
  };
}

/** Points this far off a straight line usually mean a mis-marked frame or a jump with a dip before it. */
export const MIN_R2 = 0.95;

export type Side = 'force' | 'balanced' | 'velocity';

/** Training emphasis for a profile; the exercise mix is out of six exercises a week (Jiménez-Reyes 2017). */
export type FvBand = {
  key: string;
  name: string;
  side: Side;
  /** FV% range, lower bound inclusive. */
  min: number;
  max: number;
  mix: { kind: string; n: number }[];
  /** Velocity loss that ends a set, as a fraction (Weakley 2020: smaller limits keep power, larger build strength). */
  velocityLoss: number;
};

export const FV_BANDS: FvBand[] = [
  {
    key: 'force-high',
    name: '力量明显不足',
    side: 'force',
    min: -Infinity,
    max: 60,
    mix: [
      { kind: '力量', n: 3 },
      { kind: '力量-爆发', n: 2 },
      { kind: '爆发', n: 1 },
    ],
    velocityLoss: 0.2,
  },
  {
    key: 'force-low',
    name: '力量轻度不足',
    side: 'force',
    min: 60,
    max: 90,
    mix: [
      { kind: '力量', n: 2 },
      { kind: '力量-爆发', n: 2 },
      { kind: '爆发', n: 2 },
    ],
    velocityLoss: 0.2,
  },
  {
    key: 'balanced',
    name: '均衡',
    side: 'balanced',
    min: 90,
    max: 110,
    mix: [
      { kind: '力量', n: 1 },
      { kind: '力量-爆发', n: 1 },
      { kind: '爆发', n: 2 },
      { kind: '爆发-速度', n: 1 },
      { kind: '速度', n: 1 },
    ],
    velocityLoss: 0.15,
  },
  {
    key: 'velocity-low',
    name: '速度轻度不足',
    side: 'velocity',
    min: 110,
    max: 140,
    mix: [
      { kind: '爆发', n: 2 },
      { kind: '爆发-速度', n: 2 },
      { kind: '速度', n: 2 },
    ],
    velocityLoss: 0.1,
  },
  {
    key: 'velocity-high',
    name: '速度明显不足',
    side: 'velocity',
    min: 140,
    max: Infinity,
    mix: [
      { kind: '爆发', n: 1 },
      { kind: '爆发-速度', n: 2 },
      { kind: '速度', n: 3 },
    ],
    velocityLoss: 0.1,
  },
];

/** What each kind of exercise is, with loads from Jiménez-Reyes 2017 and the app's VBT zones. */
export const EXERCISE_KINDS: { kind: string; what: string; zone: string }[] = [
  { kind: '力量', what: '后蹲 80–90% 1RM，腿举 / 硬拉 90–95% 1RM', zone: '绝对力量 < 0.5 m/s' },
  { kind: '力量-爆发', what: '硬拉 / 高拉 80% 1RM，蹲跳 > 70% 体重，CMJ > 80% 体重', zone: '加速力量 0.5–0.75 m/s' },
  { kind: '爆发', what: '蹲跳 20–30% 体重，CMJ 35–45% 体重，单腿跳，悬垂高拉跳 65% 1RM', zone: '0.75–1.3 m/s' },
  { kind: '爆发-速度', what: '跳深，徒手蹲跳，CMJ + 10% 体重，最大跳箱', zone: '速度 > 1.3 m/s' },
  { kind: '速度', what: '弹力带助力跳（比体重轻），带摆臂 CMJ', zone: '速度 > 1.3 m/s' },
];

export function bandOf(fvPct: number): FvBand {
  return FV_BANDS.find((b) => fvPct < b.max) ?? FV_BANDS[FV_BANDS.length - 1];
}

/** How far past the balanced range a single test has to land to be trusted on its own. */
const CLEAR_MARGIN = 10;

/**
 * The emphasis to train by, from FV% of each test, oldest first. One test's slope is noisy (repeat-test CV
 * 14–30 %, Lindberg 2021), so the side only counts as confirmed when the last two tests agree or the latest is
 * clearly outside the balanced range.
 */
export function suggestion(history: number[]): { band: FvBand; confirmed: boolean } | null {
  const latest = history.at(-1);
  if (latest == null) return null;
  const band = bandOf(latest);
  const previous = history.at(-2);
  const balanced = FV_BANDS.find((b) => b.side === 'balanced')!;
  const clear = latest < balanced.min - CLEAR_MARGIN || latest >= balanced.max + CLEAR_MARGIN;
  const agrees = previous != null && bandOf(previous).side === band.side;
  return { band, confirmed: agrees || clear };
}

/** Test loads: body weight plus about 25, 50 and 75 % of body mass on the bar, rounded to plates. */
export function suggestedLoads(massKg: number, step = 2.5): number[] {
  return [0, 0.25, 0.5, 0.75].map((f) => Math.round((massKg * f) / step) * step);
}
