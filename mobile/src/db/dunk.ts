import type { SQLiteDatabase } from 'expo-sqlite';

import { massNear } from '@/domain/bodyMass';
import { daysBetween, toISODate, type ISODate } from '@/domain/dates';
import { ladder } from '@/domain/dropJump';
import { diagnose, type DunkDiagnosis, type DunkInput } from '@/domain/dunk';
import { fvProfile, pushOff } from '@/domain/fvp';
import { APPROACH_TOUCH } from '@/domain/metrics';
import { pctOf1rm } from '@/domain/vbt';

import { listBodyMass } from './bodyMass';
import { listDropJumps, listLoadedJumps, profileSessions } from './jumps';
import { listMetricResults, listSessionResults, type Athlete } from './repo';
import { latestTouchMethod, latestTouchSpread, touchOffsetFor } from './touch';
import { current1rm, listTested1rm, listVbtSets, sessionEstimates, TESTED_MAX_AGE_DAYS, type Current1rm } from './vbt';

const SQUAT_LIFT = 'vbt_squat';
/** The plan exercise whose logged sets (load, reps, RPE) also give a squat 1RM. */
const SQUAT_EXERCISE = 'back_squat';
/** Reps to failure (reps + reps in reserve) past which Epley no longer gives a fair 1RM. */
const MAX_REPS_FOR_1RM = 10;

/** The back-squat 1RM to train from on `date`; see `current1rm`. */
export function currentSquat1rm(db: SQLiteDatabase, athleteId: number, date: ISODate): Promise<Current1rm | null> {
  return current1rm(db, athleteId, SQUAT_LIFT, date);
}

/**
 * Back-squat 1RMs on local dates, oldest first: every one actually lifted, one per VBT session whose load-velocity
 * profile passed its checks, and one per workout from its heaviest logged set, so athletes who don't track bar speed
 * still get a strength ratio. A lifted 1RM stands for `TESTED_MAX_AGE_DAYS`: estimates from that time are left out,
 * so the latest entry is the lifted one, as it is for the training plan.
 */
export async function squat1rmHistory(db: SQLiteDatabase, athleteId: number): Promise<{ at: string; kg: number }[]> {
  const local = (at: string) => toISODate(new Date(at));
  const tested = (await listTested1rm(db, athleteId)).map((t) => ({ at: local(t.at), kg: t.kg }));
  const out: { at: string; kg: number }[] = [];
  for (const e of sessionEstimates(await listVbtSets(db, athleteId, SQUAT_LIFT), SQUAT_LIFT)) {
    if (e.oneRm != null) out.push({ at: local(e.startedAt), kg: e.oneRm });
  }

  const logged = await db.getAllAsync<{ date: string; load_kg: number; reps: number; rpe: number }>(
    `SELECT w.date, l.load_kg, l.reps, l.rpe
     FROM set_log l JOIN workout w ON w.id = l.workout_id JOIN plan p ON p.id = w.plan_id
     WHERE p.athlete_id = ? AND l.exercise_code = ? AND l.load_kg > 0 AND l.reps > 0 AND l.rpe IS NOT NULL`,
    athleteId,
    SQUAT_EXERCISE,
  );
  const byDate = new Map<string, number>();
  for (const s of logged) {
    if (s.reps + (10 - s.rpe) > MAX_REPS_FOR_1RM) continue;
    const kg = s.load_kg / pctOf1rm(s.reps, s.rpe);
    byDate.set(s.date, Math.max(byDate.get(s.date) ?? 0, kg));
  }
  for (const [at, kg] of byDate) out.push({ at, kg });

  const standing = (at: string) => tested.some((t) => t.at <= at && daysBetween(t.at, at) <= TESTED_MAX_AGE_DAYS);
  // Estimates first on a day with a lifted 1RM, so the lifted one comes last.
  return [...out.filter((e) => !standing(e.at)), ...tested].sort((a, b) => a.at.localeCompare(b.at) || Number(tested.includes(a)) - Number(tested.includes(b)));
}

function dropUndefined<T extends object>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;
}

/** Every result the dunk diagnosis reads, oldest first. */
export async function loadDunkInputs(db: SQLiteDatabase, athlete: Athlete): Promise<DunkInput> {
  const [cmjs, sjs, touches, squat, drops, loaded, touchOffsetCm, approachMethod, approachSpread] = await Promise.all([
    listSessionResults(db, athlete.id, 'cmj'),
    listSessionResults(db, athlete.id, 'sj'),
    listMetricResults(db, athlete.id, APPROACH_TOUCH),
    squat1rmHistory(db, athlete.id),
    listDropJumps(db, athlete.id),
    listLoadedJumps(db, athlete.id),
    touchOffsetFor(db, athlete.id),
    latestTouchMethod(db, athlete.id),
    latestTouchSpread(db, athlete.id),
  ]);

  const ladders = new Map<string, typeof drops>();
  for (const j of drops) ladders.set(j.session_id, [...(ladders.get(j.session_id) ?? []), j]);
  const dropJumps = [...ladders.values()].flatMap((js) => {
    const best = ladder(js).best;
    return best ? [{ rsi: best.rsi, contactMs: best.contactMs }] : [];
  });

  // Each squat against the weigh-in nearest its day; the profile's body mass where there is none.
  const weighIns = await listBodyMass(db, athlete.id);
  const squatMassKg = squat.map((q) => massNear(weighIns, q.at));

  const hpo = athlete.leg_length_cm != null && athlete.squat_height_cm != null ? pushOff(athlete.leg_length_cm, athlete.squat_height_cm) : null;
  const mass = athlete.body_mass_kg;
  const fvPct =
    mass != null && hpo != null
      ? profileSessions(loaded).flatMap((s) => {
          const p = fvProfile(mass, hpo, s.jumps);
          return p ? [p.fvPct] : [];
        })
      : [];

  return {
    bodyMassKg: mass,
    standingReachCm: athlete.standing_reach_cm,
    rimCm: athlete.rim_height_cm,
    clearanceCm: athlete.dunk_clearance_cm,
    cmj: cmjs.map((r) => r.best),
    sj: sjs.map((r) => r.best),
    approachTouch: touches.map((r) => r.best),
    squat1rm: squat.map((s) => s.kg),
    squatMassKg,
    dropJumps,
    fvPct,
    touchOffsetCm,
    approachMethod,
    approachSpread,
    asOf: toISODate(new Date()),
    latestAt: dropUndefined({ squat: squat.at(-1)?.at, drop_jump: drops.at(-1)?.started_at, approach: touches.at(-1)?.started_at, cmj: cmjs.at(-1)?.started_at }),
  };
}

export async function loadDiagnosis(db: SQLiteDatabase, athlete: Athlete): Promise<DunkDiagnosis> {
  return diagnose(await loadDunkInputs(db, athlete));
}
