/**
 * A synthetic side-on clip of a jump, filmed the way the capture guide asks (phone on the floor, lens at ankle
 * height), for testing the automatic take-off and landing detection without real footage. The athlete is a few
 * shaded shapes: two shoes that roll onto the toes before take-off and land on the forefoot, shins, thighs, a torso and
 * a head. On top of that it can add what real gym clips have: a shadow under the shoes, a glossy floor's mirror image,
 * sensor noise, mains flicker banding across the rows, and motion blur.
 *
 * Event times are known exactly, so the frames a careful marker would pick are known too: take-off is the first frame
 * whose exposure starts with the toes off the floor, landing the first frame whose exposure starts with a foot down.
 */
import type { Grey, Rect } from '../autoMark';

// Math's functions as locals: these loops run millions of times, and a global lookup per call is slow under Jest.
const { PI, abs, ceil, cos, exp, floor, hypot, imul, max, min, round, sin, sqrt } = Math;

export type SceneKind = 'cmj' | 'approach' | 'drop';

export type SceneOptions = {
  kind: SceneKind;
  /** Real-time frame rate, and the video's size in pixels. */
  fps: number;
  width: number;
  height: number;
  /** Millimetres of scene per video pixel at the athlete. */
  mmPerPx: number;
  /** Video row of the floor under the athlete. */
  floorRow: number;
  /** Scene x (mm) of the video's left edge. */
  originX: number;
  /** Moment the toes leave the floor, and the flight time, in seconds. */
  takeoffS: number;
  flightS: number;
  durationS: number;
  /** Drop jump: ground contact before the rebound, and the box height in mm. */
  contactS?: number;
  boxMm?: number;
  /** Where the take-off toe is, in scene mm. */
  toeX?: number;
  /** The second foot lands this much later (s); feet rarely land together. */
  secondFootLagS?: number;
  /** The far foot sits this many pixels higher in the picture (it is further from the lens). */
  farFootPx?: number;
  /** CMJ on the near leg only: the far foot is held up behind, about 25 cm off the floor, the whole time. */
  singleLeg?: boolean;
  shadow?: number;
  reflection?: number;
  noise?: number;
  flicker?: number;
  /** Exposure time in seconds; motion during it smears the picture. */
  exposureS?: number;
  /** A bright court line painted on the floor behind the athlete, this many mm above the contact line in the picture. */
  courtLineMm?: number;
  /** Grey levels for the shoe upper and the sole. */
  shoe?: number;
  sole?: number;
  floor?: number;
  seed?: number;
};

const G_MM = 9810;

type Foot = { x: number; z: number; lift: number; dir: number };
type Pose = { feet: [Foot, Foot]; hip: { x: number; z: number } };

/** The frames a careful marker would pick: first frame in the air, first frame back on the floor. */
export function sceneTruth(o: SceneOptions): { touchdown?: number; takeoff: number; landing: number } {
  const first = (t: number) => floor(t * o.fps + 1e-9) + 1;
  const landingS = o.takeoffS + o.flightS;
  return {
    ...(o.kind === 'drop' ? { touchdown: ceil((o.takeoffS - (o.contactS ?? 0.2)) * o.fps - 1e-9) } : {}),
    takeoff: first(o.takeoffS),
    landing: ceil(landingS * o.fps - 1e-9),
  };
}

const smooth = (a: number) => (a <= 0 ? 0 : a >= 1 ? 1 : a * a * (3 - 2 * a));
const lerp = (a: number, b: number, k: number) => a + (b - a) * k;

function flightZ(o: SceneOptions, t: number, lag = 0): number {
  // The toe rises and falls on the same parabola as the body; the second foot comes down `lag` later.
  const T = o.flightS + lag;
  const tau = t - o.takeoffS;
  if (tau <= 0 || tau >= T) return 0;
  const v0 = (G_MM * T) / 2;
  return v0 * tau - (G_MM * tau * tau) / 2;
}

