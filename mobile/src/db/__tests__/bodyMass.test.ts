import { listBodyMass, recordBodyMass } from '../bodyMass';
import { migrate } from '../migrations';
import { createAthlete } from '../repo';
import { openMemoryDb } from '../testing/memoryDb';

async function setup() {
  const db = openMemoryDb();
  await migrate(db);
  return db;
}

it('keeps one weigh-in a day per athlete, oldest first, the latest of a day winning', async () => {
  const db = await setup();
  const other = await createAthlete(db, '队友');
  await recordBodyMass(db, 1, 80.4, '2026-10-26');
  await recordBodyMass(db, 1, 81, '2026-10-20');
  await recordBodyMass(db, 1, 80, '2026-10-26');
  await recordBodyMass(db, other, 70, '2026-10-26');
  expect(await listBodyMass(db, 1)).toEqual([
    { date: '2026-10-20', kg: 81 },
    { date: '2026-10-26', kg: 80 },
  ]);
});
