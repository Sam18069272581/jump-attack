import { cmjReadiness, judgeChange, type ChangeVerdict, type Readiness } from './assess';
import type { MetricDef } from './metrics';

import { decimal, localized, tr } from '@/i18n';

export type Assessment = {
  change: { verdict: ChangeVerdict; text: string };
  readiness?: { readiness: Readiness; text: string };
};

const VERDICT_TEXT: Record<ChangeVerdict, string> = localized({
  better: '超过最小有意义变化，是真进步',
  worse: '低于平时水平，超出正常波动',
  trivial: '在正常波动范围内',
  unknown: '再测几次（至少 3 次）就能判断进步',
});

/** Plain-language read of today's result against the athlete's own history. */
export function assess(metric: MetricDef, previousBests: number[], today: number): Assessment {
  const c = judgeChange(previousBests, today, metric.lowerIsBetter);
  const sign = c.delta >= 0 ? '+' : '−';
  const deltaText = previousBests.length ? tr('较平均 {sign}{delta} {unit}，', { sign, delta: decimal(Math.abs(c.delta), metric.decimals), unit: metric.unit }) : '';
  const out: Assessment = { change: { verdict: c.verdict, text: deltaText + VERDICT_TEXT[c.verdict] } };

  if (metric.code === 'cmj') {
    const r = cmjReadiness(previousBests, today);
    if (r.readiness !== 'unknown') {
      out.readiness = {
        readiness: r.readiness,
        text:
          r.readiness === 'fatigued'
            ? tr('比近期基线低 {dropPct}%，可能有疲劳，今天建议减量', { dropPct: decimal((r.dropPct * 100), 0) })
            : tr('神经肌肉状态正常，可以按计划训练'),
      };
    }
  }
  return out;
}
