import { daysBetween, type ISODate } from './dates';
import { isJump, type Prescription } from './plan';

/**
 * Training load the way trackload (github.com/Sam18069272581/trackload) tracks it: a daily load, an acute and a
 * chronic exponentially weighted average, and their ratio (ACWR). Two loads use it: session RPE × minutes for
 * training as a whole, and jump count for the knees.
 *
 * The ratio is read as "this week against what you are used to", nothing more: its link to injury is disputed
 * (Impellizzeri 2020), so the app never calls it an injury risk.
 */

export type DailyLoad = { date: ISODate; load: number };

/** λ = 2 ÷ (N + 1): 7 days acute, 28 days chronic. */
export const ACUTE_LAMBDA = 2 / (7 + 1);
export const CHRONIC_LAMBDA = 2 / (28 + 1);

/** The chronic average needs this many days before it is reliable (trackload's own note). */
export const MIN_LOAD_DAYS = 28;

/** Above this the week counts as a fatigue signal (domain/target.ts). */
export const ACWR_HIGH = 1.5;

/** Within ±10% of usual reads as no change. */
const SAME_PCT = 10;

/** EWMA_today = load × λ + EWMA_yesterday × (1 − λ); the first day starts at its own load. */
export function ewma(loads: number[], lambda: number): number[] {
  const out: number[] = [];
  loads.forEach((x, i) => out.push(i === 0 ? x : x * lambda + out[i - 1] * (1 - lambda)));
  return out;
}

/** One load per day from the first recorded day through `asOf`, zero on days without training. */
function daily(loads: DailyLoad[], asOf: ISODate): number[] {
  const first = loads.reduce<ISODate | null>((a, l) => (a == null || l.date < a ? l.date : a), null);
  if (!first || asOf < first) return [];
  const series = Array<number>(daysBetween(first, asOf) + 1).fill(0);
  for (const l of loads) if (l.date <= asOf) series[daysBetween(first, l.date)] += l.load;
  return series;
}

/** Acute ÷ chronic load on `asOf`; null before {@link MIN_LOAD_DAYS} days of records or with no chronic load. */
export function acwrOn(loads: DailyLoad[], asOf: ISODate): number | null {
  const series = daily(loads, asOf);
  if (series.length < MIN_LOAD_DAYS) return null;
  const chronic = ewma(series, CHRONIC_LAMBDA).at(-1)!;
  return chronic > 0 ? ewma(series, ACUTE_LAMBDA).at(-1)! / chronic : null;
}

/** Session RPE (0–10) × minutes, in arbitrary units. */
export function sessionLoad(minutes: number | null, rpe: number | null): number | null {
  return minutes != null && rpe != null ? minutes * rpe : null;
}

/** Longer than this between start and finish means the workout was closed later, not trained that long. */
const MAX_MINUTES = 240;

/** Whole minutes from start to finish, or null when unfinished or not believable. */
export function workoutMinutes(startedAt: string, finishedAt: string | null): number | null {
  if (!finishedAt) return null;
  const m = Math.round((Date.parse(finishedAt) - Date.parse(startedAt)) / 60000);
  return m >= 1 && m <= MAX_MINUTES ? m : null;
}

const change = (pct: number) => (Math.abs(pct) < SAME_PCT ? '差不多' : `${pct > 0 ? '高' : '低'} ${Math.abs(pct)}%`);

/**
 * One line on a load: against what the athlete is used to once there are 28 days, else the last 7 days against the
 * 7 before. Null with nothing recorded.
 */
export function loadNote(name: string, loads: DailyLoad[], asOf: ISODate): { text: string; high: boolean } | null {
  const series = daily(loads, asOf);
  if (series.length === 0) return null;
  const ratio = acwrOn(loads, asOf);
  if (ratio != null) {
    const pct = Math.round((ratio - 1) * 100);
    return { text: `${name}：这周${Math.abs(pct) < SAME_PCT ? '和你习惯的差不多' : `比你习惯的${change(pct)}`}`, high: ratio > ACWR_HIGH };
  }
  const sum = (from: number, to: number) => series.slice(Math.max(0, series.length - to), series.length - from).reduce((a, b) => a + b, 0);
  const week = sum(0, 7);
  const before = sum(7, 14);
  if (before === 0 || series.length < 14) return { text: `${name}：记满 ${MIN_LOAD_DAYS} 天后，再和你习惯的负荷比`, high: false };
  return { text: `${name}：最近 7 天比之前 7 天${change(Math.round((week / before - 1) * 100))}`, high: false };
}

/** A logged set with the exercise it was prescribed as (undefined when no template has that code any more). */
export type JumpSet = { date: ISODate; reps: number; exercise: Prescription | undefined };

/** Ground contacts per day, the knees' load: ticked jump sets (single-leg ones twice) plus jump-test attempts. */
export function jumpLoads(sets: JumpSet[], tests: { date: ISODate; jumps: number }[]): DailyLoad[] {
  const byDay = new Map<ISODate, number>();
  const add = (date: ISODate, n: number) => byDay.set(date, (byDay.get(date) ?? 0) + n);
  for (const s of sets) if (s.exercise && isJump(s.exercise)) add(s.date, s.exercise.perSide ? s.reps * 2 : s.reps);
  for (const t of tests) add(t.date, t.jumps);
  return [...byDay].sort((a, b) => a[0].localeCompare(b[0])).map(([date, load]) => ({ date, load }));
}
