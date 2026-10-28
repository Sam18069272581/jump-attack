/**
 * Bar velocity from a tracked plate. The tracker reports where the centre of a standard 45 cm plate is in each
 * video frame, stamped with the frame's real media time; the plate's size in the picture is the scale. From that
 * path this finds every concentric phase (bar leaving the bottom until it stands still at the top again) and its
 * mean velocity (MCV), mean propulsive velocity (MPV) and peak velocity.
 *
 * The heights are put on an even time grid and low-passed with a zero-lag Butterworth filter, which gives the
 * velocity and acceleration and finds the reps. Filtering rounds off the moments the bar leaves the bottom and
 * comes to rest at the top, though, and mean velocity is travel ÷ time, so a few frames there are worth several
 * per cent. The two ends are therefore fitted on the unfiltered points instead: around a turnaround the bar's
 * height goes as a power of the time since (or until) it, h = h₀ + k·|t − t₀|ⁿ, whatever the lift.
 */

import { velocityLoss } from './vbt';

/** Diameter of a standard (IWF/IPF) bumper or competition plate, cm. */
export const PLATE_CM = 45;

/** One tracked video frame: media time (s), plate centre in video pixels (y grows downwards), match quality 0–1. */
export type TrackSample = { t: number; x: number; y: number; c: number };

/**
 * Why a rep's numbers shouldn't be trusted. `partial`: clearly shorter than the set's other reps. `truncated`: not
 * seen from rest to rest (cut off by the start or end of the clip or by a tracking gap). `unsure`: too many frames
 * inside it missing or matched poorly. `drift`: the plate moved sideways too far for a real bar path, so likely a
 * mis-track or a moving camera.
 */
export type RepFlag = 'partial' | 'truncated' | 'unsure' | 'drift';

export type Rep = {
  /** Real time of the concentric start and end, s. */
  start: number;
  end: number;
  /** Mean concentric velocity, m/s. */
  mv: number;
  /** Mean propulsive velocity: over the concentric phase up to where the bar starts braking harder than gravity, m/s. */
  mpv: number;
  /** Peak velocity, m/s. */
  pv: number;
  /** Vertical bar travel, cm. */
  romCm: number;
  /** Empty for a rep the numbers can be trusted for. */
  flags: RepFlag[];
};

/** A smoothed point of the bar path in real time: height above the first frame (cm, up is positive) and velocity (m/s). */
export type PathPoint = { t: number; h: number; v: number };

export type BarAnalysis = {
  path: PathPoint[];
  reps: Rep[];
  /** Frames per real second the video was sampled at. */
  rate: number;
  /** Share of frames the tracker was unsure of (match below `MIN_CONFIDENCE`). */
  unsure: number;
};

/** Match quality below which a frame is dropped as a likely mis-track. */
export const MIN_CONFIDENCE = 0.5;
/** Low-pass cutoff, Hz: bar movement in lifting stays well under it, pixel jitter mostly lies above. */
const CUTOFF_HZ = 6;
/** The cutoff is lowered to this share of the frame rate for slow video, where 6 Hz would be close to Nyquist. */
const MAX_CUTOFF_SHARE = 0.2;
/**
 * A run of missing or unsure frames longer than this many frame intervals, and than `GAP_S`, splits the path. A
 * phone that drops to half its frame rate in dim light and skips a frame on top leaves 67 ms gaps in a 60 fps video,
 * which interpolate fine: mean velocity is travel ÷ time, and both ends are timed on the frames around them.
 */
const GAP_FRAMES = 3.5;
const GAP_S = 0.1;
/** Standard gravity, m/s². The bar braking harder than this is no longer being pushed. */
const G = 9.81;
/** A reversal of the bar has to move at least this far (cm) to count, so jitter at the top isn't a new rep. */
const REVERSAL_CM = 3;
/** A concentric phase shorter than this (cm) is a walk-out or re-rack, not a rep. */
const MIN_ROM_CM = 10;
/** And shorter than this share of the set's longest rise. */
const MIN_ROM_SHARE = 0.6;
/** A dip in a rise smaller than this share of the climb before it is the bar sinking at a sticking point, not a new rep. */
const SINK_SHARE = 0.25;
/**
 * The ends of a rep are fitted on the points within this share of the rise from the bottom or top… The power law
 * only holds near the turn: for a minimum-jerk lift, h = 10u³ − 15u⁴ + 6u⁵, its leading term 10u³ is already 63 %
 * too high at 15 % of the rise (u = 0.29) and 74 % at 20 % (u = 0.33), and with jitter that pulls both ends inwards.
 */
