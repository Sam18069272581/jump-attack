import { migrate } from '../migrations';
import { createAthlete, getAthlete, listAthletes, updateAthlete } from '../repo';
import { openMemoryDb } from '../testing/memoryDb';
import { getActivePlan, startPlan } from '../training';

async function setup() {
  const db = openMemoryDb();
  await migrate(db);
  return db;
}

it('keeps each athlete’s goal date, none until set', async () => {
  const db = await setup();
  const other = await createAthlete(db, '队友');
  expect((await getAthlete(db, 1))?.goal_date).toBeNull();
  await updateAthlete(db, { ...(await getAthlete(db, 1))!, goal_date: '2026-12-01' });
  expect((await listAthletes(db)).map((a) => [a.id, a.goal_date])).toEqual([
    [1, '2026-12-01'],
    [other, null],
  ]);
});

it('hands the goal date to the active plan, so the plan counts back from it', async () => {
  const db = await setup();
  await startPlan(db, 1, { templateCode: 'jump-4-1', startDate: '2026-10-21', weekdays: [1, 3, 5] });
  expect((await getActivePlan(db, 1))?.goalDate).toBeUndefined();
  await updateAthlete(db, { ...(await getAthlete(db, 1))!, goal_date: '2026-12-01' });
  expect((await getActivePlan(db, 1))?.goalDate).toBe('2026-12-01');
});
