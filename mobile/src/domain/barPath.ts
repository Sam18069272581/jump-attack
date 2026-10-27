/**
 * Bar velocity from a tracked plate. The tracker reports where the centre of a standard 45 cm plate is in each
 * video frame; the plate's size in the picture is the scale. From that path this finds every concentric phase
 * (bar rising from its lowest point to standing still at the top) and its mean velocity: displacement ÷ time,
 * with the phase starting and ending where the bar's velocity crosses zero, not at a speed threshold, which
 * would cut off the slow start and finish and overstate the speed.
 */

/** Diameter of a standard (IWF/IPF) bumper or competition plate, cm. */
export const PLATE_CM = 45;

/** One tracked video frame: media time (s), plate centre in video pixels (y grows downwards), match quality 0–1. */
export type TrackSample = { t: number; x: number; y: number; c: number };

export type Rep = {
  /** Real time of the concentric start and end, s. */
  start: number;
  end: number;
  /** Mean concentric velocity, m/s. */
  mv: number;
  /** Peak velocity, m/s. */
  pv: number;
  /** Vertical bar travel, cm. */
  romCm: number;
};

/** A smoothed point of the bar path in real time: height above the first frame (cm, up is positive) and velocity (m/s). */
export type PathPoint = { t: number; h: number; v: number };

export type BarAnalysis = {
  path: PathPoint[];
  reps: Rep[];
  /** Frames per real second the path was sampled at. */
  rate: number;
  /** Share of frames the tracker was unsure of (match below `MIN_CONFIDENCE`). */
  unsure: number;
};

/** Match quality below which a frame is dropped as a likely mis-track. */
export const MIN_CONFIDENCE = 0.5;
/** Half-width of the smoothing window, s. Wide enough to quiet pixel jitter, narrow enough to keep the turnarounds. */
const SMOOTH_S = 0.04;
/** Tracking jitter (cm, robust standard deviation) the default window is sized for. */
const JITTER_CM = 0.1;
/** A reversal of the bar has to move at least this far (cm) to count, so jitter at the top isn't a new rep. */
const REVERSAL_CM = 3;
/** A concentric phase shorter than this (cm) is a walk-out or re-rack, not a rep. */
const MIN_ROM_CM = 10;
/** And shorter than this share of the set's longest rise. */
const MIN_ROM_SHARE = 0.6;
/** How long (s) the bar must stay put for a velocity zero-crossing to count as the end (or start) of a rep… */
const SETTLE_S = 0.1;
/** …moving no more than this (cm), or three times the tracking jitter if that's larger. */
const SETTLE_CM = 0.3;
/** The ends of a rep are refined from the points within this share of the rise from the bottom or top… */
const ENDS_SHARE = 0.25;
/** …and may move by at most this much (s) from where the smoothed velocity put them. */
const MAX_SHIFT_S = 0.25;
/** How long after a rep (s) the bar's resting height at the top is read over. */
const PLATEAU_S = 0.2;
/** Velocity (m/s) treated as standing still at the ends of a rep. */
const STILL = 0;

/** Pixels per cm from the plate's diameter in pixels. */
export function pxPerCm(plateDiameterPx: number): number {
  return plateDiameterPx / PLATE_CM;
}

/**
 * Height and velocity at each sample from a local quadratic fit over ±`SMOOTH_S` (tricube weights). Works on
 * uneven timestamps, so dropped frames don't skew the velocity.
 */
