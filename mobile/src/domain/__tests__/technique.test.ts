import { LM, type Pt } from '../pose';
import { analyseTechnique, findJumpWindow, PASS_LINE, polyFit, TAP_PX, type Markers, type MetricKey, type PoseFrame, type TechniqueInput, type TechniqueResult } from '../technique';
import { coarseFrames, coarseStep, denseFrames, framesFromWire, planWindow, TAP_REACH_S, windowOf, type WireFrame } from '../techniqueRead';
import { asWire, poseScene, type PoseScene, type PoseSceneOptions } from '../testing/poseScene';

function analyse(over: Partial<PoseSceneOptions> = {}, input: Partial<TechniqueInput> = {}) {
  const scene = poseScene(over);
  return { scene, r: analyseTechnique({ frames: scene.frames, captureFps: scene.options.fps, markers: scene.markers, ...input }) };
}

function resultOf(r: ReturnType<typeof analyseTechnique>): TechniqueResult {
  if (!r.ok) throw new Error(`analysis failed: ${r.problem}`);
  return r.result;
}

/** Each figure next to what the scene was built with. */
function truthOf(scene: PoseScene): Partial<Record<MetricKey, number>> {
  const t = scene.truth;
  return {
    vz: t.vz,
    vx: t.vx,
    angle: t.angleDeg,
    approach: t.approachSpeed ?? undefined,
    brake: t.brake,
    plant: t.plantS * 1000,
    gap: t.gapS != null ? t.gapS * 1000 : undefined,
    step: t.lastStepM,
    knee: t.kneeMinDeg,
  };
}

/**
 * The figures whose stated 95 % error, times `widen`, misses the truth. One clip may miss by a little 5 % of the time,
 * which 'stated errors' checks over many; one clip off by twice its error is a fault.
 */
function misses(scene: PoseScene, result: TechniqueResult, widen = 1): string[] {
  const truth = truthOf(scene);
  return (Object.keys(truth) as MetricKey[]).flatMap((k) => {
    const m = result.metrics[k];
    const want = truth[k];
    if (!m || want == null) return [];
    return Math.abs(m.value - want) <= widen * m.error ? [] : [`${k}: ${m.value.toFixed(3)} ± ${m.error.toFixed(3)}, truth ${want.toFixed(3)}`];
  });
}
const grossMisses = (scene: PoseScene, result: TechniqueResult) => misses(scene, result, 2);
const lose = (scene: PoseScene, from: number, to: number) => scene.frames.map((f) => (f.frame >= from && f.frame <= to ? { ...f, poses: [] } : f));
const touchDownOf = (scene: PoseScene) => scene.truth.contacts.find((c) => c.downS === scene.truth.plantDownS)!.downFrame;

/**
 * The frames the technique screen reads of a scene, as tools/pose-validation does: a coarse pass from a tap on the
 * athlete a quarter second before the take-off, the jump's window in it, then every frame of the window.
 */
function readAsTheScreen(scene: PoseScene): { frames: PoseFrame[]; target: Pt } {
  const fps = scene.options.fps;
  const total = scene.frames.length;
  const wire = asWire(scene);
  const read = (frames: number[]) => frames.map((f) => [f, f / fps, ...wire[f].values] as WireFrame);
  const tapAt = scene.truth.takeoffFrame - Math.round(0.25 * fps);
  const p = scene.frames[tapAt].poses[0];
  const { forward, backward } = coarseFrames(tapAt, total, coarseStep(fps), Math.round(TAP_REACH_S * fps));
  const coarseWire = [...read(forward), ...read(backward)];
  const coarse = framesFromWire(coarseWire, scene.width, scene.height, fps);
  const plan = planWindow(coarse, fps, { x: (p[LM.leftHip].x + p[LM.rightHip].x) / 2, y: (p[LM.leftHip].y + p[LM.rightHip].y) / 2 });
  if (!plan.ok) throw new Error(`reading failed: ${plan.problem}`);
  const dense = denseFrames(plan.win, total, coarse.map((f) => f.frame));
  return { frames: windowOf(framesFromWire([...coarseWire, ...read(dense)], scene.width, scene.height, fps), plan.win), target: plan.win.target };
}

describe('polyFit', () => {
  it('recovers a parabola exactly', () => {
    const ts = Array.from({ length: 20 }, (_, i) => i / 100);
    const f = polyFit(
      ts,
      ts.map((t) => 2 + 3 * t - 4.905 * t * t),
      2,
    );
    expect(f.c[0]).toBeCloseTo(2, 9);
    expect(f.c[1]).toBeCloseTo(3, 9);
    expect(f.c[2]).toBeCloseTo(-4.905, 8);
    expect(f.sd).toBeLessThan(1e-9);
  });
});

describe('a clip filmed as the guide asks (240 fps, side on, take-off foot towards the camera, markers 3 m apart)', () => {
  const { scene, r } = analyse();
  const result = resultOf(r);
  const t = scene.truth;

  it('finds a one-foot take-off from the right foot, the side facing the camera, with nothing to warn about', () => {
    expect(result.style).toEqual({ kind: 'one', foot: 'right' });
    expect(result.nearSide).toBe('right');
    expect(result.flags).toEqual([]);
  });

  it('puts the plant, take-off and landing within a frame of where they are', () => {
    const plantDownFrame = t.contacts.find((c) => c.downS === t.plantDownS)!.downFrame;
    expect(Math.abs(result.events.plantDown! - plantDownFrame)).toBeLessThanOrEqual(1);
    expect(Math.abs(result.events.takeoff - t.takeoffFrame)).toBeLessThanOrEqual(1);
    expect(Math.abs(result.events.landing! - t.landingFrame!)).toBeLessThanOrEqual(1);
  });

  it('finds every foot contact of the run-up, and the step before the plant', () => {
    const before = t.contacts.filter((c) => c.downS < t.plantDownS);
    for (const c of before) {
      const found = result.contacts.find((k) => k.foot === c.foot && Math.abs(k.downAt - c.downS * scene.options.fps) < 3);
      expect(found).toBeDefined();
    }
    expect(result.penultimate?.foot).toBe('left');
  });

  it('gets every figure to within its stated error', () => {
    expect(misses(scene, result)).toEqual([]);
  });

  it('is precise enough to act on for the take-off angle and horizontal velocity, contact time and the last step', () => {
    for (const k of ['vx', 'angle', 'plant', 'step'] as const) expect([k, result.metrics[k]?.status]).toEqual([k, 'ok']);
  });

  it('with the lines tapped by hand, can’t tell the vertical take-off velocity to 0.05 m/s or the run-up speed to 0.15 m/s, and says so', () => {
    // A line tapped 4 px high or low, 590 px from the other, tilts up by 0.4°: of 3.2 m/s forward, 0.03 m/s (1 SD)
    // leaks into the vertical. The hips pass the take-off line braking, at half the run-up's speed, so a tap there
    // moves its time twice as much.
    expect(result.metrics.vz?.status).toBe('imprecise');
    expect(result.metrics.approach?.status).toBe('imprecise');
  });

  it('can’t tell joint angles to the 5° worth acting on, and says so (markerless pose is good to about 7° RMSE)', () => {
    expect(result.metrics.knee?.status).toBe('imprecise');
    expect(result.metrics.trunk?.status).toBe('imprecise');
    // The scene leans back 10° as the plant foot comes down.
    expect(result.metrics.trunk!.value).toBeGreaterThan(5);
    expect(result.metrics.trunk!.value).toBeLessThan(15);
  });

  it('agrees with the markers on the scale: gravity at the athlete’s distance is 9.81 m/s² within 2 %', () => {
    expect(result.scale.gravityWithMarkers!).toBeGreaterThan(9.81 * 0.98);
    expect(result.scale.gravityWithMarkers!).toBeLessThan(9.81 * 1.02);
  });
});

describe('stated errors', () => {
  // The full check is tools/pose-validation (every way of filming it lists, 40 clips each by default). Here a sample of
  // it: 8 ways × 6 clips.
  const WAYS: [string, Partial<PoseSceneOptions>][] = [
    ['as the guide asks', {}],
    ['twice the jitter', { noisePx: 3 }],
    ['take-off foot away from the camera', { foot: 'left' }],
    ['120 fps', { fps: 120 }],
    ['two-foot take-off', { style: 'two' }],
    ['no markers', { markers: null }],
    ['phone on its side', { rotate90: true }],
    ['hand on the rim', { hangAfterS: 0.34 }],
  ];
  const SEEDS = [11, 12, 13, 14, 15, 16];

  it('cover the truth in at least 95 % of clips, figure by figure', () => {
    const tally: Record<string, { n: number; covered: number }> = {};
    for (const [, over] of WAYS) {
      for (const seed of SEEDS) {
        const { scene, r } = analyse({ ...over, seed });
        const result = resultOf(r);
        const missed = new Set(misses(scene, result).map((m) => m.split(':')[0]));
        const truth = truthOf(scene);
        for (const k of Object.keys(truth) as MetricKey[]) {
          if (!result.metrics[k] || truth[k] == null) continue;
          tally[k] ??= { n: 0, covered: 0 };
          tally[k].n++;
          if (!missed.has(k)) tally[k].covered++;
        }
      }
    }
    const short = Object.entries(tally).filter(([, c]) => c.covered < 0.95 * c.n);
    expect(short).toEqual([]);
    // Every figure was checked on most clips.
    for (const k of ['vz', 'vx', 'angle', 'plant', 'step', 'brake', 'knee'] as const) expect(tally[k].n).toBeGreaterThanOrEqual(40);
  });
});

