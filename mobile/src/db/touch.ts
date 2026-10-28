import type { SQLiteDatabase } from 'expo-sqlite';

import { roundTo } from '@/domain/interval';
import { APPROACH_TOUCH } from '@/domain/metrics';
import { touchOffset, type Calibration } from '@/domain/touch';

type TouchDetail = { source?: string; jump_cm?: number; standing_reach_cm?: number; touched_cm?: number; offset_cm?: number };
type TouchTrial = { id: number; session_id: string; value: number; detail: TouchDetail };

/** Every approach-touch attempt, oldest first. */
async function listTouchTrials(db: SQLiteDatabase, athleteId: number): Promise<TouchTrial[]> {
  const rows = await db.getAllAsync<{ id: number; session_id: string; value: number; detail: string | null }>(
    `SELECT t.id, t.session_id, t.value, t.detail FROM trial t JOIN test_session s ON s.id = t.session_id
     WHERE s.athlete_id = ? AND s.metric_code = ?
     ORDER BY s.started_at, t.id`,
    athleteId,
    APPROACH_TOUCH.code,
  );
  return rows.map((r) => ({ ...r, detail: r.detail ? JSON.parse(r.detail) : {} }));
}

const calibrations = (trials: TouchTrial[]): Calibration[] =>
  trials.flatMap(({ detail: d }) =>
    d.touched_cm != null && d.jump_cm != null && d.standing_reach_cm != null ? [{ touchedCm: d.touched_cm, reachCm: d.standing_reach_cm, jumpCm: d.jump_cm }] : [],
  );

/** The athlete's gap between a wall reading and the video estimate (domain/touch.ts), or null before any calibration. */
export async function touchOffsetFor(db: SQLiteDatabase, athleteId: number): Promise<number | null> {
  return touchOffset(calibrations(await listTouchTrials(db, athleteId)));
}

/**
 * Re-values every filmed touch without a wall reading as standing reach + jump + the current offset, so earlier
 * touches move onto the same scale when a new calibration comes in. Returns the offset.
 */
export async function recalibrateTouches(db: SQLiteDatabase, athleteId: number): Promise<number | null> {
  const trials = await listTouchTrials(db, athleteId);
  const offset = touchOffset(calibrations(trials));
  await db.withTransactionAsync(async () => {
    for (const { id, detail: d } of trials) {
      if (d.touched_cm != null || d.jump_cm == null || d.standing_reach_cm == null) continue;
      const { offset_cm: _old, ...rest } = d;
      const detail = offset != null ? { ...rest, offset_cm: offset } : rest;
      await db.runAsync('UPDATE trial SET value = ?, detail = ? WHERE id = ?', roundTo(d.standing_reach_cm + d.jump_cm + (offset ?? 0), 1), JSON.stringify(detail), id);
    }
  });
  return offset;
}

/**
 * How the latest touch was measured: read off a wall or backboard (typed in, or filmed with a wall reading), or
 * only estimated from video. Null without any touch.
 */
export async function latestTouchMethod(db: SQLiteDatabase, athleteId: number): Promise<'wall' | 'video' | null> {
  const trials = await listTouchTrials(db, athleteId);
  const last = trials.at(-1);
  if (!last) return null;
  // The session's result is its best attempt.
  const best = trials.filter((t) => t.session_id === last.session_id).reduce((a, b) => (b.value > a.value ? b : a));
  return best.detail.source === 'video' && best.detail.touched_cm == null ? 'video' : 'wall';
}
