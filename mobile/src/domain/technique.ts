/**
 * Run-up jump technique from the pose landmarks of a side-on clip (domain/pose.ts): how the athlete planted and how
 * they left the ground. Every figure carries its 95 % error, and a figure whose error is wider than the change worth
 * acting on (`PASS_LINE`) is marked imprecise rather than shown as a number to trust.
 *
 * 1. The athlete: the person the pose model followed through the run-up (or the one the athlete tapped), with left
 *    and right put back where the model swapped them.
 * 2. Which way is up and along the floor: across the two floor markers when there are any, otherwise from the body;
 *    either way the floor line is then fitted to where the feet stand still, which also takes out a tilted phone.
 * 3. Foot contacts: a heel or toe is down while it is on that line and doesn't move. Each contact's edges are then
 *    timed to a fraction of a frame, by fitting the point's path as still on one side and moving steadily on the
 *    other. Take-off is the first frame of the long flight with no foot down, landing the first frame back down (the
 *    convention of marking by hand).
 * 4. The centre of mass in flight is a free-fall parabola: fitted, it gives the vertical and horizontal take-off
 *    velocity. Its curvature is gravity, which sets the scale at the athlete's own distance from the lens
 *    (pixel-to-metre from gravity, as in Aderinola et al. 2023, arXiv 2302.10749); with markers it doubles as a check
 *    of the markers and the frame rate.
 * 5. Run-up speed follows the rule the athlete agreed: two floor markers 3 m apart, and the time the hips take
 *    between them.
 *
 * Errors come from the fits themselves, from the timing of each event (its own jitter, plus `EVENT_FLOOR_FRAMES`),
 * and for joint angles from the published agreement of markerless pose with marker-based capture
 * (Aleksic et al. 2024, Sensors 24:6624: knee RMSE about 7°, hip 8°).
 */
import { lowPass } from './barPath';
import { G } from './jump';
import { centreOfMass, jointAngle, LM, mid, SIDE, type Pose, type Pt, type Side } from './pose';

const { abs, atan2, ceil, hypot, max, min, PI, round, sqrt } = Math;

/** One frame's people, as the page found them. `t` is real time, s (a slow-motion clip's file frames over its capture rate). */
export type PoseFrame = { frame: number; t: number; poses: Pose[] };

/** Two marks on the floor along the run-up, `distanceM` apart, where the athlete tapped them in the picture. */
export type Markers = { a: Pt; b: Pt; distanceM: number };

export type TechniqueInput = {
  /** Every frame of the stretch to analyse, in order, at the capture rate. */
  frames: PoseFrame[];
  captureFps: number;
  markers: Markers | null;
  /** A point on the athlete in the picture, when someone else is in it too. */
  target?: Pt | null;
};

export type TechniqueProblem =
  /** Nobody the pose model kept hold of for long enough. */
  | 'no-athlete'
  /** No flight long enough to be a jump. */
  | 'no-jump'
  /** A flight, but no plant before it in the clip. */
  | 'no-plant'
  /** The two floor lines were tapped too close together to be 3 m apart: both on the same tape. */
  | 'markers';

export type MetricKey = 'vz' | 'vx' | 'angle' | 'approach' | 'brake' | 'plant' | 'gap' | 'step' | 'knee' | 'trunk';

/** A measured figure and its 95 % error (±, same unit). */
export type Measured = { value: number; error: number; status: 'ok' | 'imprecise' };

/**
 * The widest 95 % error each figure may have and still be shown as a number: the size of change worth acting on.
 * Speeds m/s, angles °, times ms, lengths m. Agreed in the plan (起跳骨架分析方案, 2026-10-28): take-off velocity
 * 0.05 m/s (≈ 2 cm of rise at 3.3 m/s), run-up speed 0.15 m/s, contact 15 ms, take-off angle 3°, joint angles 5°, last
 * step 8 cm. Braking uses the run-up speed's line, and the gap between two feet landing the contact time's.
 */
export const PASS_LINE: Record<MetricKey, number> = {
  vz: 0.05,
  vx: 0.15,
  angle: 3,
  approach: 0.15,
  brake: 0.15,
  plant: 15,
  gap: 15,
  step: 0.08,
  knee: 5,
  trunk: 5,
};

/**
 * The least a pose-based event (a foot down or up) can be off, frames, 95 %: how far a real foot's path strays from
 * the fit's "still, then steady velocity" around the event. A toe speeds up as it peels off rather than leaving at
 * one speed, so the fit puts take-off about a third of a frame late. On top of this floor comes each event's own
 * share from the clip's jitter (see `edgeTime`). Set so the stated errors cover the truth in at least 95 % of
 * synthetic clips filmed fourteen ways (tools/pose-validation); real footage has to confirm it (the plan's gate G2).
 */
export const EVENT_FLOOR_FRAMES = 0.75;

/** Markerless joint angles against marker-based capture, 95 % (1.96 × RMSE; Aleksic et al. 2024: knee 7°, hip/trunk 8°). */
export const KNEE_ERROR_DEG = 14;
export const TRUNK_ERROR_DEG = 16;

/**
 * How far the segment model's centre of mass may drift against the real one over a flight as the limbs move, m: the
 * model's averages aren't this athlete's, and a pose model's points shift a little as joints bend. An assumption, to be
 * checked against the wall reading (the plan's gate G2); spread over the fitted flight it limits the take-off velocities.
 */
export const COM_DRIFT_M = 0.01;

/** Below this frame rate contact times can't be told to the agreed 15 ms. */
export const MIN_CONTACT_FPS = 200;

/** How well a floor marker is tapped (px of the clip, 1 SD): on a frame zoomed in to tap it. */
export const TAP_PX = 4;

/** Shortest flight that is a jump rather than a running stride, s. */
export const MIN_FLIGHT_S = 0.25;

/** Markers and gravity disagree on the scale by more than this share: the athlete wasn't on the markers' line. */
export const SCALE_MISMATCH = 0.05;
/** By more than this, the frame rate is wrong (a 120 fps clip read as 240 is off by four times). */
export const SCALE_BROKEN = 0.3;

export type QualityFlag =
  /** Fewer frames a second than the guide's 240: events are timed coarser, so contact times and take-off velocity
   *  may come out imprecise. */
  | 'low-fps'
  /** No floor markers: no run-up speed, and lengths come from gravity's scale. */
  | 'no-markers'
  /** The markers' scale and gravity's differ: the take-off wasn't on the markers' line. */
  | 'off-line'
  /** They differ hugely: the frame rate is wrong, or the markers were tapped wrong. */
  | 'scale-broken'
  /** The pose model lost the athlete for a while. */
  | 'gaps'
  /** The take-off foot was the one away from the camera. */
  | 'far-foot'
  /** The body grows or shrinks over the run-up: it comes at the camera, so speeds along the picture read low. */
  | 'curved'
  /** The free fall stops early (a hand on the rim): only the rise is used. */
  | 'hang'
  /** The clip ends before the landing. */
  | 'cut-off'
  /** A moment some figure needs isn't in the clip (before its first frame) or the model lost the athlete there: that
   *  figure is left out. */
  | 'unseen';

export type Contact = {
  foot: Side;
  /** First frame down, and first frame up again (file frames). */
  down: number;
  up: number;
  /** The same two moments to a fraction of a frame: where the foot stops, and where it starts moving off (file frames). */
  downAt: number;
  upAt: number;
  /** Their 95 % errors, frames. */
  downErr: number;
  upErr: number;
  /** Where the toe stood, along the floor (picture px, world-aligned), and how well that is known (px, 95 %). */
  toeX: number;
  toeErr: number;
};

