import type { SQLiteDatabase } from 'expo-sqlite';

import type { ISODate } from '@/domain/dates';
import type { PainEntry } from '@/domain/pain';

import { listTestJumpDays } from './load';

export async function listPain(db: SQLiteDatabase, athleteId: number): Promise<PainEntry[]> {
  return db.getAllAsync<PainEntry>('SELECT date, kind, score FROM knee_pain WHERE athlete_id = ? ORDER BY date, kind DESC', athleteId);
}

/** Records a score; tapping again the same day replaces it. */
export async function setPain(db: SQLiteDatabase, athleteId: number, e: PainEntry): Promise<void> {
  await db.runAsync(
    'INSERT INTO knee_pain (athlete_id, date, kind, score) VALUES (?, ?, ?, ?) ON CONFLICT (athlete_id, date, kind) DO UPDATE SET score = excluded.score',
    athleteId,
    e.date,
    e.kind,
    e.score,
  );
}

/** Attempts at jump tests on a local day, one ground contact each: test days count towards the jump volume too. */
export async function listTestJumps(db: SQLiteDatabase, athleteId: number, date: ISODate): Promise<number> {
  return (await listTestJumpDays(db, athleteId)).find((d) => d.date === date)?.jumps ?? 0;
}
