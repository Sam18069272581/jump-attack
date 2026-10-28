/**
 * What the replay page draws for an analysed clip (media/replayHtml.ts): every label and number, worked out here so the
 * page only draws. Pure, so the export check in tools/jump-analysis-validation builds the same page as the app.
 */
// Relative imports: tools/jump-analysis-validation compiles this file on its own.
import { flightCurve, type Analysis, type AnalysisKind, type JumpResult } from '../domain/jumpAnalysis';
import type { MetricDef } from '../domain/metrics';

import type { ReplayConfig } from './replayHtml';

/** Frames a second of the exported video. */
const OUT_FPS = 30;
/** Real-time frames shown each second of video: 120 is quarter speed for 30 fps output. */
const SHOWN_PER_S = 120;

const cm = (x: number) => x.toFixed(1);
const ms = (s: number) => `${Math.round(s * 1000)} ms`;

function label(j: JumpResult): { label: string; detail: string } {
  if (j.rsi != null && j.gctS != null) return { label: `${j.rsi.toFixed(2)} RSI`, detail: `${cm(j.jhCm)} cm · 触地 ${ms(j.gctS)}` };
  return { label: `${cm(j.jhCm)} cm`, detail: `滞空 ${ms(j.ftS)}` };
}

export function replayConfig(o: {
  def: MetricDef;
  kind: AnalysisKind;
  analysis: Analysis;
  video: string;
  fileFps: number;
  captureFps: number;
  from: number;
  to: number;
  date: string;
  colors: ReplayConfig['colors'];
  focus?: ReplayConfig['focus'];
}): ReplayConfig {
  const { analysis, kind } = o;
  const s = analysis.summary;
  const stride = Math.max(1, Math.round(o.captureFps / SHOWN_PER_S));
  const slower = o.captureFps / (stride * OUT_FPS);
  const counted = analysis.jumps.filter((j) => j.counted);
  const err = (counted.find((j) => j.gctS != null) ?? counted[0])?.error;
  let headline: ReplayConfig['headline'];
  let stats: ReplayConfig['stats'];
  if (kind === 'repeat') {
    headline = { label: '10/5 RSI', value: s.rsi105?.toFixed(2) ?? '—', unit: '' };
    stats = [
      { label: 'GCT-CV', value: s.gctCv != null ? `${s.gctCv.toFixed(1)}%` : '—' },
      { label: 'DRI-CV', value: s.driCv != null ? `${s.driCv.toFixed(1)}%` : '—' },
      { label: '平均触地', value: s.gctS ? ms(s.gctS.mean) : '—' },
    ];
  } else if (kind === 'drop') {
    headline = { label: '最好 RSI', value: s.rsi?.best.toFixed(2) ?? '—', unit: '' };
    stats = [
      { label: '最短触地', value: s.gctS ? ms(s.gctS.best) : '—' },
      { label: '平均跳高', value: s.jhCm ? `${cm(s.jhCm.mean)} cm` : '—' },
      { label: 'RSR', value: s.rsr?.mean.toFixed(2) ?? '—' },
    ];
  } else {
    headline = { label: '最高', value: s.jhCm ? cm(s.jhCm.best) : '—', unit: 'cm' };
    stats = [
      { label: '平均', value: s.jhCm ? `${cm(s.jhCm.mean)}` : '—' },
      { label: '最长滞空', value: s.ftS ? ms(s.ftS.best) : '—' },
      { label: '计入', value: `${s.counted}/${s.total}` },
    ];
  }
  return {
    video: o.video,
    fileFps: o.fileFps,
    captureFps: o.captureFps,
    from: o.from,
    to: o.to,
    stride,
    outFps: OUT_FPS,
    curve: flightCurve(
      analysis.jumps.map((j) => j.events),
      o.captureFps,
      o.from,
      o.to,
    ).map((h) => Math.round(h * 10) / 10),
    jumps: analysis.jumps.map((j) => ({ takeoff: j.events.takeoff, landing: j.events.landing, ...(j.events.touchdown != null ? { touchdown: j.events.touchdown } : {}), counted: j.counted, ...label(j) })),
    ...(o.focus ? { focus: o.focus } : {}),
    title: o.def.name,
    headline,
    stats,
    note: err ? `每个关键帧 ±1 帧：跳高 ±${err.jhCm.toFixed(1)} cm` : '',
    date: o.date,
    brand: 'JUMP ATTACK',
    speed: slower > 1.05 ? `1/${Math.round(slower)} 慢放` : '原速',
    colors: o.colors,
  };
}