export function smoothPath(points: { t: number; h: number }[], half = SMOOTH_S): PathPoint[] {
  return points.map((p, i) => {
    let lo = i;
    let hi = i;
    while (lo > 0 && p.t - points[lo - 1].t <= half) lo--;
    while (hi < points.length - 1 && points[hi + 1].t - p.t <= half) hi++;
    // Keep at least two neighbours a side where there are any, so a sparse stretch still gets a slope.
    lo = Math.max(0, Math.min(lo, i - 2));
    hi = Math.min(points.length - 1, Math.max(hi, i + 2));
    const span = Math.max(half, p.t - points[lo].t, points[hi].t - p.t) * 1.0001;
    // Weighted least squares for h ≈ a + b·d + c·d², d = t − p.t.
    let s0 = 0, s1 = 0, s2 = 0, s3 = 0, s4 = 0, y0 = 0, y1 = 0, y2 = 0;
    for (let j = lo; j <= hi; j++) {
      const d = points[j].t - p.t;
      const w = (1 - Math.abs(d / span) ** 3) ** 3;
      const h = points[j].h;
      s0 += w;
      s1 += w * d;
      s2 += w * d * d;
      s3 += w * d * d * d;
      s4 += w * d * d * d * d;
      y0 += w * h;
      y1 += w * h * d;
      y2 += w * h * d * d;
    }
    const n = hi - lo + 1;
    if (n < 3) return { t: p.t, h: p.h, v: 0 };
    // Solve the 3×3 normal equations by Cramer's rule.
    const det = s0 * (s2 * s4 - s3 * s3) - s1 * (s1 * s4 - s3 * s2) + s2 * (s1 * s3 - s2 * s2);
    if (Math.abs(det) < 1e-18) return { t: p.t, h: p.h, v: 0 };
    const a = (y0 * (s2 * s4 - s3 * s3) - s1 * (y1 * s4 - s3 * y2) + s2 * (y1 * s3 - s2 * y2)) / det;
    const b = (s0 * (y1 * s4 - y2 * s3) - y0 * (s1 * s4 - s3 * s2) + s2 * (s1 * y2 - y1 * s2)) / det;
    // h is in cm, so the slope is cm/s.
    return { t: p.t, h: a, v: b / 100 };
  });
}

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
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

/** Linear interpolation of the time where velocity crosses `level` between samples `a` and `b`. */
function crossing(path: PathPoint[], a: number, b: number, level: number): { t: number; h: number } {
  const p = path[a];
  const q = path[b];
  const f = q.v === p.v ? 0 : Math.min(1, Math.max(0, (level - p.v) / (q.v - p.v)));
  return { t: p.t + f * (q.t - p.t), h: p.h + f * (q.h - p.h) };
}

/** Where a least-squares line through (t, s) crosses s = 0, or null without three points or a slope. */
function zeroOfLine(pts: { t: number; s: number }[]): number | null {
  if (pts.length < 3) return null;
  const mt = pts.reduce((a, p) => a + p.t, 0) / pts.length;
  const ms = pts.reduce((a, p) => a + p.s, 0) / pts.length;
  const sxx = pts.reduce((a, p) => a + (p.t - mt) ** 2, 0);
  const sxy = pts.reduce((a, p) => a + (p.t - mt) * (p.s - ms), 0);
  if (sxx === 0 || sxy === 0) return null;
  return mt - ms / (sxy / sxx);
}

/**
 * The concentric phase between a low and the next high: from the last moment the bar was still near the
 * bottom to the first moment it is still near the top, both found where velocity crosses `STILL`.
 */
function measureRep(raw: { t: number; h: number }[], path: PathPoint[], low: number, high: number, tol: number): Rep | null {
  let peak = low;
  for (let i = low; i <= high; i++) if (path[i].v > path[peak].v) peak = i;
  const bottom = path[low].h;
  const rise = path[high].h - bottom;
  // Really still, not a jitter dip: the bar gets no further than `tol` past this point over the next (dir 1) or
  // previous (dir −1) `SETTLE_S`.
  const settled = (i: number, dir: 1 | -1) => {
    for (let j = i + dir; j >= 0 && j < path.length && Math.abs(path[j].t - path[i].t) <= SETTLE_S; j += dir) {
      if (dir * (path[j].h - path[i].h) > tol) return false;
    }
    return true;
  };
  // Start: walk back from the peak to where it was still, within the bottom tenth of the rise.
  let s = peak;
  while (s > low && !(path[s - 1].v <= STILL && path[s - 1].h <= bottom + 0.1 * rise && settled(s - 1, -1))) s--;
  // End: walk on from the peak to where it is still again, within the top tenth.
  let e = peak;
  while (e < high && !(path[e + 1].v <= STILL && path[e + 1].h >= bottom + 0.9 * rise && settled(e + 1, 1))) e++;
  let start = s > low ? crossing(path, s - 1, s, STILL) : { t: path[low].t, h: path[low].h };
  let end = e < high ? crossing(path, e, e + 1, STILL) : { t: path[high].t, h: path[high].h };

  // Smoothing rounds off the corners where the bar leaves the bottom and arrives at the top, which shifts both
  // crossings, more so the fewer frames per second there are. Near each end the bar moves under roughly constant
  // acceleration, h = level ± k·(t − t₀)², so √|h − level| is a straight line in t that reaches zero at t₀. Fit
  // that line to the unsmoothed points just inside each end, clear of the jitter, and take where it hits zero.
  const tPeak = path[peak].t;
  const near = (lo: number, hi: number, f: (h: number) => number) =>
    raw.flatMap((p) => {
      if (p.t < lo || p.t > hi) return [];
      const d = f(p.h);
      return d >= tol && d <= ENDS_SHARE * rise ? [{ t: p.t, s: Math.sqrt(d) }] : [];
    });
  const plateau = raw.filter((p) => p.t >= end.t && p.t <= end.t + PLATEAU_S).map((p) => p.h);
  const top = plateau.length >= 3 ? median(plateau) : path[high].h;
  const tEnd = zeroOfLine(near(tPeak, end.t, (h) => top - h));
  if (tEnd != null && tEnd > tPeak && Math.abs(tEnd - end.t) <= MAX_SHIFT_S) end = { t: tEnd, h: top };
  const tStart = zeroOfLine(near(start.t, tPeak, (h) => h - bottom));
  if (tStart != null && tStart < tPeak && Math.abs(tStart - start.t) <= MAX_SHIFT_S) start = { t: tStart, h: bottom };

  const dt = end.t - start.t;
  const romCm = end.h - start.h;
  if (dt <= 0 || romCm <= 0) return null;
  return { start: start.t, end: end.t, mv: romCm / 100 / dt, pv: path[peak].v, romCm };
}

