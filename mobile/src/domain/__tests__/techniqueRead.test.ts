import { LM, type Pose } from '../pose';
import { analyseTechnique, findJumpWindow, type PoseFrame } from '../technique';
import { coarseFrames, coarseStep, denseFrames, denseSquares, framesFromWire, MARKER_GAP_M, squareAround, windowOf, type WireFrame } from '../techniqueRead';
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

describe('reading a clip this way', () => {
  it('gives the analysis what it needs: a coarse pass, the jump in it, then every frame around the jump', () => {
    const scene = poseScene({ bystanderM: 2 });
    const total = scene.frames.length;
    const fps = scene.options.fps;
    const tapAt = scene.truth.takeoffFrame - 60;
    const target = hipOf(scene.frames[tapAt].poses[0]);
    const { forward, backward } = coarseFrames(tapAt, total, coarseStep(fps));
    const coarse = framesFromWire(read(scene, [...forward, ...backward]), scene.width, scene.height, fps);
    const win = findJumpWindow(coarse, fps, { before: 1.2, after: 0.8, target })!;
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
