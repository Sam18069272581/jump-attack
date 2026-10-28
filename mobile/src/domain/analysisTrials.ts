/**
 * What an analysed clip saves: the trials, in the same shape a hand-marked clip saves them (domain/marking.ts), so
 * history, records and the dunk diagnosis read them the same way. Each carries `auto: true` and any flags the athlete
 * chose to count anyway.
 */
import { roundTo } from './interval';
import { type Analysis, type AnalysisKind } from './jumpAnalysis';
import { markedTrial, markProfile, type MarkContext, type MarkedTrial } from './marking';
import type { MetricDef } from './metrics';

/** The kind of clip a metric is analysed as, or null when its clips can't be analysed automatically. */
export function analysisKindFor(def: MetricDef): AnalysisKind | null {
  if (def.capture.includes('rebound')) return 'repeat';
  if (def.capture.includes('contact')) return 'drop';
  if (def.capture.includes('flight')) return 'jump';
  return null;
}

export function analysisTrials(
  def: MetricDef,
  analysis: Analysis,
  opts: { captureFps: number; context: MarkContext; reachCm?: number; offsetCm?: number | null },
): MarkedTrial[] {
  const fps = opts.captureFps;
  const counted = analysis.jumps.filter((j) => j.counted);
  if (analysisKindFor(def) === 'repeat') {
    const s = analysis.summary;
    if (s.rsi105 == null) return [];
    return [
      {
        value: roundTo(s.rsi105, 2),
        flight_ms: (s.ftS?.mean ?? 0) * 1000,
        fps,
        takeoff_frame: counted[0]?.events.takeoff ?? null,
        landing_frame: counted.at(-1)?.events.landing ?? null,
        detail: {
          source: 'video',
          auto: true,
          jumps: counted.map((j) => ({
            takeoff: j.events.takeoff,
            landing: j.events.landing,
            ft_ms: Math.round(j.ftS * 1000),
            jh_cm: roundTo(j.jhCm, 1),
            ...(j.gctS != null ? { gct_ms: Math.round(j.gctS * 1000), rsi: roundTo(j.rsi!, 2) } : {}),
            ...(j.flags.length ? { flags: j.flags } : {}),
          })),
          ...(s.gctCv != null ? { gct_cv: roundTo(s.gctCv, 1) } : {}),
          ...(s.driCv != null ? { dri_cv: roundTo(s.driCv, 1) } : {}),
          ...(opts.context.asset ? { asset_id: opts.context.asset } : {}),
        },
      },
    ];
  }
  const profile = markProfile(def, { reachCm: opts.reachCm });
  if (!profile) return [];
  const out: MarkedTrial[] = [];
  for (const j of counted) {
    const marks = profile.marks.length === 3 ? [j.events.touchdown ?? null, j.events.takeoff, j.events.landing] : [j.events.takeoff, j.events.landing];
    const outcome = profile.measure(marks, fps);
    if (!outcome.ok) continue;
    const t = markedTrial(outcome, marks, fps, opts.context, { offsetCm: opts.offsetCm });
    out.push({ ...t, detail: { source: 'video', ...t.detail, auto: true, ...(j.flags.length ? { flags: j.flags } : {}) } });
  }
  return out;
}
