import { exportBackup } from '../backup';
import { addDunkAttempt, deleteDunkAttempt, listDunkAttempts } from '../dunkAttempts';
import { migrate } from '../migrations';
import { addTrial, createAthlete, ensureSession, listTrials } from '../repo';
import { deleteTechniqueTake, TECHNIQUE_CODE, techniqueVideoUris } from '../technique';
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

/** A take-off analysis saved for an attempt: a trial under the technique's code. */
async function analysis(db: Awaited<ReturnType<typeof setup>>, session: string) {
  await ensureSession(db, session, 1, TECHNIQUE_CODE);
  return addTrial(db, { session_id: session, value: 3.3, fps: 240 });
}

it('keeps the video of an attempt and the take-off analysis of it, when there are', async () => {
  const db = await setup();
  const trialId = await analysis(db, 'tt-1');
  await addDunkAttempt(db, 1, { rimCm: 305, ball: 'basketball', outcome: 'rim', at: '2026-10-31T18:00:00Z', trialId, videoUri: 'file:///app/Documents/technique/take-1.mov' });
  // Filmed, but the analysis found no jump: the video is still kept.
  await addDunkAttempt(db, 1, { rimCm: 305, ball: 'basketball', outcome: 'short', at: '2026-10-31T18:01:00Z', videoUri: 'file:///app/Documents/technique/take-2.mov' });
  await addDunkAttempt(db, 1, { rimCm: 305, ball: 'basketball', outcome: 'made', at: '2026-10-31T18:02:00Z' });

  expect(await listDunkAttempts(db, 1)).toEqual([
    { id: expect.any(Number), at: '2026-10-31T18:00:00Z', rimCm: 305, ball: 'basketball', outcome: 'rim', trialId, videoUri: 'file:///app/Documents/technique/take-1.mov' },
    { id: expect.any(Number), at: '2026-10-31T18:01:00Z', rimCm: 305, ball: 'basketball', outcome: 'short', videoUri: 'file:///app/Documents/technique/take-2.mov' },
    { id: expect.any(Number), at: '2026-10-31T18:02:00Z', rimCm: 305, ball: 'basketball', outcome: 'made' },
  ]);
  // The technique screen keeps the files these point to.
  expect((await techniqueVideoUris(db)).sort()).toEqual(['file:///app/Documents/technique/take-1.mov', 'file:///app/Documents/technique/take-2.mov']);
});

it('keeps an attempt and its video when its analysis is deleted on the technique screen', async () => {
  const db = await setup();
  const trialId = await analysis(db, 'tt-2');
  await addDunkAttempt(db, 1, { rimCm: 305, ball: 'basketball', outcome: 'made', trialId, videoUri: 'file:///app/Documents/technique/take-3.mov' });
  await deleteTechniqueTake(db, trialId);
  const [a] = await listDunkAttempts(db, 1);
  expect(a).toMatchObject({ outcome: 'made', videoUri: 'file:///app/Documents/technique/take-3.mov' });
  expect(a.trialId).toBeUndefined();
});

it('deletes the analysis with the attempt logged by mistake', async () => {
  const db = await setup();
  const trialId = await analysis(db, 'tt-3');
  const id = await addDunkAttempt(db, 1, { rimCm: 305, ball: 'basketball', outcome: 'made', trialId, videoUri: 'file:///app/Documents/technique/take-4.mov' });
  await deleteDunkAttempt(db, id);
  expect(await listDunkAttempts(db, 1)).toEqual([]);
  expect(await listTrials(db, 'tt-3')).toEqual([]);
  expect(await techniqueVideoUris(db)).toEqual([]);
});