/**
 * Reps in a tracked set. `timeScale` turns media time into real time: 1 for normal video, file fps ÷ capture fps
 * for slow motion played back at a lower rate.
 */
export function analyseBarPath(samples: TrackSample[], plateDiameterPx: number, timeScale = 1): BarAnalysis {
  const scale = pxPerCm(plateDiameterPx);
  const good = samples.filter((s) => s.c >= MIN_CONFIDENCE);
  const unsure = samples.length ? 1 - good.length / samples.length : 0;
  if (good.length < 5 || scale <= 0) return { path: [], reps: [], rate: 0, unsure };
  const y0 = good[0].y;
  const raw = good.map((s) => ({ t: s.t * timeScale, h: (y0 - s.y) / scale }));
  // Shakier tracking gets a wider window, up to 2.5×, so jitter at the top doesn't end a rep early.
  const first = smoothPath(raw);
  const jitter = median(raw.map((p, i) => Math.abs(p.h - first[i].h))) * 1.4826;
  const path = jitter > JITTER_CM ? smoothPath(raw, SMOOTH_S * Math.min(2.5, jitter / JITTER_CM)) : first;
  const span = raw[raw.length - 1].t - raw[0].t;
  const rate = span > 0 ? (raw.length - 1) / span : 0;

  const turns = turningPoints(path);
  const rises: { low: number; high: number; rise: number }[] = [];
  for (let k = 0; k + 1 < turns.length; k++) {
    if (turns[k].kind !== 'low' || turns[k + 1].kind !== 'high') continue;
    const low = turns[k].i;
    const high = turns[k + 1].i;
    rises.push({ low, high, rise: path[high].h - path[low].h });
  }
  const longest = Math.max(0, ...rises.map((r) => r.rise));
  const minRise = Math.max(MIN_ROM_CM, MIN_ROM_SHARE * longest);
  const reps = rises.filter((r) => r.rise >= minRise).flatMap((r) => measureRep(raw, path, r.low, r.high, Math.max(SETTLE_CM, 3 * jitter)) ?? []);
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

/** Problems with a tracked set worth telling the athlete before they trust the numbers. */
export function trackWarnings(a: BarAnalysis): string[] {
  const out: string[] = [];
  if (a.reps.length === 0) out.push('没有找到完整的一次向心：确认杠铃片整个行程都在画面里，圈套准杠铃片后重新分析。');
  if (a.unsure > 0.15) out.push(`有 ${Math.round(a.unsure * 100)}% 的画面没认准杠铃片，结果可能不准：光线暗、杠铃片被挡住或手机晃动都会这样。`);
  if (a.rate > 0 && a.rate < 50) out.push(`视频只有约 ${Math.round(a.rate)} fps，速度误差会变大。相机设置里把录制视频改成 60 fps 再拍。`);
  return out;
}
