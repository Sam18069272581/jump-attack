import type { SQLiteDatabase } from 'expo-sqlite';

import type { Readiness } from '@/domain/assess';
import type { ISODate } from '@/domain/dates';
import type { Adjustment, LoggedSet, PlanBlock, PlanSettings } from '@/domain/plan';

export type Plan = PlanSettings & { id: number; athleteId: number };

export type Workout = {
  id: number;
  planId: number;
  date: ISODate;
  sessionCode: string;
  readiness: Readiness;
  cmjDrop: number | null;
  adjustments: Adjustment[];
  /** The fatigue signals that caused the adjustments; null on workouts saved before reasons were kept. */
  reason: string | null;
  /** When it was started: later than `date` for a session made up or logged afterwards. */
  startedAt: string;
  finishedAt: string | null;
};

type PlanRow = { id: number; athlete_id: number; template_code: string; start_date: string; weekdays: string; deloads: string; blocks: string };
type WorkoutRow = {
  id: number;
  plan_id: number;
  date: string;
  session_code: string;
  readiness: Readiness;
  cmj_drop: number | null;
  adjustments: string;
  reason: string | null;
  started_at: string;
  finished_at: string | null;
};

const toPlan = (r: PlanRow): Plan => ({
  id: r.id,
  athleteId: r.athlete_id,
  templateCode: r.template_code,
  startDate: r.start_date,
  weekdays: JSON.parse(r.weekdays),
  deloads: JSON.parse(r.deloads),
  blocks: JSON.parse(r.blocks),
});

const toWorkout = (r: WorkoutRow): Workout => ({
  id: r.id,
  planId: r.plan_id,
  date: r.date,
  sessionCode: r.session_code,
  readiness: r.readiness,
  cmjDrop: r.cmj_drop,
  adjustments: JSON.parse(r.adjustments),
  reason: r.reason,
  startedAt: r.started_at,
  finishedAt: r.finished_at,
});

export async function getActivePlan(db: SQLiteDatabase, athleteId: number): Promise<Plan | null> {
  const row = await db.getFirstAsync<PlanRow>('SELECT * FROM plan WHERE athlete_id = ? AND ended_at IS NULL ORDER BY id DESC', athleteId);
  return row ? toPlan(row) : null;
}

/** Starts a plan, ending the athlete's current one. */
export async function startPlan(db: SQLiteDatabase, athleteId: number, settings: PlanSettings): Promise<number> {
  let id = 0;
  await db.withTransactionAsync(async () => {
    await db.runAsync("UPDATE plan SET ended_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE athlete_id = ? AND ended_at IS NULL", athleteId);
    const r = await db.runAsync(
      'INSERT INTO plan (athlete_id, template_code, start_date, weekdays, blocks) VALUES (?, ?, ?, ?, ?)',
      athleteId,
      settings.templateCode,
      settings.startDate,
      JSON.stringify([...settings.weekdays].sort((a, b) => a - b)),
      JSON.stringify(settings.blocks ?? []),
    );
    id = r.lastInsertRowId;
  });
  return id;
}

/** Inserts a 7-day deload starting on `start`, pushing the rest of the plan back a week. */
export async function insertDeload(db: SQLiteDatabase, plan: Plan, start: ISODate): Promise<void> {
  const deloads = [...new Set([...(plan.deloads ?? []), start])].sort();
  await db.runAsync('UPDATE plan SET deloads = ? WHERE id = ?', JSON.stringify(deloads), plan.id);
}

/** Replaces a block plan's blocks, e.g. after a switch or skip-ahead suggestion was accepted or turned down. */
export async function setBlocks(db: SQLiteDatabase, planId: number, blocks: PlanBlock[]): Promise<void> {
  await db.runAsync('UPDATE plan SET blocks = ? WHERE id = ?', JSON.stringify(blocks), planId);
}

export async function endPlan(db: SQLiteDatabase, planId: number): Promise<void> {
  await db.runAsync("UPDATE plan SET ended_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ? AND ended_at IS NULL", planId);
}

export async function listWorkouts(db: SQLiteDatabase, planId: number): Promise<Workout[]> {
  const rows = await db.getAllAsync<WorkoutRow>('SELECT * FROM workout WHERE plan_id = ? ORDER BY date', planId);
  return rows.map(toWorkout);
}

export async function getWorkout(db: SQLiteDatabase, planId: number, date: ISODate): Promise<Workout | null> {
  const row = await db.getFirstAsync<WorkoutRow>('SELECT * FROM workout WHERE plan_id = ? AND date = ?', planId, date);
  return row ? toWorkout(row) : null;
}

export type NewWorkout = Pick<Workout, 'planId' | 'date' | 'sessionCode' | 'readiness' | 'cmjDrop' | 'adjustments'> & { reason?: string | null };

/** Starts the day's workout, or returns the one already started so its readiness stays as first recorded. */
export async function startWorkout(db: SQLiteDatabase, w: NewWorkout): Promise<Workout> {
  await db.runAsync(
    'INSERT OR IGNORE INTO workout (plan_id, date, session_code, readiness, cmj_drop, adjustments, reason, started_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    w.planId,
    w.date,
    w.sessionCode,
    w.readiness,
    w.cmjDrop,
    JSON.stringify(w.adjustments),
    w.reason ?? null,
    // The app's clock rather than SQLite's, like the dates the workout is planned on.
    new Date().toISOString(),
  );
  return (await getWorkout(db, w.planId, w.date))!;
}

export async function finishWorkout(db: SQLiteDatabase, workoutId: number): Promise<void> {
  await db.runAsync("UPDATE workout SET finished_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?", workoutId);
}

export async function listSets(db: SQLiteDatabase, workoutId: number): Promise<LoggedSet[]> {
  return db.getAllAsync<LoggedSet>(
    'SELECT exercise_code, set_no, reps, load_kg, rpe, mean_velocity FROM set_log WHERE workout_id = ? ORDER BY exercise_code, set_no',
    workoutId,
  );
}

/** Records a set, replacing what was logged for the same set before. */
export async function logSet(db: SQLiteDatabase, workoutId: number, s: LoggedSet): Promise<void> {
  await db.runAsync(
    `INSERT INTO set_log (workout_id, exercise_code, set_no, reps, load_kg, rpe, mean_velocity) VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (workout_id, exercise_code, set_no) DO UPDATE SET
       reps = excluded.reps, load_kg = excluded.load_kg, rpe = excluded.rpe, mean_velocity = excluded.mean_velocity`,
    workoutId,
    s.exercise_code,
    s.set_no,
    s.reps,
    s.load_kg,
    s.rpe,
    s.mean_velocity ?? null,
  );
}

export async function unlogSet(db: SQLiteDatabase, workoutId: number, exerciseCode: string, setNo: number): Promise<void> {
  await db.runAsync('DELETE FROM set_log WHERE workout_id = ? AND exercise_code = ? AND set_no = ?', workoutId, exerciseCode, setNo);
}

/** The weight last used for each exercise across the athlete's workouts, to prefill the next session. */
export async function lastLoads(db: SQLiteDatabase, athleteId: number): Promise<Record<string, number>> {
  const rows = await db.getAllAsync<{ exercise_code: string; load_kg: number }>(
    `SELECT s.exercise_code, s.load_kg FROM set_log s
     JOIN workout w ON w.id = s.workout_id JOIN plan p ON p.id = w.plan_id
     WHERE p.athlete_id = ? AND s.load_kg IS NOT NULL
     ORDER BY w.date, s.set_no, s.id`,
    athleteId,
  );
  return Object.fromEntries(rows.map((r) => [r.exercise_code, r.load_kg]));
}
