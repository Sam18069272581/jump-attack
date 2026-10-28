import { exportBackup } from '../backup';
import { migrate } from '../migrations';
import { listPain, listTestJumps, setPain } from '../pain';
import { addTrial, createAthlete, ensureSession } from '../repo';
import { openMemoryDb } from '../testing/memoryDb';

async function setup() {
  const db = openMemoryDb();
  await migrate(db);
  return db;
}

it('keeps one training and one morning score per day, the latest tap winning', async () => {
  const db = await setup();
  const other = await createAthlete(db, '队友');
  await setPain(db, 1, { date: '2026-11-03', kind: 'morning', score: 2 });
  await setPain(db, 1, { date: '2026-11-02', kind: 'session', score: 4 });
  await setPain(db, 1, { date: '2026-11-02', kind: 'session', score: 5 });
  await setPain(db, other, { date: '2026-11-02', kind: 'session', score: 1 });
  expect(await listPain(db, 1)).toEqual([
    { date: '2026-11-02', kind: 'session', score: 5 },
    { date: '2026-11-03', kind: 'morning', score: 2 },
  ]);
});

it('refuses a score off the 0–10 scale', async () => {
  const db = await setup();
  await expect(setPain(db, 1, { date: '2026-11-02', kind: 'session', score: 11 })).rejects.toThrow();
});

it('is part of the backup', async () => {
  const db = await setup();
  await setPain(db, 1, { date: '2026-11-02', kind: 'session', score: 3 });
  expect((await exportBackup(db)).tables.knee_pain).toHaveLength(1);
});

it('counts each jump-test attempt as a jump on its day, other tests not', async () => {
  const db = await setup();
  const at = (s: string, iso: string) => db.runAsync('UPDATE test_session SET started_at = ? WHERE id = ?', iso, s);
  await ensureSession(db, 'touch', 1, 'approach_touch');
  await at('touch', new Date(2026, 10, 2, 18).toISOString());
  for (const v of [310, 312, 314]) await addTrial(db, { session_id: 'touch', value: v });
  await ensureSession(db, 'cmj', 1, 'cmj');
  await at('cmj', new Date(2026, 10, 3, 9).toISOString());
  await addTrial(db, { session_id: 'cmj', value: 45 });
  await ensureSession(db, 'sprint', 1, 'sprint_20');
  await at('sprint', new Date(2026, 10, 2, 18).toISOString());
  await addTrial(db, { session_id: 'sprint', value: 3.1 });
  expect(await listTestJumps(db, 1, '2026-11-02')).toBe(3);
  expect(await listTestJumps(db, 1, '2026-11-03')).toBe(1);
});
