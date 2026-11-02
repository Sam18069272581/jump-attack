import { AIR_LEG, DOWN_LEG, findPoseJumps, JUMP_LIFT_LEG, LEG_OF_STATURE, poseCoarseFrames, splitAt, stanceRuns, STANCE_S, startFrom, STILL_LEG, type PoseFlight } from '../poseJump';
import { defaultPoseJumpScene, poseJumpScene, poseJumpTruth, type PoseJumpSceneOptions } from '../testing/poseJumpScene';
import { defaultPoseScene, poseScene } from '../testing/poseScene';
import { LM } from '../pose';
import type { PoseFrame } from '../technique';
import { standing } from '../testing/standing';

/** The coarse pass's reading of a scene: only the frames it asks for. */
function coarse(frames: PoseFrame[], fps: number, rebound = false): PoseFrame[] {
  const want = new Set(poseCoarseFrames({ frames: frames.length, captureFps: fps }, { rebound }));
  return frames.filter((f) => want.has(f.frame));
}

function run(over: Partial<PoseJumpSceneOptions>, kind: 'jump' | 'drop' = 'jump') {
  const o = defaultPoseJumpScene(over);
  const r = findPoseJumps(coarse(poseJumpScene(o), o.fps, o.flights.length > 1), o.fps, { kind });
  return { o, r, truth: poseJumpTruth(o) };
}

/**
 * Each true event lies within 1/30 s (8 frames at 240 fps) of the bracket found for it: a foot moving at take-off or
 * landing speed (about 2 m/s) covers the 3.5 cm it may be up and still read as down in that time. The bracket spans at
 * most three coarse steps (`step` frames): a low jump's feet take a step or two to clear 7 cm.
 */
const SLACK = 8;
function expectBracketed(flights: PoseFlight[], truth: ReturnType<typeof poseJumpTruth>, step = 8) {
  expect(flights).toHaveLength(truth.length);
  const near = (b: [number, number], t: number) => {
    expect(t).toBeGreaterThanOrEqual(b[0] - SLACK);
    expect(t).toBeLessThanOrEqual(b[1] + SLACK);
    expect(b[1] - b[0]).toBeLessThanOrEqual(3 * step);
  };
  flights.forEach((f, i) => {
    near(f.takeoff.at, truth[i].takeoff);
    near(f.landing.at, truth[i].landing);
    if (truth[i].touchdown != null) near(f.touchdown!.at, truth[i].touchdown!);
  });
}

describe('poseCoarseFrames', () => {
  it('reads about 30 frames a real second, 60 for repeated jumps, at most 300', () => {
    // 240 fps: every 8th frame (240 / 30), every 4th for rebounds; a 20 s clip (4800 frames) every 16th.
    expect(poseCoarseFrames({ frames: 100, captureFps: 240 }).slice(0, 3)).toEqual([0, 8, 16]);
    expect(poseCoarseFrames({ frames: 100, captureFps: 240 }, { rebound: true }).slice(0, 3)).toEqual([0, 4, 8]);
    expect(poseCoarseFrames({ frames: 4800, captureFps: 240 })).toHaveLength(300);
    expect(poseCoarseFrames({ frames: 1000, captureFps: 240 }, { range: { from: 500, to: 600 } })).toEqual([500, 508, 516, 524, 532, 540, 548, 556, 564, 572, 580, 588, 596]);
  });
});

describe('stanceRuns', () => {
  it('takes still feet for standing, and not the still moment at the top of a flight', () => {
    // 30 samples a second: standing at y 1000, a flight peaking 150 px up (feet slow to a stop there for a few samples),
    // and standing again 60 px lower in the picture (landed nearer the phone).
    const ys = [1000, 1001, 999, 1000, 1000, 960, 900, 860, 850, 849, 851, 860, 900, 980, 1060, 1061, 1059, 1060];
    const runs = stanceRuns(
      ys.map((y, k) => ({ t: k / 30, y })),
      10,
    );
    expect(runs.map((r) => [r.a, r.b, r.y])).toEqual([
      [0, 4, 1000],
      [14, 17, 1060],
    ]);
  });

  it('standing means 3.5 cm for 80 ms', () => {
    // 0.04 of a 0.88 m leg = 3.5 cm, about twice the pose model's wobble at the feet; 80 ms is half the shortest
    // rebound contact a 10/5 test sees (≈ 0.15 s).
    expect(STILL_LEG * LEG_OF_STATURE * 1.8).toBeCloseTo(0.0353, 3);
    expect(STANCE_S).toBe(0.08);
  });
});

