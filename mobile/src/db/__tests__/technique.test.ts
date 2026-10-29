import { analyseTechnique, type TechniqueResult } from '@/domain/technique';
import { poseScene } from '@/domain/testing/poseScene';

import { migrate } from '../migrations';
import { addTrial, createAthlete, ensureSession, listTrials, sessionCounts } from '../repo';
import { addTechniqueTake, deleteTechniqueTake, listTechniqueTakes, reachByDay, TECHNIQUE_CODE, techniqueVideoUris } from '../technique';
import { openMemoryDb } from '../testing/memoryDb';

async function setup() {
  const db = openMemoryDb();
  await migrate(db);
  return db;
}

let result: TechniqueResult;
const scene = poseScene();

beforeAll(() => {
  const r = analyseTechnique({ frames: scene.frames, captureFps: 240, markers: scene.markers });
  if (!r.ok) throw new Error(r.problem);
  result = r.result;
});

it('saves a take as a trial of its own test: the vertical take-off velocity, the frames, the rest in its detail', async () => {
  const db = await setup();
  const id = await addTechniqueTake(db, 1, { sessionId: 's1', result, captureFps: 240, source: 'import', markers: scene.markers });

  const [trial] = await listTrials(db, 's1');
  expect(trial).toMatchObject({ id, value: result.metrics.vz!.value, fps: 240, takeoff_frame: result.events.takeoff, landing_frame: result.events.landing, video_uri: null });
  expect(await sessionCounts(db, 1)).toEqual({ [TECHNIQUE_CODE]: 1 });

  const [take] = await listTechniqueTakes(db, 1);
  expect(take).toEqual({
    id,
    sessionId: 's1',
    at: expect.any(String),
    source: 'import',
    captureFps: 240,
    style: result.style,
    metrics: result.metrics,
    flags: result.flags,
    videoUri: null,
  });
});

it('lists a take whose saved figure lost its error (JSON writes an endless one as null) without that figure', async () => {
  const db = await setup();
  const unbounded = { ...result, metrics: { ...result.metrics, plant: { value: 134, error: Infinity, status: 'imprecise' as const } } };
  await addTechniqueTake(db, 1, { sessionId: 's1', result: unbounded, captureFps: 240, source: 'import', markers: null });

  const [take] = await listTechniqueTakes(db, 1);
  expect(take.metrics.plant).toBeUndefined();
  expect(take.metrics.vz).toEqual(result.metrics.vz);
});

it('lists each athlete’s own takes, newest first, and deletes one', async () => {
  const db = await setup();
  const other = await createAthlete(db, '队友');
  const first = await addTechniqueTake(db, 1, { sessionId: 's1', result, captureFps: 60, source: 'camera', markers: null, videoUri: 'file:///app/Documents/technique/a.mp4' });
  const second = await addTechniqueTake(db, 1, { sessionId: 's2', result, captureFps: 240, source: 'import', markers: scene.markers });
  await addTechniqueTake(db, other, { sessionId: 's3', result, captureFps: 240, source: 'import', markers: null });

  const takes = await listTechniqueTakes(db, 1);
  expect(takes.map((t) => t.id)).toEqual([second, first]);
  expect(takes[1]).toMatchObject({ source: 'camera', captureFps: 60, videoUri: 'file:///app/Documents/technique/a.mp4' });

  await deleteTechniqueTake(db, second);
  expect((await listTechniqueTakes(db, 1)).map((t) => t.id)).toEqual([first]);
  expect(await listTrials(db, 's2')).toEqual([]);
});

it('lists the video of every take filmed in the app, whoever’s it is: the files to keep', async () => {
  const db = await setup();
  const other = await createAthlete(db, '队友');
  await addTechniqueTake(db, 1, { sessionId: 's1', result, captureFps: 60, source: 'camera', markers: null, videoUri: 'file:///app/Documents/technique/a.mp4' });
  await addTechniqueTake(db, other, { sessionId: 's2', result, captureFps: 60, source: 'camera', markers: null, videoUri: 'file:///app/Documents/technique/b.mp4' });
  await addTechniqueTake(db, 1, { sessionId: 's3', result, captureFps: 240, source: 'import', markers: null });
  // Another test's clip is no take's.
  await ensureSession(db, 's4', 1, 'cmj');
  await addTrial(db, { session_id: 's4', value: 40, video_uri: 'file:///app/Documents/videos/c.mov' });
  expect((await techniqueVideoUris(db)).sort()).toEqual(['file:///app/Documents/technique/a.mp4', 'file:///app/Documents/technique/b.mp4']);
});

it('gives the run-up touch of each day, the better session’s on a day of two', async () => {
  const db = await setup();
  // A touch test is scored by the mean of its best three jumps.
  const touch = async (session: string, at: string, values: number[]) => {
    await ensureSession(db, session, 1, 'approach_touch');
    await db.runAsync('UPDATE test_session SET started_at = ? WHERE id = ?', at, session);
    for (const v of values) await addTrial(db, { session_id: session, value: v });
  };
  await touch('a', new Date(2026, 9, 27, 18).toISOString(), [310, 312, 314, 300]);
  await touch('b', new Date(2026, 9, 28, 9).toISOString(), [316, 316, 316]);
  await touch('c', new Date(2026, 9, 28, 19).toISOString(), [318, 318, 321]);
  expect(await reachByDay(db, 1)).toEqual({ '2026-10-27': 312, '2026-10-28': 319 });
});