describe('what the clip lacks or gets wrong', () => {
  it('without markers: no run-up speed, lengths from gravity’s scale', () => {
    const { scene, r } = analyse({ markers: null });
    const result = resultOf(r);
    expect(result.flags).toContain('no-markers');
    expect(result.metrics.approach).toBeUndefined();
    expect(grossMisses(scene, result)).toEqual([]);
  });

  it('at 120 fps: says so, and the take-off velocity is too coarse to act on', () => {
    const { scene, r } = analyse({ fps: 120 });
    const result = resultOf(r);
    expect(result.flags).toContain('low-fps');
    expect(result.metrics.vz?.status).toBe('imprecise');
    expect(grossMisses(scene, result)).toEqual([]);
  });

  it('take-off from the foot away from the camera', () => {
    const { scene, r } = analyse({ foot: 'left' });
    const result = resultOf(r);
    expect(result.style).toEqual({ kind: 'one', foot: 'left' });
    expect(result.flags).toContain('far-foot');
    expect(grossMisses(scene, result)).toEqual([]);
  });

  it('a run-up that comes in at 20° to the picture: flags it, and the run-up speed’s error takes in the foreshortening', () => {
    const { scene, r } = analyse({ curveDeg: 20 });
    const result = resultOf(r);
    expect(result.flags).toContain('curved');
    expect(grossMisses(scene, result)).toEqual([]);
  });

  it('a hand on the rim: only the free fall before it is fitted', () => {
    const { scene, r } = analyse({ hangAfterS: 0.34 });
    const result = resultOf(r);
    expect(result.flags).toContain('hang');
    expect(result.events.landing).toBeNull();
    expect(grossMisses(scene, result)).toEqual([]);
  });

  it('at 60 fps, the app’s own camera: a hand on the rim is still found, and the jitter of a short stretch isn’t taken for one', () => {
    for (const seed of [1, 2, 3]) expect(resultOf(analyse({ fps: 60, hangAfterS: 0.34, seed }).r).flags).toContain('hang');
    // tools/pose-validation found 5 in 100 of these flagged, each with its velocities fitted on the rise alone.
    const flagged = Array.from({ length: 100 }, (_, i) => 1000 + i).filter((seed) => resultOf(analyse({ fps: 60, seed }).r).flags.includes('hang'));
    expect(flagged).toEqual([]);
  });

  it('a clip that ends in the air', () => {
    const scene = poseScene();
    const end = scene.truth.takeoffFrame + Math.round(0.5 * scene.options.fps);
    const result = resultOf(analyseTechnique({ frames: scene.frames.slice(0, end), captureFps: 240, markers: scene.markers }));
    expect(result.flags).toContain('cut-off');
    expect(result.events.landing).toBeNull();
    expect(grossMisses(scene, result)).toEqual([]);
  });

  it('a clip where the pose model loses the athlete in 8 % of frames', () => {
    const { scene, r } = analyse({ dropout: 0.08 });
    const result = resultOf(r);
    expect(result.flags).toContain('gaps');
    expect(grossMisses(scene, result)).toEqual([]);
  });

  it('markers laid 70 cm nearer the camera than the run-up: the scales disagree', () => {
    const { r } = analyse({ markers: { aM: -3, bM: 0, nearerM: 0.7 } });
    expect(resultOf(r).flags).toContain('off-line');
  });

  it('a clip that starts inside the plant: leaves out the contact time it can’t see, with no endless error', () => {
    // A slow-motion clip trimmed in Photos to start 50 ms into the last contact: its touch-down isn't in the clip.
    const scene = poseScene();
    const cut = Math.ceil(scene.truth.plantDownS * 240) + 12;
    const frames = scene.frames.slice(cut).map((f, k) => ({ ...f, frame: k, t: k / 240 }));
    const result = resultOf(analyseTechnique({ frames, captureFps: 240, markers: scene.markers }));
    expect(result.metrics.plant).toBeUndefined();
    expect(result.flags).toContain('unseen');
    for (const m of Object.values(result.metrics)) expect([m!.value, m!.error].every(Number.isFinite)).toBe(true);
    expect(grossMisses(scene, result)).toEqual([]);
  });

  it('a clip that starts inside the plant whose first frames read as moving or were missed: still leaves out the contact time', () => {
    // The filter reads the first frames' jitter as motion, and the model can miss the first frames: the contact then
    // seems to start a frame or three into the clip, with no touch-down before it to time.
    const cases: [number, number, number][] = [
      [4, 14, 0], // seed, frames into the plant, first frames missed
      [1, 12, 1],
      [1, 12, 2],
      [1, 12, 3],
    ];
    for (const [seed, into, missed] of cases) {
      const scene = poseScene({ seed });
      const cut = Math.ceil(scene.truth.plantDownS * 240) + into;
      const frames = scene.frames.slice(cut).map((f, k) => ({ ...f, frame: k, t: k / 240, poses: k < missed ? [] : f.poses }));
      const result = resultOf(analyseTechnique({ frames, captureFps: 240, markers: scene.markers }));
      expect([seed, into, missed, result.metrics.plant]).toEqual([seed, into, missed, undefined]);
      expect(result.flags).toContain('unseen');
    }
  });

  it('a clip that starts just after a heel strike, the toe still coming down: one jittery first frame isn’t the foot in the air', () => {
    // The filter keeps a stretch's first frame as it is: a heel 1.6 SD high there, with the toe really still lowering
    // after the strike, passed for the foot seen in the air before the contact.
    const cases: [Partial<PoseSceneOptions>, number, number][] = [
      [{ seed: 6, noisePx: 3 }, 4, 0], // options, frames into the plant, first frames missed
      [{ seed: 3, foot: 'left' }, 6, 0],
      [{ seed: 7, foot: 'left', fps: 60 }, 0, 0],
      [{ seed: 1, foot: 'left', distanceM: 10 }, 18, 2],
    ];
    for (const [over, into, missed] of cases) {
      const scene = poseScene(over);
      const fps = scene.options.fps;
      const cut = Math.ceil(scene.truth.plantDownS * fps) + into;
      const frames = scene.frames.slice(cut).map((f, k) => ({ ...f, frame: k, t: k / fps, poses: k < missed ? [] : f.poses }));
      const result = resultOf(analyseTechnique({ frames, captureFps: fps, markers: scene.markers }));
      expect([over, result.metrics.plant, result.metrics.trunk]).toEqual([over, undefined, undefined]);
      expect(result.flags).toContain('unseen');
    }
  });

  it('a clip that starts inside the plant: no touch-down frame is named for it', () => {
    const scene = poseScene();
    const cut = Math.ceil(scene.truth.plantDownS * 240) + 12;
    const frames = scene.frames.slice(cut).map((f, k) => ({ ...f, frame: k, t: k / 240 }));
    const result = resultOf(analyseTechnique({ frames, captureFps: 240, markers: scene.markers }));
    expect(result.flags).toContain('unseen');
    expect(result.events.plantDown).toBeNull();
  });

  it('a clip that starts inside the plant: no trunk lean at a touch-down it can’t see', () => {
    const scene = poseScene();
    const cut = Math.ceil(scene.truth.plantDownS * 240) + 12;
    const frames = scene.frames.slice(cut).map((f, k) => ({ ...f, frame: k, t: k / 240 }));
    const result = resultOf(analyseTechnique({ frames, captureFps: 240, markers: scene.markers }));
    expect(result.metrics.trunk).toBeUndefined();
    expect(result.flags).toContain('unseen');
  });

  it('at 60 fps with the athlete lost for 4 frames at take-off: no endless error, and says why figures are missing', () => {
    const scene = poseScene({ fps: 60 });
    const tk = scene.truth.takeoffFrame;
    const frames = scene.frames.map((f) => (f.frame >= tk - 1 && f.frame < tk + 3 ? { ...f, poses: [] } : f));
    const result = resultOf(analyseTechnique({ frames, captureFps: 60, markers: scene.markers }));
    for (const m of Object.values(result.metrics)) expect([m!.value, m!.error].every(Number.isFinite)).toBe(true);
    // Saved, a figure goes through JSON, which writes an endless number as null.
    expect(JSON.parse(JSON.stringify(result.metrics))).toEqual(result.metrics);
    expect(result.flags).toContain('unseen');
  });

  it('the athlete lost for a few frames at take-off or touch-down: what is timed there says how unsure it is', () => {
    // Motion blur at the fastest moments can lose the athlete for a run of frames; the path bridged across is a guess.
    const wrong: string[] = [];
    for (const [fps, len, at] of [[240, 8, 'take-off'], [240, 8, 'touch-down'], [120, 4, 'take-off'], [60, 3, 'take-off']] as const) {
      for (let seed = 1; seed <= 5; seed++) {
        const scene = poseScene({ fps, seed });
        const touchDown = scene.truth.contacts.find((c) => c.downS === scene.truth.plantDownS)!.downFrame;
        const from = (at === 'take-off' ? scene.truth.takeoffFrame : touchDown) - Math.floor(len / 2);
        const frames = scene.frames.map((f) => (f.frame >= from && f.frame < from + len ? { ...f, poses: [] } : f));
        const result = resultOf(analyseTechnique({ frames, captureFps: fps, markers: scene.markers }));
        wrong.push(...misses(scene, result).filter((m) => /^(plant|vz|angle):/.test(m)).map((m) => `${fps} fps, ${len} lost at ${at}, seed ${seed}: ${m}`));
      }
    }
    expect(wrong).toEqual([]);
  });

  it('two frames lost a little before take-off, with frames seen between them and it: no wider error than without them', () => {
    // The frames seen after the gap show the foot still standing, so the take-off can't be inside it.
    const scene = poseScene();
    const tk = scene.truth.takeoffFrame;
    const clean = resultOf(analyseTechnique({ frames: scene.frames, captureFps: 240, markers: scene.markers }));
    const frames = scene.frames.map((f) => (f.frame >= tk - 9 && f.frame < tk - 7 ? { ...f, poses: [] } : f));
    const result = resultOf(analyseTechnique({ frames, captureFps: 240, markers: scene.markers }));
    for (const k of ['vz', 'angle', 'plant'] as const) expect([k, result.metrics[k]!.error <= 1.1 * clean.metrics[k]!.error]).toEqual([k, true]);
    expect(misses(scene, result)).toEqual([]);
  });

  it('at 60 fps with 5–6 frames lost inside the plant: the plant isn’t lost and the step before it isn’t taken for it', () => {
    // Lost frames aren't the foot seen in the air: the two pieces either side of them are one contact.
    for (const [seed, from, to] of [[1, 76, 80], [3, 76, 81]]) {
      const scene = poseScene({ fps: 60, seed });
      const result = resultOf(analyseTechnique({ frames: lose(scene, from, to), captureFps: 60, markers: scene.markers }));
      expect([seed, Math.abs(result.events.plantDown! - touchDownOf(scene)) <= 2, misses(scene, result)]).toEqual([seed, true, []]);
    }
  });

  it('frames lost just after the touch-down, more than can be bridged: the contact time’s error still holds the truth', () => {
    // The frames between the touch-down and the gap show the foot at the floor but too few to be a contact of their
    // own: the touch-down is before them, not at the gap.
    const cases: [number, number, number, number][] = [
      [120, 1, 5, 12], // fps, seed, first and last frame lost after the touch-down
      [120, 1, 1, 8],
      [240, 2, 2, 17],
    ];
    for (const [fps, seed, a, b] of cases) {
      const scene = poseScene({ fps, seed });
      const td = touchDownOf(scene);
      const result = resultOf(analyseTechnique({ frames: lose(scene, td + a, td + b), captureFps: fps, markers: scene.markers }));
      expect([fps, seed, a, misses(scene, result).filter((m) => m.startsWith('plant:'))]).toEqual([fps, seed, a, []]);
    }
  });

  it('a two-foot plant with frames lost just after the first foot down: the contact time is taken from the foot that may have been first', () => {
    // Both feet are seen down only after the gap, so both are timed there, and the foot that really landed later has the
    // narrower error: the contact time has to start at the one whose error reaches back across the gap.
    for (const seed of [1, 2, 3, 4]) {
      const scene = poseScene({ style: 'two', fps: 120, seed });
      const td = touchDownOf(scene);
      const result = resultOf(analyseTechnique({ frames: lose(scene, td + 2, td + 8), captureFps: 120, markers: scene.markers }));
      expect([seed, misses(scene, result).filter((m) => m.startsWith('plant:'))]).toEqual([seed, []]);
    }
  });

  it('at 60 fps with the take-off inside 8 lost frames: the free fall isn’t fitted on a frame with the foot still down', () => {
    // The frame next to the gap has no stillness to read, so it isn't counted as down: the unknown take-off goes after
    // the lost frames, not before that frame.
    for (const seed of [1, 2, 3, 4]) {
      const scene = poseScene({ fps: 60, seed });
      const result = resultOf(analyseTechnique({ frames: lose(scene, 82, 89), captureFps: 60, markers: scene.markers }));
      expect([seed, result.flags.includes('scale-broken'), misses(scene, result)]).toEqual([seed, false, []]);
    }
  });

  it('at 60 fps, a two-foot take-off with the frames right after it lost: still a two-foot take-off, left when it was', () => {
    // An up edge that can't be timed stays where the foot was last seen down: moved past the lost frames, it falls after
    // the other foot's and out of the plant, which then holds one foot.
    for (const seed of [2, 5, 8]) {
      const scene = poseScene({ style: 'two', fps: 60, seed });
      const to = scene.truth.takeoffFrame;
      const result = resultOf(analyseTechnique({ frames: lose(scene, to, to + 4), captureFps: 60, markers: scene.markers }));
      expect([seed, result.style.kind, result.metrics.gap != null, Math.abs(result.events.takeoff - to) <= 1, misses(scene, result)]).toEqual([seed, 'two', true, true, []]);
    }
  });

  it('at 120 fps with 7–8 frames lost across the take-off: the take-off figures hold the truth, or none is given', () => {
    // The up edge is timed on the frames before the lost run, and its error reaches across it: the free fall can't be
    // fitted from there, on frames where the foot may still be down. With the foot seen still down after a run too long
    // to bridge, the moment it left wasn't seen: what rests on it is left out.
    const cases: [Partial<PoseSceneOptions>, number, number, number][] = [
      [{}, 1, -3, 4], // options, seed, first and last frame lost around the take-off
      [{}, 2, -3, 4],
      [{ markers: null, curveDeg: 20 }, 3, -5, 2],
      [{}, 1, -9, -3],
      [{}, 2, -8, -1],
    ];
    for (const [over, seed, from, to] of cases) {
      const scene = poseScene({ ...over, fps: 120, seed });
      const t = scene.truth.takeoffFrame;
      const r = analyseTechnique({ frames: lose(scene, t + from, t + to), captureFps: 120, markers: scene.markers });
      expect([seed, from, r.ok ? misses(scene, r.result).filter((m) => /^(vz|vx|angle|plant):/.test(m)) : []]).toEqual([seed, from, []]);
    }
  });

  it('at 60 fps with 4 frames lost inside the plant and the take-off seen after them: its figures are given, and hold the truth', () => {
    // The gap is too long to bridge, but the take-off is timed on the frames after it, which show the foot still down
    // and then leaving: the moment it left was seen.
    for (const seed of [1, 2, 3, 76000]) {
      const scene = poseScene({ fps: 60, seed });
      const to = scene.truth.takeoffFrame;
      const result = resultOf(analyseTechnique({ frames: lose(scene, to - 7, to - 4), captureFps: 60, markers: scene.markers }));
      const given = (['vz', 'angle', 'plant'] as const).filter((k) => result.metrics[k]);
      expect([seed, result.flags.includes('unseen'), given, misses(scene, result)]).toEqual([seed, false, ['vz', 'angle', 'plant'], []]);
    }
  });

  it('at 60 fps without lines, frames lost across the take-off: the free fall isn’t fitted from the frame next to them', () => {
    // That frame ends a stretch the filter smooths on its own: the toe can read a little above where it stood while the
    // foot is still down. Fitted from there, the path leaves the parabola early, as if a hand were on the rim.
    const scene = poseScene({ fps: 60, markers: null, seed: 71000 });
    const to = scene.truth.takeoffFrame;
    const result = resultOf(analyseTechnique({ frames: lose(scene, to - 1, to + 2), captureFps: 60, markers: null }));
    expect([result.flags.includes('hang'), misses(scene, result)]).toEqual([false, []]);
  });

  it('at 120 fps, the far foot taking off, frames lost late in the plant: the take-off figures hold the truth, or none is given', () => {
    // The far toe jitters twice as much as the near one, and the path guessed across the gap can hold its smoothed
    // height above where it stood until the foot leaves: there it sinks back, where a toe that has left rises.
    for (const [from, to] of [[-7, -5], [-10, -4], [-11, -4]]) {
      const scene = poseScene({ fps: 120, foot: 'left', seed: 71000 });
      const t = scene.truth.takeoffFrame;
      const r = analyseTechnique({ frames: lose(scene, t + from, t + to), captureFps: 120, markers: scene.markers });
      expect([from, r.ok ? misses(scene, r.result).filter((m) => /^(vz|angle|plant):/.test(m)) : []]).toEqual([from, []]);
    }
  });

  it('two feet leaving together, frames lost across the take-off: the vertical take-off speed, angle and contact time are given, and hold the truth', () => {
    // Timed together, the take-off's error is the surer foot's and can end inside the lost frames: no toe is seen there,
    // leaving or not, so nothing says the error is too narrow.
    const cases: [Partial<PoseSceneOptions>, number, number, number][] = [
      [{ fps: 240, markers: null }, 82000, -4, 3], // options, seed, first and last frame lost around the take-off
      [{ fps: 120 }, 82000, -6, 0],
    ];
    for (const [over, seed, from, to] of cases) {
      const scene = poseScene({ ...over, style: 'two', seed });
      const t = scene.truth.takeoffFrame;
      const result = resultOf(analyseTechnique({ frames: lose(scene, t + from, t + to), captureFps: scene.options.fps, markers: scene.markers }));
      const given = (['vz', 'angle', 'plant'] as const).filter((k) => result.metrics[k]);
      expect([seed, given, misses(scene, result).filter((m) => /^(vz|angle|plant):/.test(m))]).toEqual([seed, ['vz', 'angle', 'plant'], []]);
    }
  });

  it('at 240 fps, two feet leaving together, a few frames lost just before or across the take-off: the vertical take-off speed, angle and contact time are given, and hold the truth', () => {
    // Timed together, the take-off's error is the surer foot's, under 3 frames here; the toe that leaves last is 2.5 cm
    // above where it stood only 3–4 frames after it leaves. Looked for within that error alone, no frame shows every toe
    // leaving, as if the moment it left wasn't seen.
    const cases: [Partial<PoseSceneOptions>, number, number, number][] = [
      [{ twoFootGapS: 0.08 }, 97001, -2, -1], // options, seed, first and last frame lost around the take-off
      [{ twoFootGapS: 0.08 }, 97001, -3, -1],
      [{}, 97008, -1, 1],
      [{ foot: 'left' }, 97008, -2, 1],
    ];
    for (const [over, seed, from, to] of cases) {
      const scene = poseScene({ ...over, fps: 240, style: 'two', seed });
      const t = scene.truth.takeoffFrame;
      const result = resultOf(analyseTechnique({ frames: lose(scene, t + from, t + to), captureFps: 240, markers: scene.markers }));
      const given = (['vz', 'angle', 'plant'] as const).filter((k) => result.metrics[k]);
      expect([seed, from, result.flags.includes('unseen'), given, misses(scene, result).filter((m) => /^(vz|angle|plant):/.test(m))]).toEqual([
        seed,
        from,
        false,
        ['vz', 'angle', 'plant'],
        [],
      ]);
    }
  });

  it('at 60 fps, frames lost late in the plant and the take-off not timed: the take-off frame shown is where the foot left', () => {
    // The toe is seen still where it stood after the gap: the foot left after that, not where its frames down ended
    // before the gap.
    for (const seed of [1, 2, 3, 79000]) {
      const scene = poseScene({ fps: 60, seed });
      const to = scene.truth.takeoffFrame;
      const result = resultOf(analyseTechnique({ frames: lose(scene, to - 5, to - 2), captureFps: 60, markers: scene.markers }));
      expect([seed, Math.abs(result.events.takeoff - to) <= 1, misses(scene, result)]).toEqual([seed, true, []]);
    }
  });

  it('a 24 or 25 fps clip (a phone’s video mode): the plant is found, and knee and trunk come out as angles', () => {
    for (const fps of [24, 25]) {
      const { scene, r } = analyse({ fps });
      const result = resultOf(r);
      expect(result.metrics.knee!.value).toBeGreaterThan(60);
      expect(result.metrics.knee!.value).toBeLessThanOrEqual(180);
      expect(Math.abs(result.metrics.trunk!.value)).toBeLessThan(45);
      expect(grossMisses(scene, result)).toEqual([]);
    }
  });

  it('a 240 fps clip read as 120 fps: the scales disagree hugely', () => {
    const scene = poseScene();
    const frames = scene.frames.map((f) => ({ ...f, t: f.frame / 120 }));
    const r = analyseTechnique({ frames, captureFps: 120, markers: scene.markers });
    expect(resultOf(r).flags).toContain('scale-broken');
  });
});

