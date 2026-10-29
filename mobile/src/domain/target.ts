import { addDays, toISODate, type ISODate } from './dates';
import { dayState, tolerance, warmupState, worstState, type BlockType, type DayState } from './dunk';
import { loadNote, type DailyLoad } from './load';
import { kneeStatus, type PainEntry } from './pain';
import { dayReadiness } from './readiness';
import type { RecoveryDay } from './recovery';
import { roundLoad, STOP_LOSS, velocityLoss, type LvProfile } from './vbt';

import { localized, tr } from '@/i18n';

/**
 * The day's pass line for strength work. A day is read from three signals and takes the worst of them:
 * recovery (HRV, resting HR, sleep), today's CMJ, and the warm-up set's bar speed. A fair day allows 5 %
 * and a poor day 10 %, either on the load or on the velocity, as `tolerance` decides.
 */

export const STATE_LABEL: Record<DayState, string> = localized({ good: '好', fair: '一般', poor: '差', unknown: '未知' });

/** Days of warm-up history the day's warm-up is compared with. */
export const WARMUP_WINDOW_DAYS = 30;

export type VelocitySet = { started_at: string; load: number; v: number };

export type WarmupReading = { load: number; v: number; mean: number; n: number; pct: number; state: DayState };

const dayOf = (s: { started_at: string }) => toISODate(new Date(s.started_at));
const sameLoad = (a: number, b: number) => Math.abs(a - b) < 0.01;

/**
 * The warm-up on `date`: the day's fastest set at a load, against the mean of sets at that same load over
 * the previous {@link WARMUP_WINDOW_DAYS} days. With sets at several loads, the load with the most history wins.
 */
export function warmupOn(sets: VelocitySet[], date: ISODate): WarmupReading | null {
  const from = addDays(date, -WARMUP_WINDOW_DAYS);
  const today = sets.filter((s) => s.load > 0 && dayOf(s) === date);
  let found: WarmupReading | null = null;
  for (const load of [...new Set(today.map((s) => s.load))].sort((a, b) => a - b)) {
    const recent = sets.filter((s) => sameLoad(s.load, load) && dayOf(s) < date && dayOf(s) >= from).map((s) => s.v);
    if (recent.length === 0 || (found && recent.length <= found.n)) continue;
    const v = Math.max(...today.filter((s) => sameLoad(s.load, load)).map((s) => s.v));
    const mean = recent.reduce((s, x) => s + x, 0) / recent.length;
    found = { load, v, mean, n: recent.length, pct: v / mean, state: warmupState(v, recent) };
  }
  return found;
}

/** The load warmed up with most often over the last {@link WARMUP_WINDOW_DAYS} days, to keep the warm-up comparable. */
export function usualWarmupLoad(sets: VelocitySet[], date: ISODate): number | null {
  const from = addDays(date, -WARMUP_WINDOW_DAYS);
  const counts = new Map<number, number>();
  for (const s of sets) if (s.load > 0 && dayOf(s) >= from && dayOf(s) <= date) counts.set(s.load, (counts.get(s.load) ?? 0) + 1);
  let found: number | null = null;
  for (const [load, n] of [...counts].sort((a, b) => a[0] - b[0])) if (found == null || n > counts.get(found)!) found = load;
  return found;
}

export type DayInputs = {
  cmj: { started_at: string; best: number }[];
  recovery: RecoveryDay[];
  /** Sets of the VBT lifts that serve as the warm-up (back squat). */
  warmups: VelocitySet[];
  /** Knee pain: a red or stopped knee makes the day poor. */
  pain?: PainEntry[];
  /** Training loads (domain/load.ts): a week well above usual adds to another signal, never alone. */
  loads?: { name: string; entries: DailyLoad[] }[];
};

export type DayReading = { state: DayState; reasons: string[]; warmup: WarmupReading | null };

/**
 * How the athlete is on `date`. `ignore` leaves one signal out, so a test is never judged by itself:
 * a low CMJ must not hide a real drop in CMJ, nor a slow warm-up a drop in squat speed.
 */
