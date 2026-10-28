import type { SQLiteDatabase } from 'expo-sqlite';

import { toISODate, type ISODate } from '@/domain/dates';
import { METRICS } from '@/domain/metrics';

/**
 * CMJ sessions for readiness, each read as the mean of its best 3 jumps (all of them when fewer): the mean picks
 * up fatigue better than the best jump (Claudino 2017 meta-analysis). `best` keeps the field readiness reads.
 */
export async function listCmjMeans(db: SQLiteDatabase, athleteId: number): Promise<{ session_id: string; started_at: string; best: number }[]> {
  return db.getAllAsync(
    `SELECT s.id AS session_id, s.started_at, AVG(t.value) AS best
     FROM test_session s
     JOIN (SELECT session_id, value, ROW_NUMBER() OVER (PARTITION BY session_id ORDER BY value DESC) AS rank FROM trial) t ON t.session_id = s.id
     WHERE s.athlete_id = ? AND s.metric_code = 'cmj' AND t.rank <= 3
     GROUP BY s.id ORDER BY s.started_at`,
    athleteId,
  );
}

/** Workouts given a session RPE and minutes, across the athlete's plans. */
export async function listSessionLoads(db: SQLiteDatabase, athleteId: number): Promise<{ started_at: string; rpe: number; minutes: number }[]> {
  return db.getAllAsync(
    `SELECT w.started_at, w.session_rpe AS rpe, w.duration_min AS minutes FROM workout w JOIN plan p ON p.id = w.plan_id
     WHERE p.athlete_id = ? AND w.session_rpe IS NOT NULL AND w.duration_min IS NOT NULL ORDER BY w.started_at`,
    athleteId,
  );
}

const JUMP_CODES = METRICS.filter((m) => m.category === 'jump').map((m) => m.code);

/** Jump-test attempts per local day, one ground contact each. */
export async function listTestJumpDays(db: SQLiteDatabase, athleteId: number): Promise<{ date: ISODate; jumps: number }[]> {
  const rows = await db.getAllAsync<{ started_at: string; n: number }>(
    `SELECT s.started_at, COUNT(t.id) AS n FROM test_session s JOIN trial t ON t.session_id = s.id
     WHERE s.athlete_id = ? AND s.metric_code IN (${JUMP_CODES.map(() => '?').join(', ')}) GROUP BY s.id ORDER BY s.started_at`,
    athleteId,
    ...JUMP_CODES,
  );
  const byDay = new Map<ISODate, number>();
  for (const r of rows) {
    const d = toISODate(new Date(r.started_at));
    byDay.set(d, (byDay.get(d) ?? 0) + r.n);
  }
  return [...byDay].map(([date, jumps]) => ({ date, jumps }));
}

/** Every logged set with the plan template it belongs to, for counting jumps across plans. */
export async function listLoggedSets(db: SQLiteDatabase, athleteId: number): Promise<{ started_at: string; template_code: string; exercise_code: string; reps: number }[]> {
  return db.getAllAsync(
    `SELECT w.started_at, p.template_code, l.exercise_code, l.reps FROM set_log l JOIN workout w ON w.id = l.workout_id JOIN plan p ON p.id = w.plan_id
     WHERE p.athlete_id = ? ORDER BY w.started_at`,
    athleteId,
  );
}
