import { listCmjMeans, listSessionLoads, listTestJumpDays } from '../load';
import { migrate } from '../migrations';
import { addTrial, ensureSession } from '../repo';
import { openMemoryDb } from '../testing/memoryDb';
import { getWorkout, setSessionLoad, startPlan, startWorkout } from '../training';

async function setup() {
  const db = openMemoryDb();
  await migrate(db);
  return db;
}

async function session(db: Awaited<ReturnType<typeof setup>>, id: string, metric: string, at: Date, values: number[]) {
  await ensureSession(db, id, 1, metric);
  await db.runAsync('UPDATE test_session SET started_at = ? WHERE id = ?', at.toISOString(), id);
  for (const value of values) await addTrial(db, { session_id: id, value });
}

it('reads a CMJ session as the mean of its best 3 jumps, or of all when fewer', async () => {
  const db = await setup();
  await session(db, 'a', 'cmj', new Date(2026, 10, 2, 9), [40, 44, 42, 30]);
  await session(db, 'b', 'cmj', new Date(2026, 10, 3, 9), [40, 42]);
  await session(db, 'c', 'sj', new Date(2026, 10, 3, 9), [50]);
  expect(await listCmjMeans(db, 1)).toEqual([
    { session_id: 'a', started_at: new Date(2026, 10, 2, 9).toISOString(), best: 42 },
    { session_id: 'b', started_at: new Date(2026, 10, 3, 9).toISOString(), best: 41 },
  ]);
});

it('keeps the session RPE and minutes a workout was given', async () => {
  const db = await setup();
  const planId = await startPlan(db, 1, { templateCode: 'jump-4-1', startDate: '2026-11-02', weekdays: [1, 3, 5] });
  const w = await startWorkout(db, { planId, date: '2026-11-02', sessionCode: 'A', readiness: 'unknown', cmjDrop: null, adjustments: [] });
  await startWorkout(db, { planId, date: '2026-11-04', sessionCode: 'B', readiness: 'unknown', cmjDrop: null, adjustments: [] });
  await setSessionLoad(db, w.id, { rpe: 7, minutes: 65 });
  expect(await getWorkout(db, planId, '2026-11-02')).toMatchObject({ sessionRpe: 7, durationMin: 65 });
  expect(await listSessionLoads(db, 1)).toEqual([{ started_at: w.startedAt, rpe: 7, minutes: 65 }]);
});

it('counts jump-test attempts per local day', async () => {
  const db = await setup();
  await session(db, 'a', 'approach_touch', new Date(2026, 10, 2, 18), [310, 312]);
  await session(db, 'b', 'cmj', new Date(2026, 10, 2, 9), [40]);
  await session(db, 'c', 'cmj', new Date(2026, 10, 3, 9), [40, 41, 42]);
  await session(db, 'd', 'sprint_20', new Date(2026, 10, 3, 9), [3.1]);
  expect(await listTestJumpDays(db, 1)).toEqual([
    { date: '2026-11-02', jumps: 3 },
    { date: '2026-11-03', jumps: 3 },
  ]);
});
