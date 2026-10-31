import type { SQLiteDatabase } from 'expo-sqlite';

import { LATEST_VERSION, migrate } from '../migrations';
import { listAthletes, listTrials } from '../repo';
import { openMemoryDb } from '../testing/memoryDb';

/**
 * A handle to `connection` the way the web build opens it: every SQLiteDatabase opened on the same file shares one
 * SQLite connection in the worker, and each call is a round trip to that worker (a timer turn stands in for it).
 * withTransactionAsync is expo-sqlite's own: BEGIN, the task, COMMIT, and on any error a ROLLBACK whose failure is ignored.
 */
function webHandle(connection: SQLiteDatabase): SQLiteDatabase {
  const roundTrip = <A extends unknown[], R>(call: (...args: A) => Promise<R>) =>
    async (...args: A): Promise<R> => {
      await new Promise((resolve) => setTimeout(resolve, 0));
      return call(...args);
    };
  const handle = {
    databasePath: 'jump-attack.db',
    isInTransactionAsync: roundTrip(() => connection.isInTransactionAsync()),
    execAsync: roundTrip((sql: string) => connection.execAsync(sql)),
    runAsync: roundTrip((sql: string, ...args: unknown[]) => connection.runAsync(sql, ...(args as []))),
    getAllAsync: roundTrip((sql: string, ...args: unknown[]) => connection.getAllAsync(sql, ...(args as []))),
    getFirstAsync: roundTrip((sql: string, ...args: unknown[]) => connection.getFirstAsync(sql, ...(args as []))),
    async withTransactionAsync(task: () => Promise<void>) {
      try {
        await handle.execAsync('BEGIN');
        await task();
        await handle.execAsync('COMMIT');
      } catch (e) {
        try {
          await handle.execAsync('ROLLBACK');
        } catch {
          // As in expo-sqlite: keep the original error.
        }
        throw e;
      }
    },
  };
  return handle as unknown as SQLiteDatabase;
}

async function version(db: SQLiteDatabase): Promise<number | undefined> {
  return (await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version'))?.user_version;
}

/** Each start's outcome, so a failure shows its message. */
async function startTwice(connection: SQLiteDatabase): Promise<string[]> {
  const runs = await Promise.allSettled([migrate(webHandle(connection)), migrate(webHandle(connection))]);
  return runs.map((r) => (r.status === 'rejected' ? String(r.reason) : r.status));
}

describe('migrate on the web, where every handle to the file shares one connection', () => {
  // The database provider starting again before the first upgrade finished. Unguarded, the second start's BEGIN fails,
  // its ROLLBACK ends the first start's transaction, and the first start's COMMIT throws
  // "cannot commit - no transaction is active": the error the web version showed on launch.
  it('lets two overlapping starts upgrade a new database once, without ending each other’s transactions', async () => {
    const connection = openMemoryDb();
    expect(await startTwice(connection)).toEqual(['fulfilled', 'fulfilled']);
    expect(await version(connection)).toBe(LATEST_VERSION);
    expect(await listAthletes(connection)).toHaveLength(1);
  });

  it('keeps the data of an older database that two overlapping starts upgrade', async () => {
    const connection = openMemoryDb();
    await migrate(connection);
    // Back to version 7 (before the dunk attempts): drop what migrations 8–11 added, keep the rows from before.
    await connection.execAsync(`
      DROP TABLE dunk_attempt;
      DROP TABLE knee_pain;
      ALTER TABLE athlete DROP COLUMN goal_date;
      ALTER TABLE workout DROP COLUMN session_rpe;
      ALTER TABLE workout DROP COLUMN duration_min;
      PRAGMA user_version = 7;
    `);
    await connection.runAsync("UPDATE athlete SET name = 'Sam', standing_reach_cm = 248 WHERE id = 1");
    await connection.runAsync("INSERT INTO test_session (id, athlete_id, metric_code, started_at) VALUES ('s', 1, 'cmj', '2026-10-01T10:00:00Z')");
    await connection.runAsync("INSERT INTO trial (session_id, value) VALUES ('s', 52.5)");

    expect(await startTwice(connection)).toEqual(['fulfilled', 'fulfilled']);
    expect(await version(connection)).toBe(LATEST_VERSION);
    expect(await listAthletes(connection)).toEqual([expect.objectContaining({ id: 1, name: 'Sam', standing_reach_cm: 248, goal_date: null })]);
    expect(await listTrials(connection, 's')).toEqual([expect.objectContaining({ value: 52.5 })]);
  });

  // The error screen's retry opens the file again and gets the same connection back.
  it('finishes the upgrade when an earlier start left the shared connection inside a transaction', async () => {
    const connection = openMemoryDb();
    await connection.execAsync('BEGIN');
    await migrate(webHandle(connection));
    expect(await version(connection)).toBe(LATEST_VERSION);
    expect(await listAthletes(connection)).toHaveLength(1);
  });
});
