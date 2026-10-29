import { LM, type Pose } from '../pose';
import { analyseTechnique, findJumpWindow, type PoseFrame } from '../technique';
import { coarseFrames, coarseStep, denseFrames, denseSquares, framesFromWire, JUMP_WINDOW, MARKER_GAP_M, planWindow, squareAround, TAP_REACH_S, windowOf, type WireFrame } from '../techniqueRead';
import { asWire, poseScene, type PoseScene } from '../testing/poseScene';

/** The scene's frames as the page would send them, for the frames asked. */
function read(scene: PoseScene, frames: number[]): WireFrame[] {
  const wire = asWire(scene);
  return frames.map((f) => [f, f / scene.options.fps, ...wire[f].values] as WireFrame);
}

const hipOf = (p: Pose) => ({ x: (p[LM.leftHip].x + p[LM.rightHip].x) / 2, y: (p[LM.leftHip].y + p[LM.rightHip].y) / 2 });

describe('the coarse pass', () => {
  it('reads about 60 frames a second of real time: every 4th frame of a 240 fps slow-motion clip, every frame at 60', () => {
    expect([240, 120, 60, 30].map(coarseStep)).toEqual([4, 2, 1, 1]);
  });

  it('goes both ways from the tapped frame, each half starting on it', () => {
    expect(coarseFrames(10, 20, 4)).toEqual({ forward: [10, 14, 18], backward: [10, 6, 2] });
  });

  it('goes no further than `reach` frames each way when given: a take filmed in the app runs on long after the jump', () => {
    expect(coarseFrames(100, 1000, 4, 10)).toEqual({ forward: [100, 104, 108], backward: [100, 96, 92] });
  });
});

describe('how much of the clip is read', () => {
  it('holds the last 3 m of a slow run-up, the plant and the rise before the top of the jump, and the landing after it', () => {
    // 3 m at 4.5 m/s, a 0.2 s plant, and 3.3 m/s of take-off velocity rising for vz / g.
    expect(JUMP_WINDOW.before).toBeGreaterThanOrEqual(3 / 4.5 + 0.2 + 3.3 / 9.81);
    // Falling back takes as long as the rise; the landing's contact needs a little after it.
    expect(JUMP_WINDOW.after).toBeGreaterThanOrEqual(3.3 / 9.81 + 0.3);
  });

  it('reads far enough each way from a tap anywhere within a second of the jump to hold the whole window', () => {
    expect(TAP_REACH_S).toBeGreaterThanOrEqual(Math.max(JUMP_WINDOW.before, JUMP_WINDOW.after) + 1);
  });
});

describe('framesFromWire', () => {
  it('puts the frames in file order, in real time, people in pixels', () => {
    const scene = poseScene({ fps: 240 });
    const frames = framesFromWire(read(scene, [8, 4, 0]), scene.width, scene.height, 240);
    expect(frames.map((f) => [f.frame, f.t])).toEqual([
      [0, 0],
      [4, 4 / 240],
      [8, 8 / 240],
    ]);
    expect(frames[1].poses[0][LM.leftHip].x).toBeCloseTo(scene.frames[4].poses[0][LM.leftHip].x, 0);
  });

  it('keeps the fuller reading of a frame read twice', () => {
    const [item] = read(poseScene(), [12]);
    const frames = framesFromWire([[12, null], item], 1920, 1080, 240);
    expect(frames).toHaveLength(1);
    expect(frames[0].poses).toHaveLength(1);
  });

  it('takes a picture shown again (the browser’s own time unchanged) for a missing frame, not a still athlete', () => {
    const [a, b] = read(poseScene(), [30, 31]);
    const frames = framesFromWire([a, [31, a[1], ...b.slice(2)] as WireFrame], 1920, 1080, 240);
    expect(frames.map((f) => f.poses.length)).toEqual([1, 0]);
  });
});

