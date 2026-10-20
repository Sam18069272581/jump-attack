import type { SQLiteDatabase } from 'expo-sqlite';

import { listRecoveryDays } from '@/db/recovery';
import { listSessionResults } from '@/db/repo';
import { getActivePlan, listWorkouts, startWorkout, type Plan, type Workout } from '@/db/training';
import { latestEstimate, listVbtSets } from '@/db/vbt';
import { type Readiness } from '@/domain/assess';
import { daysBetween, toISODate, type ISODate } from '@/domain/dates';
import { adjustForReadiness, planDay, type Adjustment, type PlannedSession, type PlanTemplate, type Prescription, type SessionTemplate } from '@/domain/plan';
import { dayReadiness, fatigueStreak, type DayReadiness } from '@/domain/readiness';
import { getTemplate } from '@/domain/templates';
import { LOAD_FROM_VBT, pctOf1rm, roundLoad } from '@/domain/vbt';

export type { DayReadiness };

export type TrainingData = { plan: Plan; template: PlanTemplate; workouts: Workout[] };

export const todayISO = () => toISODate(new Date());

/** The athlete's active plan with its template and started workouts, or null without one. */
export async function loadTraining(db: SQLiteDatabase, athleteId: number): Promise<TrainingData | null> {
  const plan = await getActivePlan(db, athleteId);
  const template = plan && getTemplate(plan.templateCode);
  if (!plan || !template) return null;
  return { plan, template, workouts: await listWorkouts(db, plan.id) };
}

async function readinessInputs(db: SQLiteDatabase, athleteId: number) {
  return Promise.all([listSessionResults(db, athleteId, 'cmj'), listRecoveryDays(db, athleteId)]);
}

export async function loadReadiness(db: SQLiteDatabase, athleteId: number, date: ISODate): Promise<DayReadiness & { streak: number }> {
  const [cmj, recovery] = await readinessInputs(db, athleteId);
  return { ...dayReadiness(cmj, recovery, date), streak: fatigueStreak(cmj, recovery, date) };
}

/** A 1RM estimate older than this no longer says much about today's strength. */
export const ESTIMATE_MAX_AGE_DAYS = 28;

export type LoadSuggestion = { kg: number; oneRm: number; lift: string };

/**
 * Working weights for plan exercises from the matching VBT lift's latest 1RM estimate, at the share of 1RM
 * that the prescribed reps and RPE call for. Keyed by exercise code.
 */
export async function loadSuggestions(db: SQLiteDatabase, athleteId: number, items: Prescription[], date: ISODate): Promise<Record<string, LoadSuggestion>> {
  const out: Record<string, LoadSuggestion> = {};
  for (const p of items) {
    const lift = LOAD_FROM_VBT[p.code];
    if (!lift) continue;
    const est = latestEstimate(await listVbtSets(db, athleteId, lift), lift);
    if (!est?.oneRm || daysBetween(toISODate(new Date(est.startedAt)), date) > ESTIMATE_MAX_AGE_DAYS) continue;
    out[p.code] = { kg: roundLoad(est.oneRm * pctOf1rm(p.reps, p.rpe ?? 8)), oneRm: est.oneRm, lift };
  }
  return out;
}

/**
 * The session to do on a day. A started workout keeps the readiness it began with; today's not-yet-started
 * session follows the current readiness; any other day is shown as planned.
 */
export function sessionFor(planned: PlannedSession, workout: Workout | null | undefined, readiness: Readiness | null): { session: SessionTemplate; adjustments: Adjustment[] } {
  return adjustForReadiness(planned.session, workout?.readiness ?? readiness ?? 'unknown');
}

/** Starts a day's workout, applying the readiness rule when it is today. Returns the existing one if already started. */
export async function beginWorkout(db: SQLiteDatabase, data: TrainingData, date: ISODate): Promise<Workout | null> {
  const planned = planDay(data.template, data.plan, date);
  if (!planned) return null;
  const r = date === todayISO() ? await loadReadiness(db, data.plan.athleteId, date) : null;
  const readiness = r?.readiness ?? 'unknown';
  const { adjustments } = adjustForReadiness(planned.session, readiness);
  return startWorkout(db, {
    planId: data.plan.id,
    date,
    sessionCode: planned.session.code,
    readiness,
    cmjDrop: r?.today != null ? r.dropPct : null,
    adjustments,
    reason: r?.signals.length ? r.signals.join('；') : null,
  });
}