export type TechniqueResult = {
  style: { kind: 'one' | 'two'; foot: Side | null };
  /** File frames: the plant's first foot down, take-off (first frame airborne), landing (null when not in the clip). */
  events: { plantDown: number; takeoff: number; landing: number | null };
  contacts: Contact[];
  penultimate: Contact | null;
  metrics: Partial<Record<MetricKey, Measured>>;
  /** Metres per pixel from the markers and from gravity, and the gravity the markers' scale gives (m/s²). */
  scale: { markers: number | null; gravity: number; gravityWithMarkers: number | null };
  flags: QualityFlag[];
  /** The side of the body facing the camera. */
  nearSide: Side;
  /** The athlete in each input frame (null where the model lost them), with left and right put back where swapped. */
  athlete: (Pose | null)[];
  /** Centre of mass per input frame in the picture (null where lost). */
  com: (Pt | null)[];
};

// ---------------------------------------------------------------------------------------------------------------
// Small numerical helpers.

const median = (xs: number[]): number => {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

const quantile = (xs: number[], q: number): number => {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const i = (s.length - 1) * q;
  const lo = Math.floor(i);
  return s[lo] + (s[min(s.length - 1, lo + 1)] - s[lo]) * (i - lo);
};

const dot = (a: Pt, b: Pt) => a.x * b.x + a.y * b.y;
const sub = (a: Pt, b: Pt): Pt => ({ x: a.x - b.x, y: a.y - b.y });
const unit = (a: Pt): Pt => {
  const n = hypot(a.x, a.y);
  return n ? { x: a.x / n, y: a.y / n } : { x: 0, y: -1 };
};

/**
 * Least-squares polynomial (degree 1 or 2) through (t, y): coefficients from the constant up, the residual SD, the
 * coefficients' SEs and covariance.
 */
export function polyFit(ts: number[], ys: number[], degree: 1 | 2): { c: number[]; sd: number; se: number[]; cov: number[][] } {
  const n = ts.length;
  const k = degree + 1;
  if (n <= k) throw new Error(`polyFit needs more than ${k} points, got ${n}`);
  // Normal equations, solved by Gauss–Jordan: k is 2 or 3, so this is exact enough.
  const A = Array.from({ length: k }, () => new Array<number>(k).fill(0));
  const b = new Array<number>(k).fill(0);
  for (let i = 0; i < n; i++) {
    const p = [1, ts[i], ts[i] * ts[i]];
    for (let r = 0; r < k; r++) {
      b[r] += p[r] * ys[i];
      for (let c = 0; c < k; c++) A[r][c] += p[r] * p[c];
    }
  }
  const inv = invert(A);
  const c = inv.map((row) => row.reduce((s, v, j) => s + v * b[j], 0));
  let ss = 0;
  for (let i = 0; i < n; i++) {
    const f = c[0] + c[1] * ts[i] + (degree === 2 ? c[2] * ts[i] * ts[i] : 0);
    ss += (ys[i] - f) ** 2;
  }
  const sd = sqrt(ss / (n - k));
  return { c, sd, se: inv.map((row, i) => sd * sqrt(max(0, row[i]))), cov: inv.map((row) => row.map((v) => v * sd * sd)) };
}

function invert(m: number[][]): number[][] {
  const n = m.length;
  const a = m.map((row, i) => [...row, ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (abs(a[r][c]) > abs(a[p][c])) p = r;
    [a[c], a[p]] = [a[p], a[c]];
    const d = a[c][c];
    if (abs(d) < 1e-12 * max(1, abs(m[c][c]))) throw new Error('singular fit');
    for (let j = 0; j < 2 * n; j++) a[c][j] /= d;
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = a[r][c];
      for (let j = 0; j < 2 * n; j++) a[r][j] -= f * a[c][j];
    }
  }
  return a.map((row) => row.slice(n));
}

/**
 * The jitter (SD) of a path sampled every frame, from its second differences, which take out any parabola: for white
 * noise of SD σ they have SD √6·σ. Their median absolute deviation keeps a few odd frames (or a hang's bend) out of it.
 */
function flightJitter(ts: number[], ys: number[], fps: number): number {
  const d2: number[] = [];
  for (let i = 1; i + 1 < ts.length; i++) {
    // Only three frames in a row: a frame the model missed would make the step uneven.
    if (abs((ts[i] - ts[i - 1]) * fps - 1) < 0.01 && abs((ts[i + 1] - ts[i]) * fps - 1) < 0.01) d2.push(ys[i + 1] - 2 * ys[i] + ys[i - 1]);
  }
  if (d2.length < 5) return 0;
  const m = median(d2);
  return (1.4826 * median(d2.map((d) => abs(d - m)))) / sqrt(6);
}

/** Fills runs of NaN up to `maxGap` long by straight lines between their neighbours. */
function bridge(xs: number[], maxGap: number): number[] {
  const out = [...xs];
  let i = 0;
  while (i < out.length) {
    if (!Number.isNaN(out[i])) {
      i++;
      continue;
    }
    let j = i;
    while (j < out.length && Number.isNaN(out[j])) j++;
    if (i > 0 && j < out.length && j - i <= maxGap) {
      for (let k = i; k < j; k++) out[k] = out[i - 1] + ((out[j] - out[i - 1]) * (k - i + 1)) / (j - i + 1);
    }
    i = j;
  }
  return out;
}

/**
 * The highest cut-off a low-pass gets, as a share of the frame rate (barPath keeps its own to the same): past 0.4 the
 * filter's pre-warp passes Nyquist and it blows up, as a 10 Hz cut-off would on a 24 fps clip.
 */
const MAX_CUTOFF_SHARE = 0.2;

/** Zero-lag low-pass of a series that may have NaN gaps: each stretch between gaps is filtered on its own. */
function smoothSeries(xs: number[], fps: number, cutoff: number): number[] {
  const out = [...xs];
  let i = 0;
  while (i < xs.length) {
    if (Number.isNaN(xs[i])) {
      i++;
      continue;
    }
    let j = i;
    while (j < xs.length && !Number.isNaN(xs[j])) j++;
    if (j - i >= 4) {
      const f = lowPass(xs.slice(i, j), fps, min(cutoff, MAX_CUTOFF_SHARE * fps));
      for (let k = i; k < j; k++) out[k] = f[k - i];
    }
    i = j;
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// 1. The athlete.

const hipCentre = (p: Pose) => mid(p[LM.leftHip], p[LM.rightHip]);
/** Shoulder to ankle, a size that doesn't change much as limbs swing. */
const bodySize = (p: Pose) => {
  const d = sub(mid(p[LM.leftShoulder], p[LM.rightShoulder]), mid(p[LM.leftAnkle], p[LM.rightAnkle]));
  return hypot(d.x, d.y);
};

/**
 * Follows each person from frame to frame by their hips and picks the athlete: the one nearest `target` when given,
 * otherwise the one who travels furthest (the runner, not someone standing by).
 */
export function pickAthlete(frames: PoseFrame[], target?: Pt | null): (Pose | null)[] {
  type Track = { last: Pt; lastFrame: number; size: number; picks: Map<number, number> };
  const tracks: Track[] = [];
  frames.forEach((f, fi) => {
    const used = new Set<number>();
    const hips = f.poses.map(hipCentre);
    for (const tr of tracks) {
      if (fi - tr.lastFrame > max(10, frames.length / 4)) continue;
      let best = -1;
      let bestD = Infinity;
      hips.forEach((h, pi) => {
        if (used.has(pi)) return;
        const d = hypot(h.x - tr.last.x, h.y - tr.last.y);
        if (d < bestD) {
          bestD = d;
          best = pi;
        }
      });
      // A hip can move about half a body length between the frames this sees (coarse passes skip frames).
      if (best >= 0 && bestD < 0.6 * tr.size * max(1, fi - tr.lastFrame)) {
        used.add(best);
        tr.picks.set(fi, best);
        tr.last = hips[best];
        tr.lastFrame = fi;
        tr.size = 0.8 * tr.size + 0.2 * bodySize(f.poses[best]);
      }
    }
    hips.forEach((h, pi) => {
      if (!used.has(pi)) tracks.push({ last: h, lastFrame: fi, size: max(1, bodySize(f.poses[pi])), picks: new Map([[fi, pi]]) });
    });
  });
  if (!tracks.length) return frames.map(() => null);
  const hipOf = (fi: number, pi: number) => hipCentre(frames[fi].poses[pi]);
  const score = (tr: Track) => {
    if (target) {
      let d = Infinity;
      for (const [fi, pi] of tr.picks) d = min(d, hypot(hipOf(fi, pi).x - target.x, hipOf(fi, pi).y - target.y));
      return -d;
    }
    const hs = [...tr.picks].map(([fi, pi]) => hipOf(fi, pi));
    const travel = hypot(max(...hs.map((p) => p.x)) - min(...hs.map((p) => p.x)), max(...hs.map((p) => p.y)) - min(...hs.map((p) => p.y)));
    return travel + 0.01 * tr.picks.size;
  };
  const chosen = tracks.reduce((a, b) => (score(b) > score(a) ? b : a));
  return frames.map((f, fi) => (chosen.picks.has(fi) ? f.poses[chosen.picks.get(fi)!] : null));
}

const LEFT_POINTS = Object.values(SIDE.left);
const RIGHT_POINTS = Object.values(SIDE.right);

const swapSides = (p: Pose): Pose => {
  const q = [...p];
  LEFT_POINTS.forEach((li, k) => {
    q[li] = p[RIGHT_POINTS[k]];
    q[RIGHT_POINTS[k]] = p[li];
  });
  return q;
};

/**
 * Puts left and right back where the pose model swapped them for a few frames: each frame's legs are matched to where
 * the previous frames' were heading, and swapped when the other way round fits clearly better.
 */
export function unswap(track: (Pose | null)[]): { poses: (Pose | null)[]; swaps: number } {
  const out: (Pose | null)[] = [];
  let swaps = 0;
  const legs = (p: Pose, s: Side) => [SIDE[s].knee, SIDE[s].ankle, SIDE[s].heel, SIDE[s].toe].map((i) => p[i]);
  for (let i = 0; i < track.length; i++) {
    const p = track[i];
    const prev = out[i - 1];
    if (!p || !prev) {
      out.push(p);
      continue;
    }
    const prev2 = out[i - 2];
    const predict = (s: Side) => legs(prev, s).map((q, k) => (prev2 ? { x: 2 * q.x - legs(prev2, s)[k].x, y: 2 * q.y - legs(prev2, s)[k].y } : q));
    const pl = predict('left');
    const pr = predict('right');
    const cost = (a: Pt[], b: Pt[]) => a.reduce((s, q, k) => s + hypot(q.x - b[k].x, q.y - b[k].y), 0);
    const keep = cost(legs(p, 'left'), pl) + cost(legs(p, 'right'), pr);
    const swap = cost(legs(p, 'right'), pl) + cost(legs(p, 'left'), pr);
    // Only when clearly better: with the legs crossing, both ways fit alike and the labels don't matter.
    if (swap < keep && keep - swap > 0.04 * bodySize(p)) {
      out.push(swapSides(p));
      swaps++;
    } else out.push(p);
  }
  return { poses: out, swaps };
}

/**
 * Which side the pose model takes to be nearer the camera: the side whose hip, knee and ankle it puts nearer (smaller
 * `z`) and sees more surely, over most frames.
 */
function labelledNearSide(track: (Pose | null)[]): Side {
  let votes = 0;
  for (const p of track) {
    if (!p) continue;
    const z = (s: Side) => p[SIDE[s].hip].z + p[SIDE[s].knee].z + p[SIDE[s].ankle].z;
    const v = (s: Side) => p[SIDE[s].hip].v + p[SIDE[s].knee].v + p[SIDE[s].ankle].v;
    const d = z('left') - z('right') + (v('right') - v('left'));
    votes += d > 0 ? 1 : d < 0 ? -1 : 0;
  }
  return votes >= 0 ? 'right' : 'left';
}

// ---------------------------------------------------------------------------------------------------------------
// 2. Up and along the floor.

/** Up in the picture (a unit vector): across the markers' line, else the body's long axis snapped to the picture's edges. */
function upFrom(track: (Pose | null)[], markers: Markers | null): Pt {
  const axes = track.flatMap((p) => (p ? [sub(mid(p[LM.leftShoulder], p[LM.rightShoulder]), mid(p[LM.leftAnkle], p[LM.rightAnkle]))] : []));
  const body = unit({ x: median(axes.map((a) => a.x)), y: median(axes.map((a) => a.y)) });
  if (markers) {
    const along = unit(sub(markers.b, markers.a));
    const perp = { x: along.y, y: -along.x };
    return dot(perp, body) >= 0 ? perp : { x: -perp.x, y: -perp.y };
  }
  // A phone is upright or on its side; the floor fit takes out what tilt is left.
  const cands = [{ x: 0, y: -1 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: -1, y: 0 }];
  return cands.reduce((a, b) => (dot(b, body) > dot(a, body) ? b : a));
}

/** A frame of reference in the picture: X along the floor in the running direction, Y up, both in pixels. */
type Frame = { origin: Pt; xAxis: Pt; up: Pt };
const toWorld = (f: Frame, p: Pt): Pt => ({ x: dot(sub(p, f.origin), f.xAxis), y: dot(sub(p, f.origin), f.up) });
const toPicture = (f: Frame, w: Pt): Pt => ({ x: f.origin.x + w.x * f.xAxis.x + w.y * f.up.x, y: f.origin.y + w.x * f.xAxis.y + w.y * f.up.y });

// ---------------------------------------------------------------------------------------------------------------
// 3. Series.

type Track2 = { x: number[]; y: number[] };
/** Per frame of the stretch: its file frame, whether the model lost the athlete there, and the paths (gaps bridged). */
type Series = { frame: number[]; lost: boolean[]; com: Track2; hip: Track2; feet: Record<Side, { heel: Track2; toe: Track2 }> };

function seriesOf(poses: (Pose | null)[], frames: PoseFrame[], f: Frame, maxGap: number): Series {
  const pick = (fn: (p: Pose) => Pt): Track2 => {
    const pts = poses.map((p) => (p ? toWorld(f, fn(p)) : null));
    return { x: bridge(pts.map((q) => (q ? q.x : NaN)), maxGap), y: bridge(pts.map((q) => (q ? q.y : NaN)), maxGap) };
  };
  const foot = (s: Side) => ({ heel: pick((p) => p[SIDE[s].heel]), toe: pick((p) => p[SIDE[s].toe]) });
  return { frame: frames.map((fr) => fr.frame), lost: poses.map((p) => !p), com: pick(centreOfMass), hip: pick(hipCentre), feet: { left: foot('left'), right: foot('right') } };
}

/** Speed of a point along a smoothed path, px/s, by central differences. */
function speeds(x: number[], y: number[], fps: number): number[] {
  return x.map((_, i) => {
    const a = max(0, i - 1);
    const b = min(x.length - 1, i + 1);
    if (b === a || [x[a], x[b], y[a], y[b]].some(Number.isNaN)) return NaN;
    return (hypot(x[b] - x[a], y[b] - y[a]) * fps) / (b - a);
  });
}

/** The file frame at a fractional index into the series (frames are consecutive in a dense pass, but needn't be). */
function frameAt(s: Series, idx: number): number {
  const i = max(0, min(s.frame.length - 1, Math.floor(idx)));
  const j = min(s.frame.length - 1, i + 1);
  return s.frame[i] + (j > i ? (s.frame[j] - s.frame[i]) * (idx - i) : idx - i);
}

// ---------------------------------------------------------------------------------------------------------------
// 4. Contacts.

/** A foot point stands still if it moves slower than this (m/s): planted feet don't move, swinging ones do metres a second. */
const STILL_MS = 0.8;
/** Smoothing for that speed, Hz: low enough that a pose model's jitter doesn't read as motion (the edges are timed on the raw path). */
const STILL_CUTOFF_HZ = 10;
/** How far above the fitted floor (m) a heel or toe may sit and still be down: a pose model's foot jitter. */
const FLOOR_TOL_M = 0.025;
/** Shortest contact (s): shorter "contacts" are a swinging foot passing low. */
const MIN_CONTACT_S = 0.04;

/** A heel or toe: its raw path, its smoothed height, and whether it stands still. */
type PointTrace = Track2 & { sy: number[]; still: boolean[] };
type FootTrace = { heel: PointTrace; toe: PointTrace };

function footTraces(s: Series, fps: number, scale: number): Record<Side, FootTrace> {
  const trace = (pt: Track2): PointTrace => {
    const sx = smoothSeries(pt.x, fps, STILL_CUTOFF_HZ);
    const sy = smoothSeries(pt.y, fps, STILL_CUTOFF_HZ);
    return { ...pt, sy, still: speeds(sx, sy, fps).map((v) => !Number.isNaN(v) && v * scale < STILL_MS) };
  };
  return {
    left: { heel: trace(s.feet.left.heel), toe: trace(s.feet.left.toe) },
    right: { heel: trace(s.feet.right.heel), toe: trace(s.feet.right.toe) },
  };
}

/**
 * The floor along the picture's floor axis, where each foot stands. The far foot stands further from the lens, so with
 * the phone above the floor it stands a few pixels higher in the picture. `level` is read near each spot from that
 * foot's still points around it (a run-up that comes in at an angle has its floor at another height in the picture
 * than the take-off spot's); `c1` is the slope of the line through all of them.
 */
type Floor = { c1: number; level: (x: number, side: Side) => number };

/** Where the heels and toes stood still. */
function stillPoints(traces: Record<Side, FootTrace>, sides: Side[]): { X: number[]; Y: number[] } {
  const X: number[] = [];
  const Y: number[] = [];
  for (const side of sides) {
    for (const pt of [traces[side].heel, traces[side].toe]) {
      pt.still.forEach((st, i) => {
        if (st && !Number.isNaN(pt.sy[i]) && !Number.isNaN(pt.x[i])) {
          X.push(pt.x[i]);
          Y.push(pt.sy[i]);
        }
      });
    }
  }
  return { X, Y };
}

/**
 * A robust floor. The slope from both feet's still points (their lower part: still points include a heel lifting in
 * push-off), trimmed three times; the height under a spot from that foot's still points within `nearPx` of it, or all
 * of them when there are too few near, leaving out any more than `offPx` off the line (feet held still in the air, as
 * when hanging on the rim).
 */
function fitFloor(traces: Record<Side, FootTrace>, nearPx: number, offPx: number): Floor | null {
  const both = stillPoints(traces, ['left', 'right']);
  if (both.X.length < 6) return null;
  const cut = quantile(both.Y, 0.6);
  let X = both.X.filter((_, i) => both.Y[i] <= cut);
  let Y = both.Y.filter((y) => y <= cut);
  let c0 = median(Y);
  let c1 = 0;
  for (let it = 0; it < 3 && X.length > 4; it++) {
    if (max(...X) - min(...X) > 1) [c0, c1] = polyFit(X, Y, 1).c;
    const res = X.map((x, i) => Y[i] - (c0 + c1 * x));
    const mad = median(res.map(abs)) * 1.4826 + 1e-9;
    const keep = res.map((r) => abs(r) <= 3 * mad);
    X = X.filter((_, i) => keep[i]);
    Y = Y.filter((_, i) => keep[i]);
  }
  const own = { left: stillPoints(traces, ['left']), right: stillPoints(traces, ['right']) };
  const heightNear = (side: Side, x: number): number | null => {
    const { X: xs, Y: ys } = own[side];
    for (const reach of [nearPx, 2 * nearPx, Infinity]) {
      const res = xs.flatMap((xi, i) => (abs(xi - x) <= reach && abs(ys[i] - (c0 + c1 * xi)) <= offPx ? [ys[i] - c1 * xi] : []));
      if (res.length >= 8) return quantile(res, 0.3);
    }
    return null;
  };
  const level = (x: number, side: Side): number => (heightNear(side, x) ?? heightNear(side === 'left' ? 'right' : 'left', x) ?? c0) + c1 * x;
  return { c1, level };
}

/**
 * When a point stops ('down') or starts moving ('up'), as a fractional index, and its 95 % error in frames. Where it
 * stands still is known from the contact (`still`: the median over the part of the stance it is planted for, and its
 * jitter). Around the rough edge `at`, the raw path in a fixed window of 40 ms either side is fitted as standing there on
 * one side of a moment and moving away at a steady velocity on the other, for each moment in turn; the moment whose fit
 * leaves the least residual is the edge, and the window is moved there and fitted again until it settles. Every moment
 * is judged on the same points, so jitter can't favour one by leaving its worst points out.
 *
 * A foot coming down is timed on its height alone: a swinging foot brakes hard along the floor just before it strikes
 * (a steady-velocity fit would put the strike early), but keeps falling at an even speed until it lands. A foot
 * leaving is timed on both: it goes off with the body.
 *
 * The error is the range of moments whose fit is not clearly worse than the best (a likelihood-ratio interval: the
 * residual within 3.84 jitter variances of the least, with the jitter raised to the fit's own scatter when the path
 * doesn't follow the model), so a clip that leaves the moment open says so; on top of it comes the floor for how real
 * paths stray from the fit. Null when there is too little path either side.
 */
function edgeTime(
  pt: Track2,
  at: number,
  kind: 'down' | 'up',
  fps: number,
  contact: [number, number],
  still: Pt & { sd: number },
  scale: number,
): { t: number; err: number } | null {
  const half = max(4, round(0.04 * fps));
  // The slowest a foot that is moving goes (px a frame): slower is standing still.
  const minSpeed = STILL_MS / scale / fps;
  let t = at;
  let fit: { t: number; rss: number; n: number; curve: [number, number][] } | null = null;
  for (let iter = 0; iter < 4; iter++) {
    const c = round(t);
    const lo = kind === 'up' ? max(contact[0], c - half) : max(0, c - half);
    const hi = kind === 'down' ? min(contact[1] - 1, c + half) : min(pt.x.length - 1, c + half);
    const idx: number[] = [];
    const dx: number[] = [];
    const dy: number[] = [];
    for (let i = lo; i <= hi; i++) {
      if (Number.isNaN(pt.x[i]) || Number.isNaN(pt.y[i])) continue;
      idx.push(i);
      dx.push(kind === 'up' ? pt.x[i] - still.x : 0);
      dy.push(pt.y[i] - still.y);
    }
    if (idx.length < 6) return null;
    const dd = dx.reduce((s2, v, k) => s2 + v * v + dy[k] * dy[k], 0);
    const curve: [number, number][] = [];
    // Moments with at least two points either side, and no further than two windows from the rough edge.
    const first = max(idx[1] + 0.05, at - 2 * half);
    const last = min(idx[idx.length - 2] - 0.05, at + 2 * half);
    for (let k = 0; first + k * 0.05 <= last + 1e-9; k++) {
      const t0 = first + k * 0.05;
      let gg = 0;
      let gx = 0;
      let gy = 0;
      idx.forEach((i, j) => {
        const g = kind === 'up' ? max(0, i - t0) : min(0, i - t0);
        gg += g * g;
        gx += g * dx[j];
        gy += g * dy[j];
      });
      // Least squares velocity through the still point; a foot leaving goes up, one landing comes down (vy·g > 0),
      // and at no less than the slowest a moving foot goes.
      let vx = gx / gg;
      let vy = gy / gg;
      if (vy * (kind === 'up' ? 1 : -1) < 0) vy = 0;
      const speed = hypot(vx, vy);
      if (speed < minSpeed) {
        const f = speed > 0 ? minSpeed / speed : 0;
        vx *= f;
        vy = speed > 0 ? vy * f : kind === 'up' ? minSpeed : -minSpeed;
      }
      curve.push([t0, dd - 2 * (vx * gx + vy * gy) + (vx * vx + vy * vy) * gg]);
    }
    if (!curve.length) return null;
    const best = curve.reduce((a, b) => (b[1] < a[1] ? b : a));
    const moved = abs(best[0] - t);
    t = best[0];
    fit = { t, rss: best[1], n: idx.length * (kind === 'up' ? 2 : 1), curve };
    if (moved < 0.5) break;
  }
  if (!fit) return null;
  const variance = max(still.sd * still.sd, fit.rss / max(1, fit.n - 2));
  const inside = fit.curve.filter(([, rss]) => rss <= fit!.rss + 3.84 * variance).map(([t0]) => t0);
  const spread = max(fit.t - min(...inside), max(...inside) - fit.t);
  return { t: fit.t, err: hypot(spread, EVENT_FLOOR_FRAMES) };
}

/**
 * An edge timed next to a run of frames where the model lost the athlete (motion blur at the fastest moments): the
 * path bridged across the run is a guess, and the fit puts the edge at one end of it while the real one may be
 * anywhere inside. So its error reaches across any run of two or more lost frames within the fit's window. One lost
 * frame, bridged by its neighbours' mean, stays within the fit's own error.
 */
function acrossGap(e: { t: number; err: number }, lost: boolean[], fps: number): { t: number; err: number } {
  if (!Number.isFinite(e.err)) return e;
  const reach = max(4, round(0.04 * fps));
  const c = round(e.t);
  let err = e.err;
  let k = max(0, c - reach);
  while (k > 0 && lost[k] && lost[k - 1]) k--;
  for (; k <= min(lost.length - 1, c + reach); k++) {
    if (!lost[k]) continue;
    let b = k;
    while (b + 1 < lost.length && lost[b + 1]) b++;
    // The edge lies between the last frame seen before the run and the first after it.
    if (b > k) err = max(err, hypot(max(e.t - (k - 1), b + 1 - e.t), EVENT_FLOOR_FRAMES));
    k = b;
  }
  return { t: e.t, err };
}

/** Two timings of one moment, weighted by their errors; the error is the better one's (their floor is shared). */
function together(a: { t: number; err: number }, b: { t: number; err: number }): { t: number; err: number } {
  const wa = 1 / (a.err * a.err);
  const wb = 1 / (b.err * b.err);
  return { t: (a.t * wa + b.t * wb) / (wa + wb), err: min(a.err, b.err) };
}

function contactsOf(traces: Record<Side, FootTrace>, s: Series, floor: Floor, fps: number, scale: number): Contact[] {
  const tol = FLOOR_TOL_M / scale;
  const minLen = max(2, round(MIN_CONTACT_S * fps));
  const out: Contact[] = [];
  for (const side of ['left', 'right'] as const) {
    const on = (pt: PointTrace, i: number) => pt.still[i] && !Number.isNaN(pt.sy[i]) && pt.sy[i] - floor.level(pt.x[i], side) <= tol;
    const { heel, toe } = traces[side];
    const down = s.frame.map((_, i) => on(heel, i) || on(toe, i));
    // Runs of frames down. Jitter breaks a contact into pieces: a foot can't take a step in 60 ms, so pieces that
    // close and with the toe where it was are one contact. Then keep runs long enough to be contacts.
    const runs: [number, number][] = [];
    for (let i = 0; i < down.length; ) {
      if (!down[i]) {
        i++;
        continue;
      }
      let j = i;
      while (j < down.length && down[j]) j++;
      runs.push([i, j]);
      i = j;
    }
    const toeNear = (a: number, b: number) => median(toe.x.slice(a, b).filter((v) => !Number.isNaN(v)));
    const merged: [number, number][] = [];
    for (const r of runs) {
      const prev = merged.at(-1);
      if (prev && r[0] - prev[1] <= 0.06 * fps && abs(toeNear(max(prev[0], prev[1] - 5), prev[1]) - toeNear(r[0], min(r[1], r[0] + 5))) * scale < 0.1) prev[1] = r[1];
      else merged.push([...r]);
    }
    for (const [i, j] of merged) {
      if (j - i >= minLen) {
        const half = i + ((j - i) >> 1);
        const at = (pt: PointTrace, a: number, b: number) => {
          const xs = pt.x.slice(a, b).filter((v) => !Number.isNaN(v));
          const ys = pt.y.slice(a, b).filter((v) => !Number.isNaN(v));
          const x = median(xs);
          const y = median(ys);
          // Jitter of a still point, from how far it strays from where it stands (MAD, both directions pooled).
          const sd = median([...xs.map((v) => abs(v - x)), ...ys.map((v) => abs(v - y))]) * 1.4826;
          return { x, y, sd };
        };
        const unknown = { t: NaN, err: Infinity };
        // A touch-down is in the clip only if the foot is seen in the air before it, heel and toe above where they then
        // stand: a clip that starts inside the contact shows the foot down from its first frame, even where the model
        // missed that frame or the filter's start reads its jitter as motion.
        const stand = { heel: at(heel, i, half), toe: at(toe, i, half) };
        const seenInAir = down.slice(0, i).some((_, k) => !s.lost[k] && heel.sy[k] - stand.heel.y > tol && toe.sy[k] - stand.toe.y > tol);
        const downs = seenInAir ? [heel, toe].flatMap((pt) => edgeTime(pt, i, 'down', fps, [i, j], pt === heel ? stand.heel : stand.toe, scale) ?? []) : [];
        // The heel or the toe, whichever comes down first.
        const dn = acrossGap(downs.length ? downs.reduce((a, b) => (b.t < a.t ? b : a)) : { ...unknown, t: i - 0.5 }, s.lost, fps);
        const up = acrossGap(j === down.length ? { ...unknown, t: j } : (edgeTime(toe, j, 'up', fps, [i, j], at(toe, half, j), scale) ?? { ...unknown, t: j - 0.5 }), s.lost, fps);
        const downAt = frameAt(s, dn.t);
        const upAt = frameAt(s, max(up.t, dn.t + 1));
        // The toe's place: the median over the part of the stance it is planted for, good to 1.25σ/√n (1 SD).
        const stance = toe.x.slice(half, j).filter((x) => !Number.isNaN(x));
        const toeX = median(stance);
        const toeErr = (1.96 * 1.2533 * median(stance.map((x) => abs(x - toeX))) * 1.4826) / sqrt(max(1, stance.length));
        out.push({ foot: side, down: ceil(downAt - 1e-6), up: ceil(upAt - 1e-6), downAt, upAt, downErr: dn.err, upErr: up.err, toeX, toeErr });
      }
    }
  }
  return out.sort((x, y) => x.downAt - y.downAt);
}

// ---------------------------------------------------------------------------------------------------------------
// 5. The jump.

/**
 * The long flight: the longest stretch with neither foot down that lasts at least `MIN_FLIGHT_S` and follows a
 * contact. Returns its start and end in file frames (fractional): the last foot up and the first foot back down, or
 * the clip's end.
 */
function flightOf(contacts: Contact[], s: Series, fps: number): { from: number; to: number; landed: boolean } | null {
  const end = s.frame[s.frame.length - 1] + 1;
  let best: { from: number; to: number; landed: boolean } | null = null;
  let busyUntil = -Infinity;
  const consider = (from: number, to: number, landed: boolean) => {
    if (from > -Infinity && (to - from) / fps >= MIN_FLIGHT_S && (!best || to - from > best.to - best.from)) best = { from, to, landed };
  };
  for (const c of contacts) {
    if (c.downAt > busyUntil) consider(busyUntil, c.downAt, true);
    busyUntil = max(busyUntil, c.upAt);
  }
  consider(busyUntil, end, false);
  return best;
}

/** Which side faces the camera: the right side when the athlete runs towards the picture's clockwise side of up. */
function nearSideOf(run: Pt, up: Pt): Side {
  return dot(run, { x: -up.y, y: up.x }) > 0 ? 'right' : 'left';
}

const measured = (key: MetricKey, value: number, error: number): Measured => ({ value, error, status: error <= PASS_LINE[key] ? 'ok' : 'imprecise' });

/**
 * Analyses a run-up jump. Problems with the clip come back as `{ ok: false, problem }`; only a programming error throws.
 */
export function analyseTechnique(input: TechniqueInput): { ok: true; result: TechniqueResult } | { ok: false; problem: TechniqueProblem } {
  const { frames, captureFps: fps, markers } = input;
  const flags: QualityFlag[] = [];
  const picked = pickAthlete(frames, input.target);
  const found = picked.filter(Boolean).length;
  if (found < max(10, 0.5 * frames.length)) return { ok: false, problem: 'no-athlete' };
  if (found < 0.95 * frames.length) flags.push('gaps');

  // Rough scale for thresholds (m/px): the markers, or a leg (hip to ankle) of about 0.9 m.
  const legPx = median(picked.flatMap((p) => (p ? [hypot(p[LM.leftHip].x - p[LM.leftAnkle].x, p[LM.leftHip].y - p[LM.leftAnkle].y)] : [])));
  const markerPx = markers ? hypot(markers.b.x - markers.a.x, markers.b.y - markers.a.y) : null;
  // Lines 3 m apart are over three legs apart in the picture: less than one, and both were tapped on the same tape.
  if (markerPx != null && markerPx < legPx) return { ok: false, problem: 'markers' };
  const markerScale = markers && markerPx ? markers.distanceM / markerPx : null;
  const roughScale = markerScale ?? 0.9 / max(1, legPx);

  // Up, then the running direction along the floor, and the side that faces the camera.
  let up = upFrom(picked, markers);
  const runDir = (() => {
    const known = picked.flatMap((p) => (p ? [hipCentre(p)] : []));
    const half = known.slice(0, max(2, known.length >> 1));
    const d = sub(half[half.length - 1], half[0]);
    const across = { x: -up.y, y: up.x };
    return dot(d, across) >= 0 ? across : { x: up.y, y: -up.x };
  })();
  const near = nearSideOf(runDir, up);
  // The model may have the sides the wrong way round throughout, not just for a few frames: the side it takes to be
  // nearer the camera has to be the one the running direction puts there.
  let { poses: athlete } = unswap(picked);
  if (labelledNearSide(athlete) !== near) athlete = athlete.map((p) => (p ? swapSides(p) : null));

  let frame: Frame = { origin: markers ? markers.a : { x: 0, y: 0 }, xAxis: runDir, up };
  const maxGap = round(0.05 * fps);
  let s = seriesOf(athlete, frames, frame, maxGap);
  let traces = footTraces(s, fps, roughScale);
  // The floor under a spot comes from the feet within a metre of it, and is within 10 cm of the line through them all.
  const nearPx = 1 / roughScale;
  const offPx = 0.1 / roughScale;
  const floor0 = fitFloor(traces, nearPx, offPx);
  if (!floor0) return { ok: false, problem: 'no-plant' };
  // How far the frame is turned to level the floor (rad); none with markers, whose line is the floor.
  const releveled = !markers && abs(floor0.c1) > 1e-3 ? Math.atan(abs(floor0.c1)) : 0;
  if (releveled) {
    // A tilted phone: turn the frame so the floor is level, and read everything again.
    const along = unit({ x: frame.xAxis.x + floor0.c1 * frame.up.x, y: frame.xAxis.y + floor0.c1 * frame.up.y });
    up = { x: along.y, y: -along.x };
    if (dot(up, frame.up) < 0) up = { x: -up.x, y: -up.y };
    frame = { origin: frame.origin, xAxis: along, up };
    s = seriesOf(athlete, frames, frame, maxGap);
    traces = footTraces(s, fps, roughScale);
  }
  const floor = fitFloor(traces, nearPx, offPx) ?? floor0;
  const contacts = contactsOf(traces, s, floor, fps, roughScale);
  const flight = flightOf(contacts, s, fps);
  if (!flight) return { ok: false, problem: 'no-jump' };
  const landing = flight.landed ? ceil(flight.to - 1e-6) : null;
  if (!flight.landed) flags.push('cut-off');

  // The plant: the contacts that end at take-off (within a couple of frames: feet rarely leave on the same frame).
  const slack = max(2, 0.015 * fps);
  const plant = contacts.filter((c) => c.upAt <= flight.from + 1e-6 && c.upAt >= flight.from - slack);
  if (!plant.length) return { ok: false, problem: 'no-plant' };
  // Take-off is the last foot up; two feet that leave together (within their errors) time it together.
  const lastOff = plant.reduce((a, b) => (b.upAt > a.upAt ? b : a));
  const otherOff = plant.find((c) => c.foot !== lastOff.foot && Number.isFinite(c.upErr) && Number.isFinite(lastOff.upErr));
  const off =
    otherOff && lastOff.upAt - otherOff.upAt <= hypot(lastOff.upErr, otherOff.upErr)
      ? together({ t: lastOff.upAt, err: lastOff.upErr }, { t: otherOff.upAt, err: otherOff.upErr })
      : { t: lastOff.upAt, err: lastOff.upErr };
  const takeoffAt = off.t;
  const takeoff = ceil(takeoffAt - 1e-6);
  const sides = new Set(plant.map((c) => c.foot));
  const style = { kind: sides.size === 2 ? ('two' as const) : ('one' as const), foot: sides.size === 2 ? null : plant[0].foot };
  const firstPlant = plant.reduce((a, b) => (b.downAt < a.downAt ? b : a));
  const plantDownAt = firstPlant.downAt;
  const plantDown = firstPlant.down;
  // The step before the plant is the other foot's; the same foot again means the model lost a contact in between.
  const before = contacts.filter((c) => c.upAt <= plantDownAt + 1e-6 && !plant.includes(c)).at(-1);
  const penultimate = before && before.foot !== firstPlant.foot && (plantDownAt - before.upAt) / fps < 0.3 ? before : null;
  if (style.kind === 'one' && style.foot !== near) flags.push('far-foot');
  if (fps < MIN_CONTACT_FPS) flags.push('low-fps');

  // A run-up that comes at the camera: the body's size in the picture changes along it, and so does the scale.
  const sizes = athlete.flatMap((p, i) => (p && s.frame[i] < plantDownAt ? [bodySize(p)] : []));
  let sizeChange = 0;
  if (sizes.length > 10) {
    const third = max(2, Math.floor(sizes.length / 3));
    sizeChange = abs(median(sizes.slice(-third)) / median(sizes.slice(0, third)) - 1);
    if (sizeChange > 0.06) flags.push('curved');
  }

  // --- Flight parabola, on the raw centre of mass (the fit does the smoothing; a filter would bend the take-off).
  // Time runs from take-off, s.
  const fitRange = (toFrame: number) => {
    const ts: number[] = [];
    const ys: number[] = [];
    const xs: number[] = [];
    athlete.forEach((p, i) => {
      const f = s.frame[i];
      if (!p || f <= takeoffAt || f >= toFrame) return;
      const c = toWorld(frame, centreOfMass(p));
      ts.push((f - takeoffAt) / fps);
      ys.push(c.y);
      xs.push(c.x);
    });
    return { ts, ys, xs };
  };
  // Stop 30 ms short of the landing: the legs reach for the floor before the feet touch it, and the touch-down's own
  // timing is a frame or two out.
  const all = fitRange(flight.landed ? flight.to - max(2, 0.03 * fps) : flight.to);
  if (all.ts.length < 8) return { ok: false, problem: 'no-jump' };
  // Free fall lasts until the path leaves the parabola: a hand on the rim stops it, around the top. Each 50 ms stretch
  // from 0.15 s after take-off (no rim is reached sooner) to 0.2 s past the top is checked against the parabola fitted
  // to everything before it; the first whose mean is off the fit by more than four SDs (its jitter's and the fit's own
  // at that time) and by more than a centimetre shows where it stopped. It stopped a little before: the path only
  // drifts off the parabola by degrees, so the fit ends half a stretch earlier.
  const block = max(6, round(0.05 * fps));
  const start = max(8, all.ts.filter((t) => t <= 0.15).length);
  // The jitter, from the whole flight rather than the few points before a stretch: at 60 fps the first fits rest on
  // a dozen points, whose own scatter can come out small enough by chance to make plain jitter look like a hang.
  const jitter = flightJitter(all.ts, all.ys, fps);
  let n = all.ts.length;
  for (let m = start; m + block <= all.ts.length; m++) {
    const f = polyFit(all.ts.slice(0, m), all.ys.slice(0, m), 2);
    if (f.c[2] < 0 && all.ts[m] > -f.c[1] / (2 * f.c[2]) + 0.2) break;
    let sum = 0;
    for (let j = m; j < m + block; j++) sum += all.ys[j] - (f.c[0] + f.c[1] * all.ts[j] + f.c[2] * all.ts[j] ** 2);
    const tm = (all.ts[m] + all.ts[m + block - 1]) / 2;
    const p = [1, tm, tm * tm];
    const sd = max(f.sd, jitter);
    // The fit's covariance scales with the jitter it assumed.
    const predVar = p.reduce((acc, pi, i) => acc + pi * p.reduce((a2, pj, j) => a2 + f.cov[i][j] * pj, 0), 0) * (f.sd > 0 ? (sd / f.sd) ** 2 : 1);
    if (abs(sum / block) > max(4 * sqrt(sd ** 2 / block + predVar), 0.01 / roughScale)) {
      n = max(start, m - (block >> 1));
      flags.push('hang');
      break;
    }
  }
  const pts = { ts: all.ts.slice(0, n), ys: all.ys.slice(0, n), xs: all.xs.slice(0, n) };
  const fy = polyFit(pts.ts, pts.ys, 2);
  const fx = polyFit(pts.ts, pts.xs, 1);
  const curvature = -2 * fy.c[2];
  if (!(curvature > 0)) return { ok: false, problem: 'no-jump' };
  const gravityScale = G / curvature;
  const gravityScaleRel = (2 * fy.se[2]) / curvature;
  const gWithMarkers = markerScale != null ? curvature * markerScale : null;
  if (markerScale != null) {
    const r = gravityScale / markerScale;
    if (abs(r - 1) > SCALE_BROKEN) flags.push('scale-broken');
    else if (abs(r - 1) > SCALE_MISMATCH) flags.push('off-line');
  } else flags.push('no-markers');

  // Velocities at take-off. vz = g·(time from take-off to the top), so it rests on the take-off's timing, plus the
  // fit's own uncertainty about the top.
  const tApex = fy.c[1] / curvature;
  const vz = G * tApex;
  const seApex = sqrt((fy.se[1] / curvature) ** 2 + ((fy.c[1] * 2 * fy.se[2]) / (curvature * curvature)) ** 2);
  const span = pts.ts[pts.ts.length - 1] - pts.ts[0];
  const drift = COM_DRIFT_M / span;
  const vx = fx.c[1] * gravityScale;
  // Which way is up, to 1 SD (rad). Two lines each tapped to `TAP_PX`: one a little high or low tilts it. Without lines,
  // a run-up that comes at the camera makes the floor drop towards the lens, and still feet hanging from the rim sit
  // above it: either way the floor fit can't be told from a tilted phone, so its whole turn is in doubt.
  const tilt = markerPx != null ? (sqrt(2) * TAP_PX) / markerPx : flags.includes('curved') || flags.includes('hang') ? releveled : 0;
  // A tilt θ adds θ·vx to the vertical take-off velocity, and θ·(vz − g·t̄) to the horizontal one, t̄ the middle of the
  // fitted stretch: nothing over a whole flight, whose rise and fall cancel, but not so when the fit stops at a hang.
  const tMid = (pts.ts[0] + pts.ts[pts.ts.length - 1]) / 2;
  const vzErr = sqrt((G * off.err) ** 2 / fps ** 2 + (G * 1.96 * seApex) ** 2 + drift ** 2 + (1.96 * tilt * vx) ** 2);
  const vxErr = sqrt((1.96 * fx.se[1] * gravityScale) ** 2 + (vx * 1.96 * gravityScaleRel) ** 2 + drift ** 2 + (1.96 * tilt * (vz - G * tMid)) ** 2);
  const angle = (atan2(vz, vx) * 180) / PI;
  // The two velocities' errors added outright, not in quadrature: both lean on the same fit, and a take-off timed early
  // pulls them the same way.
  const angleErr = (((vx * vzErr + vz * vxErr) / (vx * vx + vz * vz)) * 180) / PI;
  const metrics: Partial<Record<MetricKey, Measured>> = {
    vz: measured('vz', vz, vzErr),
    vx: measured('vx', vx, vxErr),
    angle: measured('angle', angle, angleErr),
  };

  // --- Ground contacts, to a fraction of a frame.
  const ms = (frames: number) => (frames / fps) * 1000;
  metrics.plant = measured('plant', ms(takeoffAt - plantDownAt), ms(hypot(firstPlant.downErr, off.err)));
  if (style.kind === 'two') {
    const [a, b] = [...plant].sort((x, y) => x.downAt - y.downAt);
    metrics.gap = measured('gap', ms(b.downAt - a.downAt), ms(hypot(a.downErr, b.downErr)));
  }
  const floorScale = markerScale ?? gravityScale;
  if (penultimate) {
    const step = abs(firstPlant.toeX - penultimate.toeX) * floorScale;
    // Each toe's place (a median over its stance); the feet stand a hand's breadth either side of the line the scale
    // holds for, which moves a toe a few metres off the picture's middle by up to 3 cm; and the scale itself.
    const scaleRel = markerScale != null ? 0.01 : 1.96 * gravityScaleRel;
    const toes = hypot(firstPlant.toeErr, penultimate.toeErr) * floorScale;
    metrics.step = measured('step', step, sqrt(toes ** 2 + 0.03 ** 2 + (step * (scaleRel + sizeChange)) ** 2));
  }

  // --- Run-up speed: the time the hips take between the markers.
  if (markers) {
    const hx = smoothSeries(s.hip.x, fps, 10);
    // When the hips cross a line (s), and how fast they go there (px/s).
    const crossing = (x: number) => {
      for (let i = 1; i < hx.length; i++) {
        if (Number.isNaN(hx[i - 1]) || Number.isNaN(hx[i])) continue;
        if ((hx[i - 1] - x) * (hx[i] - x) <= 0 && hx[i] !== hx[i - 1]) {
          const df = s.frame[i] - s.frame[i - 1];
          return { t: (s.frame[i - 1] + ((x - hx[i - 1]) / (hx[i] - hx[i - 1])) * df) / fps, speed: (abs(hx[i] - hx[i - 1]) * fps) / df };
        }
      }
      return null;
    };
    const ca = crossing(toWorld(frame, markers.a).x);
    const cb = crossing(toWorld(frame, markers.b).x);
    if (ca && cb && cb.t !== ca.t) {
      const dt = abs(cb.t - ca.t);
      const v = markers.distanceM / dt;
      // Each crossing's place: the jitter a 10 Hz filter leaves (white noise keeps 2·10/fps of its variance), and the
      // tap (`TAP_PX`). Its time: that over the hips' speed there, which at the take-off line is the plant's, about
      // half the run-up's.
      const jitter = median(s.hip.x.flatMap((x, i) => (Number.isNaN(x) || Number.isNaN(hx[i]) ? [] : [abs(x - hx[i])]))) * 1.4826;
      const sdPx = hypot(jitter * sqrt((2 * 10) / fps), TAP_PX);
      const rel = hypot(sdPx / max(1, ca.speed), sdPx / max(1, cb.speed)) / dt;
      // A run-up at an angle to the picture is foreshortened, by about as much as the body's size changes along it.
      metrics.approach = measured('approach', v, v * hypot(1.96 * rel, sizeChange));
    }
  }

  // --- Braking in the plant: horizontal speed coming in (over the last airborne stretch before it, kept clear of both
  // contacts by their errors) minus at take-off.
  if (penultimate && Number.isFinite(penultimate.upErr) && Number.isFinite(firstPlant.downErr)) {
    const ts: number[] = [];
    const xs: number[] = [];
    s.frame.forEach((f, i) => {
      if (f > penultimate.upAt + penultimate.upErr + 1 && f < plantDownAt - firstPlant.downErr - 1 && !Number.isNaN(s.com.x[i])) {
        ts.push(f / fps);
        xs.push(s.com.x[i]);
      }
    });
    if (ts.length >= 4) {
      const fin = polyFit(ts, xs, 1);
      const vin = fin.c[1] * floorScale;
      // The fit, the segment model's drift over this short stretch, and a run-up that comes at the camera.
      const vinErr = sqrt((1.96 * fin.se[1] * floorScale) ** 2 + (COM_DRIFT_M / (ts[ts.length - 1] - ts[0])) ** 2 + (vin * sizeChange) ** 2);
      metrics.brake = measured('brake', vin - vx, hypot(vinErr, vxErr));
    }
  }

  // --- Joint angles in the plant, on lightly smoothed landmarks (12 Hz, the usual cut-off for jumping kinematics).
  const leg: Side = style.kind === 'one' && style.foot ? style.foot : near;
  const angleSeries = (fn: (p: Pose) => number) => smoothSeries(athlete.map((p) => (p ? fn(p) : NaN)), fps, 12);
  const knee = angleSeries((p) => jointAngle(p[SIDE[leg].hip], p[SIDE[leg].knee], p[SIDE[leg].ankle]));
  const inPlant = s.frame.flatMap((f, i) => (f >= plantDownAt && f < takeoffAt && !Number.isNaN(knee[i]) ? [knee[i]] : []));
  if (inPlant.length) metrics.knee = measured('knee', min(...inPlant), KNEE_ERROR_DEG);
  // Trunk at the plant's first touch: positive leans back, away from the run.
  const lean = angleSeries((p) => {
    const sh = toWorld(frame, mid(p[LM.leftShoulder], p[LM.rightShoulder]));
    const hp = toWorld(frame, hipCentre(p));
    return (atan2(-(sh.x - hp.x), sh.y - hp.y) * 180) / PI;
  });
  const at = s.frame.indexOf(plantDown);
  // Only at a touch it saw: one before the clip's first frame has no lean to state.
  if (at >= 0 && !Number.isNaN(lean[at])) metrics.trunk = measured('trunk', lean[at], Number.isFinite(firstPlant.downErr) ? TRUNK_ERROR_DEG : Infinity);

  // Scales off by more than a wrong frame rate or a wrong tap could explain: no figure is one to trust.
  if (flags.includes('scale-broken')) for (const m of Object.values(metrics)) m!.status = 'imprecise';

  // A figure resting on a moment that couldn't be timed has no error to state (and JSON would save an endless one as
  // null): it is left out, and the flag says why.
  for (const k of Object.keys(metrics) as MetricKey[]) {
    if ([metrics[k]!.value, metrics[k]!.error].every(Number.isFinite)) continue;
    delete metrics[k];
    if (!flags.includes('unseen')) flags.push('unseen');
  }

  return {
    ok: true,
    result: {
      style,
      events: { plantDown, takeoff, landing },
      contacts,
      penultimate,
      metrics,
      scale: { markers: markerScale, gravity: gravityScale, gravityWithMarkers: gWithMarkers },
      flags,
      nearSide: near,
      athlete,
      com: athlete.map((p) => (p ? centreOfMass(p) : null)),
    },
  };
}

/** Frames to read closely around the highest jump of a coarse pass, or null when nothing looks like a jump. */
export function findJumpWindow(
  frames: PoseFrame[],
  fps: number,
  opts: { before: number; after: number; target?: Pt | null },
): { from: number; to: number; target: Pt } | null {
  const track = pickAthlete(frames, opts.target);
  const known = track.flatMap((p, i) => (p ? [{ i, p }] : []));
  if (known.length < 5) return null;
  const up = upFrom(track, null);
  const h = known.map(({ p }) => dot(centreOfMass(p), up));
  const size = median(known.map(({ p }) => bodySize(p)));
  const base = median(h);
  let top = 0;
  h.forEach((v, k) => {
    if (v > h[top]) top = k;
  });
  // A jump lifts the centre of mass by a good part of a leg; running bobs it by a few cm.
  if (h[top] - base < 0.15 * size) return null;
  const apex = frames[known[top].i].frame;
  return { from: max(0, Math.floor(apex - opts.before * fps)), to: Math.ceil(apex + opts.after * fps), target: hipCentre(known[top].p) };
}

export { toPicture as worldToPicture };
