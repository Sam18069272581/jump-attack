import { analyseCoarse, analyseFine, coarseRequest, type CoarseOptions, type DetectKind, type FrameRequest } from '../autoMark';
import { defaultScene, renderScene, sceneEvents, type SceneOptions } from '../testing/jumpScene';

/** Both passes on a synthetic clip, as in autoMark.test.ts, with the choices an athlete makes on the analysis screen. */
function detect(o: SceneOptions, opts: CoarseOptions = {}, kind: DetectKind = 'jump') {
  const video = { width: o.width, height: o.height, frames: Math.floor(o.durationS * o.fps), captureFps: o.fps };
  const grab = (r: FrameRequest) => r.frames.map((f) => renderScene(o, f, r.rect, r.w, r.h));
  const req = coarseRequest(video, opts);
  const coarse = analyseCoarse(video, req, grab(req), kind, opts);
  if (!coarse.ok) return { coarse, req };
  return { coarse, req, fine: analyseFine(coarse.plan, grab(coarse.plan.request)) };
}

function expectEvents(got: { marks: number[] }[], want: { takeoff: number; landing: number }[]) {
  expect(got).toHaveLength(want.length);
  got.forEach((j, i) => {
    // Within one frame of a careful marker, as for single jumps.
    expect(Math.abs(j.marks[0] - want[i].takeoff)).toBeLessThanOrEqual(1);
    expect(Math.abs(j.marks[1] - want[i].landing)).toBeLessThanOrEqual(1);
  });
}

describe('a set of jumps in one clip', () => {
  it('finds every rebound of a repeated-jump set, with contacts of 0.18–0.22 s between them', () => {
    const o = defaultScene('repeat', { shadow: 0.4 });
    const r = detect(o, { rebound: true });
    expect(r.fine?.ok).toBe(true);
    if (r.fine?.ok) expectEvents(r.fine.jumps, sceneEvents(o));
  });

  it('only looks inside the part of the clip the athlete chose', () => {
    const o = defaultScene('repeat', { shadow: 0.4 });
    const all = sceneEvents(o);
    // From before the first take-off to just after the third landing: the first three jumps.
    const range = { from: all[0].takeoff - 200, to: all[2].landing + 20 };
    const r = detect(o, { rebound: true, range });
    expect(Math.min(...r.req.frames)).toBeGreaterThanOrEqual(range.from);
    expect(Math.max(...r.req.frames)).toBeLessThanOrEqual(range.to);
    expect(r.fine?.ok).toBe(true);
    if (r.fine?.ok) expectEvents(r.fine.jumps, all.slice(0, 3));
  });
});

describe('locking onto the athlete', () => {
  // A wide picture with someone bigger swaying beside the athlete the whole clip: more pixels change around them than
  // around the athlete, so on its own the detector watches the wrong person.
  const o = defaultScene('cmj', { width: 1080, bystander: { x: 1800, swayMm: 250 }, shadow: 0.4 });
  // Where the athlete's feet are in the video: toe at scene x 0, the floor at row 560, 3 mm a pixel.
  const feet = { x: (0 - o.originX) / o.mmPerPx - 40, y: o.floorRow - 20 };

  it("misses the athlete's jump when nobody is picked", () => {
    const r = detect(o);
    const right = r.fine?.ok && r.fine.jumps.length === 1 && Math.abs(r.fine.jumps[0].marks[0] - sceneEvents(o)[0].takeoff) <= 1;
    expect(right).toBeFalsy();
  });

  it('follows the athlete the athlete tapped', () => {
    const r = detect(o, { target: feet });
    expect(r.fine?.ok).toBe(true);
    if (r.fine?.ok) expectEvents(r.fine.jumps, sceneEvents(o));
  });

  it("reports the box it locked onto, around the athlete's feet and clear of the bystander", () => {
    const r = detect(o, { target: feet });
    expect(r.coarse.ok).toBe(true);
    if (!r.coarse.ok) return;
    const b = r.coarse.plan.box;
    expect(feet.x).toBeGreaterThanOrEqual(b.x);
    expect(feet.x).toBeLessThanOrEqual(b.x + b.w);
    expect(b.x + b.w).toBeLessThan((1800 - 260 - 250 - o.originX) / o.mmPerPx);
  });
});

describe('flags', () => {
  it('flags a jump whose feet reach the edge of the picture', () => {
    // The right edge of the picture 5 mm past the toe.
    const o = defaultScene('cmj', { originX: -1075, shadow: 0.4 });
    const r = detect(o);
    expect(r.fine?.ok).toBe(true);
    if (r.fine?.ok) expect(r.fine.jumps[0].flags).toContain('edge');
  });

  it('does not flag a jump in the middle of the picture', () => {
    const r = detect(defaultScene('cmj', { shadow: 0.4 }));
    expect(r.fine?.ok).toBe(true);
    if (r.fine?.ok) expect(r.fine.jumps[0].flags ?? []).toEqual([]);
  });
});