describe('lines tapped wrong, or the wrong frame rate', () => {
  it('a 240 fps clip read as 120 fps: no figure passes for one to trust', () => {
    const scene = poseScene();
    const frames = scene.frames.map((f) => ({ ...f, t: f.frame / 120 }));
    const result = resultOf(analyseTechnique({ frames, captureFps: 120, markers: scene.markers }));
    expect(result.flags).toContain('scale-broken');
    expect(Object.entries(result.metrics).flatMap(([k, m]) => (m!.status === 'ok' ? [k] : []))).toEqual([]);
  });

  it('the 3 m line tapped a metre short: no figure passes for one to trust', () => {
    const scene = poseScene();
    const { a, b } = scene.markers!;
    const short = { x: a.x + (b.x - a.x) / 3, y: a.y + (b.y - a.y) / 3 };
    const result = resultOf(analyseTechnique({ frames: scene.frames, captureFps: 240, markers: { a: short, b, distanceM: 3 } }));
    expect(result.flags).toContain('scale-broken');
    expect(Object.entries(result.metrics).flatMap(([k, m]) => (m!.status === 'ok' ? [k] : []))).toEqual([]);
  });

  it('the frame rate or a line wrong: no figure it still gives misses the truth by more than its stated error', () => {
    // Which of the two is off can't be told, so a figure resting on either has no error to state.
    const scene = poseScene();
    const { a, b } = scene.markers!;
    const wrongFps = resultOf(analyseTechnique({ frames: scene.frames.map((f) => ({ ...f, t: f.frame / 120 })), captureFps: 120, markers: scene.markers }));
    const wrongLine = resultOf(analyseTechnique({ frames: scene.frames, captureFps: 240, markers: { a: { x: a.x + (b.x - a.x) / 3, y: a.y + (b.y - a.y) / 3 }, b, distanceM: 3 } }));
    for (const result of [wrongFps, wrongLine]) {
      expect(result.flags).toContain('scale-broken');
      expect(misses(scene, result)).toEqual([]);
    }
  });

  it.each([
    ['both lines tapped 0.5 m nearer the camera than where the athlete ran', { aM: -3, bM: 0, nearerM: 0.5 }],
    ['both lines tapped 1 m nearer the camera than where the athlete ran', { aM: -3, bM: 0, nearerM: 1 }],
    ['the 3 m line laid 2.6 m back', { aM: -2.6, bM: 0, nearerM: 0 }],
  ])('%s: the scales disagree, and the last step, braking and run-up speed still hold the truth', (_, m) => {
    // The frame rate can't be off by less than twice (`SCALE_BROKEN`), so it is the lines' scale that is off.
    for (const seed of [1, 2, 3]) {
      const scene = poseScene({ seed, markers: m });
      // The screen takes the lines to be 3 m apart, wherever they are.
      const result = resultOf(analyseTechnique({ frames: scene.frames, captureFps: 240, markers: { ...scene.markers!, distanceM: 3 } }));
      expect(result.flags).toContain('off-line');
      for (const k of ['approach', 'brake', 'step'] as const) expect([seed, k, result.metrics[k] != null]).toEqual([seed, k, true]);
      expect([seed, misses(scene, result).filter((x) => /^(approach|brake|step):/.test(x))]).toEqual([seed, []]);
    }
  });

  it.each([
    ['filmed as the guide asks', {}, 5068],
    ['the phone on its side', { rotate90: true }, 5029],
  ])('lines where the athlete ran, %s, but the flight taken for a hang on the rim: the last step and braking still hold the truth', (_, over, seed) => {
    // Two clips of tools/pose-validation's, read and tapped as it does. Jitter cuts the parabola short where no hand is on
    // the rim, and the short fit puts gravity's scale 7 % and 14 % below the lines': the lines are right, but which of
    // the two is can't be told once the fit has stopped short.
    const scene = poseScene({ ...over, seed });
    const { frames, target } = readAsTheScreen(scene);
    const finger = normals(seed * 7919);
    const tap = (p: Pt) => ({ x: p.x + TAP_PX * finger(), y: p.y + TAP_PX * finger() });
    const markers = { a: tap(scene.markers!.a), b: tap(scene.markers!.b), distanceM: 3, picture: { width: scene.width, height: scene.height }, tapPx: TAP_PX };
    const result = resultOf(analyseTechnique({ frames, captureFps: 240, markers, target }));
    expect(result.flags).toEqual(expect.arrayContaining(['hang', 'off-line']));
    expect(misses(scene, result).filter((x) => /^(brake|step):/.test(x))).toEqual([]);
  });

  it.each([
    ['twice the jitter', { noisePx: 3 }, 40214, null],
    ['twice the jitter', { noisePx: 3 }, 41323, null],
    ['4K from 10 m, each line tapped a hand’s breadth off the hips’ path', { width: 3840, height: 2160, focalPx: 2740, fps: 120, noisePx: 3, distanceM: 10, approachSpeed: 4.5 }, 42047, 3],
  ])('lines where the athlete ran, %s, and gravity’s scale 5–13 %% off theirs with no hand on the rim: the last step and braking still hold the truth', (_, over, seed, draw) => {
    // Clips of the probes', read as the screen reads them. Jitter alone can bend the parabola as far as a hang can, and
    // which of the two scales is right can't be told: both figures on gravity's carry the whole gap between them.
    const scene = poseScene({ ...over, seed });
    const { frames, target } = readAsTheScreen(scene);
    const picture = { width: scene.width, height: scene.height };
    let markers: Markers = { ...scene.markers!, distanceM: 3, picture, tapPx: TAP_PX };
    if (draw != null) {
      // Tapped as the probe did: 8 px of finger on a 4K clip, and 8 cm (1 SD) along each tape.
      const finger = normals(seed * 104729 + 2 * draw);
      const depth = normals(seed * 104729 + 2 * draw + 1);
      const tap = (xM: number) => {
        const p = scene.floorPoint(xM, 0.08 * depth());
        return { x: p.x + 8 * finger(), y: p.y + 8 * finger() };
      };
      markers = { a: tap(scene.options.markers!.aM), b: tap(scene.options.markers!.bM), distanceM: 3, picture, tapPx: 8 };
    }
    const result = resultOf(analyseTechnique({ frames, captureFps: scene.options.fps, markers, target }));
    expect([seed, result.flags.includes('off-line'), result.flags.includes('hang')]).toEqual([seed, true, false]);
    expect([seed, misses(scene, result).filter((x) => /^(brake|step):/.test(x))]).toEqual([seed, []]);
  });

  it.each([
    ['1.5 m', -1.5],
    ['2 m', -2],
  ])('both lines %s further from the camera than where the athlete ran: gravity’s scale a fifth below theirs, and the last step, braking and run-up speed reach what the lines would make them too', (_, nearerM) => {
    // Which of the two scales is right can't be told, so each figure read on gravity's has to hold the lines' reading as
    // well: 1/r of it, r = gravity's over the lines'. With r = 0.78 that is 28 % above it, further than 1 − r = 22 %.
    for (const seed of [1, 2, 3]) {
      const scene = poseScene({ seed, markers: { aM: -3, bM: 0, nearerM } });
      const result = resultOf(analyseTechnique({ frames: scene.frames, captureFps: 240, markers: { ...scene.markers!, distanceM: 3 } }));
      const r = result.scale.gravity / result.scale.markers!;
      expect([seed, result.flags.includes('off-line'), r < 0.85]).toEqual([seed, true, true]);
      const short = (['step', 'approach', 'brake'] as const).filter((k) => Math.abs(result.metrics[k]!.value / r - result.metrics[k]!.value) > result.metrics[k]!.error);
      expect([seed, short]).toEqual([seed, []]);
    }
  });

  it.each([
    ['at 60 fps, a hand on the rim', { fps: 60, hangAfterS: 0.34 }, [64524, 64593], 0],
    ['at 120 fps, the jitter taken for a hand on the rim', { fps: 120 }, [61766], 0],
    ['the take-off line tapped 5 cm towards the planted foot, the jitter taken for a hand on the rim', {}, [63098], 0.05],
  ])('lines where the athlete ran, tapped at their feet, %s: a fall cut short is no reason to leave the lines’ scale, and the flag says so', (_, over, seeds, leanM) => {
    // Clips of the probes', read and tapped as tools/pose-validation does. Fitted on the rise alone, gravity's scale came
    // out 8–24 % off the lines': moved onto it, the last step read 0.11–0.32 m off and passed a correct 准 one for
    // 不够准, and the run-up speed 0.36–1.1 m/s off.
    for (const seed of seeds) {
      const scene = poseScene({ ...over, seed });
      const { frames, target } = readAsTheScreen(scene);
      const markers = tappedAtTheFeet(scene, 0.08, leanM);
      const result = resultOf(analyseTechnique({ frames, captureFps: scene.options.fps, markers, target }));
      expect([seed, result.flags.includes('hang'), result.flags.includes('short-fall')]).toEqual([seed, true, true]);
      const truth = truthOf(scene);
      const far = (['step', 'approach', 'vx', 'brake'] as const).filter((k) => result.metrics[k] && Math.abs(result.metrics[k]!.value - truth[k]!) > PASS_LINE[k]);
      expect([seed, far, misses(scene, result).filter((x) => /^(vx|approach|brake|step):/.test(x))]).toEqual([seed, [], []]);
    }
  });

  it('lines where the athlete ran, twice the jitter bending gravity’s parabola 11 % off their scale: the horizontal velocity and the angle, read on gravity’s, hold the truth too', () => {
    // Which of the two scales is right can't be told: the horizontal velocity on gravity's may be off by the whole gap.
    const scene = poseScene({ noisePx: 3, seed: 40214 });
    const { frames, target } = readAsTheScreen(scene);
    const markers = { ...scene.markers!, distanceM: 3, picture: { width: scene.width, height: scene.height }, tapPx: TAP_PX };
    const result = resultOf(analyseTechnique({ frames, captureFps: 240, markers, target }));
    expect([result.flags.includes('off-line'), result.flags.includes('hang')]).toEqual([true, false]);
    expect(misses(scene, result).filter((x) => /^(vx|angle):/.test(x))).toEqual([]);
  });

  it('lines that put the scale 10 % off, at 60 fps with a hand on the rim at 0.25 s: the take-off angle, which rests on no scale, reads and is as sure as with lines that agree', () => {
    // The angle is the rise over the run at take-off, both in the picture's own units: any one scale for the two cancels.
    // Read with the run on the lines' scale and the rise on gravity's after the fall was cut short, it moved by the gap
    // between them, 2.7° here, and its error took in the gap too. The markers still set how closely the toes are looked
    // at (`roughScale`), which moves it by a few hundredths of a degree.
    for (const seed of [1, 2, 3]) {
      const scene = poseScene({ fps: 60, hangAfterS: 0.25, seed });
      const angleWith = (distanceM: number) => resultOf(analyseTechnique({ frames: scene.frames, captureFps: scene.options.fps, markers: { ...scene.markers!, distanceM } }));
      const [agree, off] = [angleWith(3), angleWith(3.3)];
      expect([seed, off.flags.includes('off-line')]).toEqual([seed, true]);
      const [a, b] = [agree.metrics.angle!, off.metrics.angle!];
      expect([seed, Math.abs(b.value - a.value) < 0.1, Math.abs(b.error / a.error - 1) < 0.05, b.status]).toEqual([seed, true, true, a.status]);
    }
  });

  it('lines where the athlete ran, tapped at their feet, at 60 fps with a hand on the rim just before the top: the vertical take-off velocity, timed to a top the fit never saw, still holds the truth', () => {
    // Clips of the probes', read and tapped as tools/pose-validation does. On the rise alone gravity's scale came out
    // 12–21 % off the lines', and the vertical velocity, g times the time to that top, read 0.27–0.44 m/s low with 0.27–0.30
    // stated: it rests on the parabola's curvature as gravity's scale does, and which scale is right can't be told. Of 77
    // such clips it covered the truth in 63.
    for (const seed of [123006, 123026, 123071]) {
      const scene = poseScene({ fps: 60, hangAfterS: 0.25, seed });
      const { frames, target } = readAsTheScreen(scene);
      const result = resultOf(analyseTechnique({ frames, captureFps: 60, markers: tappedAtTheFeet(scene, 0.08), target }));
      expect([seed, result.flags.includes('short-fall'), misses(scene, result).filter((x) => /^vz:/.test(x))]).toEqual([seed, true, []]);
    }
  });

  it('both lines tapped on the same tape: says so, rather than that the plant isn’t in the clip', () => {
    const scene = poseScene();
    const b = scene.markers!.b;
    expect(analyseTechnique({ frames: scene.frames, captureFps: 240, markers: { a: { x: b.x + 5, y: b.y }, b, distanceM: 3 } })).toEqual({ ok: false, problem: 'markers' });
  });
});

