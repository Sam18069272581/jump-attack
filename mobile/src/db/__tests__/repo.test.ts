import { LATEST_VERSION, migrate } from '../migrations';
import { getMetric } from '@/domain/metrics';

import { addTrial, clearSavedVideoUris, deleteTrial, ensureSession, listAthletes, listMetricResults, listSessionResults, listSessionValues, listTrials, saveSession, sessionCounts, sessionTimings, updateTrialValue } from '../repo';
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
    expect(await listAthletes(db)).toEqual([{ id: 1, name: '我自己', body_mass_kg: null, standing_reach_cm: null, leg_length_cm: null, squat_height_cm: null, rim_height_cm: null, dunk_clearance_cm: null }]);
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

  it('reports the approach touch as the mean of the best three jumps, so one lucky jump is not progress', async () => {
    const db = await setup();
    await ensureSession(db, 't', 1, 'approach_touch');
    for (const v of [312, 318, 310, 316, 317, 315]) await addTrial(db, trial('t', v));
    await ensureSession(db, 'u', 1, 'approach_touch');
    await addTrial(db, trial('u', 319)); // a single-jump session stays as it was
    await db.runAsync("UPDATE test_session SET started_at = CASE id WHEN 't' THEN '2026-10-01T10:00:00Z' ELSE '2026-10-08T10:00:00Z' END");
    const results = await listMetricResults(db, 1, getMetric('approach_touch')!);
    expect(results.map((r) => [r.session_id, r.best, r.trials])).toEqual([
      ['t', 317, 6],
      ['u', 319, 1],
    ]);
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

  it('scores repeated sprints by the mean of the set and keeps each sprint', async () => {
    const db = await setup();
    await saveSession(db, 'r1', 1, 'rsa', [7.0, 7.2, 7.4]);
    const [r] = await listMetricResults(db, 1, getMetric('rsa')!);
    expect(r.best).toBeCloseTo(7.2);
    expect(r.trials).toBe(3);
    expect(await listSessionValues(db, 1, 'rsa')).toEqual({ r1: [7.0, 7.2, 7.4] });
    expect(await listSessionValues(db, 1, 'cmj')).toEqual({});
  });
});

describe('correcting a typed-in attempt', () => {
  it('changes only that attempt’s value', async () => {
    const db = await setup();
    await ensureSession(db, 't', 1, 'approach_touch');
    await addTrial(db, { session_id: 't', value: 298, detail: { source: 'manual' } });
    await addTrial(db, { session_id: 't', value: 287, detail: { source: 'manual' } });
    const [first, second] = await listTrials(db, 't');
    await updateTrialValue(db, first.id, 289);
    expect((await listTrials(db, 't')).map((t) => t.value)).toEqual([289, 287]);
    expect((await listTrials(db, 't'))[1]).toEqual(second);
  });
});

describe('sprint timing', () => {
  it('reads how each session was timed from its first attempt', async () => {
    const db = await setup();
    await ensureSession(db, 'v', 1, 'sprint_10');
    await addTrial(db, { ...trial('v', 1.82), detail: { source: 'video', asset_id: 'x' } });
    await ensureSession(db, 'g', 1, 'sprint_10');
    await addTrial(db, { session_id: 'g', value: 1.75, detail: { source: 'manual', timing: 'gates' } });
    await ensureSession(db, 'old', 1, 'sprint_10');
    await addTrial(db, trial('old', 1.9));
    await ensureSession(db, 'other', 1, 'sprint_20');
    await addTrial(db, { session_id: 'other', value: 3.1, detail: { source: 'manual', timing: 'stopwatch' } });

    expect(await sessionTimings(db, 1, 'sprint_10')).toEqual({ v: 'video', g: 'gates', old: 'video' });
  });
});

describe('saved videos', () => {
  it('forgets copies in the app’s video folder and leaves other video references alone', async () => {
    const db = await setup();
    await ensureSession(db, 'a', 1, 'cmj');
    await addTrial(db, { ...trial('a', 35), video_uri: 'file:///var/mobile/Documents/videos/a-1.mov' });
    await addTrial(db, { ...trial('a', 36), video_uri: 'file:///var/mobile/Caches/ImagePicker/x.mov' });
    await addTrial(db, trial('a', 37));

    expect(await clearSavedVideoUris(db)).toBe(1);
    expect((await listTrials(db, 'a')).map((t) => t.video_uri)).toEqual([null, 'file:///var/mobile/Caches/ImagePicker/x.mov', null]);
  });
});
