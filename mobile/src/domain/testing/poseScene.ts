/**
 * A synthetic run-up jump as a pose model would report it: the 33 MediaPipe landmarks of an athlete who runs a few
 * steps, plants one or both feet and jumps, filmed side-on, for testing the technique analysis without real footage.
 *
 * The athlete is a stick figure with Drillis & Contini's segment proportions (Winter, table 4.1). Its centre of mass,
 * by the same segment model the analysis uses (domain/pose.ts), follows a prescribed path: steady running with a dip
 * in each contact, braking in the final plant, a free-fall parabola from the take-off velocity, and a landing that
 * soaks up the fall. Planted feet stay put (the legs are solved to reach them), so every contact's moments are known
 * exactly, and so is every figure the analysis reports. On top of that it can add what a pose model gets wrong:
 * jitter, a less certain far side, left and right swapped for a few frames, missed frames, a bystander, a tilted or
 * turned phone, an approach that curves towards the camera, and a hand on the rim that stops the free fall.
 */
import { centreOfMass, LANDMARK_COUNT, LM, SIDE, type Landmark, type Pose, type Pt, type Side } from '../pose';

const { PI, atan2, cos, hypot, max, min, round, sin, sqrt, tan } = Math;
const G = 9.81;

export type PoseSceneOptions = {
  /** Real-time frame rate, and the picture's size in pixels. */
  fps: number;
  width: number;
  height: number;
  /** Athlete's standing height, m. */
  heightM: number;
  /** Final plant: 'one' takes off from `foot`, 'two' lands on `foot` first and the other foot `twoFootGapS` later. */
  style: 'one' | 'two';
  foot: Side;
  twoFootGapS: number;
  /** Run-up speed (m/s), and the running steps' ground contact and flight times (s). */
  approachSpeed: number;
  stepContactS: number;
  stepFlightS: number;
  /** Final plant contact time (s), from the first foot down to take-off. */
  plantS: number;
  /** Centre of mass velocity at take-off, m/s. */
  vx: number;
  vz: number;
  /** Moment of take-off, s from the start; the clip ends `afterS` after landing. */
  takeoffS: number;
  afterS: number;
  /** Camera: distance to the run-up line (m), lens height (m), focal length (px), aim (m along the run-up from the take-off spot). */
  distanceM: number;
  lensM: number;
  focalPx: number;
  aimM: number;
  /** Phone rolled about the lens axis, degrees (positive: picture turns anticlockwise). */
  rollDeg: number;
  /** The picture is sideways: the phone stood upright on its side while the app was held in portrait. */
  rotate90: boolean;
  /** The run-up comes in at this angle to the picture plane (degrees): 0 runs straight across, as asked. */
  curveDeg: number;
  /** Which way the athlete runs across the picture; the camera sees their right side when they run to the right. */
  direction: 'right' | 'left';
  /** Floor markers along the run-up, m from the take-off toe (negative: before it), placed this far nearer the lens (m). */
  markers: { aM: number; bM: number; nearerM: number } | null;
  /** Jitter of each landmark (px, 1 SD), twice that on the side away from the camera. */
  noisePx: number;
  /** Frames where left and right come out swapped, as [first, last] file frames. */
  swaps: [number, number][];
  /** Share of frames with no pose at all. */
  dropout: number;
  /** Someone standing still in the picture, at this many m along the run-up from the take-off toe. */
  bystanderM: number | null;
  /** The hand grabs the rim this long after take-off (s), and the body hangs there instead of falling. */
  hangAfterS: number | null;
  seed: number;
};

export const defaultPoseScene = (over: Partial<PoseSceneOptions> = {}): PoseSceneOptions => ({
  fps: 240,
  width: 1920,
  height: 1080,
  heightM: 1.85,
  style: 'one',
  // The take-off foot on the camera's side, as the filming guide asks.
  foot: 'right',
  twoFootGapS: 0.04,
  approachSpeed: 6,
  stepContactS: 0.13,
  stepFlightS: 0.1,
  plantS: 0.18,
  vx: 3.2,
  vz: 3.3,
  takeoffS: 1.4,
  afterS: 0.3,
  distanceM: 7,
  lensM: 1.0,
  // iPhone main camera, 1920 px wide: about 70° across.
  focalPx: 1370,
  aimM: -1.2,
  rollDeg: 0,
  rotate90: false,
  curveDeg: 0,
  direction: 'right',
  markers: { aM: -3, bM: 0, nearerM: 0 },
  noisePx: 1.5,
  swaps: [],
  dropout: 0,
  bystanderM: null,
  hangAfterS: null,
  seed: 1,
  ...over,
});

