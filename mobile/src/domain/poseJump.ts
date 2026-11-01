/**
 * Finds the jumps in a clip from the athlete's skeleton, for when the strip under the feet (domain/autoMark.ts) can't
 * be read on its own. The strip pass watches one band of the picture at one height. With the phone higher than the
 * ankles, an athlete who lands a little nearer it than they took off lands lower in the picture, and a band placed for
 * one of the two misses the other (the clip that started this, 2026-10-31: 8 % of the picture lower, about as far as
 * the jump was high in it). The pose model (media/poseReaderHtml.ts) finds the athlete wherever they are; what it can't
 * do is time a take-off to the frame (its feet wobble by a centimetre or two), so this pass says roughly when each
 * flight is and where the feet stood before and after it, and the strip pass then times each event there.
 *
 * 1. The athlete: the person the pose model followed (or the one tapped), left and right put back where it swapped them.
 * 2. Standing: runs of samples, at least `STANCE_S` long, in which the lowest foot point (heel or toe) stays within
 *    `STILL_LEG` of one height, and which aren't the top of a flight (where the feet slow to a stop too, but are lower
 *    in the picture just before and after). Each run is a floor level; between two runs the floor is taken to move
 *    steadily from one to the other, which is how it looks when the athlete drifts towards or away from the phone.
 * 3. In the air or not, sample by sample: the lowest foot point more than `AIR_LEG` above the floor there is in the air,
 *    back below `DOWN_LEG` it is down (between the two it stays as it was, so jitter at one height can't flip it). A run
 *    in the air with ground on both sides, as long as a jump's flight and lifting the feet at least `JUMP_LIFT_LEG` at
 *    its top, is a jump; a run-up's strides lift the lower foot only a few cm.
 *
 * Lengths are in leg lengths (hip to ankle, the 80th percentile over the clip so a squat doesn't shorten it): about
 * 0.49 of standing height in Drillis & Contini's proportions (hip 0.53, ankle 0.039; Winter, "Biomechanics and Motor
 * Control of Human Movement", fig. 4.1), so 0.1 leg is about 9 cm for a 1.80 m athlete.
 */
import { MAX_CONTACT_S } from './dropJump';
import { MAX_FLIGHT_S, MIN_FLIGHT_S } from './jump';
import { dist, LM, SIDE, type Pose, type Pt } from './pose';
import { pickAthlete, unswap, type PoseFrame } from './technique';

const { abs, ceil, max, min, round } = Math;

/** Pose readings per real second in the coarse pass (twice that for repeated jumps), and the most from one clip. */
export const POSE_COARSE_HZ = 30;
export const POSE_COARSE_MAX = 300;

/** In the air above this many leg lengths (≈ 7 cm), back down below this (≈ 3.5 cm). */
export const AIR_LEG = 0.08;
export const DOWN_LEG = 0.04;
/** A flight is a jump when the lowest foot gets at least this high (≈ 9 cm) at its top. */
export const JUMP_LIFT_LEG = 0.1;
/** Standing: the lowest foot point within this (≈ 3.5 cm, the pose model's wobble and then some) for this long (s). */
export const STILL_LEG = 0.04;
export const STANCE_S = 0.08;
/** Leg length over standing height (hip 0.53 − ankle 0.039 of stature). */
export const LEG_OF_STATURE = 0.49;
/** Samples with no pose for longer than this (s) break a run: nobody knows what the feet did in between. */
const MAX_GAP_S = 0.2;
/** How far either side of a still run (s) to look for the feet lower in the picture: the top of a flight. */
const APEX_LOOK_S = 0.1;

export type PoseJumpKind = 'jump' | 'drop';

export type PoseJumpProblem =
  /** Nobody the pose model kept hold of for long enough. */
  | 'no-athlete'
  /** The athlete, but no flight that could be a jump. */
  | 'no-jump';

