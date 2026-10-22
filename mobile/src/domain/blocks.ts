import { judgeChange, mean } from './assess';
import { type ISODate } from './dates';
import { THRESHOLDS, type BlockType, type DunkDiagnosis } from './dunk';
import { blockPosition, calendarDate, PHASE_NAMES, planPosition, withBlock, type BlockPosition, type PlanBlock, type PlanSettings, type PlanTemplate } from './plan';

/** The block template additions a diagnosis calls for (see BLOCK_TEMPLATES extras in templates.ts). */
export function blockExtras(d: DunkDiagnosis | null, type: BlockType): string[] {
  if (!d) return [];
  const squat = d.metrics.find((m) => m.key === 'squat_ratio')?.value;
  return [
    ...(d.technique ? ['technique'] : []),
    ...(type === 'transfer' && squat != null && squat < THRESHOLDS.squatRatio.good ? ['heavy_squat'] : []),
  ];
}

export const NO_DIAGNOSIS_REASON = '诊断数据还不够，先从力量块开始；测完缺的项目，块末会再看要不要换。';

/** The first block of a new plan: the diagnosed limiter unless the athlete picked another, strength when it can't tell. */
export function firstBlock(d: DunkDiagnosis | null, start: ISODate, picked?: BlockType): PlanBlock {
  const type = picked ?? d?.limiter ?? 'strength';
  const reason = d?.limiter === type ? d.reasons[0] : d?.limiter == null && !picked ? NO_DIAGNOSIS_REASON : '你自己选的训练块。';
  const extras = blockExtras(d, type);
  return { start, type, ...(reason ? { reason } : {}), ...(extras.length ? { extras } : {}) };
}

export type BlockSuggestion =
  | {
      kind: 'switch';
      /** Stored in {@link PlanBlock.declined} when turned down. */
      key: string;
      from: BlockType;
      type: BlockType;
      /** Plan-schedule Monday the next block starts on. */
      start: ISODate;
      reasons: string[];
    }
  | {
      kind: 'advance';
      key: string;
      type: BlockType;
      /** Block week to jump to. */
      week: number;
      phase: string;
      reason: string;
    };

/** A later block entry is already scheduled: the athlete has decided what comes next. */
function decided(plan: PlanSettings, pos: BlockPosition): boolean {
  return (plan.blocks?.length ?? 0) > pos.index + 1;
}

export function isRetestWeek(t: PlanTemplate, pos: BlockPosition): boolean {
  return t.blocks?.[pos.type].weeks[pos.week]?.retest === true;
}

/**
 * In a block's retest week, a switch to the block the diagnosis now calls for, once two tests in a row agree
 * on it. Nothing while the diagnosis still matches the block, can't tell, or was turned down.
 */
export function switchSuggestion(t: PlanTemplate, plan: PlanSettings, today: ISODate, d: DunkDiagnosis | null): BlockSuggestion | null {
  const pos = blockPosition(plan, today);
  if (!pos || decided(plan, pos) || !d?.limiter || !d.confirmed || d.limiter === pos.type || !isRetestWeek(t, pos)) return null;
  const key = `switch:${d.limiter}@${pos.start}`;
  if (plan.blocks?.[pos.index].declined?.includes(key)) return null;
  return { kind: 'switch', key, from: pos.type, type: d.limiter, start: pos.end, reasons: d.reasons };
}

export type TouchResult = { date: ISODate; value: number };

/**
 * A touch has to beat the earlier mean by at least this much as well as by the smallest worthwhile change: a
 * steady athlete's SD can be a few millimetres, finer than a wall chart or a frame count can be read.
 */
export const MIN_TOUCH_GAIN_CM = 1;

function clearlyBetter(before: number[], value: number): boolean {
  const c = judgeChange(before, value);
  return c.verdict === 'better' && c.delta >= MIN_TOUCH_GAIN_CM;
}

/**
 * Two touch tests in a row in this stretch of the block that each beat the earlier results by more than the
 * smallest worthwhile change (and {@link MIN_TOUCH_GAIN_CM}): the athlete is adapting faster than planned, so suggest moving on to the block's
 * next phase now. Needs three earlier results for the change to mean anything.
 */
export function advanceSuggestion(t: PlanTemplate, plan: PlanSettings, today: ISODate, touches: TouchResult[]): BlockSuggestion | null {
  const pos = blockPosition(plan, today);
  if (!pos || !t.blocks || decided(plan, pos) || planPosition(plan, today).inserted) return null;
  const weeks = t.blocks[pos.type].weeks;
  const target = weeks.findIndex((w, i) => i > pos.week && w.phase !== weeks[pos.week].phase);
  if (target < 0) return null;
  const key = `advance:${target}@${pos.start}`;
  const entry = plan.blocks![pos.index];
  if (entry.declined?.includes(key)) return null;

  const from = calendarDate(plan, entry.start > pos.start ? entry.start : pos.start);
  const sorted = [...touches].sort((a, b) => a.date.localeCompare(b.date));
  const before = sorted.filter((r) => r.date < from).map((r) => r.value);
  const during = sorted.filter((r) => r.date >= from && r.date <= today).slice(-2);
  if (during.length < 2 || !during.every((r) => clearlyBetter(before, r.value))) return null;

  const phase = weeks[target].retest ? '减量复测周' : PHASE_NAMES[weeks[target].phase];
  const values = during.map((r) => r.value.toFixed(1)).join('、');
  return {
    kind: 'advance',
    key,
    type: pos.type,
    week: target,
    phase,
    reason: `摸高连续两次明显进步（${values} cm，之前平均 ${mean(before).toFixed(1)} cm），适应得比计划快，可以提前进入${phase}。`,
  };
}

/**
 * The plan's blocks once a suggestion is accepted. A switch starts the new block after the retest week; skipping
 * ahead starts on `from` (today, or tomorrow when today's workout has begun).
 */
export function acceptSuggestion(plan: PlanSettings, s: BlockSuggestion, d: DunkDiagnosis | null, from: ISODate): PlanBlock[] {
  const blocks = plan.blocks ?? [];
  if (s.kind === 'switch') {
    const extras = blockExtras(d, s.type);
    return withBlock(blocks, { start: s.start, type: s.type, reason: s.reasons[0], ...(extras.length ? { extras } : {}) });
  }
  const current = blocks[blockPosition(plan, from)?.index ?? blocks.length - 1];
  const start = planPosition(plan, from).planDate;
  return withBlock(blocks, { start, type: s.type, week: s.week, reason: s.reason, ...(current?.extras?.length ? { extras: current.extras } : {}) });
}

/** The plan's blocks with a suggestion turned down, so it isn't offered again for this block. */
export function declineSuggestion(plan: PlanSettings, s: BlockSuggestion, today: ISODate): PlanBlock[] {
  const blocks = plan.blocks ?? [];
  const pos = blockPosition(plan, today);
  if (!pos) return blocks;
  return blocks.map((b, i) => (i === pos.index ? { ...b, declined: [...new Set([...(b.declined ?? []), s.key])] } : b));
}

/** Calendar Monday the next block starts on. */
export function nextBlockStart(plan: PlanSettings, today: ISODate): ISODate | null {
  const pos = blockPosition(plan, today);
  return pos ? calendarDate(plan, pos.end) : null;
}
