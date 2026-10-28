import type { SQLiteDatabase } from 'expo-sqlite';

import { listDropJumps } from '@/db/jumps';
import { listCmjMeans } from '@/db/load';
import { listPain } from '@/db/pain';
import { listRecoveryDays } from '@/db/recovery';
import { getActivePlan, listWorkouts, startWorkout, type Plan, type Workout } from '@/db/training';
import { current1rm, ESTIMATE_MAX_AGE_DAYS, latestOneRm, listVbtSets } from '@/db/vbt';
import { type Readiness } from '@/domain/assess';
import { daysBetween, toISODate, type ISODate } from '@/domain/dates';
import { ladder } from '@/domain/dropJump';
import { worstState, type BlockType, type DayState } from '@/domain/dunk';
import {
  adjustForReadiness,
  blockOn,
  planDay,
  type Adjustment,
  type PersonalNumbers,
  type PlannedSession,
  type PlanTemplate,
  type Prescription,
  type SessionTemplate,
} from '@/domain/plan';
import { adjustForKnee, kneeStatus, type KneeLight } from '@/domain/pain';
import { dayReadiness, fatigueStreak, type DayReadiness } from '@/domain/readiness';
import { poorDays, readDay, selfSignal, setTarget, type DayInputs, type DayReading, type SetTarget } from '@/domain/target';
import { getTemplate } from '@/domain/templates';
import { LOAD_FROM_VBT, pctOf1rm, roundLoad } from '@/domain/vbt';

import { loadTrainingLoads } from './load';

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

/** CMJ for readiness is each session's mean of its best 3 jumps (db/load.ts), today and in the baseline alike. */
async function readinessInputs(db: SQLiteDatabase, athleteId: number) {
  return Promise.all([listCmjMeans(db, athleteId), listRecoveryDays(db, athleteId)]);
}

export async function loadReadiness(db: SQLiteDatabase, athleteId: number, date: ISODate): Promise<DayReadiness & { streak: number }> {
  const [cmj, recovery] = await readinessInputs(db, athleteId);
  return { ...dayReadiness(cmj, recovery, date), streak: fatigueStreak(cmj, recovery, date) };
}

/** The day's condition and the training block it falls in, which together set how much the targets give. */
export type Day = { state: DayState; block: BlockType | null };

/** `kg` is the working weight after the day's allowance; `baseKg` the one the 1RM alone calls for. */
export type LoadSuggestion = SetTarget & { oneRm: number; lift: string; source: 'tested' | 'velocity' };

/**
 * Working weights for plan exercises at the share of 1RM that the prescribed reps and RPE call for, then eased
 * for the day's condition with the bar speed to aim for, keyed by exercise code. The 1RM is one the athlete
 * actually lifted when there is a recent one (squat only), otherwise the matching VBT lift's latest estimate
 * that passed its checks; the bar speed comes from that estimate's load-velocity profile.
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
    const pick = await current1rm(db, athleteId, lift, date);
    if (!pick) continue;
    const est = latestOneRm(await listVbtSets(db, athleteId, lift), lift);
    const profile = est && daysBetween(toISODate(new Date(est.startedAt)), date) <= ESTIMATE_MAX_AGE_DAYS ? est.profile : null;
    const base = roundLoad(pick.kg * pctOf1rm(p.reps, p.rpe ?? 8));
    out[p.code] = { ...setTarget(base, profile, day.state, day.block), oneRm: pick.kg, lift, source: pick.source };
  }
  return out;
}

/**
 * The tested numbers exercise cues point at (domain/plan.ts personalNote): the best box of the latest drop-jump
 * ladder, and the squat 1RM to load from (see `current1rm`).
 */
export async function loadPersonalNumbers(db: SQLiteDatabase, athleteId: number, date: ISODate): Promise<PersonalNumbers> {
  const [drops, squat] = await Promise.all([listDropJumps(db, athleteId), current1rm(db, athleteId, 'vbt_squat', date)]);
  const lastLadder = drops.filter((j) => j.session_id === drops.at(-1)?.session_id);
  return { bestBoxCm: ladder(lastLadder).best?.boxCm ?? null, squat1rmKg: squat?.kg ?? null };
}

/** VBT lifts whose sets double as the strength-day warm-up. */
export const WARMUP_LIFTS = [...new Set(Object.values(LOAD_FROM_VBT))];

export async function loadDayInputs(db: SQLiteDatabase, athleteId: number): Promise<DayInputs> {
  const [[cmj, recovery], warmups, pain, loads] = await Promise.all([
    readinessInputs(db, athleteId),
    Promise.all(WARMUP_LIFTS.map((l) => listVbtSets(db, athleteId, l))),
    listPain(db, athleteId),
    loadTrainingLoads(db, athleteId),
  ]);
  return { cmj, recovery, warmups: warmups.flat(), pain, loads };
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

/** The poor days among a metric's results, judged without the metric's own signal. */
export function loadPoorDaysOf(db: SQLiteDatabase, athleteId: number, metricCode: string, results: { started_at: string }[]): Promise<Set<ISODate>> {
  return loadPoorDays(db, athleteId, metricCode, results.map((r) => toISODate(new Date(r.started_at))));
}

/** Shown with a result from a poor day. */
export const POOR_DAY_NOTE = '今天状态差（恢复、CMJ 或热身速度偏低），这次成绩不计入进步趋势，也不拉低基线。';

/** The knee's light for training on `date` (domain/pain.ts). */
export async function loadKnee(db: SQLiteDatabase, athleteId: number, date: ISODate) {
  return kneeStatus(await listPain(db, athleteId), date);
}

/**
 * The session to do on a day. A started workout keeps the readiness it began with; today's not-yet-started
 * session follows the current readiness; any other day is shown as planned.
 */
export function sessionFor(
  planned: PlannedSession,
  workout: Workout | null | undefined,
  readiness: Readiness | null,
  knee?: KneeLight | null,
): { session: SessionTemplate; adjustments: Adjustment[] } {
  const r = adjustForReadiness(planned.session, workout?.readiness ?? readiness ?? 'unknown');
  const k = adjustForKnee(r.session, knee);
  return { session: k.session, adjustments: [...r.adjustments, ...k.adjustments] };
}

/**
 * Starts a day's workout, applying the readiness rule when it is today, or when a missed day is made up today.
 * Returns the existing one if already started.
 */
export async function beginWorkout(db: SQLiteDatabase, data: TrainingData, date: ISODate, makeUp = false): Promise<Workout | null> {
  const planned = planDay(data.template, data.plan, date);
  if (!planned) return null;
  const r = date === todayISO() || makeUp ? await loadReadiness(db, data.plan.athleteId, todayISO()) : null;
  const readiness = r?.readiness ?? 'unknown';
  const knee = await loadKnee(db, data.plan.athleteId, date);
  const { adjustments } = sessionFor(planned, null, readiness, knee?.light);
  const kneeCut = knee?.light === 'red' || knee?.light === 'stop';
  const reasons = [...(r?.signals ?? []), ...(kneeCut ? knee.reasons : [])];
  return startWorkout(db, {
    planId: data.plan.id,
    date,
    sessionCode: planned.session.code,
    readiness,
    cmjDrop: r?.today != null ? r.dropPct : null,
    adjustments,
    reason: reasons.length ? reasons.join('；') : null,
  });
}
