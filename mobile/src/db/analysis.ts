import type { SQLiteDatabase } from 'expo-sqlite';

import { pooledWithinSd } from '@/domain/agreement';
import type { MarkedTrial } from '@/domain/marking';
import type { MetricDef } from '@/domain/metrics';

import { addTrial, ensureSession, listMetricResults, listSessionValues } from './repo';

/** The trials of an analysed clip, all or none. */
export async function saveAnalysedTrials(db: SQLiteDatabase, athleteId: number, sessionId: string, metricCode: string, trials: MarkedTrial[]): Promise<void> {
  await db.withTransactionAsync(async () => {
    await ensureSession(db, sessionId, athleteId, metricCode);
    for (const t of trials) await addTrial(db, { session_id: sessionId, ...t });
  });
}

/**
 * What a new session of `def` is judged against: the results of the sessions before `sessionId`, oldest first, and the
 * typical error of one attempt, from the spread of attempts within those sessions (domain/agreement.ts).
 */
export async function analysisHistory(db: SQLiteDatabase, athleteId: number, def: MetricDef, sessionId: string): Promise<{ previous: number[]; te: number | null }> {
  const results = await listMetricResults(db, athleteId, def);
  const i = results.findIndex((r) => r.session_id === sessionId);
  const earlier = i < 0 ? results : results.slice(0, i);
  const values = await listSessionValues(db, athleteId, def.code);
  return { previous: earlier.map((r) => r.best), te: pooledWithinSd(earlier.map((r) => values[r.session_id] ?? [])) };
}
