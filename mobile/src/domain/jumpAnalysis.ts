/**
 * Every number a jump clip gives, from the frames automatic detection (or a hand) marked, with fixed definitions:
 *
 * - FT, flight time: landing frame − take-off frame, over the capture rate (`flightTimeFromFrames`).
 * - JH, jump height: g·FT²/8, which assumes the athlete lands in the posture they took off in (Bosco et al. 1983).
 * - GCT, ground contact: take-off − touch-down. A drop jump has its touch-down marked; in repeated jumps it is the
 *   landing of the jump before, as long as the athlete didn't stand there longer than `MAX_CONTACT_S`.
 * - RSI = JH (m) / GCT (s), the usual drop-jump index (Flanagan & Comyns 2008). RSR = FT / GCT.
 * - DRI = (drop + JH) / (g·GCT²), dimensionless (Brooks 2026). Drop is the box for a drop jump and the jump before for
 *   a rebound. New, without norms yet: shown, but nothing downstream relies on it.
 * - GCT-CV and DRI-CV: sample SD over mean of a set's counted jumps, in %: how evenly the athlete rebounds.
 * - 10/5 RSI: the mean RSI of the best five rebounds in a set of ten (Harper, Hobbs & Moore 2011).
 *
 * Each jump also carries the error one frame on each mark makes, which is what the detector was validated to
 * (tools/jump-detect-validation), and flags for what makes it unfair to count. A flagged jump the athlete wants counted
 * anyway is listed in `keep`.
 */
import { mean, sd } from './assess';
import { MAX_CONTACT_S } from './dropJump';
import { G, heightFromFlightTime } from './jump';

export type AnalysisKind = 'jump' | 'drop' | 'repeat';

/** Frames of one jump, in the clip's file frames. `flags` are what the detector saw (see `JumpFlag`). */
export type JumpEvents = { takeoff: number; landing: number; touchdown?: number; flags?: DetectorFlag[] };

/** What the detector itself can see: a foot at the edge of the picture may have left it. */
export type DetectorFlag = 'edge';

export type JumpFlag =
  | DetectorFlag
  /** Far from the set's other jumps: a wrong frame, a tucked landing or a half-hearted jump. */
  | 'outlier'
  /** A rebound slower than a fast stretch-shortening cycle. */
  | 'slow-contact'
  /** The frame rate is too low for one frame to be under 1 cm of jump height. */
  | 'low-fps';

/** Flags that leave a jump out of the summary unless the athlete keeps it. */
const EXCLUDING: JumpFlag[] = ['edge', 'outlier'];

/**
 * A rebound with contact longer than this uses the slow stretch-shortening cycle (Schmidtbleicher 1992), which RSI
 * compares badly with fast rebounds.
 */
export const SLOW_CONTACT_S = 0.25;
/** A jump further than this share of the set's median jump height from it is left out. Trial-to-trial CV of CMJ height is about 3–5 %. */
export const OUTLIER_SHARE = 0.25;
/** One frame worth more than this much jump height (cm) is flagged. */
export const MAX_FRAME_ERROR_CM = 1;

export const FLAG_TEXT: Record<JumpFlag, { what: string; advice: string }> = {
  edge: { what: '脚在画面边上，可能出画了', advice: '让人站在画面中间，起跳和落地都别出画' },
  outlier: { what: '和这组其他跳差得太多，没算进均值', advice: '逐帧核对一下；落地前别收腿，脚尖先着地、膝盖伸直' },
  'slow-contact': { what: '触地超过 250 ms，不是快速反弹', advice: '触地要短：脚一碰地就弹起，别蹲下去' },
  'low-fps': { what: '帧率低，一帧就差 1 cm 以上', advice: '用慢动作（240 fps）拍' },
};

export type JumpResult = {
  index: number;
  events: JumpEvents;
  ftS: number;
  jhCm: number;
  gctS?: number;
  rsi?: number;
  rsr?: number;
  dri?: number;
  /** What one frame on each mark changes each figure by. */
  error: { ftS: number; jhCm: number; gctS?: number; rsi?: number; rsr?: number; dri?: number };
  flags: JumpFlag[];
  counted: boolean;
};

type Spread = { mean: number; best: number };

export type AnalysisSummary = {
  total: number;
  counted: number;
  jhCm?: Spread;
  ftS?: Spread;
  /** Best is the shortest. */
  gctS?: Spread;
  rsi?: Spread;
  rsr?: Spread;
  dri?: Spread;
  gctCv?: number;
  driCv?: number;
  /** Repeated jumps only: mean RSI of the best five rebounds. */
  rsi105?: number;
};

export type Analysis = { jumps: JumpResult[]; summary: AnalysisSummary };

/** Jump height (cm) one frame of flight time is worth at this flight time and capture rate: d(g·FT²/8)/dFT · 1/fps. */
export function frameError(ftS: number, fps: number): number {
  return ((G * ftS) / 4 / fps) * 100;
}

