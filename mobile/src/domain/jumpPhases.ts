/**
 * The phases of a standing jump, read off the path of the centre of mass in a clip with the whole body in it: when the
 * athlete starts down, the lowest point, take-off and landing, so the exported video (media/replayHtml.ts) can show
 * the eccentric, concentric and flight phases with their times and how deep the athlete dipped. It does not go into
 * the diagnosis.
 *
 * 1. Scale: in flight the centre of mass falls freely, so the curvature of its path in the picture is gravity, and
 *    pixels per metre = 2c / g for y = a + bt + ct² (the same scale the technique analysis uses, domain/technique.ts).
 * 2. The path, in metres above where the athlete stood, is smoothed with a 6 Hz low-pass (barPath `lowPass`, two
 *    passes).
 * 3. Phases, as on a force plate (McMahon et al. 2018, Strength Cond J 40(4):96): eccentric from the start of the
 *    movement to the lowest point (velocity zero), concentric from the lowest point to take-off. The start is found
 *    from the fastest descent back to where the centre of mass last moved no faster than while standing (`ONSET_SD`);
 *    a threshold crossed going forward is set off early by the jitter. A jump that never dips (`MIN_DIP_M`) has no
 *    eccentric phase: a squat jump.
 *
 * The force itself is not shown. On the athlete's own CMJ (2026-10-31, 240 fps, whole body, front-on) it zigzagged by
 * 0.3–0.5 body weights through the push and dipped below zero once, because the segment model's centre of mass moves
 * as the arms and legs do (in flight it strayed 8 mm from the parabola). The phases and the depth hold up: in
 * synthetic CMJs (domain/testing/cmjScene.ts) with 3 mm of jitter the lowest point is within 4 ms and the start within
 * 63 ms (40 seeds).
 */
import { lowPass } from './barPath';
import { G } from './jump';
import { centreOfMass, LM, SIDE, type Pt } from './pose';
import { pickAthlete, polyFit, unswap, type PoseFrame } from './technique';

/**
 * Low-pass cut-off for the path, Hz. In synthetic CMJs with 3 mm of jitter (40 seeds) the start was at most 42 ms off
 * at 4 Hz, 63 ms at 6, 71 ms at 8 and 83 ms at 10, while 4 Hz flattened the dip by twice as much as 6 Hz (1.7 against
 * 0.7 mm without jitter).
 */
export const CUTOFF_HZ = 6;
/**
 * The movement starts where the centre of mass last moved no faster than this many standing scatters (SD of the
 * velocity while standing). In synthetic CMJs with 3 mm of jitter (40 seeds), 1 SD put the start 32 ms late on
 * average and never more than 63 ms off; 0 SD let the jitter carry it 108 ms early, 2 SD left it 44 ms late.
 */
export const ONSET_SD = 1;
/** A dip shallower than this (m) is no countermovement. */
export const MIN_DIP_M = 0.02;
/** Standing still needed at the start of the window to know where the athlete stood, s. */
export const QUIET_S = 0.15;
/** The filter's first stretch (s) leans on its padding, so standing is measured after it. */
const EDGE_S = 0.05;
/** Fastest the centre of mass may move and still be standing, m/s. */
const QUIET_V = 0.1;
/** The flight needs this long (s) of samples to fit gravity's parabola, after trimming `FLIGHT_TRIM_S` off each end. */
const MIN_FLIGHT_S = 0.15;
const FLIGHT_TRIM_S = 0.02;
/** Longest stretch with no centre of mass that is filled in (s). */
const MAX_GAP_S = 0.05;
/**
 * The most frame-to-frame jitter of the centre of mass (m, from second differences in flight, which take out the
 * parabola and the model's slow drift) that phases are read with: 2.8 mm on the athlete's own clip, so this leaves
 * room, and turns away a clip shaken twice as hard.
 */
export const MAX_JITTER_M = 0.005;

export type ComSample = { t: number; y: number | null };

/** How long before take-off (s) to read the clip: standing still (`QUIET_S`, after the filter's edge) and the slowest countermovement, about 1 s. */
export const BEFORE_TAKEOFF_S = 1.3;