/** Normal draws (mean 0, SD 1) from a seed: mulberry32, then Box–Muller. */
function normals(seed: number): () => number {
  let s = seed >>> 0;
  const next = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return () => Math.sqrt(-2 * Math.log(Math.max(1e-12, next()))) * Math.cos(2 * Math.PI * next());
}

/**
 * The two lines as tools/pose-validation taps them: on each tape `depthM` (1 SD) nearer the lens or further than where
 * the hips crossed it, the take-off line `leanM` nearer on top, and the finger off by `tapPx` (1 SD) either way.
 */
function tappedAtTheFeet(scene: PoseScene, depthM: number, leanM = 0, tapPx = TAP_PX): Markers {
  const finger = normals(scene.options.seed * 7919);
  const depth = normals(scene.options.seed * 7919 + 1);
  const { aM, bM, nearerM } = scene.options.markers!;
  const tap = (xM: number, lean: number) => {
    const p = scene.floorPoint(xM, nearerM + lean + depthM * depth());
    return { x: p.x + tapPx * finger(), y: p.y + tapPx * finger() };
  };
  return { a: tap(aM, 0), b: tap(bM, leanM), distanceM: 3, picture: { width: scene.width, height: scene.height }, tapPx };
}

/** The chance that a 95 % error covers the truth in `k` or fewer of `n` clips (binomial), as tools/pose-validation judges. */
function chanceOfSoFew(k: number, n: number, p = 0.95): number {
  const lg = (x: number) => {
    let s = 0;
    for (let i = 2; i <= x; i++) s += Math.log(i);
    return s;
  };
  let sum = 0;
  for (let i = 0; i <= k; i++) sum += Math.exp(lg(n) - lg(i) - lg(n - i) + i * Math.log(p) + (n - i) * Math.log(1 - p));
  return Math.min(1, sum);
}