function pose(o: SceneOptions, t: number): Pose {
  const t0 = o.takeoffS;
  const t1 = t0 + o.flightS;
  const lag = o.secondFootLagS ?? 0.004;
  const toe = o.toeX ?? 0;
  // Heel lift: rolls onto the toes in the last 120 ms before take-off, lands on the forefoot, heel down over 80 ms.
  const liftAt = (t: number, land: number) =>
    t < t0 - 0.12 ? 0 : t <= t0 ? 0.9 * smooth((t - (t0 - 0.12)) / 0.12) : t < land ? lerp(0.9, 0.45, (t - t0) / (land - t0)) : 0.45 * (1 - smooth((t - land) / 0.08));

  if (o.kind === 'cmj') {
    const hipZ =
      t < t0 - 0.6 ? 920 : t < t0 - 0.25 ? lerp(920, 640, smooth((t - (t0 - 0.6)) / 0.35)) : t <= t0 ? lerp(640, 980, smooth((t - (t0 - 0.25)) / 0.25)) : t < t1 ? 980 + flightZ(o, t) : lerp(960, 700, smooth((t - t1) / 0.25));
    const near: Foot = { x: toe, z: flightZ(o, t), lift: liftAt(t, t1), dir: 1 };
    const far: Foot = o.singleLeg
      ? { x: toe - 380, z: 250 + (t > t0 && t < t1 ? flightZ(o, t) : 0), lift: 0.7, dir: 1 }
      : { x: toe - 40, z: flightZ(o, t, lag), lift: liftAt(t, t1 + lag), dir: 1 };
    return { feet: [near, far], hip: { x: toe - 160, z: hipZ } };
  }

  if (o.kind === 'drop') {
    const box = o.boxMm ?? 300;
    const contact = o.contactS ?? 0.2;
    const td = t0 - contact;
    const fall = sqrt((2 * box) / G_MM);
    const step = td - fall;
    // Stands on the box behind the landing spot, steps off and falls; lands flat-footed and rolls to the toes.
    const dropX = (t: number) => (t < step ? -350 : t < td ? lerp(-350, 0, (t - step) / fall) : 0);
    const dropZ = (t: number) => (t < step ? box : t < td ? box - (G_MM * (t - step) ** 2) / 2 : 0);
    const footAt = (lagS: number, dx: number): Foot => {
      const tt = t - lagS;
      if (tt < td) return { x: toe + dx + dropX(tt), z: max(0, dropZ(tt)), lift: 0.15, dir: 1 };
      if (t < t0) return { x: toe + dx, z: 0, lift: liftAt(t, t1), dir: 1 };
      return { x: toe + dx, z: flightZ(o, t, lagS), lift: liftAt(t, t1 + lagS), dir: 1 };
    };
    const near = footAt(0, 0);
    const far = footAt(lag, -40);
    const hipZ = t < td ? near.z + 920 : t < t0 ? lerp(800, 960, smooth((t - td) / contact)) : t < t1 ? 980 + flightZ(o, t) : lerp(960, 700, smooth((t - t1) / 0.25));
    return { feet: [near, far], hip: { x: near.x - 160, z: hipZ } };
  }

  // Run-up: three steps in from the left, a long last plant on the near foot, take-off, land 1.3 m on with the far foot
  // first (a two-footed landing is rarely simultaneous).
  const plantStart = t0 - 0.2;
  const stepT = 0.26;
  const run = (t: number) => toe - 4000 * (plantStart - t); // running at 4 m/s before the plant
  const ballX = (k: number) => toe - 4000 * stepT * k; // where the k-th last step lands
  const swing = (from: number, to: number, start: number, end: number): Foot => {
    const k = min(1, max(0, (t - start) / (end - start)));
    return { x: lerp(from, to, smooth(k)), z: 140 * sin(PI * k), lift: 0.3, dir: 1 };
  };
  const flightX = (t: number) => lerp(toe, toe + 1300, min(1, max(0, (t - t0) / o.flightS)));
  // Near foot: contacts at steps 2 and 0 (the plant); far foot: contacts at steps 3 and 1.
  const stepContact = (k: number) => [plantStart - stepT * k, plantStart - stepT * k + 0.15] as const;
  const footRun = (steps: number[], isNear: boolean): Foot => {
    for (const k of steps) {
      const [a, b] = k === 0 ? [plantStart, t0] : stepContact(k);
      if (t >= a && t <= b) return { x: k === 0 ? toe : ballX(k), z: 0, lift: k === 0 ? liftAt(t, t1) : 0.2 * smooth((t - a) / (b - a)), dir: 1 };
    }
    if (t > t0) {
      const lagS = isNear ? lag : 0;
      const land = t1 + lagS;
      const x = flightX(t) - (isNear ? 250 : 0);
      if (t < land) return { x, z: flightZ(o, t, lagS), lift: lerp(0.9, 0.4, (t - t0) / (land - t0)), dir: 1 };
      return { x: toe + 1300 - (isNear ? 250 : 0), z: 0, lift: 0.4 * (1 - smooth((t - land) / 0.08)), dir: 1 };
    }
    // Swinging between this foot's contacts.
    const contacts = steps.map((k) => ({ k, ...{ a: k === 0 ? plantStart : stepContact(k)[0], b: k === 0 ? t0 : stepContact(k)[1] } })).sort((p, q) => p.a - q.a);
    const prev = [...contacts].reverse().find((c) => c.b < t);
    const next = contacts.find((c) => c.a > t);
    if (!prev && next) return { x: run(t) - 600, z: 140, lift: 0.3, dir: 1 };
    if (prev && next) return swing(ballX(prev.k), next.k === 0 ? toe : ballX(next.k), prev.b, next.a);
    return { x: run(t), z: 100, lift: 0.3, dir: 1 };
  };
  const near = footRun([2, 0], true);
  const far = footRun([3, 1], false);
  const hipZ = t < t0 ? 930 : t < t1 ? 980 + flightZ(o, t) : lerp(960, 720, smooth((t - t1) / 0.25));
  return { feet: [near, far], hip: { x: (near.x + far.x) / 2 - 120, z: hipZ } };
}