/** The file frames to read the pose of for one jump's phases: every one from `BEFORE_TAKEOFF_S` before take-off to landing, none before `from`. */
export function phaseFrames(jump: { takeoff: number; landing: number }, captureFps: number, from: number): number[] {
  const first = Math.max(from, 0, jump.takeoff - Math.round(BEFORE_TAKEOFF_S * captureFps));
  return Array.from({ length: jump.landing - first + 1 }, (_, i) => first + i);
}

/** The points the whole body is judged by: head, shoulders, hips, knees and ankles, both sides. */
const WHOLE_BODY = [LM.leftEar, LM.rightEar, ...(['left', 'right'] as const).flatMap((s) => [SIDE[s].shoulder, SIDE[s].hip, SIDE[s].knee, SIDE[s].ankle])];
/** The pose model's mean visibility over those points below which a frame is left out. */
const MIN_VISIBILITY = 0.5;

/**
 * The athlete's centre of mass (picture y, px) in each frame, by the segment model (domain/pose.ts): null where nobody
 * was found, where part of the body is out of the picture (the model still places those points, but guesses them), or
 * where the model barely sees the body. A jump test filmed at ankle height usually leaves the head out: no phases.
 */
export function comSamples(frames: PoseFrame[], picture: { width: number; height: number }, target?: Pt | null): ComSample[] {
  const { poses } = unswap(pickAthlete(frames, target));
  return frames.map((f, i) => {
    const p = poses[i];
    if (!p) return { t: f.t, y: null };
    const pts = WHOLE_BODY.map((k) => p[k]);
    const inside = pts.every((l) => l.x >= 0 && l.x <= picture.width && l.y >= 0 && l.y <= picture.height);
    const seen = pts.reduce((a, l) => a + l.v, 0) / pts.length >= MIN_VISIBILITY;
    return { t: f.t, y: inside && seen ? centreOfMass(p).y : null };
  });
}

export type JumpPhasesProblem =
  /** Long stretches with no centre of mass. */
  | 'gaps'
  /** No flight long enough, or a flight that doesn't fall: no scale. */
  | 'flight'
  /** The centre of mass jitters too much from frame to frame. */
  | 'jitter'
  /** The clip starts with the athlete already moving: nowhere to measure standing from. */
  | 'no-quiet';

export type JumpPhases = {
  startS: number;
  /** The lowest point; null without a countermovement. */
  lowS: number | null;
  takeoffS: number;
  landingS: number;
  eccentricS: number | null;
  concentricS: number;
  depthM: number;
  pxPerM: number;
  jitterM: number;
};

/** Fills gaps of up to `max` samples by straight lines (at either end, by the nearest sample); null if a longer one is left. */
function fill(ys: (number | null)[], max: number): number[] | null {
  const out = [...ys];
  const firstKnown = out.findIndex((y) => y != null);
  if (firstKnown < 0 || firstKnown > max) return null;
  for (let k = 0; k < firstKnown; k++) out[k] = out[firstKnown];
  let lastKnown = out.length - 1;
  while (out[lastKnown] == null) lastKnown--;
  if (out.length - 1 - lastKnown > max) return null;
  for (let k = lastKnown + 1; k < out.length; k++) out[k] = out[lastKnown];
  let i = 0;
  while (i < out.length) {
    if (out[i] != null) {
      i++;
      continue;
    }
    let j = i;
    while (out[j] == null) j++;
    if (j - i > max) return null;
    const a = out[i - 1] as number;
    const b = out[j] as number;
    for (let k = i; k < j; k++) out[k] = a + ((b - a) * (k - i + 1)) / (j - i + 1);
    i = j;
  }
  return out as number[];
}