const ENDS_SHARE = 0.15;
/** …and within this long (s) on either side of the turnaround… */
const ENDS_S = 0.4;
/** …and may move by at most this much (s) from where the filtered velocity put them. */
const MAX_SHIFT_S = 0.15;
/** Speed (m/s) below which the bar is all but still: where it crosses it is a steadier guess at the turn than 0. */
const STILL = 0.03;
/**
 * Fewest frames each end is fitted on, either side of where the filtered velocity put it. The fit has five unknowns:
 * the turn's time and height and the exponent, shared by both sides, and each side's own rate; four frames a side
 * leave it over-determined even when one side sits on a hold. At 15 fps (a 30 fps
 * video at half rate in dim light) the top 15 % of a 0.4 s rep lasts 0.1 s: one or two frames.
 */
const MIN_FIT_FRAMES = 4;
/** Exponents tried for the shape of each end: 2 is constant acceleration, higher is force still building up. */
const END_POWERS = [1.5, 2, 2.5, 3];
/** A rep shorter than this share of the set's typical (median) rep is flagged as partial. */
const PARTIAL_SHARE = 0.8;
/** A rep with fewer than this share of the frames the video has in it tracked confidently is flagged as unsure. */
const MIN_TRACKED_SHARE = 0.8;
/** Sideways travel (cm) during a rep beyond which it's flagged as drift, or this share of its rise if that's larger. */
const DRIFT_CM = 12;
const DRIFT_SHARE = 0.3;

/** Pixels per cm from the plate's diameter in pixels. */
export function pxPerCm(plateDiameterPx: number): number {
  return plateDiameterPx / PLATE_CM;
}

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/**
 * Zero-lag 4th-order Butterworth low-pass of evenly spaced values: a 2nd-order section run forwards, then
 * backwards. The ends are padded with the signal reflected about its end point, which keeps its level and slope.
 */
export function lowPass(xs: number[], rate: number, cutoff: number): number[] {
  const n = xs.length;
  if (n < 3) return [...xs];
  // Two passes cut deeper than one; widen the section so that the pair is still 3 dB down at `cutoff` (Winter).
  const k = Math.tan((Math.PI * cutoff) / 0.802 / rate);
  const norm = 1 / (1 + Math.SQRT2 * k + k * k);
  const b0 = k * k * norm;
  const a1 = 2 * (k * k - 1) * norm;
  const a2 = (1 - Math.SQRT2 * k + k * k) * norm;
  const pad = Math.min(n - 1, Math.ceil((1.5 * rate) / cutoff));
  const ext: number[] = [];
  for (let i = pad; i > 0; i--) ext.push(2 * xs[0] - xs[i]);
  ext.push(...xs);
  for (let i = n - 2; i >= n - 1 - pad; i--) ext.push(2 * xs[n - 1] - xs[i]);
  // Start each pass settled on its first value, so it doesn't ring in from zero.
  const pass = (ys: number[]) => {
    const out = new Array<number>(ys.length);
    let x1 = ys[0], x2 = ys[0], y1 = ys[0], y2 = ys[0];
    for (let i = 0; i < ys.length; i++) {
      const y = b0 * (ys[i] + 2 * x1 + x2) - a1 * y1 - a2 * y2;
      x2 = x1;
      x1 = ys[i];
      y2 = y1;
      y1 = y;
      out[i] = y;
    }
    return out;
  };
  return pass(pass(ext).reverse()).reverse().slice(pad, pad + n);
}