describe('denseSquares', () => {
  const scene = poseScene({ bystanderM: 2 });
  const step = coarseStep(240);
  const coarse = framesFromWire(read(scene, scene.frames.filter((f) => f.frame % step === 0).map((f) => f.frame)), scene.width, scene.height, 240);
  const target = hipOf(scene.frames[scene.truth.takeoffFrame].poses[0]);

  it('holds the whole athlete in every frame the coarse pass skipped, through the run-up, the jump and the landing', () => {
    const frames = scene.frames.filter((f) => f.frame % step !== 0).map((f) => f.frame);
    const squares = denseSquares(coarse, target, frames);
    frames.forEach((f, i) => {
      const sq = squares[i];
      for (const l of scene.frames[f].poses[0]) {
        expect(l.x).toBeGreaterThan(sq.x);
        expect(l.x).toBeLessThan(sq.x + sq.s);
        expect(l.y).toBeGreaterThan(sq.y);
        expect(l.y).toBeLessThan(sq.y + sq.s);
      }
    });
  });

  it('is the page’s square: 2.7 body lengths across, a little above the hips', () => {
    expect(squareAround({ x: 1000, y: 600 }, 200)).toEqual({ x: 730, y: 250, s: 540 });
  });
});

describe('planWindow', () => {
  const scene = poseScene();
  const fps = scene.options.fps;
  const step = coarseStep(fps);
  const coarseOf = (frames: number[]) => framesFromWire(read(scene, frames), scene.width, scene.height, fps);
  const every = scene.frames.filter((f) => f.frame % step === 0).map((f) => f.frame);
  const target = hipOf(scene.frames[scene.truth.takeoffFrame].poses[0]);

  it('finds the jump around the tap, from the run-up’s last 3 m to after the landing', () => {
    const plan = planWindow(coarseOf(every), fps, target);
    if (!plan.ok) throw new Error(plan.problem);
    expect(plan.win.from).toBeLessThan(Math.round(scene.truth.plantDownS * fps) - 0.5 * fps);
    expect(plan.win.to).toBeGreaterThan(scene.truth.landingFrame!);
  });

  it('says nobody was followed when the page found no one', () => {
    const empty = every.map((frame) => ({ frame, t: frame / fps, poses: [] }));
    expect(planWindow(empty, fps, target)).toEqual({ ok: false, problem: 'no-athlete' });
  });

  it('says there was no jump when the stretch read holds only the run-up', () => {
    const runUp = every.filter((f) => f / fps < scene.truth.plantDownS - 0.1);
    expect(planWindow(coarseOf(runUp), fps, target)).toEqual({ ok: false, problem: 'no-jump' });
  });
});

describe('reading a clip this way', () => {
  it('gives the analysis what it needs: a coarse pass, the jump in it, then every frame around the jump', () => {
    const scene = poseScene({ bystanderM: 2 });
    const total = scene.frames.length;
    const fps = scene.options.fps;
    const tapAt = scene.truth.takeoffFrame - 60;
    const target = hipOf(scene.frames[tapAt].poses[0]);
    const { forward, backward } = coarseFrames(tapAt, total, coarseStep(fps));
    const coarse = framesFromWire(read(scene, [...forward, ...backward]), scene.width, scene.height, fps);
    const win = findJumpWindow(coarse, fps, { ...JUMP_WINDOW, target })!;
    const more = denseFrames(win, total, coarse.map((f) => f.frame));
    expect(more.length).toBeGreaterThan(0);
    expect(more.every((f) => f >= win.from && f <= win.to && f % 4 !== tapAt % 4)).toBe(true);
    const all: PoseFrame[] = framesFromWire(read(scene, [...forward, ...backward, ...more]), scene.width, scene.height, fps);
    const frames = windowOf(all, win);
    expect(frames.map((f) => f.frame)).toEqual(Array.from({ length: frames.length }, (_, i) => frames[0].frame + i));
    const r = analyseTechnique({ frames, captureFps: fps, markers: scene.markers, target: win.target });
    if (!r.ok) throw new Error(r.problem);
    expect(Math.abs(r.result.metrics.vz!.value - scene.truth.vz)).toBeLessThan(r.result.metrics.vz!.error);
  });

  it('uses the agreed 3 m between the floor markers', () => {
    expect(MARKER_GAP_M).toBe(3);
  });
});
