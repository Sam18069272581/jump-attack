import { ALLOWANCE, BLOCKS, MISSING_TEXT, type DayState, type DunkDiagnosis, type DunkMetric, type DunkMetricKey } from './dunk';

/** What the athlete is short of, in the words the home card uses. */
export const LIMITER_NAME = { strength: '力量', reactive: '反应速度', transfer: '转化' } as const;

const metric = (d: DunkDiagnosis, key: DunkMetricKey): DunkMetric | undefined => d.metrics.find((m) => m.key === key);

/** "1.32×", "1.60", "280 ms". */
export function formatMetric(m: Pick<DunkMetric, 'value' | 'unit' | 'decimals'>): string {
  if (m.value == null) return '—';
  const v = m.value.toFixed(m.decimals);
  return m.unit === '×' ? `${v}×` : m.unit ? `${v} ${m.unit}` : v;
}

/**
 * The limiter and the result that decided it, e.g. "当前短板：反应速度 · 跳深 RSI 1.60，目标 2.0". Without enough
 * data, the first thing to measure instead.
 */
export function limiterLine(d: DunkDiagnosis): { title: string; detail: string } {
  if (d.limiter == null) {
    const next = d.missing.find((m) => m === 'body_mass' || m === 'squat' || m === 'drop_jump') ?? d.missing[0];
    return { title: '还不能判断短板', detail: next ? `下一步：${MISSING_TEXT[next]}` : '再测一次深蹲和跳深' };
  }
  const squat = metric(d, 'squat_ratio');
  const rsi = metric(d, 'rsi');
  const contact = metric(d, 'contact');
  let detail: string;
  if (d.limiter === 'strength' && squat) {
    detail = `深蹲 ${formatMetric(squat)} 体重，目标 ${squat.low}×`;
  } else if (d.limiter === 'reactive' && rsi && contact) {
    detail =
      rsi.value != null && rsi.value < rsi.threshold
        ? `跳深 RSI ${formatMetric(rsi)}，目标 ${rsi.threshold.toFixed(1)}`
        : `跳深触地 ${formatMetric(contact)}，目标 ${contact.threshold} ms 以内`;
  } else {
    detail = '力量和反应都过线了，把它们练成助跑摸高';
  }
  const plan = `建议练${BLOCKS[d.limiter].name}`;
  return { title: `当前短板：${LIMITER_NAME[d.limiter]}`, detail: `${detail} · ${plan}${d.confirmed ? '' : '（再测一次确认）'}` };
}

/** Today's state and how far the strength targets give, e.g. "状态一般 · 力量达标线放宽 5%". */
export function stateLine(s: DayState): string {
  const pct = Math.round(ALLOWANCE[s] * 100);
  switch (s) {
    case 'good':
      return '今天状态好 · 按计划练';
    case 'fair':
      return `今天状态一般 · 力量达标线放宽 ${pct}%`;
    case 'poor':
      return `今天状态差 · 力量达标线放宽 ${pct}%`;
    default:
      return '测一次 CMJ 或记录恢复数据，判断今天的状态';
  }
}

/**
 * How far the touch has come from standing reach (0) to the dunk line (1). Against the line alone every touch would
 * read about 90 %, so the climb starts at the standing reach; without one it falls back to touch ÷ line.
 */
export function touchProgress(touch: number, line: number, standingReach: number | null): number {
  const span = standingReach != null ? line - standingReach : line;
  const done = standingReach != null ? touch - standingReach : touch;
  return span > 0 ? Math.min(1, Math.max(0, done / span)) : 1;
}

export type TouchPoint = { at: string; value: number };

/** Standing touch estimates over time: the standing reach on file plus each CMJ session's best. */
export function standingTouches(cmj: { started_at: string; best: number }[], standingReach: number | null): TouchPoint[] {
  return standingReach == null ? [] : cmj.map((r) => ({ at: r.started_at, value: standingReach + r.best }));
}