/** Alternating lowest and highest points of the path, ignoring wiggles smaller than `REVERSAL_CM`. */
export function turningPoints(path: PathPoint[], reversal = REVERSAL_CM): { i: number; kind: 'low' | 'high' }[] {
  if (path.length === 0) return [];
  const out: { i: number; kind: 'low' | 'high' }[] = [];
  let lo = 0;
  let hi = 0;
  let trend: 'up' | 'down' | null = null;
  for (let i = 1; i < path.length; i++) {
    const h = path[i].h;
    if (trend === null) {
      if (h > path[hi].h) hi = i;
      if (h < path[lo].h) lo = i;
      if (path[hi].h - path[lo].h >= reversal) {
        trend = hi > lo ? 'up' : 'down';
        out.push(trend === 'up' ? { i: lo, kind: 'low' } : { i: hi, kind: 'high' });
      }
    } else if (trend === 'up') {
      if (h > path[hi].h) hi = i;
      else if (path[hi].h - h >= reversal) {
        out.push({ i: hi, kind: 'high' });
        trend = 'down';
        lo = i;
      }
    } else {
      if (h < path[lo].h) lo = i;
      else if (h - path[lo].h >= reversal) {
        out.push({ i: lo, kind: 'low' });
        trend = 'up';
        hi = i;
      }
    }
  }
  if (trend === 'up') out.push({ i: hi, kind: 'high' });
  if (trend === 'down') out.push({ i: lo, kind: 'low' });
  return out;
}

/** A tracked frame in real time: height and sideways position (cm) and which unbroken stretch of tracking it's in. */
type Raw = { t: number; h: number; x: number; seg: number };
/** A point of the filtered path, on the even time grid. */
type Point = PathPoint & { a: number; x: number; seg: number };

/** Linear interpolation of where `key` crosses `level` between points `i` and `i + 1`. */
function crossing(path: Point[], i: number, key: 'v' | 'a', level: number): { t: number; h: number } {
  const p = path[i];
  const q = path[i + 1];
  const f = q[key] === p[key] ? 0 : Math.min(1, Math.max(0, (level - p[key]) / (q[key] - p[key])));
  return { t: p.t + f * (q.t - p.t), h: p.h + f * (q.h - p.h) };
}

/** The filtered path on an even grid at `rate`, each unbroken stretch of frames filtered on its own. */
function filterPath(raw: Raw[], rate: number): Point[] {
  const cutoff = Math.min(CUTOFF_HZ, MAX_CUTOFF_SHARE * rate);
  const dt = 1 / rate;
  const out: Point[] = [];
  for (let from = 0; from < raw.length; ) {
    let to = from;
    while (to + 1 < raw.length && raw[to + 1].seg === raw[from].seg) to++;
    const seg = raw.slice(from, to + 1);
    from = to + 1;
    if (seg.length < 4) continue;
    // Resample linearly onto the grid, so a frame shown late or twice doesn't skew the filter.
    const ts: number[] = [];
    const hs: number[] = [];
    const xs: number[] = [];
    for (let k = 0, j = 0; seg[0].t + k * dt <= seg[seg.length - 1].t + 1e-9; k++) {
      const t = seg[0].t + k * dt;
      while (j + 2 < seg.length && seg[j + 1].t <= t) j++;
      const p = seg[j];
      const q = seg[j + 1];
      const f = Math.min(1, Math.max(0, (t - p.t) / (q.t - p.t)));
      ts.push(t);
      hs.push(p.h + f * (q.h - p.h));
      xs.push(p.x + f * (q.x - p.x));
    }
    if (ts.length < 4) continue;
    const h = lowPass(hs, rate, cutoff);
    const x = lowPass(xs, rate, cutoff);
    const last = h.length - 1;
    for (let i = 0; i <= last; i++) {
      const a = Math.max(1, Math.min(last - 1, i));
      // h is in cm: velocity and acceleration in m/s and m/s².
      const v = (h[Math.min(last, i + 1)] - h[Math.max(0, i - 1)]) / ((Math.min(last, i + 1) - Math.max(0, i - 1)) * dt) / 100;
      const acc = (h[a + 1] - 2 * h[a] + h[a - 1]) / (dt * dt) / 100;
      out.push({ t: ts[i], h: h[i], v, a: acc, x: x[i], seg: seg[0].seg });
    }
  }
  return out;
}