describe('lines tapped by hand, and no lines where the floor is hard to read', () => {
  it('lines tapped as well as TAP_PX says: take-off velocities and angle, run-up speed and the last step still cover the truth in 95 % of clips', () => {
    // Each tap off by TAP_PX (1 SD) either way: a line tapped a little high or low tilts which way is up, and the
    // run-up's horizontal speed then leaks into the vertical one. Three ways of tapping each of 40 clips, so that a
    // figure is judged on 120: short only where so few covered is unlikely by chance (p < 0.05). 40 clips judged one
    // by one at 95 % would fail a third of the time on a figure whose error is right.
    const normal = normals(35);
    const tally: Record<string, { n: number; covered: number }> = {};
    for (let draw = 0; draw < 3; draw++) {
      for (let seed = 11; seed <= 50; seed++) {
        const scene = poseScene({ seed });
        const { a, b } = scene.markers!;
        const tap = (p: { x: number; y: number }) => ({ x: p.x + TAP_PX * normal(), y: p.y + TAP_PX * normal() });
        const result = resultOf(analyseTechnique({ frames: scene.frames, captureFps: 240, markers: { a: tap(a), b: tap(b), distanceM: 3 } }));
        const missed = new Set(misses(scene, result).map((m) => m.split(':')[0]));
        for (const k of ['vz', 'vx', 'angle', 'approach', 'step'] as const) {
          if (!result.metrics[k]) continue;
          tally[k] ??= { n: 0, covered: 0 };
          tally[k].n++;
          if (!missed.has(k)) tally[k].covered++;
        }
      }
    }
    expect(Object.entries(tally).filter(([, c]) => c.n < 120 || chanceOfSoFew(c.covered, c.n) < 0.05)).toEqual([]);
  });

  it('lines tapped at the runner’s feet, a hand’s breadth nearer or further than the hips’ path: run-up speed, braking and the last step still cover the truth in 95 % of clips', () => {
    // A line tapped 8 cm (1 SD) nearer or further along its tape than where the hips crossed it: in the picture it moves
    // away from or towards the middle by that share of the distance, 2 cm at 1.8 m off the middle from 7 m (4 px), on
    // top of the finger's `TAP_PX`. Read as the screen reads it, six ways of tapping each of 40 clips: the run-up speed
    // falls short by a few in a hundred, which 120 can't tell from chance.
    const finger = normals(36);
    const depth = normals(37);
    const tally: Record<string, { n: number; covered: number }> = {};
    for (let seed = 11; seed <= 50; seed++) {
      const scene = poseScene({ seed });
      const { aM, bM } = scene.options.markers!;
      const { frames, target } = readAsTheScreen(scene);
      for (let draw = 0; draw < 6; draw++) {
        const tap = (xM: number) => {
          const p = scene.floorPoint(xM, 0.08 * depth());
          return { x: p.x + TAP_PX * finger(), y: p.y + TAP_PX * finger() };
        };
        const markers = { a: tap(aM), b: tap(bM), distanceM: 3, picture: { width: scene.width, height: scene.height } };
        const result = resultOf(analyseTechnique({ frames, captureFps: 240, markers, target }));
        const missed = new Set(misses(scene, result).map((m) => m.split(':')[0]));
        for (const k of ['approach', 'brake', 'step'] as const) {
          if (!result.metrics[k]) continue;
          tally[k] ??= { n: 0, covered: 0 };
          tally[k].n++;
          if (!missed.has(k)) tally[k].covered++;
        }
      }
    }
    expect(Object.entries(tally).filter(([k, c]) => (k !== 'brake' && c.n < 240) || chanceOfSoFew(c.covered, c.n) < 0.05)).toEqual([]);
  });

  it.each([
    ['the 3 m line laid at 2.9 m', { aM: -2.9, bM: 0, nearerM: 0 }],
    ['both lines 0.3 m further from the camera than where the athlete ran', { aM: -3, bM: 0, nearerM: -0.3 }],
  ])('%s, too little to flag: the last step, braking and run-up speed still cover the truth in 95 %% of clips', (_, m) => {
    // The lines' scale is 3–4 % off, within `SCALE_MISMATCH`, but further from gravity's than either's own error explains.
    // Read and tapped as the screen does it, 40 clips.
    const tally: Record<string, { n: number; covered: number }> = {};
    for (let seed = 11; seed <= 50; seed++) {
      const scene = poseScene({ seed, markers: m });
      const { frames, target } = readAsTheScreen(scene);
      const finger = normals(seed * 7919);
      const tap = (p: Pt) => ({ x: p.x + TAP_PX * finger(), y: p.y + TAP_PX * finger() });
      const markers = { a: tap(scene.markers!.a), b: tap(scene.markers!.b), distanceM: 3, picture: { width: scene.width, height: scene.height }, tapPx: TAP_PX };
      const result = resultOf(analyseTechnique({ frames, captureFps: 240, markers, target }));
      const missed = new Set(misses(scene, result).map((x) => x.split(':')[0]));
      for (const k of ['approach', 'brake', 'step'] as const) {
        if (!result.metrics[k]) continue;
        tally[k] ??= { n: 0, covered: 0 };
        tally[k].n++;
        if (!missed.has(k)) tally[k].covered++;
      }
    }
    expect(Object.entries(tally).filter(([k, c]) => (k !== 'brake' && c.n < 40) || chanceOfSoFew(c.covered, c.n) < 0.05)).toEqual([]);
  });

  it.each([
    ['at 240 fps, both lines 0.2 m further from the camera', 240, -0.2, [84415, 84443, 84474]],
    ['at 240 fps, both lines 0.2 m nearer the camera', 240, 0.2, [84640, 84673]],
    ['at 60 fps, both lines 0.15 m further from the camera', 60, -0.15, [73863]],
  ])('%s than where the athlete ran, the scales apart by no more than chance: the run-up speed still holds the truth', (_, fps, nearerM, seeds) => {
    // Clips of the probes', read and tapped as tools/pose-validation does. Gravity's scale came out 2–3 % off the lines',
    // within what the two errors explain, so nothing widened the run-up speed: it read 0.24–0.37 m/s off with 0.21–0.29
    // stated.
    for (const seed of seeds) {
      const scene = poseScene({ fps, seed, markers: { aM: -3, bM: 0, nearerM } });
      const { frames, target } = readAsTheScreen(scene);
      const result = resultOf(analyseTechnique({ frames, captureFps: fps, markers: tappedAtTheFeet(scene, 0.08), target }));
      expect([seed, result.flags.includes('off-line'), misses(scene, result).filter((x) => /^approach:/.test(x))]).toEqual([seed, false, []]);
    }
  });

  it('both lines 0.3 m nearer the camera than where the athlete ran, and a hand on the rim: the run-up speed, further off than the scales are apart, still holds the truth', () => {
    // Clips of the probes', read and tapped as tools/pose-validation does. Gravity's scale came out 4–5 % off the lines',
    // and the run-up speed 9–11 % (0.56–0.65 m/s) off, with 0.52–0.56 stated: the take-off line is crossed in the plant,
    // at about half the run-up's speed, so its being out of place costs about twice the time.
    for (const seed of [73410, 73433, 73435]) {
      const scene = poseScene({ seed, hangAfterS: 0.34, markers: { aM: -3, bM: 0, nearerM: 0.3 } });
      const { frames, target } = readAsTheScreen(scene);
      const result = resultOf(analyseTechnique({ frames, captureFps: 240, markers: tappedAtTheFeet(scene, 0.08), target }));
      expect([seed, result.flags.includes('hang'), misses(scene, result).filter((x) => /^approach:/.test(x))]).toEqual([seed, true, []]);
    }
  });

  it('lines where the athlete ran, tapped at their feet: the last step is still a figure to trust in most clips', () => {
    // Two scales a little apart by chance aren't lines laid wrong: only a gap beyond both their errors widens the step.
    const depth = normals(38);
    const finger = normals(39);
    let ok = 0;
    for (let seed = 11; seed <= 50; seed++) {
      const scene = poseScene({ seed });
      const { frames, target } = readAsTheScreen(scene);
      const tap = (xM: number) => {
        const p = scene.floorPoint(xM, 0.08 * depth());
        return { x: p.x + TAP_PX * finger(), y: p.y + TAP_PX * finger() };
      };
      const markers = { a: tap(-3), b: tap(0), distanceM: 3, picture: { width: scene.width, height: scene.height }, tapPx: TAP_PX };
      if (resultOf(analyseTechnique({ frames, captureFps: 240, markers, target })).metrics.step?.status === 'ok') ok++;
    }
    expect(ok).toBeGreaterThanOrEqual(34);
  });

  it('lines tapped along their tapes: braking’s run-in speed is as unsure as their scale, and where along the tapes they were tapped tilts up', () => {
    // The run-in speed is measured on the lines' scale, which is only as good as their taps: tapped less well, the
    // braking is less sure. And a line tapped nearer the lens than the hips' path sits lower in the picture too (further
    // from its middle by the depth over the distance): two such lines tilt up, which the picture's size lets it allow for.
    const scene = poseScene({ seed: 1 });
    const lines = { ...scene.markers!, distanceM: 3 };
    const metricsOf = (markers: Markers) => resultOf(analyseTechnique({ frames: scene.frames, captureFps: 240, markers })).metrics;
    expect(metricsOf({ ...lines, tapPx: 12 }).brake!.error).toBeGreaterThan(metricsOf({ ...lines, tapPx: 4 }).brake!.error + 0.05);
    expect(metricsOf({ ...lines, picture: { width: scene.width, height: scene.height } }).vz!.error).toBeGreaterThan(metricsOf(lines).vz!.error);
  });

  it.each([
    ['comes in at 10° to the picture', { curveDeg: 10 }],
    ['comes in at 15° to the picture', { curveDeg: 15 }],
    ['ends with a hand on the rim', { hangAfterS: 0.35 }],
  ])('no lines, and the run-up %s: the floor can’t be told from a tilted phone, and the take-off says how unsure it is', (_, over) => {
    for (const seed of [1, 2, 3]) {
      const { scene, r } = analyse({ ...over, seed, markers: null });
      const result = resultOf(r);
      expect(misses(scene, result).filter((m) => /^(vz|vx|angle):/.test(m))).toEqual([]);
    }
  });

  it.each([
    ['comes in at 15° and the phone is rolled 1.5° the other way', { curveDeg: 15, rollDeg: -1.5 }],
    ['comes in at 10° and the phone is rolled 1° the other way', { curveDeg: 10, rollDeg: -1 }],
    ['ends with a hand on the rim and the phone is rolled 3° the other way', { hangAfterS: 0.35, rollDeg: -3 }],
  ])('no lines, and the run-up %s: the two turns cancel, and the take-off still says how unsure it is', (_, over) => {
    // The floor fit's turn is the phone's roll plus the false slope of the floor: rolled the other way, the phone hides
    // the slope, and the turn left is no measure of how far up is off.
    for (const seed of [1, 2, 3]) {
      const { scene, r } = analyse({ ...over, seed, markers: null });
      expect([seed, misses(scene, resultOf(r)).filter((m) => /^(vz|vx|angle):/.test(m))]).toEqual([seed, []]);
    }
  });

  it('lines laid where the athlete ran, on a run-up that comes in at 10° or 20° to the picture: the take-off still covers the truth in 95 % of clips', () => {
    // The 3 m line is then nearer the lens than the take-off line, by 3 m × tan of the angle, so lower in the picture: the
    // two tilt up by the floor's false slope along the run-up, h/L of the body's size change over L. Read as the screen
    // reads it, each line tapped TAP_PX off, 20 clips at each angle.
    const tally: Record<string, { n: number; covered: number }> = {};
    for (const curveDeg of [10, 20]) {
      for (let seed = 500; seed < 520; seed++) {
        const scene = poseScene({ seed, curveDeg });
        const { frames, target } = readAsTheScreen(scene);
        const finger = normals(seed * 7919);
        const tap = (xM: number) => {
          const p = scene.floorPoint(xM, -xM * Math.tan((curveDeg * Math.PI) / 180));
          return { x: p.x + TAP_PX * finger(), y: p.y + TAP_PX * finger() };
        };
        const markers = { a: tap(-3), b: tap(0), distanceM: 3, picture: { width: scene.width, height: scene.height }, tapPx: TAP_PX };
        const result = resultOf(analyseTechnique({ frames, captureFps: 240, markers, target }));
        const missed = new Set(misses(scene, result).map((m) => m.split(':')[0]));
        for (const k of ['vz', 'vx', 'angle'] as const) {
          if (!result.metrics[k]) continue;
          tally[k] ??= { n: 0, covered: 0 };
          tally[k].n++;
          if (!missed.has(k)) tally[k].covered++;
        }
      }
    }
    expect(Object.entries(tally).filter(([, c]) => c.n < 40 || chanceOfSoFew(c.covered, c.n) < 0.05)).toEqual([]);
  });

  it.each([15, 20])('lines laid where the athlete ran, on a run-up that comes in at %i° to the picture: the run-up speed is the 3 m between them over the time it took', (curveDeg) => {
    // The slant alone puts the two scales apart, the 3 m line nearer the lens: no sign the lines are off, and along the
    // run-up they are 3 m apart. Moved onto gravity's scale, the run-up speed read 0.56 m/s high at 15° and 0.81 at 20°
    // (medians of 100 clips of the probes'), 0.05 and 0.09 on the 3 m. Read and tapped as the test above.
    for (const seed of [500, 501, 502]) {
      const scene = poseScene({ seed, curveDeg });
      const { frames, target } = readAsTheScreen(scene);
      const finger = normals(seed * 7919);
      const tap = (xM: number) => {
        const p = scene.floorPoint(xM, -xM * Math.tan((curveDeg * Math.PI) / 180));
        return { x: p.x + TAP_PX * finger(), y: p.y + TAP_PX * finger() };
      };
      const markers = { a: tap(-3), b: tap(0), distanceM: 3, picture: { width: scene.width, height: scene.height }, tapPx: TAP_PX };
      const result = resultOf(analyseTechnique({ frames, captureFps: 240, markers, target }));
      const approach = result.metrics.approach!;
      expect([seed, result.flags.includes('curved'), result.flags.includes('off-line'), Math.abs(approach.value - scene.truth.approachSpeed!) < 0.4]).toEqual([seed, true, true, true]);
      expect([seed, misses(scene, result).filter((x) => /^approach:/.test(x))]).toEqual([seed, []]);
    }
  });

  it('no lines, and the run-up comes in at 3–4°, too little to flag as curved: the take-off still covers the truth in 95 % of clips', () => {
    // The body's size changes by 3–6 % along such a run-up (a straight one's by about 1 %), and its floor slopes by a
    // third of a degree, which the floor fit takes for the phone's roll. Read as the screen reads it, 40 clips at each.
    const tally: Record<string, { n: number; covered: number }> = {};
    for (const curveDeg of [3, 4]) {
      for (let seed = 11; seed <= 50; seed++) {
        const scene = poseScene({ seed, curveDeg, markers: null });
        const { frames, target } = readAsTheScreen(scene);
        const result = resultOf(analyseTechnique({ frames, captureFps: 240, markers: null, target }));
        const missed = new Set(misses(scene, result).map((m) => m.split(':')[0]));
        for (const k of ['vz', 'vx', 'angle'] as const) {
          tally[k] ??= { n: 0, covered: 0 };
          tally[k].n++;
          if (!missed.has(k)) tally[k].covered++;
        }
      }
    }
    expect(Object.entries(tally).filter(([, c]) => c.n < 80 || chanceOfSoFew(c.covered, c.n) < 0.05)).toEqual([]);
  });

  it('no lines, a run-up 2° off the picture and the phone rolled up to 3° either way: the floor slopes by a fraction of a degree, and the take-off angle is still a figure to trust', () => {
    // From a lens 1 m up and 7 m away, a run-up coming in at 2° drops towards the lens by 1 · tan 2° / 7 = 0.29° in the
    // picture, whichever way the phone is rolled: that, not the phone's roll, is what the floor fit can't tell.
    for (const rollDeg of [-3, 0, 3]) {
      for (const seed of [1, 2]) {
        const { scene, r } = analyse({ seed, curveDeg: 2, rollDeg, markers: null });
        const result = resultOf(r);
        expect([rollDeg, seed, result.metrics.angle?.status, misses(scene, result).filter((m) => /^(vz|vx|angle):/.test(m))]).toEqual([rollDeg, seed, 'ok', []]);
      }
    }
  });

  it('no lines, the phone 1.3 m up and rolled 3° either way, a run-up 4–10° off the picture: the take-off still holds the truth', () => {
    // A higher lens slopes the floor more: the allowance for it is worked out for a lens up to 1.5 m.
    for (const curveDeg of [4, 10]) {
      for (const rollDeg of [-3, 3]) {
        for (const seed of [1, 2]) {
          const { scene, r } = analyse({ seed, curveDeg, rollDeg, lensM: 1.3, markers: null });
          expect([curveDeg, rollDeg, seed, misses(scene, resultOf(r)).filter((m) => /^(vz|vx|angle):/.test(m))]).toEqual([curveDeg, rollDeg, seed, []]);
        }
      }
    }
  });

  it('no lines, the phone held 1.5 m up 5 m away and rolled 3° either way: the floor can’t be turned level, and the take-off still covers the truth in 95 % of clips', () => {
    // From so high and close the floor fit refuses the turn that would level it, or stops short of level, and what slope
    // it leaves is not all there is: the fit keeps the floor's lower part, which hides a slope across the band of still
    // heels and toes. Read as the screen reads it, 20 clips rolled each way.
    const tally: Record<string, { n: number; covered: number }> = {};
    for (const rollDeg of [-3, 3]) {
      for (let seed = 11; seed <= 30; seed++) {
        const scene = poseScene({ seed, lensM: 1.5, distanceM: 5, rollDeg, markers: null });
        const { frames, target } = readAsTheScreen(scene);
        const result = resultOf(analyseTechnique({ frames, captureFps: 240, markers: null, target }));
        const missed = new Set(misses(scene, result).map((m) => m.split(':')[0]));
        for (const k of ['vz', 'vx', 'angle'] as const) {
          tally[k] ??= { n: 0, covered: 0 };
          tally[k].n++;
          if (!missed.has(k)) tally[k].covered++;
        }
      }
    }
    expect(Object.entries(tally).filter(([, c]) => c.n < 40 || chanceOfSoFew(c.covered, c.n) < 0.05)).toEqual([]);
  });

  it('no lines, the phone rolled 1–3° either way: the floor is levelled as on a level phone', () => {
    // The floor fit keeps the lower part of a sloping floor's points, which trims one end of the run-up more than the
    // other: one turn falls short of level, and what is left of it leaks the run-up's speed into the take-off's.
    for (const seed of [1, 2, 3]) {
      const level = resultOf(analyse({ seed, markers: null }).r).metrics.vz!.value;
      for (const rollDeg of [-3, -1, 2]) expect([seed, rollDeg, Math.abs(resultOf(analyse({ seed, markers: null, rollDeg }).r).metrics.vz!.value - level) < 0.005]).toEqual([seed, rollDeg, true]);
    }
  });

  it('no lines, a hand on the rim, the phone level: the feet hanging from the rim aren’t taken for a landing', () => {
    // Feet hanging still keep the floor fit sloping however far it turns: turning on for them tilts the frame.
    for (const seed of [1, 2, 3]) {
      const scene = poseScene({ hangAfterS: 0.34, markers: null, seed });
      const result = resultOf(analyseTechnique({ frames: scene.frames, captureFps: 240, markers: null }));
      expect([seed, result.events.landing, result.flags.includes('cut-off')]).toEqual([seed, null, true]);
    }
  });

  it('no lines, a hand on the rim, the phone rolled 3° against the slope the hanging feet give: the take-off figures still hold the truth', () => {
    // The feet hanging still from the rim pull the floor fit their way: it can come out nearly level on a rolled phone,
    // and the turn that follows is too small to say how far off level the picture is.
    for (const seed of [1, 2, 3]) {
      const scene = poseScene({ hangAfterS: 0.34, rollDeg: -3, markers: null, seed });
      const result = resultOf(analyseTechnique({ frames: scene.frames, captureFps: 240, markers: null }));
      expect([seed, misses(scene, result).filter((m) => /^(vz|vx|angle):/.test(m))]).toEqual([seed, []]);
    }
  });

  it('no lines, a run-up that comes in at 18–25° to the picture on a level phone: the plant is the plant, and no figure misses', () => {
    // Such a floor bends in the picture; turned for as if it were a tilt, the plant's feet leave it.
    for (const curveDeg of [18, 20, 25]) {
      for (const seed of [1, 2, 3]) {
        const scene = poseScene({ curveDeg, markers: null, seed });
        const result = resultOf(analyseTechnique({ frames: scene.frames, captureFps: 240, markers: null }));
        expect([curveDeg, seed, Math.abs(result.events.plantDown! - touchDownOf(scene)) <= 2, misses(scene, result).filter((m) => /^(vz|vx|angle|plant):/.test(m))]).toEqual([curveDeg, seed, true, []]);
      }
    }
  });

  it('lines each tapped TAP_PX in towards the other, filmed from 10 m: the last step, measured on their scale, still holds the truth', () => {
    // A 1.4 SD error in their gap: the scale is good only to the taps, a share that grows with the distance.
    for (const seed of [1, 2, 3, 4, 5]) {
      const scene = poseScene({ seed, distanceM: 10, approachSpeed: 4.5 });
      const { a, b, distanceM } = scene.markers!;
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      const u = { x: (b.x - a.x) / len, y: (b.y - a.y) / len };
      const markers = { a: { x: a.x + TAP_PX * u.x, y: a.y + TAP_PX * u.y }, b: { x: b.x - TAP_PX * u.x, y: b.y - TAP_PX * u.y }, distanceM };
      const result = resultOf(analyseTechnique({ frames: scene.frames, captureFps: 240, markers }));
      expect([seed, misses(scene, result).filter((m) => m.startsWith('step:'))]).toEqual([seed, []]);
    }
  });

  it('a 4K clip filmed from 10 m, its lines tapped as well as a finger can there: run-up speed, the last step and the take-off still cover the truth in 95 % of clips', () => {
    // The finger misses by as many screen points whatever the clip: on a 3840-px clip across the portrait page's 360-pt
    // box, zoomed 4×, a point is 3840 / 360 / 4 = 2.7 px, so the 3 pt that are `TAP_PX` on a 1920-px clip are 8 px here,
    // and the screen says so with the lines. 120 fps, the most an iPhone films 4K at; the pose model reads a picture
    // scaled down to its input, so its jitter in the clip's px doubles too. Three ways of tapping each of 40 clips.
    const tapPx = 8;
    const finger = normals(38);
    const tally: Record<string, { n: number; covered: number }> = {};
    for (let draw = 0; draw < 3; draw++) {
      for (let seed = 11; seed <= 50; seed++) {
        const scene = poseScene({ seed, width: 3840, height: 2160, focalPx: 2740, fps: 120, noisePx: 3, distanceM: 10, approachSpeed: 4.5 });
        const { a, b } = scene.markers!;
        const tap = (p: Pt) => ({ x: p.x + tapPx * finger(), y: p.y + tapPx * finger() });
        const markers = { a: tap(a), b: tap(b), distanceM: 3, picture: { width: scene.width, height: scene.height }, tapPx };
        const result = resultOf(analyseTechnique({ frames: scene.frames, captureFps: 120, markers }));
        const missed = new Set(misses(scene, result).map((m) => m.split(':')[0]));
        for (const k of ['vz', 'vx', 'angle', 'approach', 'step'] as const) {
          if (!result.metrics[k]) continue;
          tally[k] ??= { n: 0, covered: 0 };
          tally[k].n++;
          if (!missed.has(k)) tally[k].covered++;
        }
      }
    }
    expect(Object.entries(tally).filter(([, c]) => c.n < 120 || chanceOfSoFew(c.covered, c.n) < 0.05)).toEqual([]);
  });
});

