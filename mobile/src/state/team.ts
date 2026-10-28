import type { SQLiteDatabase } from 'expo-sqlite';

import { loadDiagnosis } from '@/db/dunk';
import { listMetricResults, type Athlete } from '@/db/repo';
import { APPROACH_TOUCH } from '@/domain/metrics';
import { teamBoard, type TeamRow } from '@/domain/team';

/** The coach's board: every athlete on the phone, closest to their dunk line first. */
export async function loadTeam(db: SQLiteDatabase, athletes: Athlete[]): Promise<TeamRow[]> {
  const entries = await Promise.all(
    athletes.map(async (a) => ({
      id: a.id,
      name: a.name,
      diagnosis: await loadDiagnosis(db, a),
      touches: (await listMetricResults(db, a.id, APPROACH_TOUCH)).map((r) => ({ at: r.started_at, value: r.best })),
    })),
  );
  return teamBoard(entries);
}
