/**
 * The ground force of a vertical jump, estimated from the path of the centre of mass in a side-on clip, with the
 * phases of the movement: for the exported video (media/replayHtml.ts), where it is drawn as an estimate. It does not
 * go into the diagnosis: a force read off a video has not been checked against a force plate.
 *
 * 1. Scale: in flight the centre of mass falls freely, so the curvature of its path in the picture is gravity, and
 *    pixels per metre = 2c / g for y = a + bt + ct² (the same scale the technique analysis uses, domain/technique.ts).
 * 2. The path before take-off, in metres above where the athlete stood, is smoothed with a 6 Hz low-pass (barPath
 *    `lowPass`, two passes) and differentiated twice: force = 1 + a / g, in body weights (Newton's second law for the
 *    whole body, F − mg = ma).
 * 3. Phases, as on a force plate (McMahon et al. 2018, Strength Cond J 40(4):96): the movement starts when the force
 *    first drops below standing (`ONSET_BW`, or five times the standing scatter if larger); eccentric runs from there to
 *    the lowest point (velocity zero), concentric from the lowest point to take-off. A jump that never dips
 *    (`MIN_DIP_M`) has no eccentric phase: a squat jump.
 *
 * Accuracy, from synthetic CMJs (domain/testing/cmjScene.ts, 240 fps, a known force): with 3 mm of jitter on the
 * centre of mass the peak force is within ±0.11 body weights (95 %) and the lowest point within ±2 ms; at 6 mm the
 * peak comes out about 0.16 too high (±0.19). What the synthetic clips can't hold: the segment model's centre of mass
 * against the athlete's own, as the arms swing. Hence `MAX_JITTER_M`, and the label "estimate" wherever it is shown.
 */
import { lowPass } from './barPath';
import { G } from './jump';
import { polyFit } from './technique';

/** Low-pass cut-off for the path before differentiating, Hz: in the synthetic CMJs above, 8 Hz doubled the peak's error at 3 mm of jitter and 10 Hz quadrupled it. */
export const CUTOFF_HZ = 6;
/** The movement has started once the force is this far below standing (× body weight). */
export const ONSET_BW = 0.05;
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
 * The most jitter on the centre of mass (m, the SD about the flight's parabola) that a force curve is drawn with: at
 * 6 mm the synthetic peak reads 0.16 body weights high, so the line sits below it.
 */
export const MAX_JITTER_M = 0.005;

export type ComSample = { t: number; y: number | null };

export type ForceCurveProblem =
  /** Long stretches with no centre of mass. */
  | 'gaps'
  /** No flight long enough, or a flight that doesn't fall: no scale. */
  | 'flight'
  /** The centre of mass wobbles too much to differentiate twice. */
  | 'jitter'
  /** The clip starts with the athlete already moving: nowhere to measure standing from. */
  | 'no-quiet';

export type ForceCurve = {
  /** Real time (s) of each estimate, one per frame from the window's start to take-off. */
  t: number[];
  /** Ground force, × body weight. */
  force: number[];
  /** Height of the centre of mass above standing (m), at the same times. */
  heightM: number[];
  startS: number;
  /** The lowest point; null without a countermovement. */
  lowS: number | null;
  takeoffS: number;
  landingS: number;
  eccentricS: number | null;
  concentricS: number;
  peak: { value: number; t: number };
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

export function forceCurve(input: { samples: ComSample[]; takeoffS: number; landingS: number; fps: number }): { ok: true; result: ForceCurve } | { ok: false; problem: ForceCurveProblem } {
  const { samples, takeoffS, landingS, fps } = input;
  if (samples.length < 4) return { ok: false, problem: 'gaps' };
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
  const jitterM = fit.sd / pxPerM;
  if (jitterM > MAX_JITTER_M) return { ok: false, problem: 'jitter' };

  // 2. Height above standing, smoothed, and its second derivative. The flight goes through the filter too, so the
  // filter has no edge at take-off.
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
  const a = v.map((_, i) => (v[Math.min(v.length - 1, i + 1)] - v[Math.max(0, i - 1)]) / ((Math.min(v.length - 1, i + 1) - Math.max(0, i - 1)) * dt));
  if (ts[quietN] == null || ts[quietN] > takeoffS || v.slice(edge, quietN).some((x) => Math.abs(x) > QUIET_V)) return { ok: false, problem: 'no-quiet' };

  const take = ts.findIndex((t) => t > takeoffS);
  const last = (take < 0 ? ts.length : take) - 1;
  const force = a.slice(0, last + 1).map((x) => 1 + x / G);
  const quietF = force.slice(edge, quietN);
  const meanF = quietF.reduce((s, x) => s + x, 0) / quietF.length;
  const sdF = Math.sqrt(quietF.reduce((s, x) => s + (x - meanF) ** 2, 0) / Math.max(1, quietF.length - 1));

  // 3. Phases.
  let low = 0;
  for (let i = 0; i <= last; i++) if (h[i] < h[low]) low = i;
  const dip = -h[low] >= MIN_DIP_M;
  const below = 1 - Math.max(ONSET_BW, 5 * sdF);
  let start = dip ? low : 0;
  if (dip) {
    // Back from the lowest point to where the force first fell below standing.
    let first = -1;
    for (let i = quietN; i <= low; i++)
      if (force[i] < below) {
        first = i;
        break;
      }
    start = first < 0 ? low : first;
  } else {
    // A squat jump: it starts when the force first rises above standing.
    const above = 1 + Math.max(ONSET_BW, 5 * sdF);
    const first = force.findIndex((f, i) => i >= quietN && f > above);
    start = first < 0 ? 0 : first;
  }
  let peak = start;
  for (let i = start; i <= last; i++) if (force[i] > force[peak]) peak = i;
  const lowS = dip ? ts[low] : null;
  return {
    ok: true,
    result: {
      t: ts.slice(0, last + 1),
      force,
      heightM: h.slice(0, last + 1),
      startS: ts[start],
      lowS,
      takeoffS,
      landingS,
      eccentricS: lowS != null ? lowS - ts[start] : null,
      concentricS: takeoffS - (lowS ?? ts[start]),
      peak: { value: force[peak], t: ts[peak] },
      depthM: dip ? -h[low] : 0,
      pxPerM,
      jitterM,
    },
  };
}
