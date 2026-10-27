import { ALLOWANCE, type DayState, type DunkMetric } from './dunk';

/** "1.32×", "1.60", "280 ms". */
export function formatMetric(m: Pick<DunkMetric, 'value' | 'unit' | 'decimals'>): string {
  if (m.value == null) return '—';
  const v = m.value.toFixed(m.decimals);
  return m.unit === '×' ? `${v}×` : m.unit ? `${v} ${m.unit}` : v;
}

/** Today's state and how far the strength targets give, e.g. "今天状态一般 · 力量达标线放宽 5%". */
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

export type TouchPoint = { at: string; value: number };

/** Standing touch estimates over time: the standing reach on file plus each CMJ session's best. */
export function standingTouches(cmj: { started_at: string; best: number }[], standingReach: number | null): TouchPoint[] {
  return standingReach == null ? [] : cmj.map((r) => ({ at: r.started_at, value: standingReach + r.best }));
}
