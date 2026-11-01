/**
 * What the replay page draws for an analysed clip (media/replayHtml.ts): every label and number, worked out here so the
 * page only draws. Pure, so the export check in tools/jump-analysis-validation builds the same page as the app.
 */
// Relative imports: tools/jump-analysis-validation compiles this file on its own.
import { G } from '../domain/jump';
import { flightCurve, type Analysis, type AnalysisKind, type JumpResult } from '../domain/jumpAnalysis';
import type { JumpPhases } from '../domain/jumpPhases';
import type { MetricDef } from '../domain/metrics';

import type { ReplayConfig, ReplayPhases } from './replayHtml';

import { decimal, tr } from '@/i18n';

/** Frames a second of the exported video. */
const OUT_FPS = 30;
/** Real-time frames shown each second of video: 120 is quarter speed for 30 fps output. */
const SHOWN_PER_S = 120;

const cm = (x: number) => decimal(x, 1);
const ms = (s: number) => `${Math.round(s * 1000)} ms`;

function label(j: JumpResult): { label: string; detail: string } {
  if (j.rsi != null && j.gctS != null) return { label: `${decimal(j.rsi, 2)} RSI`, detail: tr('{jhCm} cm · 触地 {gctS}', { jhCm: cm(j.jhCm), gctS: ms(j.gctS) }) };
  return { label: `${cm(j.jhCm)} cm`, detail: tr('滞空 {ftS}', { ftS: ms(j.ftS) }) };
}

/** One jump's phases in file frames (real time × capture rate, as the jump's own frames are), with their times. */
function phasesOf(jp: JumpPhases, captureFps: number): ReplayPhases {
  const at = (t: number) => Math.round(t * captureFps);
  const flightS = jp.landingS - jp.takeoffS;
  const phases: ReplayPhases['phases'] = [];
  if (jp.lowS != null && jp.eccentricS != null) phases.push({ label: tr('离心'), from: at(jp.startS), to: at(jp.lowS), time: ms(jp.eccentricS), tone: 'ecc' });
  phases.push({ label: tr('向心'), from: at(jp.lowS ?? jp.startS), to: at(jp.takeoffS), time: ms(jp.concentricS), tone: 'con' });
  phases.push({ label: tr('腾空'), from: at(jp.takeoffS), to: at(jp.landingS), time: ms(flightS), tone: 'air' });
  const stats: ReplayPhases['stats'] = [];
  if (jp.lowS != null) stats.push({ label: tr('下蹲'), value: `${Math.round(jp.depthM * 100)} cm`, at: at(jp.lowS) });
  // Take-off speed from the flight time, as the jump height is (v = g·t/2).
  stats.push({ label: tr('起跳速度'), value: `${decimal((G * flightS) / 2, 2)} m/s`, at: at(jp.takeoffS) });
  // The trend only: its peak is not shown (domain/jumpPhases `FORCE_HZ`).
  const top = Math.max(3, Math.ceil(Math.max(...jp.force.bw) * 2) / 2);
  const force = { frames: jp.force.t.map(at), values: jp.force.bw.map((f) => Math.round(f * 100) / 100), top };
  return { title: tr('发力 · 估算'), phases, stats, force };
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
  /** The phases of one jump, when the whole body was in the picture (domain/jumpPhases.ts). */
  phases?: JumpPhases | null;
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
    headline = { label: '10/5 RSI', value: s.rsi105 != null ? decimal(s.rsi105, 2) : '—', unit: '' };
    stats = [
      { label: 'GCT-CV', value: s.gctCv != null ? `${decimal(s.gctCv, 1)}%` : '—' },
      { label: 'DRI-CV', value: s.driCv != null ? `${decimal(s.driCv, 1)}%` : '—' },
      { label: tr('平均触地'), value: s.gctS ? ms(s.gctS.mean) : '—' },
    ];
  } else if (kind === 'drop') {
    headline = { label: tr('最好 RSI'), value: s.rsi ? decimal(s.rsi.best, 2) : '—', unit: '' };
    stats = [
      { label: tr('最短触地'), value: s.gctS ? ms(s.gctS.best) : '—' },
      { label: tr('平均跳高'), value: s.jhCm ? `${cm(s.jhCm.mean)} cm` : '—' },
      { label: 'RSR', value: s.rsr ? decimal(s.rsr.mean, 2) : '—' },
    ];
  } else {
    headline = { label: tr('最高'), value: s.jhCm ? cm(s.jhCm.best) : '—', unit: 'cm' };
    stats = [
      { label: tr('平均'), value: s.jhCm ? `${cm(s.jhCm.mean)}` : '—' },
      { label: tr('最长滞空'), value: s.ftS ? ms(s.ftS.best) : '—' },
      { label: tr('计入'), value: `${s.counted}/${s.total}` },
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
    note: err ? tr('每个关键帧 ±1 帧：跳高 ±{jhCm} cm', { jhCm: decimal(err.jhCm, 1) }) : '',
    date: o.date,
    brand: 'JUMP ATTACK',
    speed: slower > 1.05 ? tr('1/{slower} 慢放', { slower: Math.round(slower) }) : tr('原速'),
    colors: o.colors,
    ...(o.phases ? { phases: phasesOf(o.phases, o.captureFps) } : {}),
  };
}
