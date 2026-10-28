import type { SQLiteDatabase } from 'expo-sqlite';

import { toISODate, type ISODate } from '@/domain/dates';
import { BODY_MASS } from '@/domain/metrics';

/** A weigh-in is one test session a day, like the recovery values (db/recovery.ts), so it has history and a trend. */
const daySessionId = (athleteId: number, date: ISODate) => `day-${athleteId}-${BODY_MASS.code}-${date}`;

function middayIso(date: ISODate): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(y, m - 1, d, 12).toISOString();
}

/** Every weigh-in, oldest first. */
export async function listBodyMass(db: SQLiteDatabase, athleteId: number): Promise<{ date: ISODate; kg: number }[]> {
  const rows = await db.getAllAsync<{ started_at: string; value: number }>(
    'SELECT s.started_at, t.value FROM test_session s JOIN trial t ON t.session_id = s.id WHERE s.athlete_id = ? AND s.metric_code = ? ORDER BY s.started_at',
    athleteId,
    BODY_MASS.code,
  );
  return rows.map((r) => ({ date: toISODate(new Date(r.started_at)), kg: r.value }));
}

/** Records the day's weigh-in, replacing an earlier one that day. */
export async function recordBodyMass(db: SQLiteDatabase, athleteId: number, kg: number, date: ISODate): Promise<void> {
  const id = daySessionId(athleteId, date);
  await db.withTransactionAsync(async () => {
    await db.runAsync('DELETE FROM test_session WHERE id = ?', id);
    await db.runAsync('INSERT INTO test_session (id, athlete_id, metric_code, started_at) VALUES (?, ?, ?, ?)', id, athleteId, BODY_MASS.code, middayIso(date));
    await db.runAsync('INSERT INTO trial (session_id, value, detail) VALUES (?, ?, ?)', id, kg, JSON.stringify({ source: 'manual' }));
  });
}
