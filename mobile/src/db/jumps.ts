import type { SQLiteDatabase } from 'expo-sqlite';

import type { FvJump } from '@/domain/fvp';
import type { LadderJump } from '@/domain/dropJump';
import { roundTo } from '@/domain/interval';

import { addTrial, ensureSession } from './repo';

/** Squat jumps with the load on the bar: the trials of `sj` sessions. Unloaded jumps have no load (0 kg). */
export type LoadedJump = FvJump & { id: number; session_id: string; started_at: string };

export async function listLoadedJumps(db: SQLiteDatabase, athleteId: number): Promise<LoadedJump[]> {
  const rows = await db.getAllAsync<{ id: number; session_id: string; started_at: string; load_kg: number | null; value: number }>(
    `SELECT t.id, t.session_id, s.started_at, t.load_kg, t.value
     FROM trial t JOIN test_session s ON s.id = t.session_id
     WHERE s.athlete_id = ? AND s.metric_code = 'sj'
     ORDER BY s.started_at, t.id`,
    athleteId,
  );
  return rows.map((r) => ({ id: r.id, session_id: r.session_id, started_at: r.started_at, loadKg: r.load_kg ?? 0, heightCm: r.value }));
}

export async function addLoadedJump(db: SQLiteDatabase, athleteId: number, sessionId: string, loadKg: number, heightCm: number): Promise<number> {
  await ensureSession(db, sessionId, athleteId, 'sj');
  return addTrial(db, { session_id: sessionId, value: heightCm, load_kg: loadKg, detail: { source: 'manual' } });
}

/** Sessions with jumps at two or more loads, which is what a force-velocity profile needs, oldest first. */
export function profileSessions(jumps: LoadedJump[]): { sessionId: string; startedAt: string; jumps: LoadedJump[] }[] {
  const out: { sessionId: string; startedAt: string; jumps: LoadedJump[] }[] = [];
  for (const j of jumps) {
    const last = out.at(-1);
    if (last?.sessionId === j.session_id) last.jumps.push(j);
    else out.push({ sessionId: j.session_id, startedAt: j.started_at, jumps: [j] });
  }
  return out.filter((s) => new Set(s.jumps.map((j) => j.loadKg)).size >= 2);
}

/** A drop jump with its box height; RSI is the trial's value. */
export type DropJumpTrial = LadderJump & { id: number; session_id: string; started_at: string };

export async function listDropJumps(db: SQLiteDatabase, athleteId: number): Promise<DropJumpTrial[]> {
  const rows = await db.getAllAsync<{ id: number; session_id: string; started_at: string; value: number; detail: string | null }>(
    `SELECT t.id, t.session_id, s.started_at, t.value, t.detail
     FROM trial t JOIN test_session s ON s.id = t.session_id
     WHERE s.athlete_id = ? AND s.metric_code = 'dj_rsi'
     ORDER BY s.started_at, t.id`,
    athleteId,
  );
  return rows.map((r) => {
    const d = (r.detail ? JSON.parse(r.detail) : {}) as { box_cm?: number; contact_ms?: number; height_cm?: number };
    return { id: r.id, session_id: r.session_id, started_at: r.started_at, rsi: r.value, boxCm: d.box_cm ?? 0, contactMs: d.contact_ms ?? 0, heightCm: d.height_cm ?? 0 };
  });
}

/** A drop jump typed in from another app or a contact mat. */
export async function addDropJump(
  db: SQLiteDatabase,
  athleteId: number,
  sessionId: string,
  jump: { boxCm: number; rsi: number; contactMs: number; heightCm: number; flightS: number },
): Promise<number> {
  await ensureSession(db, sessionId, athleteId, 'dj_rsi');
  return addTrial(db, {
    session_id: sessionId,
    value: roundTo(jump.rsi, 2),
    flight_ms: jump.flightS * 1000,
    detail: { source: 'manual', box_cm: jump.boxCm, contact_ms: Math.round(jump.contactMs), height_cm: roundTo(jump.heightCm, 1) },
  });
}