/**
 * When, between `from` and `to`, the bar turned around, fitted on the tracked frames in [lo, hi] as
 * h = h₀ + kL·(t₀ − t)ⁿ before t₀ and h₀ + kR·(t − t₀)ⁿ after it. `dir` is 1 for the bottom (the bar rises after t₀
 * and was level or falling before it) and −1 for the top. Null without enough frames on both sides.
 */
function fitTurn(raw: Raw[], from: number, to: number, lo: number, hi: number, dir: 1 | -1): { t: number; h: number } | null {
  // The top is the bottom run backwards and upside down: the bar rises into it and is level or falling after it.
  // Flipping only the height would fit where the bar starts back down instead, which after a hold is jitter.
  if (dir === -1) {
    const top = fitTurn(raw.map((p) => ({ ...p, t: -p.t, h: -p.h })), -to, -from, -hi, -lo, 1);
    return top && { t: -top.t, h: -top.h };
  }
  const pts = raw.filter((p) => p.t >= lo && p.t <= hi);
  // Seconds are scaled to tenths so the powers stay well conditioned.
  const sse = (t0: number, n: number) => {
    let before = 0;
    let after = 0;
    let s0 = 0, sl = 0, sr = 0, sll = 0, srr = 0, sh = 0, slh = 0, srh = 0, shh = 0;
    for (const p of pts) {
      const l = p.t < t0 ? ((t0 - p.t) * 10) ** n : 0;
      const r = p.t > t0 ? ((p.t - t0) * 10) ** n : 0;
      if (p.t < t0) before++;
      if (p.t > t0) after++;
      s0++;
      sl += l;
      sr += r;
      sll += l * l;
      srr += r * r;
      sh += p.h;
      slh += l * p.h;
      srh += r * p.h;
      shh += p.h * p.h;
    }
    if (before < 2 || after < 2) return null;
    // Least squares for (h₀, kL, kR); the two power terms never overlap, so the normal equations stay small.
    const solve = (useL: boolean) => {
      const dl = useL ? sll - (sl * sl) / s0 : 1;
      const dr = srr - (sr * sr) / s0;
      const cross = useL ? -(sl * sr) / s0 : 0;
      const yl = useL ? slh - (sl * sh) / s0 : 0;
      const yr = srh - (sr * sh) / s0;
      const det = dl * dr - cross * cross;
      if (Math.abs(det) < 1e-12) return null;
      const kl = (yl * dr - yr * cross) / det;
      const kr = (yr * dl - yl * cross) / det;
      const h0 = (sh - kl * sl - kr * sr) / s0;
      const err = shh - 2 * (h0 * sh + kl * slh + kr * srh) + h0 * h0 * s0 + kl * kl * sll + kr * kr * srr + 2 * (h0 * kl * sl + h0 * kr * sr);
      return { h0, kl, kr, err };
    };
    let fit = solve(true);
    // The side before the turn may only be level or coming the other way; otherwise fit it as level.
    if (fit && dir * fit.kl < 0) fit = solve(false);
    if (!fit || dir * fit.kr <= 0) return null;
    return fit;
  };
  // Near a turnaround the bar moves less than the jitter for a while, so several turn times fit about as well.
  // Average them, weighted by how likely each one makes the frames given the jitter, rather than trusting the
  // single best one, which jumps about with the noise.
  const fits: { t: number; h: number; err: number }[] = [];
  for (const n of END_POWERS) {
    for (let t0 = from; t0 <= to; t0 += 0.001) {
      const f = sse(t0, n);
      if (f) fits.push({ t: t0, h: f.h0, err: f.err });
    }
  }
  if (fits.length === 0) return null;
  const least = Math.min(...fits.map((f) => f.err));
  const variance = Math.max(least / Math.max(1, pts.length - 4), 1e-6);
  let w = 0;
  let t = 0;
  let h = 0;
  for (const f of fits) {
    const wi = Math.exp(-(f.err - least) / (2 * variance));
    w += wi;
    t += wi * f.t;
    h += wi * f.h;
  }
  return { t: t / w, h: h / w };
}

