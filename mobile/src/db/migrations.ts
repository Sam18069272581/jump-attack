import type { SQLiteDatabase } from 'expo-sqlite';

/**
 * Each entry upgrades the schema by one version; `PRAGMA user_version` records how far a device has got.
 * Never edit a shipped migration, append a new one.
 */
const MIGRATIONS: string[] = [
  `
  CREATE TABLE athlete (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    body_mass_kg REAL,
    standing_reach_cm REAL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );

  -- One visit to a test (e.g. three CMJ attempts in a row).
  CREATE TABLE test_session (
    id TEXT PRIMARY KEY NOT NULL,
    athlete_id INTEGER NOT NULL REFERENCES athlete(id) ON DELETE CASCADE,
    metric_code TEXT NOT NULL,
    started_at TEXT NOT NULL
  );
  CREATE INDEX test_session_athlete_metric ON test_session(athlete_id, metric_code, started_at);

  -- A single attempt. Raw frame marks are kept so results can be recomputed if the formula changes.
  CREATE TABLE trial (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL REFERENCES test_session(id) ON DELETE CASCADE,
    value REAL NOT NULL,
    flight_ms REAL,
    fps REAL,
    takeoff_frame INTEGER,
    landing_frame INTEGER,
    video_uri TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );
  CREATE INDEX trial_session ON trial(session_id);

  INSERT INTO athlete (name) VALUES ('我自己');
  `,
];

export async function migrate(db: SQLiteDatabase): Promise<void> {
  await db.execAsync('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  let version = row?.user_version ?? 0;
  while (version < MIGRATIONS.length) {
    await db.withTransactionAsync(async () => {
      await db.execAsync(MIGRATIONS[version]);
      await db.execAsync(`PRAGMA user_version = ${version + 1}`);
    });
    version += 1;
  }
}

export const LATEST_VERSION = MIGRATIONS.length;
