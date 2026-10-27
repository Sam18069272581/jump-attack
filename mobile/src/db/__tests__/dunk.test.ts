import { loadDiagnosis, loadDunkInputs, squat1rmHistory } from '../dunk';
import { addDropJump, addLoadedJump } from '../jumps';
import { migrate } from '../migrations';
import { addTrial, ensureSession, getAthlete, updateAthlete } from '../repo';
import { openMemoryDb } from '../testing/memoryDb';
import { logSet, startPlan, startWorkout } from '../training';
import { addTested1rm, addVbtSet } from '../vbt';

async function setup() {
  const db = openMemoryDb();
  await migrate(db);
  const athlete = (await getAthlete(db, 1))!;
  await updateAthlete(db, { ...athlete, body_mass_kg: 75, standing_reach_cm: 240, leg_length_cm: 100, squat_height_cm: 60 });
  return db;
}

async function jumps(db: Awaited<ReturnType<typeof setup>>, metric: string, session: string, values: number[]) {
  await ensureSession(db, session, 1, metric);
  for (const value of values) await addTrial(db, { session_id: session, value });
}

it('estimates the squat 1RM from bar speed and from logged sets', async () => {
  const db = await setup();
  const planId = await startPlan(db, 1, { templateCode: 'jump-4-1', startDate: '2020-01-06', weekdays: [1, 3, 5] });
  const w = await startWorkout(db, { planId, date: '2020-01-06', sessionCode: 'A', readiness: 'ready', cmjDrop: null, adjustments: [] });
  // 100 kg × 5 at RPE 8 is like 7 reps to failure: 100 / (1 / (1 + 7/30)) ≈ 123.3 kg.
  await logSet(db, w.id, { exercise_code: 'back_squat', set_no: 1, reps: 5, load_kg: 100, rpe: 8 });
  // Too far from failure to say anything about a 1RM.
  await logSet(db, w.id, { exercise_code: 'back_squat', set_no: 2, reps: 12, load_kg: 110, rpe: 6 });
  // Line through 60, 80 and 100 kg at 1.0, 0.8 and 0.6 m/s reaches 0.3 m/s at 130 kg.
  await addVbtSet(db, 1, 'vbt-1', 'vbt_squat', { load: 60, v: 1.0, reps: 3, source: 'manual' });
  await addVbtSet(db, 1, 'vbt-1', 'vbt_squat', { load: 80, v: 0.8, reps: 3, source: 'manual' });
  await addVbtSet(db, 1, 'vbt-1', 'vbt_squat', { load: 100, v: 0.6, reps: 2, source: 'manual' });
  // Two light loads: too far from 1RM to extrapolate, so left out.
  await addVbtSet(db, 1, 'vbt-2', 'vbt_squat', { load: 60, v: 1.2, reps: 3, source: 'manual' });
  await addVbtSet(db, 1, 'vbt-2', 'vbt_squat', { load: 80, v: 1.0, reps: 3, source: 'manual' });
  // And one actually lifted.
  await addTested1rm(db, 1, 'max-1', 165);

  const history = await squat1rmHistory(db, 1);
  expect(history.map((h) => Math.round(h.kg * 10) / 10).sort()).toEqual([123.3, 130, 165]);
});

it('gathers every result the diagnosis reads', async () => {
  const db = await setup();
  await jumps(db, 'cmj', 'cmj-1', [44, 45]);
  await jumps(db, 'sj', 'sj-1', [40]);
  await jumps(db, 'approach_touch', 'touch-1', [290, 292]);
  await addVbtSet(db, 1, 'vbt-1', 'vbt_squat', { load: 60, v: 1.0, reps: 3, source: 'manual' });
  await addVbtSet(db, 1, 'vbt-1', 'vbt_squat', { load: 80, v: 0.8, reps: 3, source: 'manual' });
  await addVbtSet(db, 1, 'vbt-1', 'vbt_squat', { load: 100, v: 0.6, reps: 2, source: 'manual' });
  await addDropJump(db, 1, 'dj-1', { boxCm: 30, rsi: 1.8, contactMs: 190, heightCm: 34, flightS: 0.53 });
  await addDropJump(db, 1, 'dj-1', { boxCm: 40, rsi: 2.1, contactMs: 200, heightCm: 42, flightS: 0.59 });
  for (const [kg, cm] of [[0, 36.2], [20, 26.4], [40, 19.3], [60, 13.8]]) await addLoadedJump(db, 1, 'fv-1', kg, cm);

  const athlete = (await getAthlete(db, 1))!;
  const input = await loadDunkInputs(db, athlete);
  expect(input).toMatchObject({
    bodyMassKg: 75,
    standingReachCm: 240,
    rimCm: null,
    clearanceCm: null,
    cmj: [45],
    sj: [40],
    approachTouch: [292],
    dropJumps: [{ rsi: 2.1, contactMs: 200 }],
  });
  expect(input.squat1rm[0]).toBeCloseTo(130);
  expect(input.fvPct).toHaveLength(1);
  expect(input.fvPct[0]).toBeCloseTo(71, 0);

  const d = await loadDiagnosis(db, athlete);
  expect(d.gapCm).toBe(28);
  expect(d.limiter).toBe('transfer');
  expect(d.missing).toEqual([]);
});
