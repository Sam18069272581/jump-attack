import type { SQLiteDatabase } from 'expo-sqlite';

import { listLoggedSets, listSessionLoads, listTestJumpDays } from '@/db/load';
import { toISODate } from '@/domain/dates';
import { jumpLoads, sessionLoad, type DailyLoad } from '@/domain/load';
import { exerciseIn } from '@/domain/templates';

export type NamedLoad = { name: string; entries: DailyLoad[] };

/** The two loads trackload's method tracks here: session RPE × minutes, and jumps for the knees. */
export async function loadTrainingLoads(db: SQLiteDatabase, athleteId: number): Promise<NamedLoad[]> {
  const [sessions, sets, tests] = await Promise.all([listSessionLoads(db, athleteId), listLoggedSets(db, athleteId), listTestJumpDays(db, athleteId)]);
  const day = (iso: string) => toISODate(new Date(iso));
  return [
    { name: '整体负荷', entries: sessions.map((s) => ({ date: day(s.started_at), load: sessionLoad(s.minutes, s.rpe)! })) },
    { name: '跳跃负荷', entries: jumpLoads(sets.map((s) => ({ date: day(s.started_at), reps: s.reps, exercise: exerciseIn(s.template_code, s.exercise_code) })), tests) },
  ];
}
