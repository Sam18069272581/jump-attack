import { ALLOWANCE, type DayState, type DunkDiagnosis, type DunkMetric } from './dunk';
import { TOUCH_TEST_JUMPS } from './touch';

import { decimal, tr } from '@/i18n';

/** "1.32×", "1.60", "280 ms". */
export function formatMetric(m: Pick<DunkMetric, 'value' | 'unit' | 'decimals'>): string {
  if (m.value == null) return '—';
  const v = decimal(m.value, m.decimals);
  return m.unit === '×' ? `${v}×` : m.unit ? `${v} ${m.unit}` : v;
}

/** Today's state and how far the strength targets give, e.g. "今天状态一般 · 力量达标线放宽 5%". */
export function stateLine(s: DayState): string {
  const pct = Math.round(ALLOWANCE[s] * 100);
  switch (s) {
    case 'good':
      return tr('今天状态好 · 按计划练');
    case 'fair':
      return tr('今天状态一般 · 力量达标线放宽 {pct}%', { pct });
    case 'poor':
      return tr('今天状态差 · 力量达标线放宽 {pct}%', { pct });
    default:
      return tr('测一次 CMJ 或记录恢复数据，判断今天的状态');
  }
}

export type TouchPoint = { at: string; value: number };

/**
 * Standing touch estimates over time: the standing reach on file plus each CMJ session's best, plus the athlete's
 * wall-vs-video calibration (domain/touch.ts) when there is one.
 */
export function standingTouches(cmj: { started_at: string; best: number }[], standingReach: number | null, offsetCm: number | null = null): TouchPoint[] {
  if (standingReach == null) return [];
  return cmj.map((r) => ({ at: r.started_at, value: Math.round((standingReach + r.best + (offsetCm ?? 0)) * 10) / 10 }));
}

/** How sure the approach touch is, e.g. "最好 3 跳均值 ± 2.3". Null for the standing estimate or without a touch. */
export function touchSpread(d: DunkDiagnosis): string | null {
  const e = d.touchError;
  if (d.touch.source !== 'approach' || !e) return null;
  const err = e.errorCm != null ? ` ± ${decimal(e.errorCm, 1)}` : '';
  if (e.jumps === 1) return tr('只有 1 跳{err}，测满 {TOUCH_TEST_JUMPS} 跳更准', { err, TOUCH_TEST_JUMPS });
  return tr('最好 {jumps} 跳均值{p}', { jumps: e.jumps, p: e.errorCm != null ? err : tr('，录像估算的误差要校准 2 次后才知道') });
}

/** What the touch the gap is measured from is made of, and how sure it is. Null without a touch. */
export function touchNote(d: DunkDiagnosis): string | null {
  const t = d.touch;
  if (t.source === 'standing') return tr('原地估算 {standing} cm（站立摸高 + CMJ），测一次助跑摸高更准', { standing: decimal(t.standing!, 1) });
  if (t.source !== 'approach') return null;
  const spread = touchSpread(d);
  return tr('助跑摸高 {approach} cm{p}', { approach: decimal(t.approach!, 1), p: spread ? tr('（{spread}）', { spread }) : '' });
}

/** The words over the gap, and a hint under it while the line is inside the touch's error or once it is cleared. */
export function gapHeading(d: DunkDiagnosis): { label: string; hint: string | null } {
  const reached = (d.gapCm ?? 1) <= 0;
  switch (d.verdict) {
    case 'over':
      return { label: tr('已过扣篮线'), hint: tr('下一步是比赛里稳定扣：累了也能摸到这个高度。') };
    case 'close':
      return { label: reached ? tr('摸到扣篮线了') : tr('离扣篮线还差'), hint: tr('接近了，扣篮线在误差范围里，还不能确定') };
    default:
      return { label: tr('离扣篮线还差'), hint: null };
  }
}