/**
 * The concentric phase between a low and the next high: from where the bar last had no upward velocity near the
 * bottom to where it first has none again near the top, both refined by `fitTurn`. Null if it can't be timed.
 */
function measureRep(raw: Raw[], frames: number[], path: Point[], low: number, high: number): Rep | null {
  const bottom = path[low].h;
  const rise = path[high].h - bottom;
  let a = low;
  while (a < high && path[a].h < bottom + 0.1 * rise) a++;
  let b = a;
  while (b < high && path[b].h < bottom + 0.9 * rise) b++;
  // Walk out from the bottom and top tenths to where the filtered velocity is zero, staying in one tracked stretch.
  // Running into the edge of the stretch instead means the bar was never seen standing still there.
  const inA = (i: number) => i >= 0 && path[i].seg === path[a].seg;
  const inB = (i: number) => i < path.length && path[i].seg === path[b].seg;
  let s = a;
  while (inA(s - 1) && path[s - 1].v > 0) s--;
  let e = b;
  while (inB(e + 1) && path[e].v > 0) e++;
  // Seen from rest to rest: one unbroken stretch, with frames before the start and after the end.
  const truncated = path[a].seg !== path[b].seg || !inA(s - 2) || path[e].v > 0 || !inB(e + 1);
  let start = inA(s - 1) ? crossing(path, s - 1, 'v', 0) : { t: path[s].t, h: path[s].h };
  let end = path[e].v <= 0 && e > b ? crossing(path, e - 1, 'v', 0) : { t: path[e].t, h: path[e].h };
  const seg = path[a].seg;

  if (!truncated) {
    // Where the filtered velocity crosses zero wanders with the jitter while the bar is nearly still, and can
    // land well off the real turn; where it crosses a slow speed doesn't. The turn is looked for around both.
    let sv = a;
    while (sv > s && path[sv - 1].v > STILL) sv--;
    let ev = b;
    while (ev < e && path[ev].v > STILL) ev++;
    const slowStart = sv > s ? crossing(path, sv - 1, 'v', STILL).t : start.t;
    const slowEnd = ev < e && ev > b ? crossing(path, ev - 1, 'v', STILL).t : end.t;
    // The frames each end is fitted on: those within ENDS_SHARE of the rise from it and ENDS_S of either guess.
    const band = ENDS_SHARE * rise;
    const edge = (from: number, step: 1 | -1, past: (h: number) => boolean) => {
      let i = from;
      while (i + step >= 0 && i + step < path.length && path[i + step].seg === seg && !past(path[i + step].h) && Math.abs(path[i + step].t - path[from].t) <= ENDS_S) i += step;
      return path[i].t;
    };
    const segRaw = raw.filter((p) => p.seg === seg);
    // A fast rep filmed at a low frame rate has only a frame or two in the band, too few to fit; take at least
    // MIN_FIT_FRAMES frames on either side of the guess.
    const nth = (t: number, step: 1 | -1) => {
      const side = step > 0 ? segRaw.filter((p) => p.t > t) : segRaw.filter((p) => p.t < t).reverse();
      return side.length ? side[Math.min(side.length, MIN_FIT_FRAMES) - 1].t : t;
    };
    const fs = fitTurn(segRaw, Math.min(start.t, slowStart) - MAX_SHIFT_S, slowStart + MAX_SHIFT_S, Math.min(edge(s, -1, (h) => h > start.h + band), nth(Math.min(start.t, slowStart), -1)), Math.max(edge(sv, 1, (h) => h > start.h + band), nth(slowStart, 1)), 1);
    const fe = fitTurn(segRaw, slowEnd - MAX_SHIFT_S, Math.max(end.t, slowEnd) + MAX_SHIFT_S, Math.min(edge(ev, -1, (h) => h < end.h - band), nth(slowEnd, -1)), Math.max(edge(e, 1, (h) => h < end.h - band), nth(Math.max(end.t, slowEnd), 1)), -1);
    if (fs && fs.t < path[b].t) start = fs;
    if (fe && fe.t > path[a].t) end = fe;
  }

  const time = end.t - start.t;
  const romCm = end.h - start.h;
  if (time <= 0 || romCm <= 0) return null;
  const mv = romCm / 100 / time;
  let peak = s;
  for (let i = s; i <= e; i++) if (path[i].v > path[peak].v) peak = i;
  // Propulsive phase: until the bar first brakes harder than gravity after its fastest point.
  let mpv = mv;
  for (let i = peak; i < e; i++) {
    if (path[i + 1].a < -G) {
      const p = crossing(path, i, 'a', -G);
      if (p.t > start.t && p.t < end.t) mpv = (p.h - start.h) / 100 / (p.t - start.t);
      break;
    }
  }

  const flags: RepFlag[] = [];
  if (truncated) flags.push('truncated');
  // Frames the camera never recorded are not the tracker's doing; a long run of them already split the path.
  const tracked = raw.filter((p) => p.t >= start.t && p.t <= end.t).length;
  const shown = frames.filter((t) => t >= start.t && t <= end.t).length;
  // Allow a frame for where the ends fall between frames.
  if (tracked < MIN_TRACKED_SHARE * shown - 1) flags.push('unsure');
  const xs = path.slice(s, e + 1).map((p) => p.x);
  if (Math.max(...xs) - Math.min(...xs) > Math.max(DRIFT_CM, DRIFT_SHARE * romCm)) flags.push('drift');
  return { start: start.t, end: end.t, mv, mpv, pv: path[peak].v, romCm, flags };
}

