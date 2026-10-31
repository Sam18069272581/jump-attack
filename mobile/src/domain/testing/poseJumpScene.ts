/**
 * A synthetic jump test as the pose model would report it: a standing athlete (testing/standing.ts) who sinks into a
 * countermovement and jumps straight up, once or over and over, or drops off a box first, filmed from wherever the
 * phone happens to be (side-on or facing them, level or a little rolled). The body rises and falls as a free-fall
 * parabola for each flight, so the frames a careful marker would pick are known: take-off is the first frame after the
 * feet leave, landing the first frame at or after they are back.
 */
import { G } from '../jump';
import type { Pose } from '../pose';
import type { PoseFrame } from '../technique';
import { standing } from './standing';

const { cos, floor: floorOf, log, max, PI, sin, sqrt } = Math;

export type PoseJumpSceneOptions = {
  fps: number;
  width: number;
  height: number;
  /** Athlete's standing height, m and px. */
  heightM: number;
  statureP: number;
  /** Mid-hip x and the floor's row, px. */
  x: number;
  floor: number;
  /** 0 side-on, 90 facing the phone. */
  yaw: number;
  /** Flights: when the feet leave (s) and how long they are up (s). */
  flights: { takeoffS: number; flightS: number }[];
  /** A drop jump: the box's height (m) and when the athlete steps off it (s); the first flight is the rebound. */
  drop?: { boxM: number; offS: number };
  durationS: number;
  /** Jitter of every landmark, px (1 SD). */
  noisePx: number;
  /** Phone rolled this many degrees: the picture turns about the feet. */
  rollDeg: number;
  /** Share of frames with nobody found. */
  dropout: number;
  /**
   * Each landing this many px lower in the picture than its take-off (and the athlete that much bigger there, by the
   * same ratio): a phone above the ankles, and an athlete who lands a little nearer it than they took off.
   */
  landShiftPx: number;
  /** Someone else standing still at this x, px. */
  bystanderX?: number;
  seed: number;
};

export const defaultPoseJumpScene = (over: Partial<PoseJumpSceneOptions> = {}): PoseJumpSceneOptions => ({
  fps: 240,
  width: 1080,
  height: 1920,
  heightM: 1.8,
  statureP: 700,
  x: 540,
  floor: 1150,
  yaw: 90,
  flights: [{ takeoffS: 1.2031, flightS: 0.5523 }],
  durationS: 2.6,
  noisePx: 2,
  rollDeg: 0,
  dropout: 0,
  landShiftPx: 0,
  seed: 1,
  ...over,
});

/** Mulberry32. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The feet's height above the floor at time t, m. */
export function liftAt(o: PoseJumpSceneOptions, t: number): number {
  if (o.drop) {
    const fall = sqrt((2 * o.drop.boxM) / G);
    if (t < o.drop.offS) return o.drop.boxM;
    if (t < o.drop.offS + fall) return o.drop.boxM - (G / 2) * (t - o.drop.offS) ** 2;
  }
  for (const f of o.flights) {
    const s = t - f.takeoffS;
    if (s > 0 && s < f.flightS) return (G / 2) * s * (f.flightS - s);
  }
  return 0;
}

/** How far the floor under the feet has moved down the picture by time t, px: across each flight, in step with it. */
function shiftAt(o: PoseJumpSceneOptions, t: number): number {
  let shift = 0;
  for (const f of o.flights) {
    const s = t - f.takeoffS;
    if (s >= f.flightS) shift += o.landShiftPx;
    else if (s > 0) shift += (o.landShiftPx * s) / f.flightS;
  }
  return shift;
}

/** How deep the hips sink before each take-off, m: down over 0.5 s, up again over the last 0.25. */
function sinkAt(o: PoseJumpSceneOptions, t: number): number {
  for (const f of o.flights) {
    const s = f.takeoffS - t;
    if (s >= 0 && s < 0.5) return 0.25 * sin((PI * (0.5 - s)) / 0.5) * (s < 0.25 ? s / 0.25 : 1);
  }
  return 0;
}

export function poseJumpTruth(o: PoseJumpSceneOptions): { touchdown?: number; takeoff: number; landing: number }[] {
  const first = (s: number) => floorOf(s * o.fps) + 1;
  const atOrAfter = (s: number) => Math.ceil(s * o.fps - 1e-9);
  return o.flights.map((f, i) => ({
    ...(o.drop && i === 0 ? { touchdown: atOrAfter(o.drop.offS + sqrt((2 * o.drop.boxM) / G)) } : {}),
    takeoff: first(f.takeoffS),
    landing: atOrAfter(f.takeoffS + f.flightS),
  }));
}

export function poseJumpScene(o: PoseJumpSceneOptions): PoseFrame[] {
  const rand = rng(o.seed);
  const gauss = () => sqrt(-2 * log(max(1e-12, rand()))) * cos(2 * PI * rand());
  const pxPerM = o.statureP / o.heightM;
  const roll = (o.rollDeg * PI) / 180;
  const frames: PoseFrame[] = [];
  const n = floorOf(o.durationS * o.fps);
  for (let k = 0; k < n; k++) {
    const t = k / o.fps;
    const missing = rand() < o.dropout;
    const up0 = liftAt(o, t) * pxPerM;
    const sink0 = sinkAt(o, t) * pxPerM;
    const shift = shiftAt(o, t);
    const floor = o.floor + shift;
    const grow = floor / o.floor;
    const base = standing({ x: o.x, floor, stature: o.statureP * grow, yaw: o.yaw });
    const body: Pose = base.map((p, i) => {
      // The countermovement lowers everything above the knees, and the knees half as much.
      const isFoot = i >= 27;
      const isKnee = i === 25 || i === 26;
      const sink = sink0 * grow;
      const up = up0 * grow;
      const down = isFoot ? 0 : isKnee ? sink / 2 : sink;
      const x = p.x;
      const y = p.y + down - up;
      // Rolled about the feet.
      const dx = x - o.x;
      const dy = y - floor;
      return { x: o.x + dx * cos(roll) - dy * sin(roll) + o.noisePx * gauss(), y: floor + dx * sin(roll) + dy * cos(roll) + o.noisePx * gauss(), z: p.z, v: p.v };
    });
    const poses: Pose[] = missing ? [] : [body];
    if (o.bystanderX != null) poses.push(standing({ x: o.bystanderX, floor: o.floor - 40, stature: o.statureP * 0.9 }).map((p) => ({ ...p, x: p.x + o.noisePx * gauss(), y: p.y + o.noisePx * gauss() })));
    frames.push({ frame: k, t, poses });
  }
  return frames;
}
