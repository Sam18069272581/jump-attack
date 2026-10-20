import { migrate } from '../migrations';
import { createAthlete } from '../repo';
import { openMemoryDb } from '../testing/memoryDb';
import { endPlan, finishWorkout, getActivePlan, lastLoads, listSets, listWorkouts, logSet, startPlan, startWorkout, unlogSet } from '../training';

async function setup() {
  const db = openMemoryDb();
  await migrate(db);
  return db;
}

const settings = { templateCode: 'jump-4-1', startDate: '2026-10-21', weekdays: [5, 1, 3] };

describe('plans', () => {
  it('keeps one active plan per athlete', async () => {
    const db = await setup();
    const first = await startPlan(db, 1, settings);
    const second = await startPlan(db, 1, { ...settings, templateCode: 'jump-maintain-2', weekdays: [2, 5] });
    const other = await createAthlete(db, '队员');
    await startPlan(db, other, settings);

    const active = await getActivePlan(db, 1);
    expect(active).toEqual({ id: second, athleteId: 1, templateCode: 'jump-maintain-2', startDate: '2026-10-21', weekdays: [2, 5], deloads: [] });
    expect(first).not.toBe(second);

    await endPlan(db, second);
    expect(await getActivePlan(db, 1)).toBeNull();
    expect((await getActivePlan(db, other))?.weekdays).toEqual([1, 3, 5]);
  });
});

describe('workouts and sets', () => {
  it('freezes readiness at the first start and upserts logged sets', async () => {
    const db = await setup();
    const planId = await startPlan(db, 1, settings);
    const adjustments = [{ code: 'back_squat', name: '杠铃后蹲', change: '4 组 → 3 组' }];
    const w = await startWorkout(db, { planId, date: '2026-10-26', sessionCode: 'A', readiness: 'fatigued', cmjDrop: 0.06, adjustments });
    const again = await startWorkout(db, { planId, date: '2026-10-26', sessionCode: 'A', readiness: 'ready', cmjDrop: null, adjustments: [] });
    expect(again).toMatchObject({ id: w.id, readiness: 'fatigued', cmjDrop: 0.06, adjustments, finishedAt: null });

    await logSet(db, w.id, { exercise_code: 'back_squat', set_no: 1, reps: 5, load_kg: 100, rpe: 7 });
    await logSet(db, w.id, { exercise_code: 'back_squat', set_no: 1, reps: 4, load_kg: 102.5, rpe: 8 });
    await logSet(db, w.id, { exercise_code: 'back_squat', set_no: 2, reps: 5, load_kg: 105, rpe: 8 });
    await logSet(db, w.id, { exercise_code: 'squat_jump', set_no: 1, reps: 5, load_kg: null, rpe: null });
    await unlogSet(db, w.id, 'squat_jump', 1);
    expect(await listSets(db, w.id)).toEqual([
      { exercise_code: 'back_squat', set_no: 1, reps: 4, load_kg: 102.5, rpe: 8 },
      { exercise_code: 'back_squat', set_no: 2, reps: 5, load_kg: 105, rpe: 8 },
    ]);
    expect(await lastLoads(db, 1)).toEqual({ back_squat: 105 });

    await finishWorkout(db, w.id);
    const [done] = await listWorkouts(db, planId);
    expect(done.finishedAt).not.toBeNull();
  });
});