/**
 * Reps in a tracked set. `timeScale` turns media time into real time: 1 for normal video, file fps ÷ capture fps
 * for slow motion played back at a lower rate.
 */
export function analyseBarPath(samples: TrackSample[], plateDiameterPx: number, timeScale = 1): BarAnalysis {
  const scale = pxPerCm(plateDiameterPx);
  // Real time, oldest first, one sample per frame.
  const frames = [...samples].sort((p, q) => p.t - q.t).filter((s, i, all) => i === 0 || s.t > all[i - 1].t);
  const unsure = frames.length ? frames.filter((s) => s.c < MIN_CONFIDENCE).length / frames.length : 0;
  // The frame rate from every frame, not just the confident ones: a dropped frame isn't a slower camera.
  const step = median(frames.slice(1).map((s, i) => (s.t - frames[i].t) * timeScale));
  const rate = step > 0 ? 1 / step : 0;
  const good = frames.filter((s) => s.c >= MIN_CONFIDENCE);
  if (good.length < 5 || scale <= 0 || rate <= 0) return { path: [], reps: [], rate, unsure };

  const { x: x0, y: y0 } = good[0];
  const raw: Raw[] = [];
  for (const s of good) {
    const t = s.t * timeScale;
    const prev = raw[raw.length - 1];
    const seg = !prev ? 0 : t - prev.t > Math.max(GAP_FRAMES * step, GAP_S) ? prev.seg + 1 : prev.seg;
    raw.push({ t, h: (y0 - s.y) / scale, x: (s.x - x0) / scale, seg });
  }
  const grid = filterPath(raw, rate);
  const path = grid.map(({ t, h, v }) => ({ t, h, v }));

  const turns = turningPoints(path);
  let rises: { low: number; high: number }[] = [];
  for (let k = 0; k + 1 < turns.length; k++) {
    if (turns[k].kind === 'low' && turns[k + 1].kind === 'high') rises.push({ low: turns[k].i, high: turns[k + 1].i });
  }
  // A bar that sinks a little at a sticking point and then grinds on to lockout is still one rep.
  const height = (i: number) => grid[i].h;
  rises = rises.reduce<typeof rises>((out, r) => {
    const prev = out[out.length - 1];
    const climb = prev ? height(prev.high) - height(prev.low) : 0;
    if (prev && height(prev.high) - height(r.low) < SINK_SHARE * climb && height(r.low) > height(prev.low) && height(r.high) > height(prev.high)) {
      prev.high = r.high;
      return out;
    }
    return [...out, { ...r }];
  }, []);
  const longest = Math.max(0, ...rises.map((r) => height(r.high) - height(r.low)));
  const minRise = Math.max(MIN_ROM_CM, MIN_ROM_SHARE * longest);
  const shown = frames.map((s) => s.t * timeScale);
  const reps = rises.filter((r) => height(r.high) - height(r.low) >= minRise).flatMap((r) => measureRep(raw, shown, grid, r.low, r.high) ?? []);

  // Partial: clearly shorter than the set's typical rep, judged on the reps that were seen whole.
  const whole = reps.filter((r) => !r.flags.includes('truncated')).map((r) => r.romCm);
  if (whole.length >= 2) {
    const typical = median(whole);
    for (const r of reps) if (r.romCm < PARTIAL_SHARE * typical) r.flags.push('partial');
  }
  return { path, reps, rate, unsure };
}

