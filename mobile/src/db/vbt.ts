import type { SQLiteDatabase } from 'expo-sqlite';

import { estimate1rm, lvProfile, MVT, type LvProfile } from '@/domain/vbt';

import { addTrial, ensureSession } from './repo';

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
  set: { load: number; v: number; reps: number | null; source: 'manual' | 'video'; romCm?: number },
): Promise<number> {
  await ensureSession(db, sessionId, athleteId, code);
  return addTrial(db, {
    session_id: sessionId,
    value: set.v,
    load_kg: set.load,
    detail: { source: set.source, ...(set.reps != null ? { reps: set.reps } : {}), ...(set.romCm != null ? { rom_cm: set.romCm } : {}) },
  });
}

export type LiftEstimate = { profile: LvProfile; oneRm: number | null; sessionId: string; startedAt: string };

/**
 * The load-velocity profile from the most recent session that has one (sets at two or more loads,
 * usually the warm-up), with the 1RM it implies for lifts that have a minimum velocity threshold.
 */
export function latestEstimate(sets: VbtSet[], code: string): LiftEstimate | null {
  const sessions = [...new Set(sets.map((s) => s.session_id))].reverse();
  for (const id of sessions) {
    const inSession = sets.filter((s) => s.session_id === id && s.load > 0);
    const profile = lvProfile(inSession.map((s) => ({ load: s.load, v: s.v })));
    if (!profile) continue;
    const mvt = MVT[code];
    return { profile, oneRm: mvt != null ? estimate1rm(profile, mvt) : null, sessionId: id, startedAt: inSession[0].started_at };
  }
  return null;
}

/** Load of each session's fastest set, keyed by session. */
export function fastestSetLoads(sets: VbtSet[]): Record<string, number> {
  const fastest: Record<string, VbtSet> = {};
  for (const s of sets) if (!fastest[s.session_id] || s.v > fastest[s.session_id].v) fastest[s.session_id] = s;
  return Object.fromEntries(Object.entries(fastest).map(([id, s]) => [id, s.load]));
}
