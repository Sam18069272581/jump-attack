/**
 * Body landmarks as MediaPipe's pose model reports them, and what the technique analysis builds from them: the whole
 * body's centre of mass and joint angles.
 *
 * The centre of mass is the mass-weighted mean of 14 segments' own centres (de Leva 1996, the adjusted
 * Zatsiorsky–Seluyanov parameters for men, Table 4), each placed along the line between the two landmarks that stand
 * in for its anatomical end points. The model is the standard one for 2D video analysis (Winter, "Biomechanics and
 * Motor Control of Human Movement", ch. 4); its error against force plates is a few cm for the CoM path, most of it a
 * steady offset that cancels out of velocities.
 */

/** MediaPipe Pose Landmarker's 33 landmarks, by index. */
export const LM = {
  nose: 0,
  leftEar: 7,
  rightEar: 8,
  leftShoulder: 11,
  rightShoulder: 12,
  leftElbow: 13,
  rightElbow: 14,
  leftWrist: 15,
  rightWrist: 16,
  leftPinky: 17,
  rightPinky: 18,
  leftIndex: 19,
  rightIndex: 20,
  leftHip: 23,
  rightHip: 24,
  leftKnee: 25,
  rightKnee: 26,
  leftAnkle: 27,
  rightAnkle: 28,
  leftHeel: 29,
  rightHeel: 30,
  leftToe: 31,
  rightToe: 32,
} as const;

export const LANDMARK_COUNT = 33;
/** Numbers per landmark on the wire from the page: x, y (0–1 of the picture), z (MediaPipe's relative depth), visibility. */
export const LANDMARK_FIELDS = 4;

export type Pt = { x: number; y: number };
/** One landmark: where it is, MediaPipe's relative depth `z` (smaller is nearer the camera) and how likely it is to be visible, 0–1. */
export type Landmark = Pt & { z: number; v: number };
/** A person's 33 landmarks, indexed by `LM`. */
export type Pose = Landmark[];

export type Side = 'left' | 'right';

/** The landmarks of one side of the body. */
export const SIDE = {
  left: { shoulder: LM.leftShoulder, elbow: LM.leftElbow, wrist: LM.leftWrist, index: LM.leftIndex, pinky: LM.leftPinky, hip: LM.leftHip, knee: LM.leftKnee, ankle: LM.leftAnkle, heel: LM.leftHeel, toe: LM.leftToe },
  right: { shoulder: LM.rightShoulder, elbow: LM.rightElbow, wrist: LM.rightWrist, index: LM.rightIndex, pinky: LM.rightPinky, hip: LM.rightHip, knee: LM.rightKnee, ankle: LM.rightAnkle, heel: LM.rightHeel, toe: LM.rightToe },
} as const;

/**
 * The page's flat numbers for one person (x, y as shares of the picture's width and height) as landmarks in pixels.
 * Throws on a malformed list: the page and this decoder are written together, so that is a bug, not bad input.
 */
export function decodePose(values: number[], width: number, height: number): Pose {
  if (values.length !== LANDMARK_COUNT * LANDMARK_FIELDS) throw new Error(`pose has ${values.length} numbers, expected ${LANDMARK_COUNT * LANDMARK_FIELDS}`);
  const out: Pose = [];
  for (let i = 0; i < LANDMARK_COUNT; i++) {
    const k = i * LANDMARK_FIELDS;
    out.push({ x: values[k] * width, y: values[k + 1] * height, z: values[k + 2], v: values[k + 3] });
  }
  return out;
}

export const mid = (a: Pt, b: Pt): Pt => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
const along = (a: Pt, b: Pt, share: number): Pt => ({ x: a.x + (b.x - a.x) * share, y: a.y + (b.y - a.y) * share });
export const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);

/** A segment: its share of body mass, and where its own centre sits from the proximal end, as a share of its length. */
type Segment = { mass: number; com: number; from: (p: Pose) => Pt; to: (p: Pose) => Pt };

