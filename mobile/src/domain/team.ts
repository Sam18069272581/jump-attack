import type { BlockType, DunkDiagnosis, Missing } from './dunk';

/**
 * Several athletes on one phone: a coach's board of how far each is from their own dunk line and what holds them back,
 * and the order they take turns in on a test day.
 */

export type TeamTouch = { at: string; value: number };

/** One athlete's diagnosis and run-up touches (oldest first), as the board reads them. */
export type TeamEntry = { id: number; name: string; diagnosis: DunkDiagnosis; touches: TeamTouch[] };

export type TeamRow = {
  id: number;
  name: string;
  /** 1 for the closest to their line; ties share a rank. Null without a touch to rank by. */
  rank: number | null;
  /** E.g. "差 4.0 cm", "过线 3.0 cm". */
  gap: string;
  /** What the diagnosis says to train, or which tests it still needs. */
  weakness: string;
  /** The latest three run-up touches, newest first. */
  recent: TeamTouch[];
  /** The latest touch minus the one before, cm. */
  change: number | null;
  lastAt: string | null;
};

const LIMITER: Record<BlockType, string> = { strength: '力量', reactive: '反应力量', transfer: '转化' };

const MISSING: Record<Missing, string> = { body_mass: '体重', standing_reach: '站立摸高', squat: '深蹲 1RM', drop_jump: '跳深', approach: '助跑摸高', cmj: 'CMJ' };

const round1 = (x: number) => Math.round(x * 10) / 10;

/** Says what the dunk page says (domain/dunkSummary.ts gapHeading): over the line only once the touch's error clears it. */
function gapText(d: DunkDiagnosis): string {
  const gap = d.gapCm;
  if (gap == null) return '还没测摸高';
  let text: string;
  if (d.verdict === 'over') text = gap < 0 ? `过线 ${(-gap).toFixed(1)} cm` : '正好摸到线';
  else if (d.verdict === 'close') text = gap <= 0 ? '摸到线 · 在误差内' : `差 ${gap.toFixed(1)} cm · 在误差内`;
  // A touch a hair under the line rounds to a 0.0 cm gap.
  else text = gap > 0 ? `差 ${gap.toFixed(1)} cm` : '差不到 0.1 cm';
  return d.touch.source === 'standing' ? `${text} · 原地估算` : text;
}

function weaknessText(d: DunkDiagnosis): string {
  const parts = [...(d.limiter ? [LIMITER[d.limiter] + (d.confirmed ? '' : '（待复测确认）')] : []), ...(d.technique ? ['助跑技术'] : [])];
  if (parts.length) return parts.join('、');
  return d.missing.length ? `先测：${d.missing.map((m) => MISSING[m]).join('、')}` : '—';
}

/**
 * Closest to their own line first: each athlete's line follows their rim and clearance (domain/dunk.ts dunkLine), so a
 * team training at different rims still compares fairly. Athletes with nothing to rank by come last.
 */
export function teamBoard(entries: TeamEntry[]): TeamRow[] {
  const key = (e: TeamEntry) => e.diagnosis.gapCm ?? Infinity;
  // Stable: a tie keeps the order the athletes were added in.
  const sorted = [...entries].sort((a, b) => (key(a) === key(b) ? 0 : key(a) - key(b)));
  return sorted.map((e) => {
    const gap = e.diagnosis.gapCm;
    const recent = e.touches.slice(-3).reverse();
    return {
      id: e.id,
      name: e.name,
      rank: gap == null ? null : sorted.findIndex((o) => key(o) === gap) + 1,
      gap: gapText(e.diagnosis),
      weakness: weaknessText(e.diagnosis),
      recent,
      change: recent.length >= 2 ? round1(recent[0].value - recent[1].value) : null,
      lastAt: recent[0]?.at ?? null,
    };
  });
}

/**
 * Who goes next when several athletes take turns: everyone does a test before anyone starts the next, so each rests
 * while the others jump, and the test-day order (domain/testDay.ts, least to most tiring) holds for everyone.
 * `lanes[athlete][step]` is what each has recorded today. Null once everyone has a result for every test.
 */
export function nextTurn(lanes: { trials: number }[][]): { athlete: number; step: number } | null {
  const steps = Math.max(0, ...lanes.map((l) => l.length));
  for (let step = 0; step < steps; step++) {
    const athlete = lanes.findIndex((l) => l[step] && !l[step].trials);
    if (athlete !== -1) return { athlete, step };
  }
  return null;
}