export type SetSummary = { best: number; first: number; last: number; loss: number; count: number };

/** The set at a glance: its fastest rep (the value logged), first and last, and how much the last one slowed. */
export function summariseReps(mvs: number[]): SetSummary | null {
  if (mvs.length === 0) return null;
  const best = Math.max(...mvs);
  const last = mvs[mvs.length - 1];
  return { best, first: mvs[0], last, loss: best > 0 ? Math.max(0, (best - last) / best) : 0, count: mvs.length };
}

/** Why a flagged rep was left out, as the athlete reads it under the rep. */
export const REP_FLAG_REASONS: Record<RepFlag, string> = {
  truncated: '没拍全：视频在这一次中间开始或结束，或者中途跟丢了杠铃片',
  partial: '行程明显比这组其他几次短，可能没蹲到底或没站直',
  unsure: '这一次有不少画面没认准杠铃片',
  drift: '杠铃片左右移动太多，可能跟错了东西或手机动了',
};

/** A rep counts towards the logged set unless something about it was flagged; the athlete can still put it back. */
export function countsByDefault(r: Rep): boolean {
  return r.flags.length === 0;
}

export type TrackedSet = {
  kept: Rep[];
  summary: SetSummary;
  /** The fastest kept rep: its velocity is the one logged. */
  best: Rep;
  /** Highest peak velocity of the kept reps, m/s. */
  peakV: number;
  /** Each rep's velocity loss against the fastest kept rep, in the order given; 0 for a rep left out. */
  loss: number[];
};

/** What gets logged for a tracked set from the reps the athlete kept (`included[i]` for `reps[i]`). Null if none. */
export function trackedSet(reps: Rep[], included: boolean[]): TrackedSet | null {
  const kept = reps.filter((_, i) => included[i]);
  const summary = summariseReps(kept.map((r) => r.mv));
  if (!summary) return null;
  const best = kept.reduce((a, b) => (b.mv > a.mv ? b : a));
  return {
    kept,
    summary,
    best,
    peakV: Math.max(...kept.map((r) => r.pv)),
    loss: reps.map((r, i) => (included[i] ? velocityLoss(summary.best, r.mv) : 0)),
  };
}

/** Highest file frame rate that can be an iPhone slow-motion export (those are saved at 30 fps). */
const SLOW_MO_FILE_FPS = 30;

/**
 * Real seconds per media second. Only a file of at most 30 fps can be slow motion (`captureFps` as chosen by the
 * athlete); for anything else, or a file whose rate is unknown, media time is real time, whatever was chosen.
 */
export function trackTimeScale(fileFps: number | null, captureFps: number | null): number {
  if (!fileFps || fileFps > SLOW_MO_FILE_FPS || !captureFps || captureFps <= fileFps) return 1;
  return fileFps / captureFps;
}

/** Problems with a tracked set worth telling the athlete before they trust the numbers. */
export function trackWarnings(a: BarAnalysis): string[] {
  const out: string[] = [];
  if (a.reps.every((r) => r.flags.length > 0)) out.push('没有找到完整的一次向心：确认杠铃片整个行程都在画面里，圈套准杠铃片后重新分析。');
  if (a.unsure > 0.15) out.push(`有 ${Math.round(a.unsure * 100)}% 的画面没认准杠铃片，结果可能不准：光线暗、杠铃片被挡住或手机晃动都会这样。`);
  if (a.rate > 0 && a.rate < 50) out.push(`视频只有约 ${Math.round(a.rate)} fps，速度误差会变大。相机设置里把录制视频改成 60 fps 再拍。`);
  return out;
}
