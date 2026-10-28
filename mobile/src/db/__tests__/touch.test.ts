import { migrate } from '../migrations';
import { addTrial, ensureSession, listTrials } from '../repo';
import { openMemoryDb } from '../testing/memoryDb';
import { latestTouchMethod, recalibrateTouches, touchOffsetFor } from '../touch';

async function setup() {
  const db = openMemoryDb();
  await migrate(db);
  return db;
}

async function touch(db: Awaited<ReturnType<typeof setup>>, session: string, at: string, value: number, detail: Record<string, unknown>) {
  await ensureSession(db, session, 1, 'approach_touch');
  await db.runAsync('UPDATE test_session SET started_at = ? WHERE id = ?', at, session);
  await addTrial(db, { session_id: session, value, detail });
}

it('has no offset and reads touches as they were saved until a jump is calibrated', async () => {
  const db = await setup();
  await touch(db, 'a', '2026-10-01T10:00:00Z', 290, { source: 'video', jump_cm: 50, standing_reach_cm: 240 });
  expect(await touchOffsetFor(db, 1)).toBeNull();
  expect(await latestTouchMethod(db, 1)).toBe('video');
});

it('calibrates earlier filmed touches once a jump has a wall reading', async () => {
  const db = await setup();
  await touch(db, 'a', '2026-10-01T10:00:00Z', 290, { source: 'video', jump_cm: 50, standing_reach_cm: 240 });
  await touch(db, 'm', '2026-10-05T10:00:00Z', 296, { source: 'manual' });
  // Filmed and read off the wall: 297 − (240 + 51) = 6.
  await touch(db, 'b', '2026-10-08T10:00:00Z', 297, { source: 'video', jump_cm: 51, standing_reach_cm: 240, touched_cm: 297 });

  expect(await recalibrateTouches(db, 1)).toBe(6);
  expect(await touchOffsetFor(db, 1)).toBe(6);
  const [a] = await listTrials(db, 'a');
  expect(a).toMatchObject({ value: 296, detail: { jump_cm: 50, standing_reach_cm: 240, offset_cm: 6 } });
  // Wall readings and typed touches keep their value.
  expect((await listTrials(db, 'b'))[0].value).toBe(297);
  expect((await listTrials(db, 'm'))[0].value).toBe(296);
  expect(await latestTouchMethod(db, 1)).toBe('wall');
});

it('says a typed touch is read off the wall', async () => {
  const db = await setup();
  await touch(db, 'm', '2026-10-05T10:00:00Z', 296, { source: 'manual' });
  expect(await latestTouchMethod(db, 1)).toBe('wall');
  expect(await latestTouchMethod(db, 2)).toBeNull();
});
