/**
 * How the technique screen reads a clip with the pose page (media/poseReaderHtml.ts): which frames, in which squares,
 * and how the page's answers become the analysis's input (domain/technique.ts).
 *
 * 1. A coarse pass at about 60 frames a second of real time, following the athlete from the frame they were tapped on,
 *    forwards to the end of the clip and backwards to its start.
 * 2. The jump in it (`findJumpWindow`).
 * 3. Around the jump, every frame the coarse pass skipped, each read in a square around where the coarse pass puts the
 *    athlete at that moment: between its frames, 1/60 s apart, a sprinting athlete moves about 10 cm, so their path
 *    there is near enough a straight line.
 */
import { decodePose, dist, LM, mid, type Pose, type Pt } from './pose';
import { findJumpWindow, pickAthlete, type PoseFrame, type TechniqueProblem } from './technique';

/** The coarse pass's rate, frames a second of real time. */
export const COARSE_HZ = 60;

/** The two floor markers along the run-up are this far apart (m): at the take-off spot, and 3 m back. */
export const MARKER_GAP_M = 3;

/**
 * What is read closely around the top of the jump, s of real time: before it, the last 3 m of a run-up as slow as
 * 4.5 m/s (0.67 s), the plant (about 0.2 s) and the rise (vz / g, 0.34 s at 3.3 m/s), with 0.4 s to spare for the
 * smoothing at the stretch's ends; after it, the fall and the landing's contact.
 */
export const JUMP_WINDOW = { before: 1.6, after: 0.8 };

/**
 * How far the coarse pass reads each way from the tapped frame, s of real time. The athlete is asked to tap themselves
 * near the take-off; a take filmed in the app also holds the walk back to the start of the run-up and back to the phone,
 * which isn't worth reading.
 */
export const TAP_REACH_S = 3;

/** A square of the picture, px: what the page reads a frame in. */
export type Square = { x: number; y: number; s: number };

/** A frame as the page sends it: file frame, its own time in the file when the browser says (else null), its people. */
export type WireFrame = [number, number | null, ...number[][]];

/** File frames between the coarse pass's reads: a slow-motion clip holds every frame captured. */
export function coarseStep(captureFps: number): number {
  return Math.max(1, Math.round(captureFps / COARSE_HZ));
}

/**
 * The coarse pass's frames, each way from the tapped frame `at` (both start there, so each can lock on to the tap), at
 * most `reach` frames away from it.
 */
export function coarseFrames(at: number, total: number, step: number, reach = Infinity): { forward: number[]; backward: number[] } {
  const forward: number[] = [];
  const backward: number[] = [];
  for (let f = at; f < total && f - at < reach; f += step) forward.push(f);
  for (let f = at; f >= 0 && at - f < reach; f -= step) backward.push(f);
  return { forward, backward };
}

/**
 * The page's frames as the analysis's, in file order, `t` in real time. A frame read twice (the tapped one, by both
 * halves of the coarse pass) keeps the reading with more people. A frame that shows the same picture as the one before
 * (the browser's own time for it unchanged) gets nobody: a clip recorded at an uneven rate, as the camera page's are,
 * can lack a frame, and the picture before it stands in for it.
 */
export function framesFromWire(items: WireFrame[], width: number, height: number, captureFps: number): PoseFrame[] {
  const sorted = [...items].sort((a, b) => a[0] - b[0]);
  const out: PoseFrame[] = [];
  let lastTime: number | null = null;
  for (const [frame, time, ...people] of sorted) {
    const poses = people.map((v) => decodePose(v, width, height));
    const prev = out[out.length - 1];
    if (prev?.frame === frame) {
      if (poses.length > prev.poses.length) prev.poses = poses;
      continue;
    }
    const repeat = time != null && time === lastTime;
    out.push({ frame, t: frame / captureFps, poses: repeat ? [] : poses });
    lastTime = time;
  }
  return out;
}

