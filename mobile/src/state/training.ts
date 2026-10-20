import type { SQLiteDatabase } from 'expo-sqlite';

import { listSessionResults } from '@/db/repo';
import { getActivePlan, listWorkouts, startWorkout, type Plan, type Workout } from '@/db/training';
import { readinessOn, type Readiness } from '@/domain/assess';
import { toISODate, type ISODate } from '@/domain/dates';
import { adjustForReadiness, planDay, type Adjustment, type PlannedSession, type PlanTemplate, type SessionTemplate } from '@/domain/plan';
import { getTemplate } from '@/domain/templates';

export type DayReadiness = { today: number | null; readiness: Readiness; dropPct: number };

export type TrainingData = { plan: Plan; template: PlanTemplate; workouts: Workout[] };

export const todayISO = () => toISODate(new Date());

/** The athlete's active plan with its template and started workouts, or null without one. */
export async function loadTraining(db: SQLiteDatabase, athleteId: number): Promise<TrainingData | null> {
  const plan = await getActivePlan(db, athleteId);
  const template = plan && getTemplate(plan.templateCode);
  if (!plan || !template) return null;
  return { plan, template, workouts: await listWorkouts(db, plan.id) };
}

export async function loadReadiness(db: SQLiteDatabase, athleteId: number, date: ISODate): Promise<DayReadiness> {
  return readinessOn(await listSessionResults(db, athleteId, 'cmj'), date);
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
    cmjDrop: readiness === 'unknown' ? null : r!.dropPct,
    adjustments,
  });
}
