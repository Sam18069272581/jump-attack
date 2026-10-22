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
  `
  -- A training plan built from a template in src/domain/templates.ts. An athlete has at most one without ended_at.
  CREATE TABLE plan (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    athlete_id INTEGER NOT NULL REFERENCES athlete(id) ON DELETE CASCADE,
    template_code TEXT NOT NULL,
    start_date TEXT NOT NULL,
    weekdays TEXT NOT NULL, -- JSON array, 1 = Monday
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    ended_at TEXT
  );
  CREATE INDEX plan_athlete ON plan(athlete_id, ended_at);

  -- A planned day the athlete started. Readiness and the adjustments it caused are frozen at the start.
  CREATE TABLE workout (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    plan_id INTEGER NOT NULL REFERENCES plan(id) ON DELETE CASCADE,
    date TEXT NOT NULL,
    session_code TEXT NOT NULL,
    readiness TEXT NOT NULL DEFAULT 'unknown',
    cmj_drop REAL,
    adjustments TEXT NOT NULL DEFAULT '[]', -- JSON array of {code, name, change}
    started_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    finished_at TEXT,
    UNIQUE (plan_id, date)
  );

  CREATE TABLE set_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    workout_id INTEGER NOT NULL REFERENCES workout(id) ON DELETE CASCADE,
    exercise_code TEXT NOT NULL,
    set_no INTEGER NOT NULL,
    reps INTEGER NOT NULL,
    load_kg REAL,
    rpe REAL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    UNIQUE (workout_id, exercise_code, set_no)
  );
  `,
  `
  -- Barbell load for VBT sets; detail is a JSON object for per-test extras (e.g. {"source":"manual"}, {"rom_cm":55}).
  ALTER TABLE trial ADD COLUMN load_kg REAL;
  ALTER TABLE trial ADD COLUMN detail TEXT;

  -- Start days of deload weeks inserted after repeated fatigue (JSON array), and why a workout was cut.
  ALTER TABLE plan ADD COLUMN deloads TEXT NOT NULL DEFAULT '[]';
  ALTER TABLE workout ADD COLUMN reason TEXT;
  `,
  `
  -- For the squat-jump force-velocity profile: leg length (greater trochanter to tiptoe, standing on toes) and
  -- trochanter height in the 90° start position. Their difference is the push-off distance.
  ALTER TABLE athlete ADD COLUMN leg_length_cm REAL;
  ALTER TABLE athlete ADD COLUMN squat_height_cm REAL;
  `,
  `
  -- The dunk goal: rim height and how far above it the hand has to reach. Null means 305 cm and 15 cm.
  ALTER TABLE athlete ADD COLUMN rim_height_cm REAL;
  ALTER TABLE athlete ADD COLUMN dunk_clearance_cm REAL;
  `,
  `
  -- Block plans: the training blocks in order (JSON array of {start, type, ...}, see PlanBlock in domain/plan.ts).
  ALTER TABLE plan ADD COLUMN blocks TEXT NOT NULL DEFAULT '[]';
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
