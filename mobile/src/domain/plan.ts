import { type Readiness } from './assess';
import { addDays, daysBetween, mondayOf, weekday, type ISODate } from './dates';
import type { BlockType } from './dunk';

/**
 * What an exercise trains. Block plans tag every exercise strength, reactive, transfer or technique, so a block
 * can say how much of each it wants; `plyo` and `accessory` are the older tags and stay valid.
 */
export type ItemKind = 'plyo' | 'strength' | 'accessory' | 'reactive' | 'transfer' | 'technique';

export const KIND_NAMES: Record<ItemKind, string> = {
  plyo: '跳跃',
  strength: '力量',
  accessory: '辅助',
  reactive: '反应',
  transfer: '转化',
  technique: '技术',
};

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
  /** Counted as jumps in the training report. Defaults to true for plyo and reactive work. */
  jump?: boolean;
  cue?: string;
};

export type SessionTemplate = { code: string; name: string; focus: string; items: Prescription[] };

export type Phase = 'accumulate' | 'intensify' | 'deload';

export const PHASE_NAMES: Record<Phase, string> = { accumulate: '积累期', intensify: '强化期', deload: '减量期' };

/** How a week changes the base sessions. `setFactor` wins over `setDelta`. `retest` marks the week to test again. */
export type WeekSpec = { phase: Phase; setDelta?: number; setFactor?: number; rpeDelta?: number; dropIntense?: boolean; retest?: boolean };

/** A training block's sessions and weeks, the last of which deloads and retests. Name and focus are in domain/dunk.ts BLOCKS. */
export type BlockTemplate = {
  type: BlockType;
  sessions: SessionTemplate[];
  weeks: WeekSpec[];
  /** Tests to redo in the retest week, as metric codes. */
  retest: string[];
  /** Optional additions a block can switch on (see {@link PlanBlock.extras}): the item and the session slot it joins. */
  extras?: Record<string, { slot: number; item: Prescription }>;
};

export type PlanTemplate = {
  code: string;
  name: string;
  summary: string;
  /** One per training day of the week, in weekday order. */
  sessions: SessionTemplate[];
  weeks: WeekSpec[];
  /** Start the weeks over after the last one instead of ending. */
  repeat: boolean;
  /** Set on block plans: sessions and weeks come from the block a day falls in (see {@link PlanSettings.blocks}). */
  blocks?: Record<BlockType, BlockTemplate>;
};

/**
 * One stretch of a block plan. A block runs 4 weeks and then starts over as the same type until the next entry,
 * so switching blocks or skipping ahead is just appending an entry.
 */
export type PlanBlock = {
  /**
   * First day, in the plan's own schedule: inserted deload weeks push it back with the rest of the plan.
   * Entries are kept in order of `start`.
   */
  start: ISODate;
  type: BlockType;
  /** Block week this stretch starts at, 0-based. Set when a block skips ahead to its next phase. */
  week?: number;
  /** Why this block was picked, with the numbers, e.g. "RSI 1.6 低于 2.0". */
  reason?: string;
  /** Keys of the block template's optional additions to switch on. */
  extras?: string[];
  /** Suggestions the athlete turned down while this stretch ran, so they aren't offered again. */
  declined?: string[];
};

export type PlanSettings = {
  templateCode: string;
  startDate: ISODate;
  weekdays: number[];
  /** First days of 7-day deload weeks inserted after repeated fatigue; each pushes the rest of the plan back a week. */
  deloads?: ISODate[];
  /** Block plans only: the blocks in order. The first starts with the plan. */
  blocks?: PlanBlock[];
};

export type PlannedSession = {
  date: ISODate;
  /** 0-based week since the plan's first Monday. */
  week: number;
  phase: Phase;
  session: SessionTemplate;
  /** Part of a deload week inserted because of fatigue, not one the template planned. */
  inserted?: boolean;
  /** Block plans: where in which block the day falls. */
  block?: BlockPosition;
};

export const MIN_RPE = 5;
export const MAX_RPE = 10;

const clampRpe = (r: number) => Math.min(MAX_RPE, Math.max(MIN_RPE, r));

export function isLoaded(p: Prescription): boolean {
  return p.kind === 'strength' || p.loaded === true;
}