export function analyseJumps(events: JumpEvents[], opts: { kind: AnalysisKind; captureFps: number; boxCm?: number; keep?: number[] }): Analysis {
  const { kind, captureFps: fps } = opts;
  if (fps <= 0) throw new Error('fps must be positive');
  const dt = 1 / fps;
  const jumps: JumpResult[] = events.map((e, i) => {
    const ftS = (e.landing - e.takeoff) / fps;
    const jhM = heightFromFlightTime(ftS);
    const jhErrM = frameError(ftS, fps) / 100;
    const prev = events[i - 1];
    let gctS: number | undefined;
    let dropM: number | undefined;
    if (kind === 'drop') {
      if (e.touchdown != null) gctS = (e.takeoff - e.touchdown) / fps;
      if (opts.boxCm != null) dropM = opts.boxCm / 100;
    } else if (prev && (e.takeoff - prev.landing) / fps <= MAX_CONTACT_S) {
      gctS = (e.takeoff - prev.landing) / fps;
      dropM = heightFromFlightTime((prev.landing - prev.takeoff) / fps);
    }
    const r: JumpResult = { index: i, events: e, ftS, jhCm: jhM * 100, error: { ftS: dt, jhCm: jhErrM * 100 }, flags: [...(e.flags ?? [])], counted: true };
    if (gctS != null && gctS > 0) {
      r.gctS = gctS;
      r.rsi = jhM / gctS;
      r.rsr = ftS / gctS;
      r.error.gctS = dt;
      r.error.rsi = r.rsi * Math.hypot(jhErrM / jhM, dt / gctS);
      r.error.rsr = r.rsr * Math.hypot(dt / ftS, dt / gctS);
      if (dropM != null) {
        r.dri = (dropM + jhM) / (G * gctS * gctS);
        r.error.dri = Math.hypot(jhErrM / (G * gctS * gctS), ((2 * r.dri) / gctS) * dt);
      }
      if (gctS > SLOW_CONTACT_S) r.flags.push('slow-contact');
    }
    if (frameError(ftS, fps) > MAX_FRAME_ERROR_CM) r.flags.push('low-fps');
    return r;
  });

  if (jumps.length >= 3) {
    const mid = median(jumps.map((j) => j.jhCm));
    for (const j of jumps) if (Math.abs(j.jhCm - mid) > OUTLIER_SHARE * mid) j.flags.push('outlier');
  }
  for (const j of jumps) j.counted = (opts.keep ?? []).includes(j.index) || !j.flags.some((f) => EXCLUDING.includes(f));

  return { jumps, summary: summarise(jumps, kind) };
}

function summarise(jumps: JumpResult[], kind: AnalysisKind): AnalysisSummary {
  const used = jumps.filter((j) => j.counted);
  const pick = (f: (j: JumpResult) => number | undefined) => used.map(f).filter((v): v is number => v != null);
  const spread = (xs: number[], lowerIsBetter = false): Spread | undefined =>
    xs.length ? { mean: mean(xs), best: lowerIsBetter ? Math.min(...xs) : Math.max(...xs) } : undefined;
  const cv = (xs: number[]) => (xs.length >= 2 ? (sd(xs) / mean(xs)) * 100 : undefined);
  const gct = pick((j) => j.gctS);
  const rsi = pick((j) => j.rsi);
  const dri = pick((j) => j.dri);
  const out: AnalysisSummary = { total: jumps.length, counted: used.length };
  const set = <K extends keyof AnalysisSummary>(k: K, v: AnalysisSummary[K] | undefined) => {
    if (v !== undefined) out[k] = v;
  };
  set('jhCm', spread(pick((j) => j.jhCm)));
  set('ftS', spread(pick((j) => j.ftS)));
  set('gctS', spread(gct, true));
  set('rsi', spread(rsi));
  set('rsr', spread(pick((j) => j.rsr)));
  set('dri', spread(dri));
  set('gctCv', cv(gct));
  set('driCv', cv(dri));
  if (kind === 'repeat' && rsi.length) set('rsi105', mean([...rsi].sort((a, b) => b - a).slice(0, 5)));
  return out;
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const k = s.length >> 1;
  return s.length % 2 ? s[k] : (s[k - 1] + s[k]) / 2;
}

/**
 * How high the centre of mass is above where it left the ground, frame by frame from `from` to `to` (cm): zero on the
 * ground, g·τ·(FT − τ)/2 in the air, τ the time since take-off. Drawn as the jump curve on a replay; its peak is the jump
 * height by the same assumption that gives the height from flight time.
 */
export function flightCurve(events: JumpEvents[], captureFps: number, from: number, to: number): number[] {
  const out: number[] = [];
  for (let f = from; f <= to; f++) {
    const e = events.find((j) => f >= j.takeoff && f < j.landing);
    if (!e) {
      out.push(0);
      continue;
    }
    const ft = (e.landing - e.takeoff) / captureFps;
    const tau = (f - e.takeoff) / captureFps;
    out.push(((G * tau * (ft - tau)) / 2) * 100);
  }
  return out;
}