// ---- drawing ----

type Shape = { grey: number; hit: (x: number, z: number) => boolean };

const SOLE = 25;
const LEN = 270;

function upperHeight(u: number): number {
  return 40 + 55 * min(1, max(0, (u - 40) / 120));
}

/** Foot-local coordinates: u from the toe tip back along the sole, v up from the sole. */
function toLocal(f: Foot, c: number, s: number, x: number, z: number) {
  const dx = (x - f.x) * f.dir;
  const dz = z - f.z;
  return { u: -dx * c + dz * s, v: dx * s + dz * c };
}

function fromLocal(f: Foot, u: number, v: number) {
  const c = cos(f.lift);
  const s = sin(f.lift);
  return { x: f.x + (-u * c + v * s) * f.dir, z: f.z + u * s + v * c };
}

function segment(ax: number, az: number, bx: number, bz: number, r: number) {
  const vx = bx - ax;
  const vz = bz - az;
  const len2 = vx * vx + vz * vz || 1;
  return (x: number, z: number) => {
    const k = min(1, max(0, ((x - ax) * vx + (z - az) * vz) / len2));
    const px = ax + k * vx - x;
    const pz = az + k * vz - z;
    return px * px + pz * pz <= r * r;
  };
}

function knee(ankle: { x: number; z: number }, hip: { x: number; z: number }) {
  // Two 460 mm links, knee bent forward.
  const L = 460;
  const dx = hip.x - ankle.x;
  const dz = hip.z - ankle.z;
  const d = min(2 * L - 1, hypot(dx, dz));
  const h = sqrt(max(0, L * L - (d / 2) ** 2));
  const mx = ankle.x + dx / 2;
  const mz = ankle.z + dz / 2;
  const nx = dz / (hypot(dx, dz) || 1);
  const nz = -dx / (hypot(dx, dz) || 1);
  return { x: mx + nx * h, z: mz + nz * h };
}