const hand = (s: Side) => (p: Pose) => mid(p[SIDE[s].index], p[SIDE[s].pinky]);
const limbSegments = (s: Side): Segment[] => {
  const k = SIDE[s];
  return [
    // de Leva 1996, Table 4, men: mass %, CoM % of length from the proximal end point.
    { mass: 0.0271, com: 0.5772, from: (p) => p[k.shoulder], to: (p) => p[k.elbow] }, // upper arm, shoulder → elbow
    { mass: 0.0162, com: 0.4574, from: (p) => p[k.elbow], to: (p) => p[k.wrist] }, // forearm, elbow → wrist
    // Hand, wrist → third knuckle; MediaPipe's index and pinky points sit on the knuckles either side of it.
    { mass: 0.0061, com: 0.79, from: (p) => p[k.wrist], to: hand(s) },
    { mass: 0.1416, com: 0.4095, from: (p) => p[k.hip], to: (p) => p[k.knee] }, // thigh, hip → knee
    { mass: 0.0433, com: 0.4459, from: (p) => p[k.knee], to: (p) => p[k.ankle] }, // shank, knee → ankle
    { mass: 0.0137, com: 0.4415, from: (p) => p[k.heel], to: (p) => p[k.toe] }, // foot, heel → toe tip
  ];
};

export const SEGMENTS: Segment[] = [
  // Head and neck: its centre is level with the ear canal (de Leva's 59.76 % from the vertex to the jaw angle), and
  // MediaPipe has no vertex, so the midpoint of the ears stands in for it.
  { mass: 0.0694, com: 0, from: (p) => mid(p[LM.leftEar], p[LM.rightEar]), to: (p) => mid(p[LM.leftEar], p[LM.rightEar]) },
  // Trunk, suprasternale → mid-hip, 44.86 % down; the shoulders' midpoint stands in for the suprasternal notch.
  { mass: 0.4346, com: 0.4486, from: (p) => mid(p[LM.leftShoulder], p[LM.rightShoulder]), to: (p) => mid(p[LM.leftHip], p[LM.rightHip]) },
  ...limbSegments('left'),
  ...limbSegments('right'),
];

/** The whole body's centre of mass. */
export function centreOfMass(p: Pose): Pt {
  let x = 0;
  let y = 0;
  let m = 0;
  for (const s of SEGMENTS) {
    const c = along(s.from(p), s.to(p), s.com);
    x += s.mass * c.x;
    y += s.mass * c.y;
    m += s.mass;
  }
  return { x: x / m, y: y / m };
}

/** The angle at `b` between the lines to `a` and `c`, degrees: 180 is a straight joint. */
export function jointAngle(a: Pt, b: Pt, c: Pt): number {
  const v1 = { x: a.x - b.x, y: a.y - b.y };
  const v2 = { x: c.x - b.x, y: c.y - b.y };
  const n = Math.hypot(v1.x, v1.y) * Math.hypot(v2.x, v2.y);
  if (n === 0) return 180;
  const cos = Math.max(-1, Math.min(1, (v1.x * v2.x + v1.y * v2.y) / n));
  return (Math.acos(cos) * 180) / Math.PI;
}

/** The lines MediaPipe's own drawing joins, for drawing a skeleton. */
export const BONES: [number, number][] = [
  [LM.leftShoulder, LM.rightShoulder],
  [LM.leftShoulder, LM.leftElbow],
  [LM.leftElbow, LM.leftWrist],
  [LM.rightShoulder, LM.rightElbow],
  [LM.rightElbow, LM.rightWrist],
  [LM.leftShoulder, LM.leftHip],
  [LM.rightShoulder, LM.rightHip],
  [LM.leftHip, LM.rightHip],
  [LM.leftHip, LM.leftKnee],
  [LM.leftKnee, LM.leftAnkle],
  [LM.leftAnkle, LM.leftHeel],
  [LM.leftHeel, LM.leftToe],
  [LM.leftAnkle, LM.leftToe],
  [LM.rightHip, LM.rightKnee],
  [LM.rightKnee, LM.rightAnkle],
  [LM.rightAnkle, LM.rightHeel],
  [LM.rightHeel, LM.rightToe],
  [LM.rightAnkle, LM.rightToe],
];
