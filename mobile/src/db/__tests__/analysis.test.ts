import { getMetric } from '@/domain/metrics';

import { analysisHistory, saveAnalysedTrials } from '../analysis';
import { migrate } from '../migrations';
import { addTrial, ensureSession, listTrials } from '../repo';
import { openMemoryDb } from '../testing/memoryDb';

async function setup() {
  const db = openMemoryDb();
  await migrate(db);
  return db;
}

async function session(db: Awaited<ReturnType<typeof setup>>, id: string, at: string, values: number[]) {
  await ensureSession(db, id, 1, 'cmj');
  await db.runAsync('UPDATE test_session SET started_at = ? WHERE id = ?', at, id);
  for (const value of values) await addTrial(db, { session_id: id, value });
}

it('saves every analysed trial in one go', async () => {
  const db = await setup();
  await saveAnalysedTrials(db, 1, 's1', 'cmj', [
    { value: 37.1, flight_ms: 550, fps: 240, takeoff_frame: 100, landing_frame: 232, detail: { source: 'video', auto: true } },
    { value: 36.5, flight_ms: 546, fps: 240, takeoff_frame: 900, landing_frame: 1031, detail: { source: 'video', auto: true } },
  ]);
  const t = await listTrials(db, 's1');
  expect(t.map((x) => x.value)).toEqual([37.1, 36.5]);
  expect(t[0].detail).toEqual({ source: 'video', auto: true });
});

it("reads the earlier sessions' results and the test's typical error from the attempts within them", async () => {
  const db = await setup();
  await session(db, 'a', '2026-10-01T10:00:00Z', [40, 42]);
  await session(db, 'b', '2026-10-03T10:00:00Z', [50, 51, 52]);
  await session(db, 'c', '2026-10-05T10:00:00Z', [45]);
  await session(db, 'today', '2026-10-08T10:00:00Z', [47, 48]);
  const h = await analysisHistory(db, 1, getMetric('cmj')!, 'today');
  // Session bests before today, oldest first; today's own attempts don't count towards the noise of the test.
  expect(h.previous).toEqual([42, 52, 45]);
  // Pooled within-session SD of a and b: √((2 + 2) / 3) (see agreement.test.ts).
  expect(h.te).toBeCloseTo(Math.sqrt(4 / 3), 9);
});

it('has no typical error while no session has two attempts', async () => {
  const db = await setup();
  await session(db, 'a', '2026-10-01T10:00:00Z', [40]);
  expect((await analysisHistory(db, 1, getMetric('cmj')!, 'new')).te).toBeNull();
});