describe('findPoseJumps', () => {
  it('thresholds in leg lengths: about 7 cm up, 3.5 cm down, 9 cm at the top, for a 1.80 m athlete', () => {
    // Leg = 0.49 × 1.80 m = 0.88 m: 0.08 leg = 7.1 cm, 0.04 leg = 3.5 cm, 0.1 leg = 8.8 cm.
    const leg = LEG_OF_STATURE * 1.8;
    expect(AIR_LEG * leg).toBeCloseTo(0.0706, 3);
    expect(DOWN_LEG * leg).toBeCloseTo(0.0353, 3);
    expect(JUMP_LIFT_LEG * leg).toBeCloseTo(0.0882, 3);
  });

  it('finds a CMJ filmed from the front, the phone higher than the ankles', () => {
    const { r, truth } = run({});
    if (!r.ok) throw new Error(r.problem);
    expectBracketed(r.flights, truth);
    // Feet under the athlete, the floor where they stand, their height from the leg.
    for (const { spot } of [r.flights[0].takeoff, r.flights[0].landing]) {
      expect(spot.left).toBeLessThan(540);
      expect(spot.right).toBeGreaterThan(540);
      expect(spot.y).toBeCloseTo(1150, -1);
      expect(spot.stature).toBeGreaterThan(650);
      expect(spot.stature).toBeLessThan(750);
    }
  });

  it('finds it side-on, with a rolled phone, jittery landmarks and missed frames', () => {
    for (const over of [{ yaw: 0 }, { rollDeg: 4 }, { noisePx: 5 }, { dropout: 0.2, seed: 3 }]) {
      const { r, truth } = run(over);
      if (!r.ok) throw new Error(`${JSON.stringify(over)}: ${r.problem}`);
      expectBracketed(r.flights, truth);
    }
  });

  it('finds a jump that lands nearer a phone set above the ankles', () => {
    // The clip that started this (2026-10-31): phone about knee-high, landing 150 px (8 % of the picture) lower than
    // the take-off, about as far as the jump is high in the picture.
    const { r, truth } = run({ landShiftPx: 150 });
    if (!r.ok) throw new Error(r.problem);
    expectBracketed(r.flights, truth);
    expect(r.flights[0].takeoff.spot.y).toBeCloseTo(1150, -1);
    expect(r.flights[0].landing.spot.y).toBeCloseTo(1300, -1);
  });

  it('finds a low jump: 0.3 s in the air, 11 cm', () => {
    // h = g t² / 8 = 9.81 × 0.3² / 8 = 11.0 cm, above the 8.8 cm a flight must reach (0.1 of a 0.88 m leg).
    const { r, truth } = run({ flights: [{ takeoffS: 1.2031, flightS: 0.3 }] });
    if (!r.ok) throw new Error(r.problem);
    expectBracketed(r.flights, truth);
  });

  it('finds every hop of repeated jumps off short contacts', () => {
    const flights: { takeoffS: number; flightS: number }[] = [];
    let t = 1.2031;
    for (const [flightS, contactS] of [
      [0.4623, 0.1813],
      [0.4511, 0.1917],
      [0.4382, 0.2046],
      [0.4294, 0.1958],
      [0.4117, 0.2231],
    ]) {
      flights.push({ takeoffS: t, flightS });
      t += flightS + contactS;
    }
    const { r, truth } = run({ flights, durationS: 5 });
    if (!r.ok) throw new Error(r.problem);
    // Read twice as densely: a coarse step of 4 frames.
    expectBracketed(r.flights, truth, 4);
  });

  it("finds a drop jump's touch-down, contact and rebound", () => {
    const { r, truth } = run({ drop: { boxM: 0.3, offS: 0.6 }, flights: [{ takeoffS: 1.05, flightS: 0.46 }] }, 'drop');
    if (!r.ok) throw new Error(r.problem);
    expectBracketed(r.flights, truth);
  });

  it('follows the tapped athlete past someone standing beside them', () => {
    const o = defaultPoseJumpScene({ bystanderX: 850 });
    const r = findPoseJumps(coarse(poseJumpScene(o), o.fps), o.fps, { kind: 'jump', target: { x: 540, y: 900 } });
    if (!r.ok) throw new Error(r.problem);
    expectBracketed(r.flights, poseJumpTruth(o));
  });

  it('finds the jump at the end of a run-up and none of the strides before it', () => {
    const scene = poseScene(defaultPoseScene({ markers: null }));
    const r = findPoseJumps(coarse(scene.frames, 240), 240, { kind: 'jump' });
    if (!r.ok) throw new Error(r.problem);
    expect(r.flights).toHaveLength(1);
    expectBracketed(r.flights, [{ takeoff: scene.truth.takeoffFrame, landing: scene.truth.landingFrame! }]);
  });

  it('says there is no jump when the athlete only squats, and no athlete when nobody is found', () => {
    expect(run({ flights: [] }).r).toEqual({ ok: false, problem: 'no-jump' });
    expect(run({ dropout: 1 }).r).toEqual({ ok: false, problem: 'no-athlete' });
  });

  it("doesn't take a gap in the pose model's readings for a flight", () => {
    // Nobody found for 0.4 s in the middle of standing: no reading says the feet were up.
    const o = defaultPoseJumpScene({ flights: [] });
    const frames = poseJumpScene(o).map((f) => (f.t > 1 && f.t < 1.4 ? { ...f, poses: [] } : f));
    expect(findPoseJumps(coarse(frames, o.fps), o.fps, { kind: 'jump' })).toEqual({ ok: false, problem: 'no-jump' });
  });
});

