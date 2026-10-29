import { FATIGUE_DROP, readinessOn, type Readiness } from './assess';
import { addDays, type ISODate } from './dates';
import { readRecovery, type RecoveryDay, type RecoveryRead } from './recovery';

import { tr } from '@/i18n';

/** A day's readiness from every signal there is: today's CMJ against its baseline, and HRV / resting HR / sleep. */
export type DayReadiness = {
  /** Today's best CMJ, or null when not tested. */
  today: number | null;
  readiness: Readiness;
  dropPct: number;
  recovery: RecoveryRead;
  /** The fatigue signals, in words; empty unless `readiness` is fatigued. */
  signals: string[];
};

type CmjResult = { started_at: string; best: number };

export function dayReadiness(cmj: CmjResult[], recovery: RecoveryDay[], date: ISODate): DayReadiness {
  const c = readinessOn(cmj, date);
  const r = readRecovery(recovery, date);
  const signals: string[] = [];
  if (c.readiness === 'fatigued') signals.push(tr('CMJ 比近期均值低 {dropPct}%（超过 {FATIGUE_DROP}%）', { dropPct: (c.dropPct * 100).toFixed(1), FATIGUE_DROP: FATIGUE_DROP * 100 }));
  if (r.status === 'poor') signals.push(...r.warnings);
  const readiness: Readiness = signals.length ? 'fatigued' : c.readiness === 'ready' || r.status === 'good' || r.status === 'fair' ? 'ready' : 'unknown';
  return { today: c.today, readiness, dropPct: c.dropPct, recovery: r, signals };
}

/** Fatigued readings in a row that call for a deload week rather than another lighter day. */
export const DELOAD_STREAK = 3;

/**
 * How many of the most recent days with a reading were fatigued in a row, looking back `lookback` days.
 * Days with no CMJ or recovery data are skipped rather than breaking the streak.
 */
export function fatigueStreak(cmj: CmjResult[], recovery: RecoveryDay[], date: ISODate, lookback = 7): number {
  let streak = 0;
  for (let i = 0; i < lookback; i++) {
    const r = dayReadiness(cmj, recovery, addDays(date, -i));
    if (r.readiness === 'unknown') continue;
    if (r.readiness !== 'fatigued') break;
    streak++;
  }
  return streak;
}