/**
 * Two file frames read either side of an event: for a take-off the last with a foot within `DOWN_LEG` of the floor and
 * the first above `AIR_LEG`, for a landing (or touch-down) the last above `DOWN_LEG` and the first back within it. A
 * foot up to 3.5 cm off the floor still reads as down, and at take-off or landing speed (about 2 m/s) it covers that in
 * under 1/30 s, so the event can lie that far outside them: the strip pass looks further beyond.
 */
export type Bracket = [number, number];

/** Where the feet stood around an event, video px: the floor's row there, the left and rightmost heel or toe, and the athlete's standing height at that distance from the lens. */
export type Spot = { y: number; left: number; right: number; stature: number };

export type PoseEvent = { at: Bracket; spot: Spot };

export type PoseFlight = {
  /** A drop jump's touch-down after the drop off the box. */
  touchdown?: PoseEvent;
  takeoff: PoseEvent;
  landing: PoseEvent;
};

/** The frames the coarse pose pass reads: the whole stretch at `POSE_COARSE_HZ` of real time, at most `POSE_COARSE_MAX`. */
export function poseCoarseFrames(v: { frames: number; captureFps: number }, opts: { range?: { from: number; to: number }; rebound?: boolean } = {}): number[] {
  const from = max(0, opts.range?.from ?? 0);
  const to = min(v.frames - 1, opts.range?.to ?? v.frames - 1);
  let step = max(1, round(v.captureFps / (POSE_COARSE_HZ * (opts.rebound ? 2 : 1))));
  if ((to - from + 1) / step > POSE_COARSE_MAX) step = ceil((to - from + 1) / POSE_COARSE_MAX);
  const out: number[] = [];
  for (let f = from; f <= to; f += step) out.push(f);
  return out;
}

const FOOT_POINTS = [SIDE.left.heel, SIDE.left.toe, SIDE.right.heel, SIDE.right.toe];

/** The lowest heel or toe in the picture (largest y). */
function lowestFoot(p: Pose): Pt {
  let best = p[FOOT_POINTS[0]];
  for (const i of FOOT_POINTS) if (p[i].y > best.y) best = p[i];
  return best;
}

function legOf(p: Pose): number {
  return (dist(p[LM.leftHip], p[LM.leftAnkle]) + dist(p[LM.rightHip], p[LM.rightAnkle])) / 2;
}

function quantile(xs: number[], q: number): number {
  const s = [...xs].sort((a, b) => a - b);
  return s[min(s.length - 1, max(0, round(q * (s.length - 1))))];
}

type Sample = { frame: number; t: number; p: Pose; foot: Pt };
type Run = { a: number; b: number; y: number };

/**
 * The runs of samples in which the athlete stands: the lowest foot point within `still` px of one height for at least
 * `STANCE_S`, unless the feet are lower in the picture (by more than that) on both sides of it, which is the top of a
 * flight. Each run's floor is its median height.
 */
export function stanceRuns(s: { t: number; y: number }[], still: number): Run[] {
  const runs: Run[] = [];
  let i = 0;
  while (i < s.length) {
    let lo = s[i].y;
    let hi = s[i].y;
    let j = i;
    while (j + 1 < s.length && s[j + 1].t - s[j].t <= MAX_GAP_S && max(hi, s[j + 1].y) - min(lo, s[j + 1].y) <= still) {
      j++;
      lo = min(lo, s[j].y);
      hi = max(hi, s[j].y);
    }
    if (j - i >= 2 && s[j].t - s[i].t >= STANCE_S - 1e-9) {
      const y = quantile(
        s.slice(i, j + 1).map((q) => q.y),
        0.5,
      );
      const lowerAt = (k: number, dir: number) => {
        for (let m = k + dir; m >= 0 && m < s.length && abs(s[m].t - s[k].t) <= APEX_LOOK_S; m += dir) if (s[m].y > y + still) return true;
        return false;
      };
      if (!(lowerAt(i, -1) && lowerAt(j, 1))) runs.push({ a: i, b: j, y });
    }
    i = j + 1;
  }
  return runs;
}

