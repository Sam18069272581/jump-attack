import type { SQLiteDatabase } from 'expo-sqlite';

import { addDays, toISODate, type ISODate } from '@/domain/dates';
import { METRICS } from '@/domain/metrics';
import type { PainEntry } from '@/domain/pain';

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

const JUMP_CODES = METRICS.filter((m) => m.category === 'jump').map((m) => m.code);

/** Attempts at jump tests on a local day, one ground contact each: test days count towards the jump volume too. */
export async function listTestJumps(db: SQLiteDatabase, athleteId: number, date: ISODate): Promise<number> {
  // Sessions are stored by instant; a day either side covers any time zone, then each is checked by local day.
  const rows = await db.getAllAsync<{ started_at: string; n: number }>(
    `SELECT s.started_at, COUNT(t.id) AS n FROM test_session s JOIN trial t ON t.session_id = s.id
     WHERE s.athlete_id = ? AND s.started_at >= ? AND s.started_at < ? AND s.metric_code IN (${JUMP_CODES.map(() => '?').join(', ')})
     GROUP BY s.id`,
    athleteId,
    addDays(date, -1),
    addDays(date, 2),
    ...JUMP_CODES,
  );
  return rows.filter((r) => toISODate(new Date(r.started_at)) === date).reduce((sum, r) => sum + r.n, 0);
}