describe('starting to follow', () => {
  it('starts at the biggest person in the first frame with anyone', () => {
    const o = defaultPoseJumpScene({ bystanderX: 850 });
    const frames = poseJumpScene(o).slice(0, 3);
    frames[0] = { ...frames[0], poses: [] };
    const s = startFrom(frames)!;
    expect(s.frame).toBe(1);
    // The athlete's hips: 0.53 of 700 px above the floor at 1150, at x 540.
    expect(s.at.x).toBeCloseTo(540, -1);
    expect(s.at.y).toBeCloseTo(1150 - 0.53 * 700, -1);
    expect(startFrom([{ frame: 0, t: 0, poses: [] }])).toBeNull();
  });

  // Seen in a real clip (a drop jump filmed low, in black, against dark machines): beside the athlete the model read a
  // second "person" upside down, hips at the top of the picture and legs reaching up out of it, longer than the
  // athlete's. In another, the middle frame held only a scrap of someone at the picture's edge. And a clip left uncut
  // holds the athlete walking up to the phone, biggest of all with the feet out of the picture.
  const athlete = standing({ x: 140, floor: 1150, stature: 1000 });
  const ghost = standing({ x: 200, floor: 1150, stature: 1200 }).map((l) => ({ ...l, y: 400 - (l.y - 400) }));

  it('skips a reading upside down (ankles above the hips), however long its legs', () => {
    const s = startFrom([{ frame: 0, t: 0, poses: [ghost, athlete] }], { width: 720, height: 1280 })!;
    expect(s.at.x).toBeCloseTo(140, 6);
    expect(s.at.y).toBeCloseTo(1150 - 0.53 * 1000, 6);
  });

  const picture = { width: 720, height: 1280 };

  it('skips a scrap of someone at the edge, or someone up close with the feet below the picture, for the next frame', () => {
    const scrap = standing({ x: -10, floor: 520, stature: 150 });
    const close = standing({ x: 360, floor: 1700, stature: 1600 });
    const s = startFrom(
      [
        { frame: 3010, t: 0, poses: [scrap] },
        { frame: 2196, t: 0, poses: [close] },
        { frame: 3823, t: 0, poses: [athlete] },
      ],
      picture,
    )!;
    expect(s.frame).toBe(3823);
    expect(s.at.x).toBeCloseTo(athlete[LM.leftHip].x, 6);
    expect(startFrom([{ frame: 0, t: 0, poses: [ghost, scrap, close] }], picture)).toBeNull();
  });

  it('splits the coarse frames at the one nearest the start, both halves starting there', () => {
    expect(splitAt([0, 8, 16, 24, 32], 17)).toEqual({ forward: [16, 24, 32], backward: [16, 8, 0] });
    expect(splitAt([0, 8], 100)).toEqual({ forward: [8], backward: [8, 0] });
  });
});