/** The floor's height at each sample: its run's where it stands, moving steadily from one run to the next between them. */
function floorLevels(s: { t: number }[], runs: Run[]): number[] {
  return s.map((q, k) => {
    const after = runs.findIndex((r) => r.b >= k);
    if (after < 0) return runs[runs.length - 1].y;
    const r = runs[after];
    if (k >= r.a || after === 0) return r.y;
    const prev = runs[after - 1];
    const u = (q.t - s[prev.b].t) / (s[r.a].t - s[prev.b].t);
    return prev.y + (r.y - prev.y) * u;
  });
}

/**
 * The jumps in a coarse pose pass, or why there are none. `frames` are the pass's frames in file order; `captureFps`
 * turns file frames into real time. A drop jump's flight must follow a short contact that itself follows the drop off
 * the box.
 */
export function findPoseJumps(
  frames: PoseFrame[],
  captureFps: number,
  opts: { kind: PoseJumpKind; target?: Pt | null },
): { ok: true; flights: PoseFlight[] } | { ok: false; problem: PoseJumpProblem } {
  const track = unswap(pickAthlete(frames, opts.target)).poses;
  const known: Sample[] = track.flatMap((p, i) => (p ? [{ frame: frames[i].frame, t: frames[i].frame / captureFps, p, foot: lowestFoot(p) }] : []));
  if (known.length < 8) return { ok: false, problem: 'no-athlete' };
  const leg = quantile(
    known.map(({ p }) => legOf(p)),
    0.8,
  );
  if (!(leg > 0)) return { ok: false, problem: 'no-athlete' };

  const runs = stanceRuns(
    known.map((q) => ({ t: q.t, y: q.foot.y })),
    STILL_LEG * leg,
  );
  if (!runs.length) return { ok: false, problem: 'no-jump' };
  const floor = floorLevels(known, runs);
  const lift = known.map((q, k) => (floor[k] - q.foot.y) / leg);

  // Down or up, with hysteresis; the first sample is down unless clearly up.
  const up: boolean[] = [];
  lift.forEach((h, i) => {
    const before = i > 0 ? up[i - 1] : h > AIR_LEG;
    up.push(before ? h > DOWN_LEG : h > AIR_LEG);
  });
  const gapAfter = (i: number) => known[i + 1].t - known[i].t > MAX_GAP_S;

  /** Where the feet stood in the run of standing nearest sample k on the given side. */
  const spotNear = (k: number, dir: -1 | 1): Spot => {
    const cands = dir < 0 ? runs.filter((r) => r.a <= k) : runs.filter((r) => r.b >= k);
    const r = dir < 0 ? cands[cands.length - 1] : cands[0];
    const from = r ? r.a : k;
    const to = r ? r.b : k;
    let left = Infinity;
    let right = -Infinity;
    const legs: number[] = [];
    for (let m = from; m <= to; m++) {
      const p = known[m].p;
      legs.push(legOf(p));
      for (const pi of FOOT_POINTS) {
        if (abs(p[pi].y - (r ? r.y : known[m].foot.y)) > 2 * STILL_LEG * leg) continue;
        left = min(left, p[pi].x);
        right = max(right, p[pi].x);
      }
    }
    if (!(right >= left)) left = right = known[k].foot.x;
    // The leg there, straight: a squat shortens it, so the longest of the run's, or the clip's where the run is short.
    const local = max(...legs);
    return { y: r ? r.y : known[k].foot.y, left, right, stature: max(local, legs.length >= 3 ? local : leg) / LEG_OF_STATURE };
  };

  const flights: PoseFlight[] = [];
  let i = 0;
  while (i < known.length) {
    if (!up[i] || i === 0 || up[i - 1]) {
      i++;
      continue;
    }
    let j = i;
    let broken = gapAfter(i - 1);
    while (j + 1 < known.length && up[j + 1]) {
      if (gapAfter(j)) broken = true;
      j++;
    }
    const a = i;
    i = j + 1;
    if (j + 1 >= known.length || broken || gapAfter(j)) continue;
    // Between the last frame read down and the first read down again, the flight is no longer than that and no
    // shorter than from the first to the last read in the air.
    const longest = known[j + 1].t - known[a - 1].t;
    const shortest = known[j].t - known[a].t;
    if (longest < MIN_FLIGHT_S || shortest > MAX_FLIGHT_S) continue;
    if (max(...lift.slice(a, j + 1)) < JUMP_LIFT_LEG) continue;
    // Back from the first sample up to the last within `DOWN_LEG`: one between the two thresholds may be up already.
    let last = a - 1;
    while (last > 0 && lift[last] > DOWN_LEG && !up[last - 1]) last--;
    const flight: PoseFlight = {
      takeoff: { at: [known[last].frame, known[a].frame], spot: spotNear(last, -1) },
      landing: { at: [known[j].frame, known[j + 1].frame], spot: spotNear(j + 1, 1) },
    };
    if (opts.kind === 'drop') {
      // The contact before the take-off: the last run of standing that starts before it, which must come after the
      // athlete stood higher (on the box) and be short. Falling feet are fast, so the run starts at the touch-down.
      const k = runs.findLastIndex((r) => r.a <= last);
      const contact = runs[k];
      if (!contact || k === 0 || runs[k - 1].y > contact.y - AIR_LEG * leg) continue;
      if (contact.a === 0 || known[a].t - known[contact.a - 1].t > MAX_CONTACT_S) continue;
      flight.touchdown = { at: [known[contact.a - 1].frame, known[contact.a].frame], spot: spotNear(contact.a, 1) };
    }
    flights.push(flight);
  }
  if (!flights.length) return { ok: false, problem: 'no-jump' };
  return { ok: true, flights };
}