function shapes(o: SceneOptions, p: Pose): { person: Shape[]; feet: Foot[] } {
  const shoe = o.shoe ?? 45;
  const sole = o.sole ?? 225;
  const person: Shape[] = [];
  const legs = p.feet.map((f, i) => {
    const ankle = fromLocal(f, 200, 80);
    const k = knee(ankle, { x: p.hip.x + (i === 0 ? 20 : -20), z: p.hip.z });
    return { f, ankle, k };
  });
  // Near leg in front of the far one.
  for (const { f, ankle, k } of legs) {
    const c = cos(f.lift);
    const s = sin(f.lift);
    person.push({
      grey: shoe,
      hit: (x, z) => {
        const { u, v } = toLocal(f, c, s, x, z);
        return u >= 0 && u <= LEN && v >= SOLE && v <= SOLE + upperHeight(u) && !(u < 25 && v > SOLE + 20 + u);
      },
    });
    person.push({
      grey: sole,
      hit: (x, z) => {
        const { u, v } = toLocal(f, c, s, x, z);
        return u >= 0 && u <= LEN && v >= 0 && v < SOLE;
      },
    });
    person.push({ grey: 205, hit: segment(ankle.x, ankle.z, ankle.x, ankle.z + 120, 48) });
    person.push({ grey: 160, hit: segment(ankle.x, ankle.z + 100, k.x, k.z, 52) });
    person.push({ grey: 150, hit: segment(k.x, k.z, p.hip.x, p.hip.z, 72) });
  }
  person.push({ grey: 70, hit: segment(p.hip.x, p.hip.z, p.hip.x + 30, p.hip.z + 200, 140) });
  person.push({ grey: 100, hit: segment(p.hip.x + 30, p.hip.z + 150, p.hip.x + 40, p.hip.z + 560, 150) });
  person.push({ grey: 150, hit: segment(p.hip.x + 50, p.hip.z + 730, p.hip.x + 50, p.hip.z + 740, 105) });
  return { person, feet: p.feet };
}

function background(o: SceneOptions, x: number, z: number): number {
  const ground = o.floor ?? 135;
  if (o.kind === 'drop' && x < (o.toeX ?? 0) - 330 && x > (o.toeX ?? 0) - 900 && z >= 0 && z < (o.boxMm ?? 300)) return 95 + 6 * sin(x / 37);
  if (z < 0) return ground - 8 + 6 * sin(x / 23 + z / 7) + 4 * sin(z / 3.1);
  if (o.courtLineMm != null && z >= o.courtLineMm && z < o.courtLineMm + 10) return 215;
  if (z < 90) return ground + 4 + 5 * sin(x / 31) + 3 * sin(z / 5);
  return 178 + 7 * sin(x / 53) + 5 * sin(z / 41);
}

