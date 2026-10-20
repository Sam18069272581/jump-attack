import { migrate } from '../migrations';
import { listRecoveryDays, saveRecoveryDay } from '../recovery';
import { addTrial, ensureSession, latestResults, listTrials, sessionCounts } from '../repo';
import { openMemoryDb } from '../testing/memoryDb';
import { getActivePlan, insertDeload, startPlan } from '../training';
import { addVbtSet, latestEstimate, listVbtSets } from '../vbt';

async function setup() {
  const db = openMemoryDb();
  await migrate(db);
  return db;
}

async function session(db: Awaited<ReturnType<typeof setup>>, id: string, code: string, at: string, values: number[]) {
  await ensureSession(db, id, 1, code);
  await db.runAsync('UPDATE test_session SET started_at = ? WHERE id = ?', at, id);
  for (const value of values) await addTrial(db, { session_id: id, value });
}

describe('trials', () => {
  it('keep a load and a JSON detail', async () => {
    const db = await setup();
    await ensureSession(db, 's', 1, 'vbt_squat');
    await addTrial(db, { session_id: 's', value: 0.62, load_kg: 100, detail: { source: 'manual', reps: 3 } });
    expect(await listTrials(db, 's')).toEqual([expect.objectContaining({ value: 0.62, load_kg: 100, detail: { source: 'manual', reps: 3 }, flight_ms: null })]);
  });

  it('report each metric’s latest session by its best attempt in the metric’s direction', async () => {
    const db = await setup();
    await session(db, 'a', 'sprint_30', '2026-10-01T10:00:00Z', [4.5, 4.4]);
    await session(db, 'b', 'sprint_30', '2026-10-08T10:00:00Z', [4.38, 4.45]);
    await session(db, 'c', 'sprint_40', '2026-10-08T11:00:00Z', [5.6]);
    await session(db, 'd', 'cmj', '2026-10-08T11:00:00Z', [40]);
    const latest = await latestResults(db, 1, 'sprint_%');
    expect(Object.keys(latest).sort()).toEqual(['sprint_30', 'sprint_40']);
    expect(latest.sprint_30).toMatchObject({ session_id: 'b', best: 4.38, trials: 2 });
    expect(await sessionCounts(db, 1)).toEqual({ sprint_30: 2, sprint_40: 1, cmj: 1 });
  });
});

describe('recovery days', () => {
  it('saves one value per metric per day and replaces it on a second save', async () => {
    const db = await setup();
    await saveRecoveryDay(db, 1, { date: '2026-10-19', hrv: 64, rhr: 52, sleep: 7.5, resp: null });
    await saveRecoveryDay(db, 1, { date: '2026-10-20', hrv: 60, rhr: 55, sleep: null, resp: 14.2 });
    await saveRecoveryDay(db, 1, { date: '2026-10-20', hrv: 58, rhr: null, sleep: 6.5, resp: 14.2 });
    expect(await listRecoveryDays(db, 1)).toEqual([
      { date: '2026-10-19', hrv: 64, rhr: 52, sleep: 7.5, resp: null },
      { date: '2026-10-20', hrv: 58, rhr: null, sleep: 6.5, resp: 14.2 },
    ]);
    expect((await sessionCounts(db, 1)).rec_hrv).toBe(2);
  });
});

describe('VBT sets', () => {
  it('estimate 1RM from the latest session with two or more loads', async () => {
    const db = await setup();
    await addVbtSet(db, 1, 'old', 'vbt_squat', { load: 80, v: 0.7, reps: 3, source: 'manual' });
    for (const [load, v] of [[60, 0.9], [80, 0.7], [100, 0.5]]) await addVbtSet(db, 1, 'today', 'vbt_squat', { load, v, reps: 3, source: 'manual' });
    await addVbtSet(db, 1, 'later', 'vbt_squat', { load: 100, v: 0.52, reps: null, source: 'video', romCm: 55 });
    const sets = await listVbtSets(db, 1, 'vbt_squat');
    expect(sets).toHaveLength(5);
    expect(sets[0]).toMatchObject({ load: 80, v: 0.7, reps: 3 });
    const est = latestEstimate(sets, 'vbt_squat')!;
    expect(est.sessionId).toBe('today'); // 'later' has a single load
    expect(est.oneRm).toBeCloseTo(120); // v = 1.5 − 0.01 × load reaches 0.3 m/s at 120 kg
    expect(latestEstimate(sets, 'vbt_clean_hang')?.oneRm ?? null).toBeNull();
  });
});

describe('deload weeks', () => {
  it('are stored on the plan, sorted and without duplicates', async () => {
    const db = await setup();
    await startPlan(db, 1, { templateCode: 'jump-4-1', startDate: '2026-10-19', weekdays: [1, 3, 5] });
    await insertDeload(db, (await getActivePlan(db, 1))!, '2026-11-04');
    await insertDeload(db, (await getActivePlan(db, 1))!, '2026-10-28');
    await insertDeload(db, (await getActivePlan(db, 1))!, '2026-10-28');
    expect((await getActivePlan(db, 1))!.deloads).toEqual(['2026-10-28', '2026-11-04']);
  });
});