/** Thigh + shank + trunk, about 0.78 of standing height in any posture: the page's measure of a person (media/poseShared.ts). */
function bodyLength(p: Pose): number {
  const thigh = (dist(p[LM.leftHip], p[LM.leftKnee]) + dist(p[LM.rightHip], p[LM.rightKnee])) / 2;
  const shank = (dist(p[LM.leftKnee], p[LM.leftAnkle]) + dist(p[LM.rightKnee], p[LM.rightAnkle])) / 2;
  const hip = mid(p[LM.leftHip], p[LM.rightHip]);
  return thigh + shank + dist(mid(p[LM.leftShoulder], p[LM.rightShoulder]), hip);
}

/** The page's square around a person: 2.7 lengths (about 2.1 statures) across, centred a little above the hips. */
export function squareAround(hip: Pt, length: number): Square {
  const s = 2.7 * length;
  return { x: hip.x - s / 2, y: hip.y - 0.4 * length - s / 2, s };
}

/**
 * The square to read each of `frames` in, from where the coarse pass found the athlete (the person nearest `target`,
 * the tap): between two of its frames along the line from one to the other, before or after them where it ends.
 * Throws when the coarse pass never found the athlete: the window comes from that pass, so that is a bug.
 */
export function denseSquares(coarse: PoseFrame[], target: Pt, frames: number[]): Square[] {
  const athlete = pickAthlete(coarse, target);
  const path = coarse.flatMap((f, i) => {
    const p = athlete[i];
    return p ? [{ frame: f.frame, hip: mid(p[LM.leftHip], p[LM.rightHip]), length: bodyLength(p) }] : [];
  });
  if (!path.length) throw new Error('denseSquares: the coarse pass never found the athlete');
  // Lengths vary a little frame to frame with the model's jitter: the median keeps the square steady.
  const lengths = path.map((q) => q.length).sort((a, b) => a - b);
  const length = lengths[lengths.length >> 1];
  return frames.map((f) => {
    let j = path.findIndex((q) => q.frame >= f);
    if (j < 0) j = path.length - 1;
    const b = path[j];
    const a = j > 0 ? path[j - 1] : b;
    const u = b.frame === a.frame ? 0 : Math.max(0, Math.min(1, (f - a.frame) / (b.frame - a.frame)));
    return squareAround({ x: a.hip.x + (b.hip.x - a.hip.x) * u, y: a.hip.y + (b.hip.y - a.hip.y) * u }, length);
  });
}

/**
 * The stretch around the jump to read closely, from the coarse pass and the tap (`JUMP_WINDOW`), or why there is none:
 * the page never found the athlete, or they didn't jump in the stretch read.
 */
export function planWindow(
  coarse: PoseFrame[],
  fps: number,
  target: Pt,
): { ok: true; win: { from: number; to: number; target: Pt } } | { ok: false; problem: Extract<TechniqueProblem, 'no-athlete' | 'no-jump'> } {
  // findJumpWindow needs five frames of the athlete too, but can't say which of the two went wrong.
  if (pickAthlete(coarse, target).filter(Boolean).length < 5) return { ok: false, problem: 'no-athlete' };
  const win = findJumpWindow(coarse, fps, { ...JUMP_WINDOW, target });
  return win ? { ok: true, win } : { ok: false, problem: 'no-jump' };
}

/** The frames in the jump's window the coarse pass hasn't read, in file order. */
export function denseFrames(win: { from: number; to: number }, total: number, read: Iterable<number>): number[] {
  const done = new Set(read);
  const out: number[] = [];
  for (let f = Math.max(0, win.from); f <= Math.min(total - 1, win.to); f++) if (!done.has(f)) out.push(f);
  return out;
}

/** The frames of a window, every one of them, from everything read: the analysis's input. */
export function windowOf(frames: PoseFrame[], win: { from: number; to: number }): PoseFrame[] {
  return frames.filter((f) => f.frame >= win.from && f.frame <= win.to);
}