export function readDay(inputs: DayInputs, date: ISODate, ignore?: 'cmj' | 'warmup'): DayReading {
  const r = dayReadiness(ignore === 'cmj' ? [] : inputs.cmj, inputs.recovery, date);
  const warmup = ignore === 'warmup' ? null : warmupOn(inputs.warmups, date);
  const reasons = [...r.signals];
  if (r.recovery.status === 'fair') reasons.push(...r.recovery.warnings);
  if (warmup && (warmup.state === 'fair' || warmup.state === 'poor')) {
    reasons.push(tr('热身 {load} kg 速度 {v} m/s，是 30 天均值的 {pct}%', { load: warmup.load, v: warmup.v.toFixed(2), pct: Math.round(warmup.pct * 100) }));
  }
  const knee = kneeStatus(inputs.pain ?? [], date);
  const kneeBad = knee?.light === 'red' || knee?.light === 'stop';
  if (kneeBad) reasons.push(...knee.reasons);
  const state = worstState(dayState(r), warmup?.state ?? 'unknown', kneeBad ? 'poor' : 'unknown');
  // Load up to yesterday, so today's own session doesn't count against it.
  const high = (inputs.loads ?? []).map((l) => loadNote(l.name, l.entries, addDays(date, -1))).filter((n) => n?.high);
  if (high.length && (state === 'fair' || state === 'poor')) {
    reasons.push(...high.map((n) => n!.text));
    return { state: 'poor', reasons: [...new Set(reasons)], warmup };
  }
  return { state, reasons: [...new Set(reasons)], warmup };
}

/** Days among `dates` that were poor and so stay out of progress trends. */
export function poorDays(inputs: DayInputs, dates: ISODate[], ignore?: 'cmj' | 'warmup'): Set<ISODate> {
  return new Set([...new Set(dates)].filter((d) => readDay(inputs, d, ignore).state === 'poor'));
}

/** Which signal a test must not be judged by: its own. */
export function selfSignal(metricCode: string, warmupLifts: string[]): 'cmj' | 'warmup' | undefined {
  if (metricCode === 'cmj') return 'cmj';
  return warmupLifts.includes(metricCode) ? 'warmup' : undefined;
}

export type SetTarget = {
  /** Planned load after the day's allowance. */
  kg: number;
  baseKg: number;
  loadFactor: number;
  velocityTolerance: number;
  /** Mean velocity the load-velocity profile predicts at `kg`; null without a profile. */
  targetV: number | null;
  /** The pass line: slowest mean velocity that still counts as done today. */
  minV: number | null;
};

/**
 * The day's target for a lift planned at `baseKg`. With a load-velocity profile the set is judged by bar
 * speed; without one only the load can give.
 */
export function setTarget(baseKg: number, profile: LvProfile | null, state: DayState, block: BlockType | null): SetTarget {
  const { loadFactor, velocityTolerance } = tolerance(state, block, profile != null);
  const kg = loadFactor === 1 ? baseKg : roundLoad(baseKg * loadFactor);
  const predicted = profile ? profile.intercept + profile.slope * kg : null;
  const targetV = predicted != null && predicted > 0 ? predicted : null;
  return { kg, baseKg, loadFactor, velocityTolerance, targetV, minV: targetV != null ? targetV * (1 - velocityTolerance) : null };
}

/**
 * Whether to stop after a set at mean velocity `v`: below the day's pass line, or more than {@link STOP_LOSS}
 * slower than today's fastest set of the exercise.
 */
export function checkSet(v: number, minV: number | null, fastestToday: number | null): { stop: boolean; why: string | null } {
  if (minV != null && v < minV) return { stop: true, why: tr('这组 {v} m/s，低于今天的达标线 {minV} m/s', { v: v.toFixed(2), minV: minV.toFixed(2) }) };
  if (fastestToday != null && velocityLoss(fastestToday, v) >= STOP_LOSS) {
    return { stop: true, why: tr('比今天最快的一组（{fastestToday} m/s）慢了 {fastestToday2}%', { fastestToday: fastestToday.toFixed(2), fastestToday2: Math.round(velocityLoss(fastestToday, v) * 100) }) };
  }
  return { stop: false, why: null };
}

/** One line on what today's allowance means, for the workout screen. */
export function allowanceText(state: DayState, block: BlockType | null): string | null {
  const plain = tolerance(state, block, false);
  const tracked = tolerance(state, block, true);
  if (plain.loadFactor === 1) return null;
  const pct = Math.round((1 - plain.loadFactor) * 100);
  const withSpeed =
    tracked.velocityTolerance > 0
      ? tr('测了速度的组保持重量，速度低 {velocityTolerance}% 以内仍算完成', { velocityTolerance: Math.round(tracked.velocityTolerance * 100) })
      : tr('测了速度的组减重 {p}%，速度要达到目标', { p: Math.round((1 - tracked.loadFactor) * 100) });
  return tr('今天状态{STATE_LABEL}：推荐重量减 {pct}%；{withSpeed}。', { STATE_LABEL: STATE_LABEL[state], pct, withSpeed });
}
