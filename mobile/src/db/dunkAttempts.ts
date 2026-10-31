import type { SQLiteDatabase } from 'expo-sqlite';

import type { Ball, DunkAttempt, Outcome } from '@/domain/dunkAttempts';

import { deleteTrial } from './repo';

type Row = { id: number; at: string; rim_cm: number; ball: Ball; outcome: Outcome; trial_id: number | null; video_uri: string | null };

/** Every attempt of the athlete, oldest first. */
export async function listDunkAttempts(db: SQLiteDatabase, athleteId: number): Promise<DunkAttempt[]> {
  const rows = await db.getAllAsync<Row>('SELECT id, at, rim_cm, ball, outcome, trial_id, video_uri FROM dunk_attempt WHERE athlete_id = ? ORDER BY at, id', athleteId);
  return rows.map((r) => ({
    id: r.id,
    at: r.at,
    rimCm: r.rim_cm,
    ball: r.ball,
    outcome: r.outcome,
    ...(r.trial_id != null && { trialId: r.trial_id }),
    ...(r.video_uri != null && { videoUri: r.video_uri }),
  }));
}

/** Saves one attempt (now, unless `at` is given), with its video and take-off analysis when filmed, and returns its id. */
export async function addDunkAttempt(
  db: SQLiteDatabase,
  athleteId: number,
  a: { rimCm: number; ball: Ball; outcome: Outcome; at?: string; trialId?: number | null; videoUri?: string | null },
): Promise<number> {
  const cols = ['athlete_id', 'rim_cm', 'ball', 'outcome', 'trial_id', 'video_uri'];
  const values: (string | number | null)[] = [athleteId, a.rimCm, a.ball, a.outcome, a.trialId ?? null, a.videoUri ?? null];
  if (a.at) {
    cols.push('at');
    values.push(a.at);
  }
  const r = await db.runAsync(`INSERT INTO dunk_attempt (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`, values);
  return r.lastInsertRowId;
}

/** Deletes an attempt and its take-off analysis; its video goes with the next prune (media/takes.ts). */
export async function deleteDunkAttempt(db: SQLiteDatabase, id: number): Promise<void> {
  const row = await db.getFirstAsync<{ trial_id: number | null }>('SELECT trial_id FROM dunk_attempt WHERE id = ?', id);
  await db.runAsync('DELETE FROM dunk_attempt WHERE id = ?', id);
  if (row?.trial_id != null) await deleteTrial(db, row.trial_id);
}
