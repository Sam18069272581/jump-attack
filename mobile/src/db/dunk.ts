import type { SQLiteDatabase } from 'expo-sqlite';

import { ladder } from '@/domain/dropJump';
import { diagnose, type DunkDiagnosis, type DunkInput } from '@/domain/dunk';
import { fvProfile, pushOff } from '@/domain/fvp';
import { APPROACH_TOUCH } from '@/domain/metrics';
import { pctOf1rm } from '@/domain/vbt';

import { listDropJumps, listLoadedJumps, profileSessions } from './jumps';
import { listSessionResults, type Athlete } from './repo';
import { listTested1rm, listVbtSets, sessionEstimates } from './vbt';

const SQUAT_LIFT = 'vbt_squat';
/** The plan exercise whose logged sets (load, reps, RPE) also give a squat 1RM. */
const SQUAT_EXERCISE = 'back_squat';
/** Reps to failure (reps + reps in reserve) past which Epley no longer gives a fair 1RM. */
const MAX_REPS_FOR_1RM = 10;

/**
 * Back-squat 1RMs, oldest first: every one actually lifted, one per VBT session whose load-velocity profile passed
 * its checks, and one per workout from its heaviest logged set, so athletes who don't track bar speed still get a
 * strength ratio.
 */
export async function squat1rmHistory(db: SQLiteDatabase, athleteId: number): Promise<{ at: string; kg: number }[]> {
  const out: { at: string; kg: number }[] = await listTested1rm(db, athleteId);
  for (const e of sessionEstimates(await listVbtSets(db, athleteId, SQUAT_LIFT), SQUAT_LIFT)) {
    if (e.oneRm != null) out.push({ at: e.startedAt, kg: e.oneRm });
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

  return out.sort((a, b) => a.at.localeCompare(b.at));
}

/** Every result the dunk diagnosis reads, oldest first. */
export async function loadDunkInputs(db: SQLiteDatabase, athlete: Athlete): Promise<DunkInput> {
  const bests = async (code: string) => (await listSessionResults(db, athlete.id, code)).map((r) => r.best);
  const [cmj, sj, approachTouch, squat, drops, loaded] = await Promise.all([
    bests('cmj'),
    bests('sj'),
    bests(APPROACH_TOUCH.code),
    squat1rmHistory(db, athlete.id),
    listDropJumps(db, athlete.id),
    listLoadedJumps(db, athlete.id),
  ]);

  const ladders = new Map<string, typeof drops>();
  for (const j of drops) ladders.set(j.session_id, [...(ladders.get(j.session_id) ?? []), j]);
  const dropJumps = [...ladders.values()].flatMap((js) => {
    const best = ladder(js).best;
    return best ? [{ rsi: best.rsi, contactMs: best.contactMs }] : [];
  });

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
    cmj,
    sj,
    approachTouch,
    squat1rm: squat.map((s) => s.kg),
    dropJumps,
    fvPct,
  };
}

export async function loadDiagnosis(db: SQLiteDatabase, athlete: Athlete): Promise<DunkDiagnosis> {
  return diagnose(await loadDunkInputs(db, athlete));
}
