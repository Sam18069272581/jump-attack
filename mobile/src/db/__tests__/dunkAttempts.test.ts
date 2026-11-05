import { discardKept, exportBackup, keptBeforeRestore, restoreBackup, undoRestore } from '../backup';
import { addDunkAttempt, deleteDunkAttempt, listDunkAttempts } from '../dunkAttempts';
import { LATEST_VERSION, migrate } from '../migrations';
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

// A restore keeps what it replaced on the phone to put back (db/backup.ts), so it keeps the videos of that too: a take
// filmed in the app has no other copy.
it('keeps the videos of the data a restore replaced, so they come back with it', async () => {
  const db = await setup();
  const trialId = await analysis(db, 'tt-5');
  await addDunkAttempt(db, 1, { rimCm: 305, ball: 'basketball', outcome: 'made', trialId, videoUri: 'file:///app/Documents/technique/take-5.mov' });
  await ensureSession(db, 'tt-6', 1, TECHNIQUE_CODE);
  await addTrial(db, { session_id: 'tt-6', value: 3.1, fps: 60, video_uri: 'file:///app/Documents/technique/take-6.mov' });
  // Another test's clip is no take's, kept or not.
  await ensureSession(db, 'cmj-1', 1, 'cmj');
  await addTrial(db, { session_id: 'cmj-1', value: 40, video_uri: 'file:///app/Documents/videos/c.mov' });
  const videos = ['file:///app/Documents/technique/take-5.mov', 'file:///app/Documents/technique/take-6.mov'];
  expect((await techniqueVideoUris(db)).sort()).toEqual(videos);

  const other = await setup();
  await createAthlete(other, '别人');
  expect(await restoreBackup(db, await exportBackup(other))).toEqual({ ok: true });
  expect(await listDunkAttempts(db, 1)).toEqual([]);
  expect((await techniqueVideoUris(db)).sort()).toEqual(videos);
  expect(await undoRestore(db)).toEqual({ ok: true });
  expect((await techniqueVideoUris(db)).sort()).toEqual(videos);
});

// A copy kept by a newer app (a bundle rolled back on the phone) waits for that app to put it back, videos and all.
it('keeps the videos of a copy a newer app kept, which only that app can put back', async () => {
  const db = await setup();
  await addDunkAttempt(db, 1, { rimCm: 305, ball: 'basketball', outcome: 'made', videoUri: 'file:///app/Documents/technique/take-7.mov' });
  await db.execAsync(`PRAGMA user_version = ${LATEST_VERSION + 1}`);
  expect(await restoreBackup(db, await exportBackup(await setup()))).toEqual({ ok: true });
  expect(await keptBeforeRestore(db)).toBeNull();
  expect(await techniqueVideoUris(db)).toEqual(['file:///app/Documents/technique/take-7.mov']);
});

/** A phone with a filmed attempt, which a restore of another phone's data then replaced (and kept). */
async function filmedThenReplaced() {
  const db = await setup();
  await addDunkAttempt(db, 1, { rimCm: 305, ball: 'basketball', outcome: 'made', videoUri: 'file:///app/Documents/technique/take-8.mov' });
  const other = await setup();
  await createAthlete(other, '别人');
  await restoreBackup(db, await exportBackup(other));
  return db;
}

// The attempts and technique screens ask for the videos each time they open and after every attempt logged, and the
// kept copy is the whole database before the restore.
it('reads the kept copy once, and again only once a later restore keeps another', async () => {
  const db = await filmedThenReplaced();
  const reads = jest.spyOn(db, 'getFirstAsync');
  const copyReads = () => reads.mock.calls.filter(([sql]) => /SELECT data FROM restore_undo/.test(String(sql))).length;
  expect(await techniqueVideoUris(db)).toEqual(['file:///app/Documents/technique/take-8.mov']);
  expect(await techniqueVideoUris(db)).toEqual(['file:///app/Documents/technique/take-8.mov']);
  expect(copyReads()).toBe(1);

  await new Promise((r) => setTimeout(r, 2));
  await restoreBackup(db, await exportBackup(await setup()));
  expect(await techniqueVideoUris(db)).toEqual([]);
  expect(copyReads()).toBe(2);
});

it('lets the videos of the kept copy go once it is deleted', async () => {
  const db = await filmedThenReplaced();
  expect(await techniqueVideoUris(db)).toEqual(['file:///app/Documents/technique/take-8.mov']);
  await discardKept(db, (await keptBeforeRestore(db))!.at);
  expect(await techniqueVideoUris(db)).toEqual([]);
});