function hash(a: number, b: number, c: number) {
  let h = (a * 374761393 + b * 668265263 + c * 2147483647) | 0;
  h = imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** One frame (or a crop of it), scaled to `outW` × `outH` like a canvas draw of `rect` would. */
export function renderScene(o: SceneOptions, frame: number, rect: Rect, outW: number, outH: number): Grey {
  const data = new Uint8Array(outW * outH);
  const exposure = o.exposureS ?? 1 / 1000;
  const subs = exposure > 1 / 900 ? 3 : 1;
  const sx = rect.w / outW;
  const sy = rect.h / outH;
  // Supersample each output pixel on a 2×2 grid (enough to keep thin shapes from aliasing).
  const ss = sx > 1.5 ? 2 : 1;
  const acc = new Float32Array(outW * outH);
  for (let s = 0; s < subs; s++) {
    const t = frame / o.fps + (subs === 1 ? 0 : (exposure * s) / (subs - 1));
    const { person, feet } = shapes(o, pose(o, t));
    const farPx = o.farFootPx ?? 0;
    for (let j = 0; j < outH; j++) {
      for (let i = 0; i < outW; i++) {
        let sum = 0;
        for (let a = 0; a < ss; a++) {
          for (let b = 0; b < ss; b++) {
            const vx = rect.x + (i + (a + 0.5) / ss) * sx;
            const vy = rect.y + (j + (b + 0.5) / ss) * sy;
            sum += shade(o, person, feet, vx, vy, farPx);
          }
        }
        acc[j * outW + i] += sum / (ss * ss);
      }
    }
  }
  const noise = o.noise ?? 2;
  const flicker = o.flicker ?? 0;
  for (let j = 0; j < outH; j++) {
    const row = rect.y + (j + 0.5) * sy;
    const gain = 1 + flicker * sin(2 * PI * 100 * (frame / o.fps + (row / o.height) / o.fps));
    for (let i = 0; i < outW; i++) {
      const n = (hash(frame, j, i + (o.seed ?? 0)) + hash(i, frame, j) + hash(j, i, frame) - 1.5) * 2 * noise;
      data[j * outW + i] = max(0, min(255, round((acc[j * outW + i] / subs) * gain + n)));
    }
  }
  return { w: outW, h: outH, data };
}

function shade(o: SceneOptions, person: Shape[], feet: Foot[], vx: number, vy: number, farPx: number): number {
  const x = o.originX + vx * o.mmPerPx;
  const z = (o.floorRow - vy) * o.mmPerPx;
  // Near foot's shapes come first; the far leg is drawn as if `farPx` higher up in the picture.
  for (let k = 0; k < person.length; k++) {
    const far = k >= 5 && k < 10;
    const zz = far ? z - farPx * o.mmPerPx : z;
    if (person[k].hit(x, zz)) return person[k].grey;
  }
  let g = background(o, x, z);
  // Shadow: a dark strip on the floor right under each shoe, fading as the shoe rises. It lies on the floor, so from a
  // lens at ankle height (≈ 8 cm up, 3 m away) the few centimetres of floor it covers in depth span under 2 mm of the
  // picture's height around the contact line.
  if (o.shadow && abs(z) < 2) {
    for (const f of feet) {
      const h = max(0, f.z);
      const toe = f.x;
      const heel = fromLocal(f, LEN, 0).x;
      if (x > min(toe, heel) - 25 && x < max(toe, heel) + 25) g *= 1 - o.shadow * exp(-h / 25);
    }
  }
  // Glossy floor: below each foot's contact line it mirrors what is above it (the far leg's line is `farPx` higher).
  const farZ = farPx * o.mmPerPx;
  if (o.reflection && z < farZ && z > -200) {
    for (let k = 0; k < person.length; k++) {
      const far = k >= 5 && k < 10;
      if ((far || z < 0) && person[k].hit(x, far ? farZ - z : -z)) {
        const a = o.reflection * exp(z / 80);
        g = g * (1 - a) + person[k].grey * a;
        break;
      }
    }
  }
  return g;
}

export function defaultScene(kind: SceneKind, over: Partial<SceneOptions> = {}): SceneOptions {
  const base: SceneOptions = {
    kind,
    fps: 240,
    width: 360,
    height: 640,
    mmPerPx: 3,
    floorRow: 560,
    originX: -540,
    takeoffS: 1.2031,
    flightS: 0.5523,
    durationS: 2.6,
    noise: 2,
    seed: 1,
  };
  if (kind === 'approach') return { ...base, mmPerPx: 6, width: 480, height: 360, floorRow: 300, originX: -1300, takeoffS: 1.1013, flightS: 0.6411, durationS: 2.4, ...over };
  if (kind === 'drop') return { ...base, originX: -900, width: 420, takeoffS: 1.4017, flightS: 0.4613, contactS: 0.2117, boxMm: 300, ...over };
  return { ...base, ...over };
}
