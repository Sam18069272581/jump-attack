import type { SQLiteDatabase } from 'expo-sqlite';

import { listSessionResults, type Athlete } from '@/db/repo';
import { toISODate, type ISODate } from '@/domain/dates';
import type { DunkDiagnosis } from '@/domain/dunk';
import { forecastLine, goalSummary } from '@/domain/goal';
import { APPROACH_TOUCH } from '@/domain/metrics';

/** The home screen's goal row: the countdown to the goal date and when the run-up touch trend reaches the line. */
export async function loadGoalSummary(db: SQLiteDatabase, athlete: Athlete, diagnosis: DunkDiagnosis, today: ISODate) {
  const touches = (await listSessionResults(db, athlete.id, APPROACH_TOUCH.code)).map((r) => ({ date: toISODate(new Date(r.started_at)), value: r.best }));
  return goalSummary({
    goalDate: athlete.goal_date ?? null,
    today,
    forecast: forecastLine(touches, diagnosis.line, today),
    strengthLimited: diagnosis.limiter === 'strength',
  });
}
