import { centreOfMass, decodePose, distanceToBody, jointAngle, LANDMARK_COUNT, LANDMARK_FIELDS, LM, SEGMENTS, SIDE, type Pose, type Pt } from '../pose';
import { standing } from '../testing/standing';

/** A pose with every landmark at `at`, then the given ones moved. */
function poseWith(at: Pt, moves: [number[], Pt][] = []): Pose {
  const p: Pose = Array.from({ length: LANDMARK_COUNT }, () => ({ ...at, z: 0, v: 1 }));
  for (const [idx, q] of moves) for (const i of idx) p[i] = { ...q, z: 0, v: 1 };
  return p;
}

describe('decodePose', () => {
  it('turns shares of the picture into pixels and keeps depth and visibility', () => {
    const values = Array.from({ length: LANDMARK_COUNT * LANDMARK_FIELDS }, (_, i) => (i % 4 === 0 ? 0.5 : i % 4 === 1 ? 0.25 : i % 4 === 2 ? -0.1 : 0.9));
    const p = decodePose(values, 1920, 1080);
    expect(p).toHaveLength(LANDMARK_COUNT);
    expect(p[LM.nose]).toEqual({ x: 960, y: 270, z: -0.1, v: 0.9 });
  });

  it('throws on a list of the wrong length: the page and the decoder are written together', () => {
    expect(() => decodePose([0.5, 0.5], 100, 100)).toThrow();
  });
});

describe('centreOfMass', () => {
  it('uses de Leva’s mass shares, which add up to the whole body', () => {
    expect(SEGMENTS.reduce((s, seg) => s + seg.mass, 0)).toBeCloseTo(1, 10);
  });

  it('is the point itself when every landmark is in one place', () => {
    const c = centreOfMass(poseWith({ x: 12, y: -3 }));
    expect(c.x).toBeCloseTo(12, 10);
    expect(c.y).toBeCloseTo(-3, 10);
  });

  it('weights each segment’s own centre by its mass (worked example: a figure standing straight, arms hanging)', () => {
    // Picture y runs down. Ears at 0, shoulders 10, elbows 40, wrists 65, knuckles 75, hips 60, knees 105, ankles 150;
    // heels at (−5, 155) and toes at (20, 155).
    const both = (k: keyof typeof SIDE.left) => [SIDE.left[k], SIDE.right[k]];
    const p = poseWith({ x: 0, y: 0 }, [
      [both('shoulder'), { x: 0, y: 10 }],
      [both('elbow'), { x: 0, y: 40 }],
      [both('wrist'), { x: 0, y: 65 }],
      [[...both('index'), ...both('pinky')], { x: 0, y: 75 }],
      [both('hip'), { x: 0, y: 60 }],
      [both('knee'), { x: 0, y: 105 }],
      [both('ankle'), { x: 0, y: 150 }],
      [both('heel'), { x: -5, y: 155 }],
      [both('toe'), { x: 20, y: 155 }],
    ]);
    // Head 6.94 % at the ears; trunk 43.46 % at 44.86 % of shoulders → hips; then per side upper arm 2.71 % at 57.72 %,
    // forearm 1.62 % at 45.74 %, hand 0.61 % at 79 %, thigh 14.16 % at 40.95 %, shank 4.33 % at 44.59 %, foot 1.37 %
    // at 44.15 % from heel to toe.
    const y =
      0.0694 * 0 +
      0.4346 * (10 + 0.4486 * 50) +
      2 * (0.0271 * (10 + 0.5772 * 30) + 0.0162 * (40 + 0.4574 * 25) + 0.0061 * (65 + 0.79 * 10) + 0.1416 * (60 + 0.4095 * 45) + 0.0433 * (105 + 0.4459 * 45) + 0.0137 * 155);
    const x = 2 * 0.0137 * (-5 + 0.4415 * 25);
    const c = centreOfMass(p);
    expect(y).toBeCloseTo(55.419, 3);
    expect(c.y).toBeCloseTo(y, 9);
    expect(c.x).toBeCloseTo(x, 9);
  });
});

describe('jointAngle', () => {
  it('is 180° for a straight joint and 90° for a right angle', () => {
    expect(jointAngle({ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 })).toBeCloseTo(180);
    expect(jointAngle({ x: 1, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 1 })).toBeCloseTo(90);
    expect(jointAngle({ x: 1, y: 1 }, { x: 0, y: 0 }, { x: 1, y: 0 })).toBeCloseTo(45);
  });

  it('calls a joint with a zero-length limb straight rather than failing', () => {
    expect(jointAngle({ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 1, y: 0 })).toBe(180);
  });
});

describe('distanceToBody', () => {
  // Side-on, 1000 px tall, feet at y 1000 (domain/testing/standing.ts): the shin runs from the knee (500, 715) to the
  // ankle (500, 961), the head line from the shoulders (500, 182) to the nose (550, 70).
  const p = standing({ x: 500, floor: 1000, stature: 1000 });

  it('is 0 on a bone, between its ends as well as at them', () => {
    expect(distanceToBody(p, { x: 500, y: 715 })).toBe(0);
    expect(distanceToBody(p, { x: 500, y: 800 })).toBe(0);
  });

  it('is the distance to the nearest bone: beside the shin, past the toes, above the nose', () => {
    expect(distanceToBody(p, { x: 530, y: 800 })).toBeCloseTo(30, 6);
    // The toe is 112 px in front of the ankle, on the floor.
    expect(distanceToBody(p, { x: 612 + 40, y: 1000 })).toBeCloseTo(40, 6);
    expect(distanceToBody(p, { x: 550, y: 40 })).toBeCloseTo(30, 6);
  });
});
