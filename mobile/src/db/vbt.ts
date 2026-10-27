import type { SQLiteDatabase } from 'expo-sqlite';

import { SQUAT_1RM } from '@/domain/metrics';
import { checkedOneRm, MVT, type LvProfile, type OneRmProblem } from '@/domain/vbt';

import { addTrial, ensureSession, listSessionResults } from './repo';

/** One logged VBT set: a trial whose value is the mean velocity. */
export type VbtSet = { id: number; session_id: string; started_at: string; load: number; v: number; reps: number | null };

export async function listVbtSets(db: SQLiteDatabase, athleteId: number, code: string): Promise<VbtSet[]> {
  const rows = await db.getAllAsync<{ id: number; session_id: string; started_at: string; load_kg: number | null; value: number; detail: string | null }>(
    `SELECT t.id, t.session_id, s.started_at, t.load_kg, t.value, t.detail
     FROM trial t JOIN test_session s ON s.id = t.session_id
     WHERE s.athlete_id = ? AND s.metric_code = ?
     ORDER BY s.started_at, t.id`,
    athleteId,
    code,
  );
  return rows.map((r) => ({
    id: r.id,
    session_id: r.session_id,
    started_at: r.started_at,
    load: r.load_kg ?? 0,
    v: r.value,
    reps: (r.detail ? (JSON.parse(r.detail).reps as number | undefined) : undefined) ?? null,
  }));
}

export async function addVbtSet(
  db: SQLiteDatabase,
  athleteId: number,
  sessionId: string,
  code: string,
  set: {
    load: number;
    v: number;
    reps: number | null;
    /** Typed in, tracked from video, or copied from the VBTgo app. */
    source: 'manual' | 'video' | 'vbtgo';
    romCm?: number;
    /** Mean velocity of every rep, in order, when known. */
    repV?: number[];
    peakV?: number;
    videoUri?: string;
  },
): Promise<number> {
  await ensureSession(db, sessionId, athleteId, code);
  return addTrial(db, {
    session_id: sessionId,
    value: set.v,
    load_kg: set.load,
    video_uri: set.videoUri,
    detail: {
      source: set.source,
      ...(set.reps != null ? { reps: set.reps } : {}),
      ...(set.romCm != null ? { rom_cm: set.romCm } : {}),
      ...(set.repV ? { rep_v: set.repV } : {}),
      ...(set.peakV != null ? { peak_v: set.peakV } : {}),
    },
  });
}

export type LiftEstimate = { profile: LvProfile; oneRm: number | null; problem: OneRmProblem | null; sessionId: string; startedAt: string };

/** Every session's load-velocity profile, oldest first, with the 1RM it implies when the profile is good enough. */
export function sessionEstimates(sets: VbtSet[], code: string): LiftEstimate[] {
  const out: LiftEstimate[] = [];
  for (const id of new Set(sets.map((s) => s.session_id))) {
    const inSession = sets.filter((s) => s.session_id === id && s.load > 0);
    const est = checkedOneRm(
      inSession.map((s) => ({ load: s.load, v: s.v })),
      MVT[code],
    );
    if (est) out.push({ ...est, sessionId: id, startedAt: inSession[0].started_at });
  }
  return out;
}

/**
 * The load-velocity profile from the most recent session that has one (sets at two or more loads,
 * usually the warm-up), with the 1RM it implies for lifts that have a minimum velocity threshold, if the
 * profile passes the checks in `checkedOneRm`.
 */
export function latestEstimate(sets: VbtSet[], code: string): LiftEstimate | null {
  return sessionEstimates(sets, code).at(-1) ?? null;
}

export type Tested1rm = { kg: number; at: string };

/** Back-squat 1RMs the athlete actually lifted, oldest first. */
export async function listTested1rm(db: SQLiteDatabase, athleteId: number): Promise<Tested1rm[]> {
  return (await listSessionResults(db, athleteId, SQUAT_1RM.code)).map((r) => ({ kg: r.best, at: r.started_at }));
}

export async function addTested1rm(db: SQLiteDatabase, athleteId: number, sessionId: string, kg: number): Promise<void> {
  await ensureSession(db, sessionId, athleteId, SQUAT_1RM.code);
  await addTrial(db, { session_id: sessionId, value: kg, detail: { source: 'tested' } });
}

/** A lifted 1RM older than this no longer stands in for today's strength. */
export const TESTED_MAX_AGE_DAYS = 120;

/** Load of each session's fastest set, keyed by session. */
export function fastestSetLoads(sets: VbtSet[]): Record<string, number> {
  const fastest: Record<string, VbtSet> = {};
  for (const s of sets) if (!fastest[s.session_id] || s.v > fastest[s.session_id].v) fastest[s.session_id] = s;
  return Object.fromEntries(Object.entries(fastest).map(([id, s]) => [id, s.load]));
}