export function jumpPhases(input: { samples: ComSample[]; takeoffS: number; landingS: number; fps: number }): { ok: true; result: JumpPhases } | { ok: false; problem: JumpPhasesProblem } {
  const { takeoffS, landingS, fps } = input;
  if (input.samples.length < 4) return { ok: false, problem: 'gaps' };
  // One sample per frame: a frame the pose model sent nothing for is a gap like one it found nobody in.
  const at = new Map(input.samples.map((s) => [Math.round(s.t * fps), s.y]));
  const firstFrame = Math.round(input.samples[0].t * fps);
  const lastFrame = Math.round(input.samples[input.samples.length - 1].t * fps);
  const samples: ComSample[] = Array.from({ length: lastFrame - firstFrame + 1 }, (_, i) => ({ t: (firstFrame + i) / fps, y: at.get(firstFrame + i) ?? null }));
  const ys = fill(
    samples.map((s) => s.y),
    Math.round(MAX_GAP_S * fps),
  );
  if (!ys) return { ok: false, problem: 'gaps' };
  const ts = samples.map((s) => s.t);

  // 1. Scale, from the flight.
  const inFlight = ts.flatMap((t, i) => (t > takeoffS + FLIGHT_TRIM_S && t < landingS - FLIGHT_TRIM_S && samples[i].y != null ? [i] : []));
  if (landingS - takeoffS - 2 * FLIGHT_TRIM_S < MIN_FLIGHT_S || inFlight.length < 8) return { ok: false, problem: 'flight' };
  const t0 = ts[inFlight[0]];
  const fit = polyFit(
    inFlight.map((i) => ts[i] - t0),
    inFlight.map((i) => ys[i]),
    2,
  );
  const pxPerM = (2 * fit.c[2]) / G;
  if (!(pxPerM > 0)) return { ok: false, problem: 'flight' };
  // White jitter of SD σ gives second differences of SD σ√6.
  const flightYs = inFlight.map((i) => ys[i]);
  const d2 = flightYs.slice(2).map((y, i) => y - 2 * flightYs[i + 1] + flightYs[i]);
  const jitterM = Math.sqrt(d2.reduce((s2, d) => s2 + d * d, 0) / d2.length / 6) / pxPerM;
  if (jitterM > MAX_JITTER_M) return { ok: false, problem: 'jitter' };

  // 2. Height above standing, smoothed, and its velocity. The flight goes through the filter too, so the filter has
  // no edge at take-off.
  const edge = Math.round(EDGE_S * fps);
  const quietN = edge + Math.round(QUIET_S * fps);
  const end = ts.findIndex((t) => t > landingS - FLIGHT_TRIM_S);
  const upto = end < 0 ? ts.length : end;
  const raw = ys.slice(0, upto);
  const smooth = lowPass(raw, fps, CUTOFF_HZ);
  const standPx = smooth.slice(edge, quietN).reduce((a, b) => a + b, 0) / (quietN - edge);
  const h = smooth.map((y) => (standPx - y) / pxPerM);
  const dt = 1 / fps;
  const v = h.map((_, i) => (h[Math.min(h.length - 1, i + 1)] - h[Math.max(0, i - 1)]) / ((Math.min(h.length - 1, i + 1) - Math.max(0, i - 1)) * dt));
  if (ts[quietN] == null || ts[quietN] > takeoffS || v.slice(edge, quietN).some((x) => Math.abs(x) > QUIET_V)) return { ok: false, problem: 'no-quiet' };

  const take = ts.findIndex((t) => t > takeoffS);
  const last = (take < 0 ? ts.length : take) - 1;
  const quietV = v.slice(edge, quietN);
  const sdV = Math.sqrt(quietV.reduce((s2, x) => s2 + x * x, 0) / quietV.length);

  // 3. Phases.
  let low = quietN;
  for (let i = quietN; i <= last; i++) if (h[i] < h[low]) low = i;
  const dip = -h[low] >= MIN_DIP_M;
  // From the fastest movement of the first phase (down in a CMJ, up in a squat jump) back to where the centre of mass
  // was last as still as when standing.
  const sign = dip ? -1 : 1;
  let start = quietN;
  for (let i = quietN; i <= (dip ? low : last); i++) if (sign * v[i] > sign * v[start]) start = i;
  while (start > quietN && sign * v[start - 1] > ONSET_SD * sdV) start--;
  const lowS = dip ? ts[low] : null;
  return {
    ok: true,
    result: {
      startS: ts[start],
      lowS,
      takeoffS,
      landingS,
      eccentricS: lowS != null ? lowS - ts[start] : null,
      concentricS: takeoffS - (lowS ?? ts[start]),
      depthM: dip ? -h[low] : 0,
      pxPerM,
      jitterM,
    },
  };
}
