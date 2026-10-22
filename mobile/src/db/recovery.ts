import type { SQLiteDatabase } from 'expo-sqlite';

import { toISODate, type ISODate } from '@/domain/dates';
import { RECOVERY_CODES, type RecoveryDay, type RecoveryKey } from '@/domain/recovery';

const KEYS = Object.keys(RECOVERY_CODES) as RecoveryKey[];

/** Recovery values are one test session per metric per day, so they share history and trends with every other test. */
function daySessionId(athleteId: number, code: string, date: ISODate): string {
  return `day-${athleteId}-${code}-${date}`;
}

/** Midday local time, so the session's day survives any timezone rounding. */
function middayIso(date: ISODate): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(y, m - 1, d, 12).toISOString();
}

/** Every recorded day, oldest first. */
export async function listRecoveryDays(db: SQLiteDatabase, athleteId: number): Promise<RecoveryDay[]> {
  const rows = await db.getAllAsync<{ metric_code: string; started_at: string; value: number }>(
    `SELECT s.metric_code, s.started_at, t.value
     FROM test_session s JOIN trial t ON t.session_id = s.id
     WHERE s.athlete_id = ? AND s.metric_code IN (${KEYS.map(() => '?').join(', ')})
     ORDER BY s.started_at, t.id`,
    athleteId,
    ...KEYS.map((k) => RECOVERY_CODES[k]),
  );
  const byDate = new Map<ISODate, RecoveryDay>();
  for (const r of rows) {
    const date = toISODate(new Date(r.started_at));
    const day = byDate.get(date) ?? { date, hrv: null, rhr: null, sleep: null, resp: null };
    const key = KEYS.find((k) => RECOVERY_CODES[k] === r.metric_code)!;
    day[key] = r.value; // the last entry of the day wins
    byDate.set(date, day);
  }
  return [...byDate.values()].sort((a, b) => (a.date < b.date ? -1 : 1));
}

/** Where a value came from: typed in, or pasted from Apple Health. */
export type RecoverySource = 'manual' | 'health';

/** Saves one day, replacing what was there; a null value clears that metric for the day. Values default to typed in. */
export async function saveRecoveryDay(
  db: SQLiteDatabase,
  athleteId: number,
  day: RecoveryDay,
  sources: Partial<Record<RecoveryKey, RecoverySource>> = {},
): Promise<void> {
  await db.withTransactionAsync(async () => {
    for (const key of KEYS) {
      const code = RECOVERY_CODES[key];
      const id = daySessionId(athleteId, code, day.date);
      await db.runAsync('DELETE FROM test_session WHERE id = ?', id);
      const value = day[key];
      if (value == null) continue;
      await db.runAsync('INSERT INTO test_session (id, athlete_id, metric_code, started_at) VALUES (?, ?, ?, ?)', id, athleteId, code, middayIso(day.date));
      await db.runAsync('INSERT INTO trial (session_id, value, detail) VALUES (?, ?, ?)', id, value, JSON.stringify({ source: sources[key] ?? 'manual' }));
    }
  });
}
