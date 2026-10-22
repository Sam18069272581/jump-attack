import type { SQLiteDatabase } from 'expo-sqlite';

import { listRecoveryDays } from '@/db/recovery';
import { listSessionResults } from '@/db/repo';
import { getActivePlan, listWorkouts, startWorkout, type Plan, type Workout } from '@/db/training';
import { latestEstimate, listVbtSets } from '@/db/vbt';
import { countedResults, type Readiness } from '@/domain/assess';
import { daysBetween, toISODate, type ISODate } from '@/domain/dates';
import { worstState, type BlockType, type DayState } from '@/domain/dunk';
import { adjustForReadiness, blockOn, planDay, type Adjustment, type PlannedSession, type PlanTemplate, type Prescription, type SessionTemplate } from '@/domain/plan';
import { dayReadiness, fatigueStreak, type DayReadiness } from '@/domain/readiness';
import { poorDays, readDay, selfSignal, setTarget, type DayInputs, type DayReading, type SetTarget } from '@/domain/target';
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

/** The day's condition and the training block it falls in, which together set how much the targets give. */
export type Day = { state: DayState; block: BlockType | null };

/** `kg` is the working weight after the day's allowance; `baseKg` the one the 1RM alone calls for. */
export type LoadSuggestion = SetTarget & { oneRm: number; lift: string };

/**
 * Working weights for plan exercises from the matching VBT lift's latest 1RM estimate, at the share of 1RM
 * that the prescribed reps and RPE call for, then eased for the day's condition with the bar speed to aim
 * for. Keyed by exercise code.
 */
export async function loadSuggestions(
  db: SQLiteDatabase,
  athleteId: number,
  items: Prescription[],
  date: ISODate,
  day: Day = { state: 'unknown', block: null },
): Promise<Record<string, LoadSuggestion>> {
  const out: Record<string, LoadSuggestion> = {};
  for (const p of items) {
    const lift = LOAD_FROM_VBT[p.code];
    if (!lift) continue;
    const est = latestEstimate(await listVbtSets(db, athleteId, lift), lift);
    if (!est?.oneRm || daysBetween(toISODate(new Date(est.startedAt)), date) > ESTIMATE_MAX_AGE_DAYS) continue;
    const base = roundLoad(est.oneRm * pctOf1rm(p.reps, p.rpe ?? 8));
    out[p.code] = { ...setTarget(base, est.profile, day.state, day.block), oneRm: est.oneRm, lift };
  }
  return out;
}

/** VBT lifts whose sets double as the strength-day warm-up. */
export const WARMUP_LIFTS = [...new Set(Object.values(LOAD_FROM_VBT))];

export async function loadDayInputs(db: SQLiteDatabase, athleteId: number): Promise<DayInputs> {
  const [[cmj, recovery], warmups] = await Promise.all([readinessInputs(db, athleteId), Promise.all(WARMUP_LIFTS.map((l) => listVbtSets(db, athleteId, l)))]);
  return { cmj, recovery, warmups: warmups.flat() };
}

/**
 * The day's condition for a workout. A workout that started fatigued stays at least poor, as its cut volume
 * already assumed; a warm-up logged since can only make the day worse.
 */
export async function loadDay(db: SQLiteDatabase, plan: Plan, date: ISODate, workout?: Workout | null): Promise<Day & DayReading> {
  const reading = readDay(await loadDayInputs(db, plan.athleteId), date);
  const state = worstState(reading.state, workout?.readiness === 'fatigued' ? 'poor' : 'unknown');
  return { ...reading, state, block: blockOn(plan, date) };
}

/** Days among `dates` the athlete was in poor shape, judged without the metric's own signal. */
export async function loadPoorDays(db: SQLiteDatabase, athleteId: number, metricCode: string, dates: ISODate[]): Promise<Set<ISODate>> {
  return poorDays(await loadDayInputs(db, athleteId), dates, selfSignal(metricCode, WARMUP_LIFTS));
}

/** A metric's results split into those that count toward progress and the poor days left out. */
export async function countedTrend<T extends { started_at: string }>(
  db: SQLiteDatabase,
  athleteId: number,
  metricCode: string,
  results: T[],
): Promise<{ counted: T[]; poor: Set<ISODate> }> {
  const poor = await loadPoorDays(db, athleteId, metricCode, results.map((r) => toISODate(new Date(r.started_at))));
  return { counted: countedResults(results, poor), poor };
}

/** Shown with a result from a poor day. */
export const POOR_DAY_NOTE = '今天状态差（恢复、CMJ 或热身速度偏低），这次成绩不计入进步趋势，也不拉低基线。';

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
