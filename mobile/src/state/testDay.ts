import type { SQLiteDatabase } from 'expo-sqlite';

import { listDropJumps } from '@/db/jumps';
import { listMetricResults } from '@/db/repo';
import { toISODate, type ISODate } from '@/domain/dates';
import { getMetric, type MetricDef } from '@/domain/metrics';
import { testDayBox, testDaySteps, type TestDayStep } from '@/domain/testDay';

/** A test-day step with what was recorded for it on the day: the day's latest session, its attempts and result. */
export type TestDayRow = TestDayStep & { def: MetricDef; sessionId: string | null; trials: number; best: number | null };

export async function loadTestDay(db: SQLiteDatabase, athleteId: number, today: ISODate): Promise<TestDayRow[]> {
  const steps = testDaySteps(testDayBox(await listDropJumps(db, athleteId)));
  return Promise.all(
    steps.map(async (step) => {
      const def = getMetric(step.metric)!;
      const session = (await listMetricResults(db, athleteId, def)).filter((r) => toISODate(new Date(r.started_at)) === today).at(-1);
      return { ...step, def, sessionId: session?.session_id ?? null, trials: session?.trials ?? 0, best: session?.best ?? null };
    }),
  );
}