/** A planted foot: which, when down and up (s), and where its toe stands (m along the run-up). */
export type SceneContact = { foot: Side; downS: number; upS: number; toeM: number };

export type PoseSceneTruth = {
  /** First airborne frame, the convention for take-off. */
  takeoffFrame: number;
  /** First frame with a foot back on the floor, or null when the athlete hangs on the rim past the clip's end. */
  landingFrame: number | null;
  /** The moments themselves, s: the plant's first foot down, take-off, and landing (null as above). */
  plantDownS: number;
  takeoffS: number;
  landingS: number | null;
  /** The run-up's and the plant's contacts, with their first frame down and first frame up again. */
  contacts: (SceneContact & { downFrame: number; upFrame: number })[];
  style: 'one' | 'two';
  foot: Side;
  /** Final plant contact time, s: first foot down to take-off. */
  plantS: number;
  /** A two-foot plant's time between the first and second foot down, s. */
  gapS: number | null;
  vx: number;
  vz: number;
  angleDeg: number;
  /** Mean speed between the markers, from the moments the hips pass them (m/s). */
  approachSpeed: number | null;
  /** Horizontal speed of the centre of mass coming into the plant minus at take-off, m/s. */
  brake: number;
  /** Toe to toe, penultimate contact to the plant's first foot (m). */
  lastStepM: number;
  /** Smallest knee angle of the take-off leg (the near leg in a two-foot plant) during the plant, degrees. */
  kneeMinDeg: number;
  /** Centre of mass height at take-off and at the top, m. */
  comTakeoffM: number;
  comPeakM: number;
  /** Metres per pixel at the run-up line. */
  scale: number;
};

export type PoseSceneFrame = { frame: number; t: number; poses: Pose[] };

export type PoseScene = {
  options: PoseSceneOptions;
  width: number;
  height: number;
  frames: PoseSceneFrame[];
  /** Where the markers are in the picture, as tapped. */
  markers: { a: Pt; b: Pt; distanceM: number } | null;
  /** Where a point on the floor is in the picture: `xM` along the run-up from the take-off toe, `nearerM` nearer the lens. */
  floorPoint: (xM: number, nearerM: number) => Pt;
  truth: PoseSceneTruth;
  /** The athlete's landmarks at time t in the world (m: x along the run-up from the take-off toe, y up from the floor). */
  world: (t: number) => Pt[];
};

/** Mulberry32: small, fast, and without the correlations between successive draws a plain LCG has. */
function rng(seed: number) {
  let s = seed >>> 0;
  const next = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  // Box–Muller: one standard normal draw.
  const normal = () => sqrt(-2 * Math.log(max(1e-12, next()))) * cos(2 * PI * next());
  return { next, normal };
}

/** Cubic Hermite between (0, p0) with slope m0 and (1, p1) with slope m1, at u in [0, 1]; slopes per unit u. */
function hermite(p0: number, m0: number, p1: number, m1: number, u: number): number {
  const u2 = u * u;
  const u3 = u2 * u;
  return (2 * u3 - 3 * u2 + 1) * p0 + (u3 - 2 * u2 + u) * m0 + (-2 * u3 + 3 * u2) * p1 + (u3 - u2) * m1;
}

const smooth = (u: number) => {
  const c = max(0, min(1, u));
  return c * c * (3 - 2 * c);
};

const lerp = (a: Pt, b: Pt, w: number): Pt => ({ x: a.x + (b.x - a.x) * w, y: a.y + (b.y - a.y) * w });

/** Body proportions as shares of standing height (Drillis & Contini, via Winter table 4.1). */
const BODY = { hip: 0.53, knee: 0.285, ankle: 0.039, shoulder: 0.818, ear: 0.93, upperArm: 0.186, forearm: 0.146, hand: 0.108, foot: 0.152 };

/** Foot pitch, degrees (positive heel up): toes up as the heel strikes, the ankle fully extended as the toe leaves, and
 * heel up as the toes touch down first in the landing. */
const HEEL_STRIKE_PITCH = -10;
const TOE_OFF_PITCH = 50;
const LANDING_PITCH = 20;
/** The swinging foot still moves forward at this speed (m/s) as its heel strikes. */
const STRIKE_VX = 1;
/** The landing's give: the centre of mass comes to rest this long after touch-down, this low (share of height). */
const LAND_S = 0.25;
const LAND_COM = 0.42;

type Joints = {
  hip: Pt;
  trunkDeg: number;
  /** Per side: ankle position and foot pitch (degrees, positive heel up). */
  legs: Record<Side, { ankle: Pt; footDeg: number }>;
  /** Upper arm angle from hanging (degrees, positive forward and up) and elbow bend, per side. */
  arms: Record<Side, { shoulderDeg: number; elbowDeg: number }>;
};

