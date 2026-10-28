import { toISODate, type ISODate } from './dates';

export function mean(xs: number[]): number {
  if (xs.length === 0) throw new Error('mean of empty list');
  return xs.reduce((s, x) => s + x, 0) / xs.length;
}

/** Sample standard deviation (n − 1). Returns 0 for fewer than two values. */
export function sd(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1));
}

/** Smallest worthwhile change: 0.2 × between-session SD. */
export function smallestWorthwhileChange(history: number[]): number {
  return 0.2 * sd(history);
}

export type ChangeVerdict = 'better' | 'worse' | 'trivial' | 'unknown';

/**
 * Compares a new value with the athlete's own baseline (mean of earlier results).
 * A change only counts when it exceeds the smallest worthwhile change, so test noise isn't read as progress.
 * Needs at least three earlier results to have a meaningful SD.
 */
export function judgeChange(history: number[], latest: number, lowerIsBetter = false): { verdict: ChangeVerdict; delta: number; swc: number } {
  if (history.length < 3) return { verdict: 'unknown', delta: history.length ? latest - mean(history) : 0, swc: 0 };
  const baseline = mean(history);
  const delta = latest - baseline;
  const swc = smallestWorthwhileChange(history);
  if (Math.abs(delta) <= swc) return { verdict: 'trivial', delta, swc };
  const improved = lowerIsBetter ? delta < 0 : delta > 0;
  return { verdict: improved ? 'better' : 'worse', delta, swc };
}

/** CMJ drop vs. baseline that we treat as a neuromuscular fatigue signal. */
export const FATIGUE_DROP = 0.05;

export type Readiness = 'ready' | 'fatigued' | 'unknown';

/**
 * Readiness from today's CMJ against the rolling baseline of the previous `window` sessions.
 * A drop larger than {@link FATIGUE_DROP} flags fatigue.
 */
export function cmjReadiness(previous: number[], today: number, window = 7): { readiness: Readiness; dropPct: number } {
  const recent = previous.slice(-window);
  if (recent.length < 3) return { readiness: 'unknown', dropPct: 0 };
  const baseline = mean(recent);
  const dropPct = (baseline - today) / baseline;
  return { readiness: dropPct > FATIGUE_DROP ? 'fatigued' : 'ready', dropPct };
}

/**
 * Readiness on `date` from CMJ session results: the day's best against the sessions on earlier days.
 * `today` is null when CMJ hasn't been tested that day.
 */
export function readinessOn(results: { started_at: string; best: number }[], date: ISODate): { today: number | null; readiness: Readiness; dropPct: number } {
  const dayOf = (r: { started_at: string }) => toISODate(new Date(r.started_at));
  const todays = results.filter((r) => dayOf(r) === date).map((r) => r.best);
  if (todays.length === 0) return { today: null, readiness: 'unknown', dropPct: 0 };
  const before = results.filter((r) => dayOf(r) < date).map((r) => r.best);
  const today = Math.max(...todays);
  return { today, ...cmjReadiness(before, today) };
}

/** Whether a result was recorded on one of the `poor` days (days the athlete was in poor shape). */
export function onPoorDay(r: { started_at: string }, poor?: ReadonlySet<ISODate>): boolean {
  return poor?.has(toISODate(new Date(r.started_at))) ?? false;
}

/**
 * What session `sessionId` is judged against: the bests of the sessions before it, leaving out those from
 * `poor` days so one bad day doesn't drag the trend down, and whether the session itself fell on a poor day
 * (it then doesn't count toward the trend either). `results` are in recording order.
 */
export function trendBaseline<T extends { session_id: string; started_at: string; best: number }>(
  results: T[],
  sessionId: string,
  poor?: ReadonlySet<ISODate>,
): { previous: number[]; poorDay: boolean } {
  const i = results.findIndex((r) => r.session_id === sessionId);
  const earlier = i < 0 ? results : results.slice(0, i);
  return { previous: earlier.filter((r) => !onPoorDay(r, poor)).map((r) => r.best), poorDay: i >= 0 && onPoorDay(results[i], poor) };
}