export function isJump(p: Prescription): boolean {
  return p.jump ?? (p.kind === 'plyo' || p.kind === 'reactive');
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

/** Used for a deload week inserted into a template that has no deload week of its own. */
export const INSERTED_DELOAD: WeekSpec = { phase: 'deload', setFactor: 0.6, rpeDelta: -1.5, dropIntense: true };

export const DELOAD_DAYS = 7;

/**
 * Where `date` falls in the plan once inserted deload weeks are accounted for: the date in the original
 * schedule it plays the part of, and whether it sits inside an inserted deload week.
 */
export function planPosition(s: PlanSettings, date: ISODate): { planDate: ISODate; inserted: boolean } {
  let shift = 0;
  for (const start of [...(s.deloads ?? [])].sort()) {
    if (date < start) break;
    if (daysBetween(start, date) < DELOAD_DAYS) return { planDate: addDays(date, -shift), inserted: true };
    shift += DELOAD_DAYS;
  }
  return { planDate: addDays(date, -shift), inserted: false };
}

/** 0-based week of the original schedule a date plays the part of. */
export function planWeekOf(s: PlanSettings, date: ISODate): number {
  return Math.floor(daysBetween(mondayOf(s.startDate), planPosition(s, date).planDate) / 7);
}

/** The session planned for `date`, already scaled for its week; null on rest days and outside the plan. */
export function planDay(t: PlanTemplate, s: PlanSettings, date: ISODate): PlannedSession | null {
  if (daysBetween(s.startDate, date) < 0) return null;
  const { planDate, inserted } = planPosition(s, date);
  const week = Math.floor(daysBetween(mondayOf(s.startDate), planDate) / 7);
  if (!t.repeat && week >= t.weeks.length) return null;
  // Weekdays are kept: an inserted week is exactly 7 days, so the original date falls on the same weekday.
  const slot = [...s.weekdays].sort((a, b) => a - b).indexOf(weekday(date));
  if (slot < 0) return null;
  const block = t.blocks ? blockAt(s, planDate) : null;
  if (t.blocks && block) {
    const bt = t.blocks[block.type];
    const spec = inserted ? (bt.weeks.find((w) => w.phase === 'deload') ?? INSERTED_DELOAD) : bt.weeks[block.week];
    const session = blockSession(bt, slot, s.blocks![block.index].extras ?? []);
    return { date, week, phase: spec.phase, session: scaleSession(session, spec), ...(inserted ? { inserted } : {}), block };
  }
  const spec = inserted ? (t.weeks.find((w) => w.phase === 'deload') ?? INSERTED_DELOAD) : t.weeks[week % t.weeks.length];
  return { date, week, phase: spec.phase, session: scaleSession(t.sessions[slot % t.sessions.length], spec), ...(inserted ? { inserted } : {}) };
}

/** Weeks in a training block: three to train, the fourth to deload and retest. */
export const BLOCK_WEEKS = 4;

export type BlockPosition = {
  /** Index into {@link PlanSettings.blocks} of the stretch the day falls in. */
  index: number;
  type: BlockType;
  /** 0-based week of the block; {@link BLOCK_WEEKS} − 1 is the retest week. */
  week: number;
  /** Plan-schedule Monday the block's current 4 weeks began on, and the Monday after they end. */
  start: ISODate;
  end: ISODate;
};

/** Where a day of the plan's own schedule (see {@link planPosition}) falls among the blocks. */
export function blockAt(s: PlanSettings, planDate: ISODate): BlockPosition | null {
  const blocks = s.blocks ?? [];
  if (!blocks.length || planDate < s.startDate) return null;
  let index = 0;
  blocks.forEach((b, i) => {
    if (b.start <= planDate) index = i;
  });
  const b = blocks[index];
  // Monday of the stretch's week 0, which lies before its start when it skipped ahead.
  const origin = addDays(mondayOf(b.start), -7 * (b.week ?? 0));
  const offset = Math.max(0, Math.floor(daysBetween(origin, planDate) / 7));
  const week = offset % BLOCK_WEEKS;
  const start = addDays(origin, 7 * (offset - week));
  return { index, type: b.type, week, start, end: addDays(start, 7 * BLOCK_WEEKS) };
}

/** The block a day falls in, or null outside a block plan. */
export function blockOn(plan: PlanSettings, date: ISODate): BlockType | null {
  if (daysBetween(plan.startDate, date) < 0) return null;
  return blockAt(plan, planPosition(plan, date).planDate)?.type ?? null;
}

/** Same as {@link blockAt}, for a calendar date. */
export function blockPosition(plan: PlanSettings, date: ISODate): BlockPosition | null {
  if (daysBetween(plan.startDate, date) < 0) return null;
  return blockAt(plan, planPosition(plan, date).planDate);
}

/** The calendar date a day of the plan's own schedule falls on, after inserted deloads: the inverse of {@link planPosition}. */
export function calendarDate(s: PlanSettings, planDate: ISODate): ISODate {
  let shift = 0;
  for (const start of [...(s.deloads ?? [])].sort()) {
    if (planDate < addDays(start, -shift)) break;
    shift += DELOAD_DAYS;
  }
  return addDays(planDate, shift);
}

function blockSession(bt: BlockTemplate, slot: number, extras: string[]): SessionTemplate {
  const session = bt.sessions[slot % bt.sessions.length];
  const added = extras
    .map((k) => bt.extras?.[k])
    .filter((e): e is NonNullable<typeof e> => e != null && e.slot === slot % bt.sessions.length && !session.items.some((p) => p.code === e.item.code))
    .map((e) => e.item);
  return added.length ? { ...session, items: [...session.items, ...added] } : session;
}

/**
 * Appends a block entry, dropping any that would start on or after it (a later decision replaces an earlier
 * one for the same days). `start` is in the plan's own schedule.
 */
export function withBlock(blocks: PlanBlock[], next: PlanBlock): PlanBlock[] {
  return [...blocks.filter((b, i) => i === 0 || b.start < next.start), next].sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));
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
  const { planDate, inserted } = planPosition(s, date);
  return !inserted && daysBetween(addDays(mondayOf(s.startDate), t.weeks.length * 7), planDate) >= 0;
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
    if (p && isJump(p)) jumps += reps;
    if (l.load_kg != null) volumeKg += reps * l.load_kg;
  }
  const planned = new Set(session.items.flatMap((p) => Array.from({ length: p.sets }, (_, i) => `${p.code}#${i + 1}`)));
  const setsDone = logs.filter((l) => planned.has(`${l.exercise_code}#${l.set_no}`)).length;
  return { setsDone, setsPlanned: planned.size, jumps, volumeKg: Math.round(volumeKg) };
}
