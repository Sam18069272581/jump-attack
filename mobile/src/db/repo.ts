import type { SQLiteDatabase } from 'expo-sqlite';

export type Athlete = {
  id: number;
  name: string;
  body_mass_kg: number | null;
  standing_reach_cm: number | null;
};

export type Trial = {
  id: number;
  session_id: string;
  value: number;
  flight_ms: number | null;
  fps: number | null;
  takeoff_frame: number | null;
  landing_frame: number | null;
  video_uri: string | null;
  created_at: string;
};

/** A session's result: its best attempt. */
export type SessionResult = {
  session_id: string;
  metric_code: string;
  started_at: string;
  best: number;
  trials: number;
};

export function newSessionId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export async function listAthletes(db: SQLiteDatabase): Promise<Athlete[]> {
  return db.getAllAsync<Athlete>('SELECT id, name, body_mass_kg, standing_reach_cm FROM athlete ORDER BY id');
}

export async function getAthlete(db: SQLiteDatabase, id: number): Promise<Athlete | null> {
  return db.getFirstAsync<Athlete>('SELECT id, name, body_mass_kg, standing_reach_cm FROM athlete WHERE id = ?', id);
}

export async function createAthlete(db: SQLiteDatabase, name: string): Promise<number> {
  const r = await db.runAsync('INSERT INTO athlete (name) VALUES (?)', name);
  return r.lastInsertRowId;
}

export async function updateAthlete(db: SQLiteDatabase, a: Athlete): Promise<void> {
  await db.runAsync(
    'UPDATE athlete SET name = ?, body_mass_kg = ?, standing_reach_cm = ? WHERE id = ?',
    a.name,
    a.body_mass_kg,
    a.standing_reach_cm,
    a.id,
  );
}

/** Creates the session row on first use, so abandoned captures leave nothing behind. */
export async function ensureSession(db: SQLiteDatabase, sessionId: string, athleteId: number, metricCode: string): Promise<void> {
  await db.runAsync(
    'INSERT OR IGNORE INTO test_session (id, athlete_id, metric_code, started_at) VALUES (?, ?, ?, ?)',
    sessionId,
    athleteId,
    metricCode,
    new Date().toISOString(),
  );
}

export type NewTrial = Omit<Trial, 'id' | 'created_at'>;

export async function addTrial(db: SQLiteDatabase, t: NewTrial): Promise<number> {
  const r = await db.runAsync(
    `INSERT INTO trial (session_id, value, flight_ms, fps, takeoff_frame, landing_frame, video_uri)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    t.session_id,
    t.value,
    t.flight_ms,
    t.fps,
    t.takeoff_frame,
    t.landing_frame,
    t.video_uri,
  );
  return r.lastInsertRowId;
}

export async function deleteTrial(db: SQLiteDatabase, id: number): Promise<void> {
  await db.runAsync('DELETE FROM trial WHERE id = ?', id);
  // Drop the session too once its last attempt is gone.
  await db.runAsync('DELETE FROM test_session WHERE id NOT IN (SELECT DISTINCT session_id FROM trial)');
}

export async function listTrials(db: SQLiteDatabase, sessionId: string): Promise<Trial[]> {
  return db.getAllAsync<Trial>('SELECT * FROM trial WHERE session_id = ? ORDER BY id', sessionId);
}

/** One row per session, oldest first, valued by its best attempt (max, or min when lower is better). */
export async function listSessionResults(
  db: SQLiteDatabase,
  athleteId: number,
  metricCode: string,
  lowerIsBetter = false,
): Promise<SessionResult[]> {
  const agg = lowerIsBetter ? 'MIN' : 'MAX';
  return db.getAllAsync<SessionResult>(
    `SELECT s.id AS session_id, s.metric_code, s.started_at, ${agg}(t.value) AS best, COUNT(t.id) AS trials
     FROM test_session s JOIN trial t ON t.session_id = s.id
     WHERE s.athlete_id = ? AND s.metric_code = ?
     GROUP BY s.id
     ORDER BY s.started_at`,
    athleteId,
    metricCode,
  );
}

/** Number of sessions per metric, for the history category list. */
export async function sessionCounts(db: SQLiteDatabase, athleteId: number): Promise<Record<string, number>> {
  const rows = await db.getAllAsync<{ metric_code: string; n: number }>(
    `SELECT metric_code, COUNT(*) AS n FROM test_session
     WHERE athlete_id = ? AND id IN (SELECT session_id FROM trial)
     GROUP BY metric_code`,
    athleteId,
  );
  return Object.fromEntries(rows.map((r) => [r.metric_code, r.n]));
}