const rad = (d: number) => (d * PI) / 180;

/** Knee position for a leg from `hip` to `ankle`, bent forward; the ankle is pulled in if it is out of reach. */
function solveKnee(hip: Pt, ankle: Pt, thigh: number, shank: number): { knee: Pt; ankle: Pt } {
  let dx = ankle.x - hip.x;
  let dy = ankle.y - hip.y;
  let d = hypot(dx, dy);
  const reach = thigh + shank - 1e-6;
  if (d > reach) {
    dx *= reach / d;
    dy *= reach / d;
    d = reach;
  }
  const a = (thigh * thigh - shank * shank + d * d) / (2 * d);
  const h = sqrt(max(0, thigh * thigh - a * a));
  const ux = dx / d;
  const uy = dy / d;
  // Of the two solutions, the one ahead (+x) of the hip–ankle line: knees bend forward.
  const n = { x: -uy, y: ux };
  const sign = n.x >= 0 ? 1 : -1;
  return { knee: { x: hip.x + a * ux + sign * h * n.x, y: hip.y + a * uy + sign * h * n.y }, ankle: { x: hip.x + dx, y: hip.y + dy } };
}

/** The foot's heel and toe from its ankle and pitch: the toe sits three quarters of a foot ahead, ankle-height below. */
function footOf(ankle: Pt, footDeg: number, H: number): { heel: Pt; toe: Pt } {
  const f = rad(footDeg);
  const footLen = BODY.foot * H;
  const ankleH = BODY.ankle * H;
  // Heel up turns the foot clockwise about the ankle: rotate the offsets by −f.
  const rot = (o: Pt) => ({ x: o.x * cos(f) + o.y * sin(f), y: -o.x * sin(f) + o.y * cos(f) });
  const ho = rot({ x: -0.25 * footLen, y: -ankleH });
  const to = rot({ x: 0.75 * footLen, y: -ankleH });
  return { heel: { x: ankle.x + ho.x, y: ankle.y + ho.y }, toe: { x: ankle.x + to.x, y: ankle.y + to.y } };
}

/** The ankle of a foot whose toe stands on the floor at `toeX`, pitched `footDeg`. */
function plantedAnkle(toeX: number, footDeg: number, H: number): Pt {
  const toe = footOf({ x: 0, y: 0 }, footDeg, H).toe;
  return { x: toeX - toe.x, y: -toe.y };
}

/** The ankle of a foot whose heel stands on the floor at `heelX`, toes up (`footDeg` negative). */
function heelPlantedAnkle(heelX: number, footDeg: number, H: number): Pt {
  const heel = footOf({ x: 0, y: 0 }, footDeg, H).heel;
  return { x: heelX - heel.x, y: -heel.y };
}

const THIGH = BODY.hip - BODY.knee;
const SHANK = BODY.knee - BODY.ankle;

/** World landmarks (m, x along the run-up, y up) from joint placements, and whether each leg reached its ankle. */
function buildPose(j: Joints, H: number): { pts: Pt[]; reached: Record<Side, boolean> } {
  const p: Pt[] = Array.from({ length: LANDMARK_COUNT }, () => ({ x: 0, y: 0 }));
  const trunk = (BODY.shoulder - BODY.hip) * H;
  const t = rad(j.trunkDeg);
  const shoulder = { x: j.hip.x + trunk * sin(t), y: j.hip.y + trunk * cos(t) };
  const neck = (BODY.ear - BODY.shoulder) * H;
  const ear = { x: shoulder.x + neck * sin(t), y: shoulder.y + neck * cos(t) };
  p[LM.leftEar] = ear;
  p[LM.rightEar] = ear;
  p[LM.nose] = { x: ear.x + 0.09 * cos(t), y: ear.y - 0.09 * sin(t) - 0.01 };
  // The face's other points sit around the nose and ears; nothing here reads them, but a pose always has them.
  for (const i of [1, 2, 3, 4, 5, 6]) p[i] = { x: p[LM.nose].x - 0.02, y: p[LM.nose].y + 0.03 };
  for (const i of [9, 10]) p[i] = { x: p[LM.nose].x - 0.01, y: p[LM.nose].y - 0.04 };
  const reached = { left: true, right: true };
  for (const s of ['left', 'right'] as const) {
    const k = SIDE[s];
    p[k.shoulder] = shoulder;
    p[k.hip] = j.hip;
    const leg = solveKnee(j.hip, j.legs[s].ankle, THIGH * H, SHANK * H);
    reached[s] = hypot(leg.ankle.x - j.legs[s].ankle.x, leg.ankle.y - j.legs[s].ankle.y) <= 1e-4;
    p[k.knee] = leg.knee;
    p[k.ankle] = leg.ankle;
    const foot = footOf(leg.ankle, j.legs[s].footDeg, H);
    p[k.heel] = foot.heel;
    p[k.toe] = foot.toe;
    const arm = j.arms[s];
    const a = rad(arm.shoulderDeg);
    const elbow = { x: shoulder.x + BODY.upperArm * H * sin(a), y: shoulder.y - BODY.upperArm * H * cos(a) };
    const fa = a + rad(arm.elbowDeg);
    const wrist = { x: elbow.x + BODY.forearm * H * sin(fa), y: elbow.y - BODY.forearm * H * cos(fa) };
    const knuckle = { x: wrist.x + 0.45 * BODY.hand * H * sin(fa), y: wrist.y - 0.45 * BODY.hand * H * cos(fa) };
    p[k.elbow] = elbow;
    p[k.wrist] = wrist;
    p[k.index] = knuckle;
    p[k.pinky] = knuckle;
    p[s === 'left' ? 21 : 22] = knuckle;
  }
  return { pts: p, reached };
}

