import { exportBackup, restoreBackup } from '../backup';
import { LATEST_VERSION, migrate } from '../migrations';
import { addTrial, createAthlete, ensureSession, listAthletes, listSessionResults, updateAthlete } from '../repo';
import { saveRecoveryDay } from '../recovery';
import { openMemoryDb } from '../testing/memoryDb';
import { getActivePlan, logSet, startPlan, startWorkout } from '../training';

async function setup() {
  const db = openMemoryDb();
  await migrate(db);
  return db;
}

/** A phone with a bit of everything: two athletes, a test, a recovery day, a plan with a logged set. */
async function used() {
  const db = await setup();
  const [me] = await listAthletes(db);
  await updateAthlete(db, { ...me, body_mass_kg: 78, standing_reach_cm: 232 });
  await createAthlete(db, '队友');
  await ensureSession(db, 's1', 1, 'cmj');
  await addTrial(db, { session_id: 's1', value: 45.2, flight_ms: 607, fps: 240, takeoff_frame: 10, landing_frame: 156, video_uri: null, load_kg: null, detail: { source: 'video' } });
  await saveRecoveryDay(db, 1, { date: '2026-10-27', hrv: 62, rhr: 51, sleep: null, resp: null });
  const planId = await startPlan(db, 1, { templateCode: 'dunk', startDate: '2026-10-26', weekdays: [1, 3, 5] });
  const workout = await startWorkout(db, { planId, date: '2026-10-26', sessionCode: 'A', readiness: 'ready', cmjDrop: null, adjustments: [] });
  await logSet(db, workout.id, { exercise_code: 'back_squat', set_no: 1, reps: 5, load_kg: 100, rpe: 8 });
  return db;
}

async function dump(db: Awaited<ReturnType<typeof setup>>) {
  const b = await exportBackup(db);
  return b.tables;
}

describe('exportBackup', () => {
  it('copies every table and records the schema version it came from', async () => {
    const db = await used();
    const b = await exportBackup(db);
    expect(b.format).toBe('jump-attack-backup');
    expect(b.schema_version).toBe(LATEST_VERSION);
    expect(b.tables.athlete.map((a) => a.name)).toEqual(['我自己', '队友']);
    expect(b.tables.trial).toHaveLength(3); // the CMJ and two recovery values
    expect(b.tables.set_log).toHaveLength(1);
  });

  it('picks up every table by itself, so later migrations are backed up without touching this file', async () => {
    const db = await used();
    await db.execAsync('CREATE TABLE future_thing (id INTEGER PRIMARY KEY, athlete_id INTEGER REFERENCES athlete(id)); INSERT INTO future_thing VALUES (1, 1);');
    const b = await exportBackup(db);
    expect(Object.keys(b.tables).sort()).toEqual(['athlete', 'future_thing', 'plan', 'set_log', 'test_session', 'trial', 'workout']);

    const fresh = await setup();
    await fresh.execAsync('CREATE TABLE future_thing (id INTEGER PRIMARY KEY, athlete_id INTEGER REFERENCES athlete(id));');
    expect(await restoreBackup(fresh, b)).toEqual({ ok: true });
    expect((await dump(fresh)).future_thing).toEqual([{ id: 1, athlete_id: 1 }]);
  });
});

describe('restoreBackup', () => {
  it('moves everything to a new phone unchanged, ids included so links between tables hold', async () => {
    const old = await used();
    const fresh = await setup();
    expect(await restoreBackup(fresh, await exportBackup(old))).toEqual({ ok: true });
    expect(await dump(fresh)).toEqual(await dump(old));
    expect((await listSessionResults(fresh, 1, 'cmj')).map((r) => r.best)).toEqual([45.2]);
  });

  it('replaces what was on the phone instead of mixing two histories', async () => {
    const old = await used();
    const other = await setup();
    await createAthlete(other, '别人');
    await ensureSession(other, 'x', 1, 'sj');
    await restoreBackup(other, await exportBackup(old));
    expect(await dump(other)).toEqual(await dump(old));
  });

  it('keeps counting ids after the restored rows, so new records do not collide', async () => {
    const fresh = await setup();
    await restoreBackup(fresh, await exportBackup(await used()));
    expect(await createAthlete(fresh, '新人')).toBe(3);
  });

  it('restores a backup made before later migrations, new columns take their defaults', async () => {
    const fresh = await setup();
    const b = await exportBackup(await used());
    b.schema_version = 1;
    b.tables.athlete = b.tables.athlete.map(({ id, name, body_mass_kg, standing_reach_cm, created_at }) => ({ id, name, body_mass_kg, standing_reach_cm, created_at }));
    b.tables.plan = b.tables.plan.map(({ deloads: _d, blocks: _b, ...rest }) => rest);
    delete b.tables.set_log;
    expect(await restoreBackup(fresh, b)).toEqual({ ok: true });
    const [me] = await listAthletes(fresh);
    expect(me).toMatchObject({ name: '我自己', body_mass_kg: 78, leg_length_cm: null });
    expect((await getActivePlan(fresh, 1))?.deloads).toEqual([]);
    expect((await dump(fresh)).set_log).toEqual([]);
  });

  it('ignores tables and columns this app does not know instead of building SQL from them', async () => {
    const fresh = await setup();
    const b = await exportBackup(await used());
    b.tables.athlete[0] = { ...b.tables.athlete[0], 'name) VALUES (1); DROP TABLE trial; --': 'x' };
    b.tables['trial; DROP TABLE plan; --'] = [{ id: 1 }];
    expect(await restoreBackup(fresh, b)).toEqual({ ok: true });
    expect((await dump(fresh)).trial).toHaveLength(3);
    expect((await dump(fresh)).plan).toHaveLength(1);
  });

  it('leaves the phone as it was when a row cannot be stored', async () => {
    const db = await used();
    const before = await dump(db);
    const b = await exportBackup(db);
    b.tables.trial = [{ id: 9, session_id: 'missing', value: 1 }];
    expect(await restoreBackup(db, b)).toEqual({ ok: false, problem: '备份里的数据有问题，没有恢复，手机上原来的数据保持不变。' });
    expect(await dump(db)).toEqual(before);
  });
});
