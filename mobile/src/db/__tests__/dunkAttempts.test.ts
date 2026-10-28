import { exportBackup } from '../backup';
import { addDunkAttempt, deleteDunkAttempt, listDunkAttempts } from '../dunkAttempts';
import { migrate } from '../migrations';
import { createAthlete } from '../repo';
import { openMemoryDb } from '../testing/memoryDb';

async function setup() {
  const db = openMemoryDb();
  await migrate(db);
  return db;
}

it('keeps each athlete’s attempts, oldest first', async () => {
  const db = await setup();
  const other = await createAthlete(db, '队友');
  await addDunkAttempt(db, 1, { rimCm: 305, ball: 'basketball', outcome: 'rim', at: '2026-10-28T18:05:00Z' });
  await addDunkAttempt(db, 1, { rimCm: 300, ball: 'volleyball', outcome: 'made', at: '2026-10-28T18:00:00Z' });
  await addDunkAttempt(db, other, { rimCm: 305, ball: 'basketball', outcome: 'made' });

  expect(await listDunkAttempts(db, 1)).toEqual([
    { id: expect.any(Number), at: '2026-10-28T18:00:00Z', rimCm: 300, ball: 'volleyball', outcome: 'made' },
    { id: expect.any(Number), at: '2026-10-28T18:05:00Z', rimCm: 305, ball: 'basketball', outcome: 'rim' },
  ]);
  expect(await listDunkAttempts(db, other)).toHaveLength(1);
});

it('deletes one attempt logged by mistake', async () => {
  const db = await setup();
  const id = await addDunkAttempt(db, 1, { rimCm: 305, ball: 'basketball', outcome: 'short' });
  await addDunkAttempt(db, 1, { rimCm: 305, ball: 'basketball', outcome: 'made' });
  await deleteDunkAttempt(db, id);
  expect((await listDunkAttempts(db, 1)).map((a) => a.outcome)).toEqual(['made']);
});

it('refuses an outcome or ball the app does not know', async () => {
  const db = await setup();
  await expect(db.runAsync("INSERT INTO dunk_attempt (athlete_id, rim_cm, ball, outcome) VALUES (1, 305, 'basketball', 'maybe')")).rejects.toThrow();
  await expect(db.runAsync("INSERT INTO dunk_attempt (athlete_id, rim_cm, ball, outcome) VALUES (1, 305, 'tennis', 'made')")).rejects.toThrow();
});

it('is part of the backup, so attempts move with the rest of the data', async () => {
  const db = await setup();
  await addDunkAttempt(db, 1, { rimCm: 305, ball: 'basketball', outcome: 'made' });
  expect((await exportBackup(db)).tables.dunk_attempt).toHaveLength(1);
});
