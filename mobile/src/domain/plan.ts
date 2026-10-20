import { type Readiness } from './assess';
import { addDays, daysBetween, mondayOf, weekday, type ISODate } from './dates';

export type ItemKind = 'plyo' | 'strength' | 'accessory';

/** One exercise in a session, written as a rule (sets × reps at an effort) rather than a fixed weight. */
export type Prescription = {
  /** Stable id used by the set log. */
  code: string;
  name: string;
  kind: ItemKind;
  sets: number;
  reps: number;
  perSide?: boolean;
  /** Target effort (RPE 1–10) for loaded lifts. */
  rpe?: number;
  /** Logged with a weight. Strength lifts always are. */
  loaded?: boolean;
  /** Maximal-intensity work, skipped in deload weeks and on fatigued days. */
  intense?: boolean;
  cue?: string;
};

export type SessionTemplate = { code: string; name: string; focus: string; items: Prescription[] };

export type Phase = 'accumulate' | 'intensify' | 'deload';

export const PHASE_NAMES: Record<Phase, string> = { accumulate: '积累期', intensify: '强化期', deload: '减量期' };

/** How a week changes the base sessions. `setFactor` wins over `setDelta`. */
export type WeekSpec = { phase: Phase; setDelta?: number; setFactor?: number; rpeDelta?: number; dropIntense?: boolean };

export type PlanTemplate = {
  code: string;
  name: string;
  summary: string;
  /** One per training day of the week, in weekday order. */
  sessions: SessionTemplate[];
  weeks: WeekSpec[];
  /** Start the weeks over after the last one instead of ending. */
  repeat: boolean;
};

export type PlanSettings = { templateCode: string; startDate: ISODate; weekdays: number[] };

export type PlannedSession = {
  date: ISODate;
  /** 0-based week since the plan's first Monday. */
  week: number;
  phase: Phase;
  session: SessionTemplate;
};

export const MIN_RPE = 5;
export const MAX_RPE = 10;

const clampRpe = (r: number) => Math.min(MAX_RPE, Math.max(MIN_RPE, r));

export function isLoaded(p: Prescription): boolean {
  return p.kind === 'strength' || p.loaded === true;
}

export function scaleSession(session: SessionTemplate, week: WeekSpec): SessionTemplate {
  const items = session.items
    .filter((p) => !(week.dropIntense && p.intense))
    .map((p) => ({
      ...p,
      sets: week.setFactor != null ? Math.max(1, Math.round(p.sets * week.setFactor)) : p.sets + (week.setDelta ?? 0),
      rpe: p.rpe != null ? clampRpe(p.rpe + (week.rpeDelta ?? 0)) : undefined,
    }));
  return { ...session, items };
}

/** Number of weeks a plan runs, or null when it repeats. */
export function planWeeks(t: PlanTemplate): number | null {
  return t.repeat ? null : t.weeks.length;
}

/** The session planned for `date`, already scaled for its week; null on rest days and outside the plan. */
export function planDay(t: PlanTemplate, s: PlanSettings, date: ISODate): PlannedSession | null {
  if (daysBetween(s.startDate, date) < 0) return null;
  const week = Math.floor(daysBetween(mondayOf(s.startDate), date) / 7);
  if (!t.repeat && week >= t.weeks.length) return null;
  const slot = [...s.weekdays].sort((a, b) => a - b).indexOf(weekday(date));
  if (slot < 0) return null;
  const spec = t.weeks[week % t.weeks.length];
  return { date, week, phase: spec.phase, session: scaleSession(t.sessions[slot % t.sessions.length], spec) };
}

/** Monday to Sunday of the week containing `date`. */
export function weekDays(date: ISODate): ISODate[] {
  const monday = mondayOf(date);
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
}

/** The first planned session on or after `from`, looking at most `horizon` days ahead. */
export function nextSession(t: PlanTemplate, s: PlanSettings, from: ISODate, horizon = 28): PlannedSession | null {
  for (let i = 0; i <= horizon; i++) {
    const p = planDay(t, s, addDays(from, i));
    if (p) return p;
  }
  return null;
}

/** True once a non-repeating plan has no more sessions on or after `date`. */
export function planFinished(t: PlanTemplate, s: PlanSettings, date: ISODate): boolean {
  if (t.repeat) return false;
  return daysBetween(addDays(mondayOf(s.startDate), t.weeks.length * 7), date) >= 0;
}

/** Share of sets kept on a fatigued day: total volume about −30%. */
export const FATIGUE_SET_FACTOR = 0.7;

export type Adjustment = { code: string; name: string; change: string };

/**
 * The "readiness low → cut volume" rule: on a fatigued day, skip maximal-intensity work, cut every
 * other exercise to ~70% of its sets and lower its target RPE by one.
 */
export function adjustForReadiness(session: SessionTemplate, readiness: Readiness): { session: SessionTemplate; adjustments: Adjustment[] } {
  if (readiness !== 'fatigued') return { session, adjustments: [] };
  const adjustments: Adjustment[] = [];
  const items: Prescription[] = [];
  for (const p of session.items) {
    if (p.intense) {
      adjustments.push({ code: p.code, name: p.name, change: '今天取消（最大强度）' });
      continue;
    }
    const sets = Math.max(1, Math.round(p.sets * FATIGUE_SET_FACTOR));
    const rpe = p.rpe != null ? clampRpe(p.rpe - 1) : undefined;
    const changes = [
      sets !== p.sets ? `${p.sets} 组 → ${sets} 组` : null,
      rpe != null && rpe !== p.rpe ? `RPE ${formatRpe(p.rpe!)} → ${formatRpe(rpe)}` : null,
    ].filter((c): c is string => c != null);
    if (changes.length) adjustments.push({ code: p.code, name: p.name, change: changes.join('，') });
    items.push({ ...p, sets, rpe });
  }
  return { session: { ...session, items }, adjustments };
}

export function formatRpe(rpe: number): string {
  return Number.isInteger(rpe) ? String(rpe) : rpe.toFixed(1);
}

/** e.g. "4 × 5 · RPE 8" or "3 × 5/侧". */
export function formatPrescription(p: Prescription): string {
  const base = `${p.sets} × ${p.reps}${p.perSide ? '/侧' : ''}`;
  return p.rpe != null ? `${base} · RPE ${formatRpe(p.rpe)}` : base;
}

export type LoggedSet = { exercise_code: string; set_no: number; reps: number; load_kg: number | null; rpe: number | null };

export type WorkoutSummary = { setsDone: number; setsPlanned: number; jumps: number; volumeKg: number };

/** What the training report shows: completion, number of jumps and lifted volume (reps × kg). */
export function summarizeWorkout(session: SessionTemplate, logs: LoggedSet[]): WorkoutSummary {
  const kinds = new Map(session.items.map((p) => [p.code, p]));
  let jumps = 0;
  let volumeKg = 0;
  for (const l of logs) {
    const p = kinds.get(l.exercise_code);
    const reps = p?.perSide ? l.reps * 2 : l.reps;
    if (p?.kind === 'plyo') jumps += reps;
    if (l.load_kg != null) volumeKg += reps * l.load_kg;
  }
  const planned = new Set(session.items.flatMap((p) => Array.from({ length: p.sets }, (_, i) => `${p.code}#${i + 1}`)));
  const setsDone = logs.filter((l) => planned.has(`${l.exercise_code}#${l.set_no}`)).length;
  return { setsDone, setsPlanned: planned.size, jumps, volumeKg: Math.round(volumeKg) };
}
