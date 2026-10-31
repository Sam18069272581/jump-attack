import { exportAthlete, findSameAthlete, importAthlete } from '../athleteData';
import { exportBackup } from '../backup';
import { listBodyMass, recordBodyMass } from '../bodyMass';
import { addDunkAttempt, listDunkAttempts } from '../dunkAttempts';
import { migrate } from '../migrations';
import { listPain, setPain } from '../pain';
import { addTrial, createAthlete, ensureSession, getAthlete, listAthletes, listSessionResults, updateAthlete } from '../repo';
import { listRecoveryDays, saveRecoveryDay } from '../recovery';
import { openMemoryDb } from '../testing/memoryDb';
import { getActivePlan, listSets, listWorkouts, logSet, startPlan, startWorkout } from '../training';

async function setup() {
  const db = openMemoryDb();
  await migrate(db);
  return db;
}

/**
 * The coach's phone: the owner (1) with a CMJ, and a teammate (2) with a bit of everything, including the session ids
 * that carry an athlete or workout id (a weigh-in, a recovery day, a warm-up bar speed).
 */
async function coachPhone() {
  const db = await setup();
  const [me] = await listAthletes(db);
  await updateAthlete(db, { ...me, body_mass_kg: 78 });
  // Set up weeks ago, so its default athlete can't share a creation time with one made during the test.
  await db.runAsync("UPDATE athlete SET created_at = '2026-09-01T08:00:00.000Z' WHERE id = 1");
  await ensureSession(db, 'own-cmj', 1, 'cmj');
  await addTrial(db, { session_id: 'own-cmj', value: 45 });

  const mate = await createAthlete(db, '小明');
  await updateAthlete(db, { ...(await getAthlete(db, mate))!, standing_reach_cm: 238 });
  await ensureSession(db, 'mate-touch', mate, 'approach_touch');
  for (const value of [312, 314, 313]) await addTrial(db, { session_id: 'mate-touch', value });
  await recordBodyMass(db, mate, 72, '2026-10-27');
  await saveRecoveryDay(db, mate, { date: '2026-10-27', hrv: 70, rhr: 48, sleep: null, resp: null });
  const planId = await startPlan(db, mate, { templateCode: 'dunk', startDate: '2026-10-26', weekdays: [1, 3, 5] });
  const workout = await startWorkout(db, { planId, date: '2026-10-26', sessionCode: 'A', readiness: 'ready', cmjDrop: null, adjustments: [] });
  await logSet(db, workout.id, { exercise_code: 'back_squat', set_no: 1, reps: 5, load_kg: 90, rpe: 8 });
  await ensureSession(db, `warmup-${workout.id}-back_squat`, mate, 'vbt_back_squat');
  await addTrial(db, { session_id: `warmup-${workout.id}-back_squat`, value: 0.82, load_kg: 60 });
  await addDunkAttempt(db, mate, { rimCm: 305, ball: 'volleyball', outcome: 'rim', at: '2026-10-27T18:00:00Z' });
  await setPain(db, mate, { date: '2026-10-27', kind: 'morning', score: 2 });
  return { db, mate, planId, workoutId: workout.id };
}

/** Everything one athlete has, without ids, to compare across phones. */
async function records(db: Awaited<ReturnType<typeof setup>>, athleteId: number) {
  const plan = await getActivePlan(db, athleteId);
  const workouts = plan ? await listWorkouts(db, plan.id) : [];
  return {
    athlete: { ...(await getAthlete(db, athleteId)), id: undefined },
    touches: (await listSessionResults(db, athleteId, 'approach_touch')).map((r) => [r.started_at, r.best, r.trials]),
    bodyMass: await listBodyMass(db, athleteId),
    recovery: await listRecoveryDays(db, athleteId),
    plan: plan && { ...plan, id: undefined, athleteId: undefined },
    sets: await Promise.all(workouts.map(async (w) => listSets(db, w.id))),
    warmups: await db.getAllAsync('SELECT t.value, t.load_kg FROM trial t JOIN test_session s ON s.id = t.session_id WHERE s.athlete_id = ? AND s.id LIKE ?', athleteId, 'warmup-%'),
    attempts: (await listDunkAttempts(db, athleteId)).map(({ id: _id, ...a }) => a),
    pain: await listPain(db, athleteId),
  };
}

describe('exportAthlete', () => {
  it('takes one athlete and everything recorded for them, nobody else', async () => {
    const { db, mate } = await coachPhone();
    const file = await exportAthlete(db, mate);
    expect(file.format).toBe('jump-attack-athlete');
    expect(file.tables.athlete.map((a) => a.name)).toEqual(['小明']);
    expect(file.tables.test_session.every((s) => s.athlete_id === mate)).toBe(true);
    expect(file.tables.test_session.map((s) => s.id)).not.toContain('own-cmj');
    // Three touches, the weigh-in, two recovery values (HRV, resting HR) and the warm-up set.
    expect(file.tables.trial).toHaveLength(7);
    expect(file.tables.set_log).toHaveLength(1);
    expect(file.tables.dunk_attempt).toHaveLength(1);
    expect(file.tables.knee_pain).toHaveLength(1);
  });

  it('follows the links between tables by itself, so tables added later come along', async () => {
    const { db, mate } = await coachPhone();
    await db.execAsync(`CREATE TABLE future_thing (id INTEGER PRIMARY KEY, athlete_id INTEGER REFERENCES athlete(id)); INSERT INTO future_thing VALUES (1, 1), (2, ${mate});`);
    expect((await exportAthlete(db, mate)).tables.future_thing).toEqual([{ id: 2, athlete_id: mate }]);
  });
});