describe('pose-model mistakes it copes with', () => {
  it('left and right swapped for a few frames, in the run-up and in the plant', () => {
    const { scene, r } = analyse({ swaps: [[200, 206], [300, 306]] });
    const result = resultOf(r);
    expect(result.style.foot).toBe('right');
    expect(grossMisses(scene, result)).toEqual([]);
  });

  it('left and right swapped throughout', () => {
    const { scene, r } = analyse({ swaps: [[0, 100_000]] });
    const result = resultOf(r);
    expect(result.style.foot).toBe('right');
    expect(grossMisses(scene, result)).toEqual([]);
  });

  it('someone standing in the picture: follows the runner, or whoever was tapped', () => {
    const { scene, r } = analyse({ bystanderM: 2 });
    expect(grossMisses(scene, resultOf(r))).toEqual([]);
    const bystander = scene.frames[0].poses[1];
    const tapped = analyseTechnique({ frames: scene.frames, captureFps: 240, markers: scene.markers, target: bystander[24] });
    expect(tapped).toEqual({ ok: false, problem: 'no-jump' });
  });

  it('the phone on its side, or tilted 5°', () => {
    for (const over of [{ rotate90: true }, { rollDeg: 5 }]) {
      const { scene, r } = analyse(over);
      expect(grossMisses(scene, resultOf(r))).toEqual([]);
    }
  });

  it('running right to left: the left side faces the camera', () => {
    const { scene, r } = analyse({ direction: 'left', foot: 'left' });
    const result = resultOf(r);
    expect(result.nearSide).toBe('left');
    expect(result.style).toEqual({ kind: 'one', foot: 'left' });
    expect(result.flags).not.toContain('far-foot');
    expect(grossMisses(scene, result)).toEqual([]);
  });
});

