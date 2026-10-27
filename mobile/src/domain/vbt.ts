/** Velocity-based training: zones, velocity loss, and the load-velocity profile that estimates 1RM. */

export type Zone = { key: string; name: string; min: number; max: number };

/** Mean concentric velocity zones (m/s), as in the design's VBT screen. */
export const ZONES: Zone[] = [
  { key: 'absolute', name: '绝对力量', min: 0, max: 0.5 },
  { key: 'accel', name: '加速力量', min: 0.5, max: 0.75 },
  { key: 'strength-speed', name: '力量-速度', min: 0.75, max: 1.0 },
  { key: 'speed-strength', name: '速度-力量', min: 1.0, max: 1.3 },
  { key: 'speed', name: '速度', min: 1.3, max: Infinity },
];

export function zoneOf(v: number): Zone {
  return ZONES.find((z) => v < z.max) ?? ZONES[ZONES.length - 1];
}

/** Velocity loss that ends a set: past it, fatigue rather than intent is driving the reps. */
export const STOP_LOSS = 0.2;

/** How much slower `v` is than the fastest set at the same load, as a fraction (0.2 = 20 % slower). */
export function velocityLoss(fastest: number, v: number): number {
  return fastest > 0 ? Math.max(0, (fastest - v) / fastest) : 0;
}

/** Mean velocity at a true 1RM; only the back squat has a well-established value. */
export const MVT: Record<string, number> = { vbt_squat: 0.3 };

export type LvPoint = { load: number; v: number };
export type LvProfile = { intercept: number; slope: number; r2: number; n: number };

/**
 * Least-squares line through load (kg) → mean velocity (m/s). Needs at least two different loads and
 * velocity that falls as load rises; otherwise there is no profile to read.
 */
export function lvProfile(points: LvPoint[]): LvProfile | null {
  const n = points.length;
  if (n < 2) return null;
  const mx = points.reduce((s, p) => s + p.load, 0) / n;
  const my = points.reduce((s, p) => s + p.v, 0) / n;
  const sxx = points.reduce((s, p) => s + (p.load - mx) ** 2, 0);
  if (sxx === 0) return null;
  const sxy = points.reduce((s, p) => s + (p.load - mx) * (p.v - my), 0);
  const slope = sxy / sxx;
  if (slope >= 0) return null;
  const intercept = my - slope * mx;
  const syy = points.reduce((s, p) => s + (p.v - my) ** 2, 0);
  const r2 = syy === 0 ? 1 : (sxy * sxy) / (sxx * syy);
  return { intercept, slope, r2, n };
}

/** Load (kg) that the profile says moves at `v` m/s. */
export function loadAt(p: LvProfile, v: number): number {
  return (v - p.intercept) / p.slope;
}

/** Estimated 1RM: the load whose predicted velocity is the minimum velocity threshold. */
export function estimate1rm(p: LvProfile, mvt: number): number {
  return loadAt(p, mvt);
}

/**
 * When a load-velocity line can be trusted to reach all the way to 1RM. Extrapolating from light sets multiplies
 * any error in the measured speeds: a squat profile from three warm-ups that are each 0.1 m/s too fast puts 1RM
 * tens of kilograms too high. So the line needs three different loads, a heaviest set slow enough to be within
 * reach of 1RM (0.75 m/s is about 70 % for a squat), and points that sit on a line.
 */
export const ONE_RM_RULES = { minLoads: 3, heaviestV: 0.75, minR2: 0.9 };

export type OneRmProblem = 'few-loads' | 'too-light' | 'scatter';

export const ONE_RM_PROBLEMS: Record<OneRmProblem, string> = {
  'few-loads': `至少要 ${ONE_RM_RULES.minLoads} 个不同重量才估 1RM`,
  'too-light': `最重一组要慢到 ${ONE_RM_RULES.heaviestV} m/s 以下才估 1RM，太轻的重量往外推误差很大`,
  scatter: '这几组的速度不在一条线上，估不准 1RM：检查是不是有一组测错了',
};

/** The fastest set at each load: a slower one at the same load is fatigue, not the load. */
export function fastestPerLoad(points: LvPoint[]): LvPoint[] {
  const best = new Map<number, number>();
  for (const p of points) if (p.load > 0) best.set(p.load, Math.max(best.get(p.load) ?? 0, p.v));
  return [...best].map(([load, v]) => ({ load, v }));
}

export type OneRmEstimate = { profile: LvProfile; oneRm: number | null; problem: OneRmProblem | null };

/** The load-velocity profile of a session's sets and, if it passes `ONE_RM_RULES`, the 1RM at `mvt`. */
export function checkedOneRm(points: LvPoint[], mvt: number | undefined): OneRmEstimate | null {
  const best = fastestPerLoad(points);
  const profile = lvProfile(best);
  if (!profile) return null;
  const problem: OneRmProblem | null =
    best.length < ONE_RM_RULES.minLoads
      ? 'few-loads'
      : Math.min(...best.map((p) => p.v)) > ONE_RM_RULES.heaviestV
        ? 'too-light'
        : profile.r2 < ONE_RM_RULES.minR2
          ? 'scatter'
          : null;
  const kg = mvt != null && problem == null ? estimate1rm(profile, mvt) : null;
  return { profile, oneRm: kg != null && Number.isFinite(kg) && kg > 0 ? kg : null, problem: mvt != null ? problem : null };
}

/**
 * Mean velocities typed for a set, one per rep, as VBT apps show them: "0.62 0.60 0.55". Spaces, Chinese commas,
 * slashes or semicolons separate them; so does a comma when the numbers use decimal points ("0.62,0.60").
 * A lone "0,62" is a decimal comma. Returns null if any part isn't a number.
 */
export function parseRepVelocities(input: string): number[] | null {
  const s = input.trim();
  if (!s) return null;
  const sep = s.includes('.') ? /[\s、，,;；/]+/ : /[\s、，;；/]+/;
  const out: number[] = [];
  for (const part of s.split(sep)) {
    if (!part) continue;
    const n = Number(part.replace(',', '.'));
    if (!Number.isFinite(n)) return null;
    out.push(n);
  }
  return out.length ? out : null;
}

/**
 * Share of 1RM for `reps` at an RPE, from Epley with reps in reserve:
 * a set of r reps at RPE x is as hard as r + (10 − x) reps to failure.
 */
export function pctOf1rm(reps: number, rpe: number): number {
  return 1 / (1 + (reps + (10 - rpe)) / 30);
}

export function roundLoad(kg: number, step = 2.5): number {
  return Math.round(kg / step) * step;
}

/** Plan exercises whose working load can be set from a VBT lift's 1RM estimate. */
export const LOAD_FROM_VBT: Record<string, string> = { back_squat: 'vbt_squat' };