const asPose = (pts: Pt[]): Pose => pts.map((q) => ({ x: q.x, y: q.y, z: 0, v: 1 }));

/** Times within this of a contact's edge count as on it (s): frame times are sums of floats. */
const EPS = 1e-9;

/**
 * Builds the clip. Throws on options that can't make a jump (a programming error in a test, not user input), and when
 * a planted foot is out of the leg's reach, which would move it.
 */
export function poseScene(over: Partial<PoseSceneOptions> = {}): PoseScene {
  const o = defaultPoseScene(over);
  const H = o.heightM;
  const r = rng(o.seed);
  const other: Side = o.foot === 'left' ? 'right' : 'left';

  // --- Contacts, built backwards from the plant. The plant's first foot lands `plantS` before take-off.
  const plantDown = o.takeoffS - o.plantS;
  const stepS = o.stepContactS + o.stepFlightS;
  const times: { foot: Side; downS: number; upS: number }[] = [{ foot: o.foot, downS: plantDown, upS: o.takeoffS }];
  if (o.style === 'two') times.push({ foot: other, downS: plantDown + o.twoFootGapS, upS: o.takeoffS });
  // Running steps alternate feet; the penultimate is the other foot.
  let up = plantDown - o.stepFlightS;
  let foot: Side = other;
  while (up - o.stepContactS > 0.05) {
    times.push({ foot, downS: up - o.stepContactS, upS: up });
    up = up - o.stepContactS - o.stepFlightS;
    foot = foot === 'left' ? 'right' : 'left';
  }
  times.sort((a, b) => a.downS - b.downS);
  if (times.length < 3) throw new Error('scene too short for a run-up');

  // --- Centre of mass path. Horizontal: steady run-up, braking in the plant down to vx, at rest soon after landing.
  // Vertical: each running step's flight is a parabola, each contact a Hermite dip; the plant leaves at vz.
  const runCom = 0.5 * H;
  const takeoffCom = 0.58 * H;
  const stepVz = (G * o.stepFlightS) / 2;
  const tEnd = o.takeoffS + 2 * (o.vz / G) + 0.6 + o.afterS;
  // Lands when the centre of mass is back at about standing height with the legs reaching down.
  const yLand = 0.55 * H;
  const tLand = o.takeoffS + (o.vz + sqrt(o.vz * o.vz + 2 * G * (takeoffCom - yLand))) / G;
  const vLand = o.vz - G * (tLand - o.takeoffS);
  const hangS = o.hangAfterS != null ? o.takeoffS + o.hangAfterS : null;

  /** Horizontal speed at time t. */
  const vxAt = (t: number) => {
    if (hangS != null && t >= hangS) return o.vx * (1 - smooth((t - hangS) / 0.1));
    if (hangS == null && t >= tLand) return o.vx * (1 - smooth((t - tLand) / LAND_S));
    if (t >= o.takeoffS) return o.vx;
    if (t >= plantDown) return o.approachSpeed + (o.vx - o.approachSpeed) * smooth((t - plantDown) / o.plantS);
    return o.approachSpeed;
  };
  // x(t) by integrating vx, at 0.1 ms steps; x = 0 at the start.
  const DT = 1e-4;
  const xs: number[] = [0];
  for (let i = 1; i * DT <= tEnd + 0.01; i++) xs.push(xs[i - 1] + vxAt((i - 0.5) * DT) * DT);
  const xAtRaw = (t: number) => {
    const i = max(0, min(xs.length - 2, Math.floor(t / DT)));
    return xs[i] + (xs[i + 1] - xs[i]) * (t / DT - i);
  };
  const yAt = (t: number): number => {
    if (t >= o.takeoffS) {
      if (hangS == null && t >= tLand) return hermite(yLand, vLand * LAND_S, LAND_COM * H, 0, min(1, (t - tLand) / LAND_S));
      // Hanging on the rim: the centre of mass holds where it was.
      const u = (hangS != null ? min(t, hangS) : t) - o.takeoffS;
      return takeoffCom + o.vz * u - (G / 2) * u * u;
    }
    if (t >= plantDown) return hermite(runCom, -stepVz * o.plantS, takeoffCom, o.vz * o.plantS, (t - plantDown) / o.plantS);
    const k = times.find((c) => c.downS <= t && t < c.upS);
    if (k) {
      const len = k.upS - k.downS;
      return hermite(runCom, -stepVz * len, runCom, stepVz * len, (t - k.downS) / len);
    }
    // In a running step's flight: a parabola from the last toe-off (or into the first contact, before it).
    const last = times.filter((c) => c.upS <= t).at(-1);
    const u = last ? t - last.upS : t - (times[0].downS - o.stepFlightS);
    return runCom + stepVz * u - (G / 2) * u * u;
  };

  // The take-off toe is at x = 0 in run-up metres: shift the path so the plant's toe lands there.
  const plantToeAhead = o.style === 'one' ? 0.55 : 0.5;
  const shift = -(xAtRaw(plantDown) + plantToeAhead);
  const comX = (t: number) => xAtRaw(t) + shift;
  const comAt = (t: number): Pt => ({ x: comX(t), y: yAt(t) });
  const contacts: SceneContact[] = times.map((k) => {
    const ahead = k.downS >= plantDown - EPS ? plantToeAhead - (k.downS > plantDown + EPS ? 0.05 : 0) : 0.42;
    return { ...k, toeM: comX(k.downS) + ahead };
  });
  // Both feet come down side by side a little ahead of the centre of mass, and stay.
  const landings: SceneContact[] =
    hangS == null ? [o.foot, other].map((s, i) => ({ foot: s, downS: tLand, upS: Infinity, toeM: comX(tLand) + 0.3 + 0.08 * i })) : [];
  const all = [...contacts, ...landings];
  const contactOf = (s: Side, t: number) => all.find((k) => k.foot === s && k.downS <= t + EPS && t + EPS < k.upS);
  const lastUpOf = (s: Side, t: number) => contacts.filter((k) => k.foot === s && k.upS <= t + EPS).at(-1);
  const nextDownOf = (s: Side, t: number) => contacts.find((k) => k.foot === s && k.downS > t + EPS);

  /**
   * Foot pitch in a contact: the heel strikes and the foot rolls flat over the first 20 %, then the heel rises over the
   * last 40 % to toe-off. A landing comes down on the toes and settles flat in 60 ms.
   */
  const pitchIn = (k: SceneContact, t: number) => {
    if (k.upS === Infinity) return LANDING_PITCH * (1 - smooth((t - k.downS) / 0.06));
    const u = (t - k.downS) / (k.upS - k.downS);
    return HEEL_STRIKE_PITCH * (1 - smooth(u / 0.2)) + TOE_OFF_PITCH * smooth((u - 0.6) / 0.4);
  };
  /** A planted foot's ankle: rolling on its heel while toes-up, otherwise on its toe. */
  const footLen = BODY.foot * H;
  const planted = (k: SceneContact, t: number) => {
    const pitch = pitchIn(k, t);
    return { ankle: pitch < 0 ? heelPlantedAnkle(k.toeM - footLen, pitch, H) : plantedAnkle(k.toeM, pitch, H), footDeg: pitch };
  };

  // Trunk: leans forward running, back at the plant, upright in the air.
  const trunkAt = (t: number) => {
    if (t < plantDown - 0.1) return 10;
    if (t < plantDown) return 10 - 20 * smooth((t - (plantDown - 0.1)) / 0.1);
    if (t < o.takeoffS) return -10 + 15 * smooth((t - plantDown) / o.plantS);
    return 5 - 5 * smooth((t - o.takeoffS) / 0.3);
  };
  // Arms: swing with the steps, then both drive up for the jump and stay up to the top.
  const armsAt = (t: number): Joints['arms'] => {
    if (t < plantDown - 0.15) {
      const ph = sin((2 * PI * t) / (2 * stepS));
      return { left: { shoulderDeg: 35 * ph, elbowDeg: 80 }, right: { shoulderDeg: -35 * ph, elbowDeg: 80 } };
    }
    if (t < plantDown) {
      const u = smooth((t - (plantDown - 0.15)) / 0.15);
      return { left: { shoulderDeg: -45 * u, elbowDeg: 80 - 50 * u }, right: { shoulderDeg: -45 * u, elbowDeg: 80 - 50 * u } };
    }
    if (t < o.takeoffS + 0.15) {
      const u = smooth((t - plantDown) / (o.takeoffS + 0.15 - plantDown));
      return { left: { shoulderDeg: -45 + 205 * u, elbowDeg: 30 - 20 * u }, right: { shoulderDeg: -45 + 195 * u, elbowDeg: 30 - 20 * u } };
    }
    return { left: { shoulderDeg: 160, elbowDeg: 10 }, right: { shoulderDeg: 150, elbowDeg: 10 } };
  };

  /** Where a foot in the air is, relative to the centre of mass, once it has tucked under the body. */
  const tucked = (s: Side, t: number) => {
    const u = t - o.takeoffS;
    const tuck = smooth(u / 0.25) * (1 - smooth((u - (tLand - o.takeoffS - 0.3)) / 0.25));
    const lift = (s === o.foot ? 0.15 : 0.35) * tuck;
    const leg = (THIGH + SHANK) * H * (0.97 - 0.3 * tuck);
    return { ankle: { x: (s === o.foot ? -0.1 : 0.2) * tuck, y: -0.06 * H - leg + lift }, footDeg: 40 * (1 - smooth(u / 0.4)) + 10 };
  };

  /**
   * A foot swinging between contacts: the ankle travels from where the foot left the floor (on its toe) to where it
   * strikes (on its heel, still moving forward and down), lifted on the way. The free leg of a one-foot take-off has
   * no next contact: it drives forward and up.
   */
  const swingAt = (s: Side, t: number) => {
    const from = lastUpOf(s, t);
    const to = nextDownOf(s, t);
    const t0 = from ? from.upS : 0;
    const t1 = to ? to.downS : t0 + 0.4;
    const T = max(1e-6, t1 - t0);
    const u = max(0, min(1, (t - t0) / T));
    const a0 = from ? plantedAnkle(from.toeM, TOE_OFF_PITCH, H) : { x: comX(t0) - 0.6, y: 0.3 };
    const a1 = to ? heelPlantedAnkle(to.toeM - footLen, HEEL_STRIKE_PITCH, H) : { x: comX(t1) + 0.3, y: 0.5 };
    const endPitch = to ? HEEL_STRIKE_PITCH : 20;
    return {
      ankle: { x: hermite(a0.x, 0, a1.x, STRIKE_VX * T, u), y: a0.y + (a1.y - a0.y) * u + 0.3 * sin(PI * u) * (1 - 0.3 * u) },
      footDeg: TOE_OFF_PITCH + (endPitch - TOE_OFF_PITCH) * u,
    };
  };

  /** Where each foot's ankle is and how it is pitched at time t. */
  const legsAt = (t: number): Joints['legs'] => {
    const out = {} as Joints['legs'];
    for (const s of ['left', 'right'] as const) {
      const k = contactOf(s, t);
      if (k) {
        out[s] = planted(k, t);
        continue;
      }
      if (t < o.takeoffS) {
        out[s] = swingAt(s, t);
        continue;
      }
      // In the air the feet ride with the centre of mass: from where each was at take-off into the tuck, and in the
      // last moments down onto its landing spot at the body's own speed.
      const c = comAt(t);
      const c0 = comAt(o.takeoffS);
      const k0 = contactOf(s, o.takeoffS - 1e-6);
      const at0 = k0 ? planted(k0, o.takeoffS - 1e-12) : swingAt(s, o.takeoffS);
      const tk = tucked(s, t);
      const w = smooth((t - o.takeoffS) / 0.15);
      let rel = lerp({ x: at0.ankle.x - c0.x, y: at0.ankle.y - c0.y }, tk.ankle, w);
      let footDeg = at0.footDeg + (tk.footDeg - at0.footDeg) * w;
      const land = landings.find((l) => l.foot === s);
      if (land) {
        const spot = plantedAnkle(land.toeM, LANDING_PITCH, H);
        const cl = comAt(tLand);
        const wl = smooth((t - (tLand - 0.25)) / 0.13);
        rel = lerp(rel, { x: spot.x - cl.x, y: spot.y - cl.y }, wl);
        footDeg = footDeg + (LANDING_PITCH - footDeg) * wl;
      }
      out[s] = { ankle: { x: c.x + rel.x, y: c.y + rel.y }, footDeg };
    }
    return out;
  };

  /** The pose at time t: the hip is moved until the segment model's centre of mass sits on the prescribed path. */
  const solve = (t: number) => {
    const target = comAt(t);
    let hip = { x: target.x, y: target.y - 0.03 * H };
    let built: ReturnType<typeof buildPose> = { pts: [], reached: { left: true, right: true } };
    for (let it = 0; it < 8; it++) {
      built = buildPose({ hip, trunkDeg: trunkAt(t), legs: legsAt(t), arms: armsAt(t) }, H);
      const c = centreOfMass(asPose(built.pts));
      const ex = target.x - c.x;
      const ey = target.y - c.y;
      if (hypot(ex, ey) < 1e-6) break;
      hip = { x: hip.x + ex, y: hip.y + ey };
    }
    return built;
  };
  const world = (t: number) => solve(t).pts;

  // --- Camera. Run-up metres to picture pixels: perspective about the lens, then roll, then the sideways turn.
  const curve = rad(o.curveDeg);
  /** How much nearer the lens a point on the run-up is, from the approach angle (m): 0 at the take-off spot. */
  const nearer = (x: number) => (x < 0 ? -x * tan(curve) : 0);
  const W = o.rotate90 ? o.height : o.width;
  const Hh = o.rotate90 ? o.width : o.height;
  const project = (q: Pt, depthOffset: number): Pt => {
    const d = o.distanceM - depthOffset;
    const px = o.width / 2 + ((o.direction === 'right' ? 1 : -1) * o.focalPx * (q.x - o.aimM)) / d;
    const py = o.height / 2 - (o.focalPx * (q.y - o.lensM)) / d;
    const rr = rad(o.rollDeg);
    const cx = o.width / 2;
    const cy = o.height / 2;
    const rx = cx + (px - cx) * cos(rr) + (py - cy) * sin(rr);
    const ry = cy - (px - cx) * sin(rr) + (py - cy) * cos(rr);
    // Sideways: the picture's top edge is the scene's left edge.
    return o.rotate90 ? { x: ry, y: o.width - rx } : { x: rx, y: ry };
  };
  // The camera sees the athlete's right side when they run towards the right of the picture.
  const nearSide: Side = o.direction === 'right' ? 'right' : 'left';
  // MediaPipe's face points by side: 1–3 and 7, 9 are the left eye, ear and mouth corner; 4–6 and 8, 10 the right.
  const farIdx = new Set<number>(nearSide === 'right' ? [1, 2, 3, 7, 9, ...Object.values(SIDE.left)] : [4, 5, 6, 8, 10, ...Object.values(SIDE.right)]);

  const frames: PoseSceneFrame[] = [];
  const nFrames = Math.floor(min(tEnd, tLand + o.afterS) * o.fps);
  const bystanderPose =
    o.bystanderM != null
      ? buildPose(
          {
            hip: { x: o.bystanderM, y: BODY.hip * 1.8 },
            trunkDeg: 0,
            legs: { left: { ankle: { x: o.bystanderM - 0.1, y: BODY.ankle * 1.8 }, footDeg: 0 }, right: { ankle: { x: o.bystanderM + 0.1, y: BODY.ankle * 1.8 }, footDeg: 0 } },
            arms: { left: { shoulderDeg: 5, elbowDeg: 10 }, right: { shoulderDeg: -5, elbowDeg: 10 } },
          },
          1.8,
        ).pts
      : null;

  for (let f = 0; f < nFrames; f++) {
    const t = f / o.fps;
    if (o.dropout > 0 && r.next() < o.dropout) {
      frames.push({ frame: f, t, poses: [] });
      continue;
    }
    const built = solve(t);
    // A planted foot the leg can't reach would move: the scene would no longer match its own truth.
    for (const s of ['left', 'right'] as const) {
      if (contactOf(s, t) && !built.reached[s]) throw new Error(`planted ${s} foot out of reach at ${t.toFixed(4)} s`);
    }
    const swapped = o.swaps.some(([a, b]) => f >= a && f <= b);
    const pose: Landmark[] = built.pts.map((q, i) => {
      const far = farIdx.has(i);
      // Each point at its own depth: a planted foot stays put in the picture while the body comes on towards the lens.
      const offset = nearer(q.x) + (far ? -0.12 : 0.12);
      const pq = project(q, offset);
      const sd = o.noisePx * (far ? 2 : 1);
      return { x: pq.x + sd * r.normal(), y: pq.y + sd * r.normal(), z: far ? 0.1 : -0.1, v: far ? 0.55 + 0.1 * r.next() : 0.9 + 0.08 * r.next() };
    });
    if (swapped) {
      for (const k of Object.keys(SIDE.left) as (keyof typeof SIDE.left)[]) {
        const a = SIDE.left[k];
        const b = SIDE.right[k];
        [pose[a], pose[b]] = [pose[b], pose[a]];
      }
    }
    const poses = [pose];
    if (bystanderPose) poses.push(bystanderPose.map((q) => ({ ...project(q, 1.5), z: 0, v: 0.95 })));
    frames.push({ frame: f, t, poses });
  }

  // --- Truth.
  const firstFrameAtOrAfter = (s: number) => Math.ceil((s - EPS) * o.fps);
  const takeoffFrame = firstFrameAtOrAfter(o.takeoffS);
  const landed = hangS == null ? firstFrameAtOrAfter(tLand) : null;
  const landingFrame = landed != null && landed < nFrames ? landed : null;
  const plantContacts = contacts.filter((k) => k.upS === o.takeoffS);
  const firstDown = min(...plantContacts.map((k) => k.downS));
  const penultimate = contacts.filter((k) => k.upS < firstDown).at(-1)!;
  const plantFirstContact = plantContacts.find((k) => k.downS === firstDown)!;
  const kneeLeg: Side = o.style === 'one' ? o.foot : nearSide;
  let kneeMin = 180;
  for (let t = firstDown; t < o.takeoffS; t += 0.0005) {
    const p = world(t);
    const k = SIDE[kneeLeg];
    const v1 = { x: p[k.hip].x - p[k.knee].x, y: p[k.hip].y - p[k.knee].y };
    const v2 = { x: p[k.ankle].x - p[k.knee].x, y: p[k.ankle].y - p[k.knee].y };
    const ang = (Math.acos((v1.x * v2.x + v1.y * v2.y) / (hypot(v1.x, v1.y) * hypot(v2.x, v2.y))) * 180) / PI;
    kneeMin = min(kneeMin, ang);
  }
  /** When the hips pass run-up metre xm (bisection on the monotonic run-up). */
  const hipCrossing = (xm: number) => {
    const hipX = (t: number) => world(t)[LM.leftHip].x;
    let lo = 0;
    let hi = o.takeoffS + 0.3;
    if (hipX(lo) > xm || hipX(hi) < xm) return null;
    for (let i = 0; i < 50; i++) {
      const m = (lo + hi) / 2;
      if (hipX(m) < xm) lo = m;
      else hi = m;
    }
    return (lo + hi) / 2;
  };
  const scale = o.distanceM / o.focalPx;
  let markers: PoseScene['markers'] = null;
  let approachSpeed: number | null = null;
  if (o.markers) {
    const m = o.markers;
    const a = project({ x: m.aM, y: 0 }, m.nearerM);
    const b = project({ x: m.bM, y: 0 }, m.nearerM);
    markers = { a, b, distanceM: Math.abs(m.bM - m.aM) };
    const ta = hipCrossing(m.aM);
    const tb = hipCrossing(m.bM);
    approachSpeed = ta != null && tb != null ? Math.abs(m.bM - m.aM) / (tb - ta) : null;
  }
  const comPeakM = takeoffCom + (o.vz * o.vz) / (2 * G);
  const second = plantContacts.find((k) => k !== plantFirstContact);

  return {
    options: o,
    width: W,
    height: Hh,
    frames,
    markers,
    floorPoint: (xM, nearerM) => project({ x: xM, y: 0 }, nearerM),
    world,
    truth: {
      takeoffFrame,
      landingFrame,
      plantDownS: firstDown,
      takeoffS: o.takeoffS,
      landingS: landingFrame != null ? tLand : null,
      contacts: contacts.map((k) => ({ ...k, downFrame: firstFrameAtOrAfter(k.downS), upFrame: firstFrameAtOrAfter(k.upS) })),
      style: o.style,
      foot: o.foot,
      plantS: o.takeoffS - firstDown,
      gapS: second ? second.downS - firstDown : null,
      vx: o.vx,
      vz: o.vz,
      angleDeg: (atan2(o.vz, o.vx) * 180) / PI,
      approachSpeed,
      brake: o.approachSpeed - o.vx,
      lastStepM: plantFirstContact.toeM - penultimate.toeM,
      kneeMinDeg: kneeMin,
      comTakeoffM: takeoffCom,
      comPeakM,
      scale,
    },
  };
}


/** Rounds a scene's poses the way the page sends them: shares of the picture to 4 decimals. */
export function asWire(scene: PoseScene): { frame: number; t: number; values: number[][] }[] {
  return scene.frames.map((f) => ({
    frame: f.frame,
    t: f.t,
    values: f.poses.map((p) => p.flatMap((l) => [round((l.x / scene.width) * 1e4) / 1e4, round((l.y / scene.height) * 1e4) / 1e4, round(l.z * 1e3) / 1e3, round(l.v * 100) / 100])),
  }));
}
