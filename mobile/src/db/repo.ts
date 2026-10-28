import type { SQLiteDatabase } from 'expo-sqlite';

import { best, getMetric, type MetricDef } from '@/domain/metrics';
import { timingOf, type Timing } from '@/domain/timing';

export type Athlete = {
  id: number;
  name: string;
  body_mass_kg: number | null;
  standing_reach_cm: number | null;
  /** Greater trochanter to tiptoe with the ankle extended. */
  leg_length_cm: number | null;
  /** Greater trochanter height in the 90° squat-jump start. */
  squat_height_cm: number | null;
  /** Null means a regulation 305 cm rim. */
  rim_height_cm: number | null;
  /** How far above the rim the hand must reach to dunk; null means the default. */
  dunk_clearance_cm: number | null;
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
  /** Barbell load of a VBT set or a loaded jump. */
  load_kg: number | null;
  /** Per-test extras, e.g. {source: 'health'} or {rom_cm: 55}. */
  detail: Record<string, unknown> | null;
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
  return db.getAllAsync<Athlete>('SELECT id, name, body_mass_kg, standing_reach_cm, leg_length_cm, squat_height_cm, rim_height_cm, dunk_clearance_cm FROM athlete ORDER BY id');
}

export async function getAthlete(db: SQLiteDatabase, id: number): Promise<Athlete | null> {
  return db.getFirstAsync<Athlete>('SELECT id, name, body_mass_kg, standing_reach_cm, leg_length_cm, squat_height_cm, rim_height_cm, dunk_clearance_cm FROM athlete WHERE id = ?', id);
}

export async function createAthlete(db: SQLiteDatabase, name: string): Promise<number> {
  const r = await db.runAsync('INSERT INTO athlete (name) VALUES (?)', name);
  return r.lastInsertRowId;
}