describe('importAthlete', () => {
  it('moves an athlete to their own new phone unchanged, in place of the empty default athlete', async () => {
    const { db, mate } = await coachPhone();
    const phone = await setup();
    const r = await importAthlete(phone, await exportAthlete(db, mate));
    expect(r).toEqual({ ok: true, athleteId: expect.any(Number) });
    expect((await listAthletes(phone)).map((a) => a.name)).toEqual(['小明']);
    expect(await records(phone, r.ok ? r.athleteId : 0)).toEqual(await records(db, mate));
  });

  it('adds a teammate next to the people already on a phone, links and day ids intact', async () => {
    const { db, mate } = await coachPhone();
    const { db: other } = await coachPhone();
    const before = await records(other, 1);
    const r = await importAthlete(other, await exportAthlete(db, mate));
    if (!r.ok) throw new Error(r.problem);
    expect((await listAthletes(other)).map((a) => a.name)).toEqual(['我自己', '小明', '小明']);
    expect(r.athleteId).toBe(3);
    expect(await records(other, r.athleteId)).toEqual(await records(db, mate));
    expect(await records(other, 1)).toEqual(before);

    // Ids that name their athlete or workout follow the new ids, so the next weigh-in that day replaces this one.
    const ids = (await other.getAllAsync<{ id: string }>('SELECT id FROM test_session WHERE athlete_id = ?', r.athleteId)).map((s) => s.id);
    const workout = (await listWorkouts(other, (await getActivePlan(other, r.athleteId))!.id))[0];
    expect(ids).toEqual(expect.arrayContaining(['day-3-body_mass-2026-10-27', `warmup-${workout.id}-back_squat`]));
    await recordBodyMass(other, r.athleteId, 71.5, '2026-10-27');
    expect(await listBodyMass(other, r.athleteId)).toEqual([{ date: '2026-10-27', kg: 71.5 }]);
  });

  it('keeps each filmed dunk attempt pointing at its own take-off analysis on the new phone', async () => {
    const { db, mate } = await coachPhone();
    await ensureSession(db, 'mate-tech', mate, 'takeoff_tech');
    const trialId = await addTrial(db, { session_id: 'mate-tech', value: 3.1, fps: 240 });
    await addDunkAttempt(db, mate, { rimCm: 305, ball: 'basketball', outcome: 'made', trialId, videoUri: 'file:///app/Documents/technique/take-9.mov' });
    // The other phone has trials of its own, so the analysis gets another id there.
    const { db: other } = await coachPhone();
    const r = await importAthlete(other, await exportAthlete(db, mate));
    if (!r.ok) throw new Error(r.problem);
    const filmed = (await listDunkAttempts(other, r.athleteId)).find((a) => a.trialId != null)!;
    expect(filmed).toMatchObject({ outcome: 'made', videoUri: 'file:///app/Documents/technique/take-9.mov' });
    expect(filmed.trialId).not.toBe(trialId);
    const trial = await other.getFirstAsync<{ value: number; athlete_id: number }>('SELECT t.value, s.athlete_id FROM trial t JOIN test_session s ON s.id = t.session_id WHERE t.id = ?', filmed.trialId!);
    expect(trial).toEqual({ value: 3.1, athlete_id: r.athleteId });
  });

  it('recognises an athlete brought back to the phone they came from, and replaces only their records', async () => {
    const { db, mate } = await coachPhone();
    // The teammate trained on their own phone for a week, then brings the newer data back.
    const theirPhone = await setup();
    const moved = await importAthlete(theirPhone, await exportAthlete(db, mate));
    if (!moved.ok) throw new Error(moved.problem);
    await theirPhone.runAsync("INSERT INTO test_session (id, athlete_id, metric_code, started_at) VALUES ('later-touch', ?, 'approach_touch', '2099-01-01T10:00:00.000Z')", moved.athleteId);
    await addTrial(theirPhone, { session_id: 'later-touch', value: 317 });
    const newer = await exportAthlete(theirPhone, moved.athleteId);

    const ownBefore = await records(db, 1);
    expect((await findSameAthlete(db, newer))?.id).toBe(mate);
    const r = await importAthlete(db, newer, { replace: mate });
    expect(r).toEqual({ ok: true, athleteId: mate });
    expect((await listAthletes(db)).map((a) => a.name)).toEqual(['我自己', '小明']);
    expect((await records(db, mate)).touches.map((t) => t[1])).toEqual([314, 317]);
    expect(await records(db, 1)).toEqual(ownBefore);
  });

  it('still recognises an athlete renamed on either phone, by when they were added', async () => {
    const { db, mate } = await coachPhone();
    const file = await exportAthlete(db, mate);
    await updateAthlete(db, { ...(await getAthlete(db, mate))!, name: '王小明' });
    expect((await findSameAthlete(db, file))?.id).toBe(mate);
  });

  it("does not take a new phone's default athlete for the same person", async () => {
    const { db } = await coachPhone();
    expect(await findSameAthlete(await setup(), await exportAthlete(db, 1))).toBeNull();
  });

  it('changes nothing when the file does not fit, all or nothing', async () => {
    const { db, mate } = await coachPhone();
    const file = await exportAthlete(db, mate);
    // A trial pointing at a session the file does not have.
    file.tables.trial.push({ id: 999, session_id: 'missing', value: 1 });
    const phone = await setup();
    const before = await exportBackup(phone);
    expect(await importAthlete(phone, file)).toEqual({ ok: false, problem: '文件里的数据有问题，没有导入，手机上原来的数据保持不变。' });
    expect((await exportBackup(phone)).tables).toEqual(before.tables);
  });
});