/**
 * Where to start following the athlete when nobody tapped them: the biggest person (longest legs) in the first frame
 * of `frames` that has anyone who can be them, at their hips. Bystanders in a jump test stand further back than the
 * athlete, who was framed to fill the picture. Who can't be them: a reading with the ankles above the hips (the model
 * can see a "person" upside down in a dark, cluttered picture) and, given the picture's size, anyone whose hips or
 * ankles are outside it (a scrap at the edge, or the athlete walking up to the phone at the start of an uncut clip).
 */
export function startFrom(frames: PoseFrame[], picture?: { width: number; height: number }): { frame: number; at: Pt } | null {
  const POINTS = [LM.leftHip, LM.rightHip, LM.leftAnkle, LM.rightAnkle];
  const inside = (p: Pose) => !picture || POINTS.every((i) => p[i].x >= 0 && p[i].x <= picture.width && p[i].y >= 0 && p[i].y <= picture.height);
  const upright = (p: Pose) => min(p[LM.leftAnkle].y, p[LM.rightAnkle].y) > (p[LM.leftHip].y + p[LM.rightHip].y) / 2;
  for (const f of frames) {
    const can = f.poses.filter((p) => upright(p) && inside(p));
    if (!can.length) continue;
    const p = can.reduce((a, b) => (legOf(b) > legOf(a) ? b : a));
    return { frame: f.frame, at: { x: (p[LM.leftHip].x + p[LM.rightHip].x) / 2, y: (p[LM.leftHip].y + p[LM.rightHip].y) / 2 } };
  }
  return null;
}

/** The coarse frames from `at` onwards and from `at` back (both start at the coarse frame nearest it, to lock on there). */
export function splitAt(frames: number[], at: number): { forward: number[]; backward: number[] } {
  if (!frames.length) return { forward: [], backward: [] };
  const k = frames.reduce((best, f, i) => (abs(f - at) < abs(frames[best] - at) ? i : best), 0);
  return { forward: frames.slice(k), backward: frames.slice(0, k + 1).reverse() };
}
