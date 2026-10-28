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
 *
 * A drop jump is compared only with drop jumps from the same box (`boxCm`): a ladder session holds every box, and RSI
 * changes with the box by design, so mixing them would read the ladder as noise.
 */
export async function analysisHistory(
  db: SQLiteDatabase,
  athleteId: number,
  def: MetricDef,
  sessionId: string,
  opts: { boxCm?: number } = {},
): Promise<{ previous: number[]; te: number | null }> {
  if (opts.boxCm != null) return sameBoxHistory(db, athleteId, def, sessionId, opts.boxCm);
  const results = await listMetricResults(db, athleteId, def);
  const i = results.findIndex((r) => r.session_id === sessionId);
  const earlier = i < 0 ? results : results.slice(0, i);
  const values = await listSessionValues(db, athleteId, def.code);
  return { previous: earlier.map((r) => r.best), te: pooledWithinSd(earlier.map((r) => values[r.session_id] ?? [])) };
}

async function sameBoxHistory(db: SQLiteDatabase, athleteId: number, def: MetricDef, sessionId: string, boxCm: number): Promise<{ previous: number[]; te: number | null }> {
  const rows = await db.getAllAsync<{ session_id: string; value: number; detail: string | null }>(
    `SELECT t.session_id, t.value, t.detail FROM trial t JOIN test_session s ON s.id = t.session_id
     WHERE s.athlete_id = ? AND s.metric_code = ? AND s.started_at < COALESCE((SELECT started_at FROM test_session WHERE id = ?), '9999')
     ORDER BY s.started_at, t.id`,
    athleteId,
    def.code,
    sessionId,
  );
  const bySession = new Map<string, number[]>();
  for (const r of rows) {
    if (r.session_id === sessionId || (r.detail ? JSON.parse(r.detail).box_cm : undefined) !== boxCm) continue;
    bySession.set(r.session_id, [...(bySession.get(r.session_id) ?? []), r.value]);
  }
  const groups = [...bySession.values()];
  return { previous: groups.map((v) => (def.lowerIsBetter ? Math.min(...v) : Math.max(...v))), te: pooledWithinSd(groups) };
}
