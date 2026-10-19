import { LATEST_VERSION, migrate } from '../migrations';
import { addTrial, deleteTrial, ensureSession, listAthletes, listSessionResults, listTrials, sessionCounts } from '../repo';
import { openMemoryDb } from '../testing/memoryDb';

async function setup() {
  const db = openMemoryDb();
  await migrate(db);
  return db;
}

function trial(sessionId: string, value: number) {
  return { session_id: sessionId, value, flight_ms: null, fps: 240, takeoff_frame: 0, landing_frame: 1, video_uri: null };
}

describe('migrate', () => {
  it('creates the schema and a default athlete, and is idempotent', async () => {
    const db = await setup();
    await migrate(db);
    const v = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
    expect(v?.user_version).toBe(LATEST_VERSION);
    expect(await listAthletes(db)).toEqual([{ id: 1, name: '我自己', body_mass_kg: null, standing_reach_cm: null }]);
  });
});

describe('sessions and trials', () => {
  it('reports each session by its best attempt, oldest first', async () => {
    const db = await setup();
    await ensureSession(db, 'a', 1, 'cmj');
    await db.runAsync("UPDATE test_session SET started_at = '2026-10-01T00:00:00Z' WHERE id = 'a'");
    await ensureSession(db, 'b', 1, 'cmj');
    await ensureSession(db, 'b', 1, 'cmj'); // second call is a no-op
    for (const v of [35.1, 36.2, 35.8]) await addTrial(db, trial('a', v));
    await addTrial(db, trial('b', 37.0));

    const results = await listSessionResults(db, 1, 'cmj');
    expect(results.map((r) => [r.session_id, r.best, r.trials])).toEqual([
      ['a', 36.2, 3],
      ['b', 37.0, 1],
    ]);
    expect((await listSessionResults(db, 1, 'cmj', true))[0].best).toBe(35.1);
    expect(await sessionCounts(db, 1)).toEqual({ cmj: 2 });
  });

  it('removes a session once its last trial is deleted', async () => {
    const db = await setup();
    await ensureSession(db, 's', 1, 'sj');
    const id = await addTrial(db, trial('s', 30));
    expect(await listTrials(db, 's')).toHaveLength(1);
    await deleteTrial(db, id);
    expect(await listTrials(db, 's')).toHaveLength(0);
    expect(await sessionCounts(db, 1)).toEqual({});
    expect(await db.getAllAsync('SELECT * FROM test_session')).toEqual([]);
  });

  it('does not count sessions without trials', async () => {
    const db = await setup();
    await ensureSession(db, 'empty', 1, 'cmj');
    expect(await sessionCounts(db, 1)).toEqual({});
    expect(await listSessionResults(db, 1, 'cmj')).toEqual([]);
  });
});