describe('a two-foot take-off', () => {
  it('names it, and times the second foot down', () => {
    const { scene, r } = analyse({ style: 'two' });
    const result = resultOf(r);
    expect(result.style).toEqual({ kind: 'two', foot: null });
    expect(result.metrics.gap).toBeDefined();
    expect(grossMisses(scene, result)).toEqual([]);
  });
});

describe('clips it can’t use', () => {
  it('nobody in the picture', () => {
    const frames = Array.from({ length: 100 }, (_, i) => ({ frame: i, t: i / 240, poses: [] }));
    expect(analyseTechnique({ frames, captureFps: 240, markers: null })).toEqual({ ok: false, problem: 'no-athlete' });
  });

  it('a run-up that stops before the jump', () => {
    const scene = poseScene();
    const frames = scene.frames.slice(0, scene.truth.takeoffFrame - 60);
    expect(analyseTechnique({ frames, captureFps: 240, markers: scene.markers })).toEqual({ ok: false, problem: 'no-jump' });
  });
});

describe('findJumpWindow', () => {
  it('finds the jump in a coarse pass (every 8th frame), with the athlete to follow', () => {
    const scene = poseScene({ bystanderM: 2 });
    const coarse = scene.frames.filter((f) => f.frame % 8 === 0);
    const w = findJumpWindow(coarse, 240, { before: 1.2, after: 0.8 })!;
    expect(w.from).toBeLessThan(scene.truth.takeoffFrame - 0.5 * 240);
    expect(w.to).toBeGreaterThan(scene.truth.landingFrame!);
    // The athlete's hips at the top of the jump, not the bystander's.
    expect(Math.abs(w.target.x - scene.frames[scene.truth.takeoffFrame].poses[0][24].x)).toBeLessThan(300);
  });

  it('finds nothing in a run-up without a jump', () => {
    const scene = poseScene();
    const coarse = scene.frames.filter((f) => f.frame % 8 === 0 && f.frame < scene.truth.takeoffFrame - 60);
    expect(findJumpWindow(coarse, 240, { before: 1.2, after: 0.8 })).toBeNull();
  });
});

describe('PASS_LINE', () => {
  it('holds the lines agreed in the plan', () => {
    expect(PASS_LINE).toMatchObject({ vz: 0.05, approach: 0.15, plant: 15, angle: 3, knee: 5, step: 0.08 });
  });
});
