import type { SQLiteDatabase } from 'expo-sqlite';

import { toISODate } from '@/domain/dates';
import { APPROACH_TOUCH } from '@/domain/metrics';
import type { Markers, Measured, MetricKey, QualityFlag, TechniqueResult } from '@/domain/technique';

import { addTrial, deleteTrial, ensureSession, listMetricResults } from './repo';

/**
 * Run-up jump technique takes (domain/technique.ts), one trial each under their own test code: the trial's value is
 * the vertical take-off velocity (m/s), its frames take-off and landing, and the rest of the result is in its detail.
 * The code isn't in the metric registry: the technique is measured and shown on its own screen, and isn't part of the
 * dunk diagnosis until real footage has confirmed its errors.
 */
export const TECHNIQUE_CODE = 'takeoff_tech';

/** Where a take came from: filmed in the app (up to 60 fps), or a slow-motion clip from the photo library. */
export type TechniqueSource = 'camera' | 'import';

export type TechniqueTake = {
  id: number;
  sessionId: string;
  at: string;
  source: TechniqueSource;
  captureFps: number;
  style: TechniqueResult['style'];
  metrics: Partial<Record<MetricKey, Measured>>;
  flags: QualityFlag[];
  /** The app's own copy of a clip filmed in it; null for a clip from the photo library, which stays there. */
  videoUri: string | null;
};

type Detail = {
  v: 1;
  source: TechniqueSource;
  style: TechniqueResult['style'];
  metrics: Partial<Record<MetricKey, Measured>>;
  flags: QualityFlag[];
  events: TechniqueResult['events'];
  scale: TechniqueResult['scale'];
  markers: Markers | null;
};

/** Saves an analysed take and returns its trial id. */
export async function addTechniqueTake(
  db: SQLiteDatabase,
  athleteId: number,
  t: { sessionId: string; result: TechniqueResult; captureFps: number; source: TechniqueSource; markers: Markers | null; videoUri?: string | null },
): Promise<number> {
  const r = t.result;
  await ensureSession(db, t.sessionId, athleteId, TECHNIQUE_CODE);
  const detail: Detail = { v: 1, source: t.source, style: r.style, metrics: r.metrics, flags: r.flags, events: r.events, scale: r.scale, markers: t.markers };
  return addTrial(db, {
    session_id: t.sessionId,
    value: r.metrics.vz?.value ?? 0,
    fps: t.captureFps,
    takeoff_frame: r.events.takeoff,
    landing_frame: r.events.landing,
    video_uri: t.videoUri ?? null,
    detail,
  });
}

/** Every take of the athlete, newest first. */
export async function listTechniqueTakes(db: SQLiteDatabase, athleteId: number): Promise<TechniqueTake[]> {
  const rows = await db.getAllAsync<{ id: number; session_id: string; created_at: string; fps: number; video_uri: string | null; detail: string }>(
    `SELECT t.id, t.session_id, t.created_at, t.fps, t.video_uri, t.detail
     FROM trial t JOIN test_session s ON s.id = t.session_id
     WHERE s.athlete_id = ? AND s.metric_code = ?
     ORDER BY t.created_at DESC, t.id DESC`,
    athleteId,
    TECHNIQUE_CODE,
  );
  return rows.map((r) => {
    const d = JSON.parse(r.detail) as Detail;
    return { id: r.id, sessionId: r.session_id, at: r.created_at, source: d.source, captureFps: r.fps, style: d.style, metrics: d.metrics, flags: d.flags, videoUri: r.video_uri };
  });
}

export async function deleteTechniqueTake(db: SQLiteDatabase, id: number): Promise<void> {
  await deleteTrial(db, id);
}

/** The app's own copy of every take filmed in it, of every athlete: the files to keep (media/takes.ts `pruneTakes`). */
export async function techniqueVideoUris(db: SQLiteDatabase): Promise<string[]> {
  const rows = await db.getAllAsync<{ video_uri: string }>(
    `SELECT t.video_uri FROM trial t JOIN test_session s ON s.id = t.session_id
     WHERE s.metric_code = ? AND t.video_uri IS NOT NULL`,
    TECHNIQUE_CODE,
  );
  return rows.map((r) => r.video_uri);
}

/** The run-up touch result of each day it was tested (cm, the better session's on a day of two), keyed by local date. */
export async function reachByDay(db: SQLiteDatabase, athleteId: number): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const s of await listMetricResults(db, athleteId, APPROACH_TOUCH)) {
    const day = toISODate(new Date(s.started_at));
    out[day] = Math.max(out[day] ?? -Infinity, s.best);
  }
  return out;
}