export async function updateAthlete(db: SQLiteDatabase, a: Athlete): Promise<void> {
  await db.runAsync(
    'UPDATE athlete SET name = ?, body_mass_kg = ?, standing_reach_cm = ?, leg_length_cm = ?, squat_height_cm = ?, rim_height_cm = ?, dunk_clearance_cm = ? WHERE id = ?',
    a.name,
    a.body_mass_kg,
    a.standing_reach_cm,
    a.leg_length_cm,
    a.squat_height_cm,
    a.rim_height_cm,
    a.dunk_clearance_cm,
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

export type NewTrial = Omit<Trial, 'id' | 'created_at' | 'flight_ms' | 'fps' | 'takeoff_frame' | 'landing_frame' | 'video_uri' | 'load_kg' | 'detail'> &
  Partial<Pick<Trial, 'flight_ms' | 'fps' | 'takeoff_frame' | 'landing_frame' | 'video_uri' | 'load_kg' | 'detail'>>;

/** Video marks are stored as frames: take-off/landing for jumps, start/finish for interval tests. */
export async function addTrial(db: SQLiteDatabase, t: NewTrial): Promise<number> {
  const r = await db.runAsync(
    `INSERT INTO trial (session_id, value, flight_ms, fps, takeoff_frame, landing_frame, video_uri, load_kg, detail)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    t.session_id,
    t.value,
    t.flight_ms ?? null,
    t.fps ?? null,
    t.takeoff_frame ?? null,
    t.landing_frame ?? null,
    t.video_uri ?? null,
    t.load_kg ?? null,
    t.detail ? JSON.stringify(t.detail) : null,
  );
  return r.lastInsertRowId;
}

export async function deleteTrial(db: SQLiteDatabase, id: number): Promise<void> {
  await db.runAsync('DELETE FROM trial WHERE id = ?', id);
  // Drop the session too once its last attempt is gone.
  await db.runAsync('DELETE FROM test_session WHERE id NOT IN (SELECT DISTINCT session_id FROM trial)');
}

/** Folder the app used to copy every marked video into; see media/videos.ts. */
export const SAVED_VIDEO_DIR = '/videos/';

/** Drops references to the app's own video copies once they are deleted. Returns how many trials pointed at one. */
export async function clearSavedVideoUris(db: SQLiteDatabase): Promise<number> {
  const r = await db.runAsync("UPDATE trial SET video_uri = NULL WHERE instr(video_uri, ?) > 0", SAVED_VIDEO_DIR);
  return r.changes;
}

export async function listTrials(db: SQLiteDatabase, sessionId: string): Promise<Trial[]> {
  const rows = await db.getAllAsync<Omit<Trial, 'detail'> & { detail: string | null }>('SELECT * FROM trial WHERE session_id = ? ORDER BY id', sessionId);
  return rows.map((r) => ({ ...r, detail: r.detail ? JSON.parse(r.detail) : null }));
}

/**
 * One row per session, oldest first, valued by its best attempt (max, or min when lower is better),
 * or by the mean of its attempts for tests scored as a set, like repeated sprints.
 */
export async function listSessionResults(
  db: SQLiteDatabase,
  athleteId: number,
  metricCode: string,
  lowerIsBetter = false,
  aggregate: MetricDef['aggregate'] = 'best',
): Promise<SessionResult[]> {
  const agg = aggregate === 'mean' ? 'AVG' : lowerIsBetter ? 'MIN' : 'MAX';
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

export function listMetricResults(db: SQLiteDatabase, athleteId: number, def: MetricDef): Promise<SessionResult[]> {
  return listSessionResults(db, athleteId, def.code, def.lowerIsBetter, def.aggregate);
}

/** Every attempt of every session of a metric, in the order they were recorded, keyed by session. */
export async function listSessionValues(db: SQLiteDatabase, athleteId: number, metricCode: string): Promise<Record<string, number[]>> {
  const rows = await db.getAllAsync<{ session_id: string; value: number }>(
    `SELECT t.session_id, t.value FROM trial t JOIN test_session s ON s.id = t.session_id
     WHERE s.athlete_id = ? AND s.metric_code = ?
     ORDER BY t.id`,
    athleteId,
    metricCode,
  );
  const out: Record<string, number[]> = {};
  for (const r of rows) (out[r.session_id] ??= []).push(r.value);
  return out;
}

/** How each session of a metric was timed (domain/timing.ts), read from its first attempt. */
export async function sessionTimings(db: SQLiteDatabase, athleteId: number, metricCode: string): Promise<Record<string, Timing>> {
  const rows = await db.getAllAsync<{ session_id: string; detail: string | null }>(
    `SELECT t.session_id, t.detail FROM trial t JOIN test_session s ON s.id = t.session_id
     WHERE s.athlete_id = ? AND s.metric_code = ?
     ORDER BY t.id`,
    athleteId,
    metricCode,
  );
  const out: Record<string, Timing> = {};
  for (const r of rows) out[r.session_id] ??= timingOf(r.detail ? JSON.parse(r.detail) : null);
  return out;
}

/** Saves a finished multi-attempt test (e.g. all sprints of a repeated-sprint set) in one transaction. */
export async function saveSession(db: SQLiteDatabase, sessionId: string, athleteId: number, metricCode: string, values: number[]): Promise<void> {
  await db.withTransactionAsync(async () => {
    await ensureSession(db, sessionId, athleteId, metricCode);
    for (const value of values) {
      await addTrial(db, { session_id: sessionId, value, flight_ms: null, fps: null, takeoff_frame: null, landing_frame: null, video_uri: null });
    }
  });
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

/**
 * Each metric's most recent session, valued by its best attempt, for metric codes matching a LIKE pattern
 * (e.g. 'sprint_%'). Keyed by metric code.
 */
export async function latestResults(db: SQLiteDatabase, athleteId: number, pattern: string): Promise<Record<string, SessionResult>> {
  const rows = await db.getAllAsync<{ session_id: string; metric_code: string; started_at: string; value: number }>(
    `SELECT s.id AS session_id, s.metric_code, s.started_at, t.value
     FROM test_session s JOIN trial t ON t.session_id = s.id
     WHERE s.athlete_id = ? AND s.metric_code LIKE ?
     ORDER BY s.started_at, s.id, t.id`,
    athleteId,
    pattern,
  );
  const out: Record<string, SessionResult> = {};
  for (const r of rows) {
    const prev = out[r.metric_code];
    if (prev?.session_id === r.session_id) {
      const def = getMetric(r.metric_code);
      prev.best = def ? best(def, [prev.best, r.value])! : Math.max(prev.best, r.value);
      prev.trials += 1;
    } else {
      out[r.metric_code] = { session_id: r.session_id, metric_code: r.metric_code, started_at: r.started_at, best: r.value, trials: 1 };
    }
  }
  return out;
}
