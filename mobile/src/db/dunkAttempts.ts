import type { SQLiteDatabase } from 'expo-sqlite';

import type { Ball, DunkAttempt, Outcome } from '@/domain/dunkAttempts';

type Row = { id: number; at: string; rim_cm: number; ball: Ball; outcome: Outcome };

/** Every attempt of the athlete, oldest first. */
export async function listDunkAttempts(db: SQLiteDatabase, athleteId: number): Promise<DunkAttempt[]> {
  const rows = await db.getAllAsync<Row>('SELECT id, at, rim_cm, ball, outcome FROM dunk_attempt WHERE athlete_id = ? ORDER BY at, id', athleteId);
  return rows.map((r) => ({ id: r.id, at: r.at, rimCm: r.rim_cm, ball: r.ball, outcome: r.outcome }));
}

/** Saves one attempt (now, unless `at` is given) and returns its id. */
export async function addDunkAttempt(db: SQLiteDatabase, athleteId: number, a: { rimCm: number; ball: Ball; outcome: Outcome; at?: string }): Promise<number> {
  const r = a.at
    ? await db.runAsync('INSERT INTO dunk_attempt (athlete_id, at, rim_cm, ball, outcome) VALUES (?, ?, ?, ?, ?)', athleteId, a.at, a.rimCm, a.ball, a.outcome)
    : await db.runAsync('INSERT INTO dunk_attempt (athlete_id, rim_cm, ball, outcome) VALUES (?, ?, ?, ?)', athleteId, a.rimCm, a.ball, a.outcome);
  return r.lastInsertRowId;
}

export async function deleteDunkAttempt(db: SQLiteDatabase, id: number): Promise<void> {
  await db.runAsync('DELETE FROM dunk_attempt WHERE id = ?', id);
}
