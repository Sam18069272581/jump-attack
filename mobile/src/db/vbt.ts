import type { SQLiteDatabase } from 'expo-sqlite';

import { daysBetween, toISODate, type ISODate } from '@/domain/dates';
import { SQUAT_1RM } from '@/domain/metrics';
import { checkedOneRm, MVT, type LvProfile, type OneRmProblem } from '@/domain/vbt';

import { addTrial, ensureSession, listSessionResults } from './repo';

/** One logged VBT set: a trial whose value is the mean velocity. */
export type VbtSet = { id: number; session_id: string; started_at: string; load: number; v: number; reps: number | null; repV: number[] | null };

export async function listVbtSets(db: SQLiteDatabase, athleteId: number, code: string): Promise<VbtSet[]> {
  const rows = await db.getAllAsync<{ id: number; session_id: string; started_at: string; load_kg: number | null; value: number; detail: string | null }>(
    `SELECT t.id, t.session_id, s.started_at, t.load_kg, t.value, t.detail
     FROM trial t JOIN test_session s ON s.id = t.session_id
     WHERE s.athlete_id = ? AND s.metric_code = ?
     ORDER BY s.started_at, t.id`,
    athleteId,
    code,
  );
  return rows.map((r) => {
    const detail = r.detail ? (JSON.parse(r.detail) as { reps?: number; rep_v?: number[] }) : {};
    return {
      id: r.id,
      session_id: r.session_id,
      started_at: r.started_at,
      load: r.load_kg ?? 0,
      v: r.value,
      reps: detail.reps ?? null,
      repV: detail.rep_v ?? null,
    };
  });
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
    /** Mean propulsive velocity of every rep, in order, when known. */
    repMpv?: number[];
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
      ...(set.repMpv ? { rep_mpv: set.repMpv } : {}),
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

/** The most recent 1RM estimate that passed its checks, which may be from an earlier session than `latestEstimate`. */
export function latestOneRm(sets: VbtSet[], code: string): LiftEstimate | null {
  return sessionEstimates(sets, code).filter((e) => e.oneRm != null).at(-1) ?? null;
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
/** Nor does a velocity estimate older than this. */
export const ESTIMATE_MAX_AGE_DAYS = 28;

export type Current1rm = { kg: number; source: 'tested' | 'velocity'; at: ISODate };

/**
 * The 1RM of a VBT lift to train from on `date`: one actually lifted (squat only) within `TESTED_MAX_AGE_DAYS`,
 * otherwise the latest velocity estimate that passed its checks within `ESTIMATE_MAX_AGE_DAYS`, otherwise none.
 */
export async function current1rm(db: SQLiteDatabase, athleteId: number, lift: string, date: ISODate): Promise<Current1rm | null> {
  const local = (at: string) => toISODate(new Date(at));
  const tested = lift === 'vbt_squat' ? (await listTested1rm(db, athleteId)).at(-1) : undefined;
  if (tested && daysBetween(local(tested.at), date) <= TESTED_MAX_AGE_DAYS) return { kg: tested.kg, source: 'tested', at: local(tested.at) };
  const est = latestOneRm(await listVbtSets(db, athleteId, lift), lift);
  if (est?.oneRm != null && daysBetween(local(est.startedAt), date) <= ESTIMATE_MAX_AGE_DAYS) return { kg: est.oneRm, source: 'velocity', at: local(est.startedAt) };
  return null;
}

/** Load of each session's fastest set, keyed by session. */
export function fastestSetLoads(sets: VbtSet[]): Record<string, number> {
  const fastest: Record<string, VbtSet> = {};
  for (const s of sets) if (!fastest[s.session_id] || s.v > fastest[s.session_id].v) fastest[s.session_id] = s;
  return Object.fromEntries(Object.entries(fastest).map(([id, s]) => [id, s.load]));
}
