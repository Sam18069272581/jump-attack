import { analyseTechnique, findJumpWindow, PASS_LINE, polyFit, type MetricKey, type TechniqueInput, type TechniqueResult } from '../technique';
import { poseScene, type PoseScene, type PoseSceneOptions } from '../testing/poseScene';

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
    expect(Math.abs(result.events.plantDown - plantDownFrame)).toBeLessThanOrEqual(1);
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

  it('is precise enough to act on for take-off velocity and angle, run-up speed, contact time and the last step', () => {
    for (const k of ['vz', 'vx', 'angle', 'approach', 'plant', 'step'] as const) expect([k, result.metrics[k]?.status]).toEqual([k, 'ok']);
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
  // The full check is tools/pose-validation (14 ways of filming, 40 clips each). Here a sample of it: 8 ways × 6 clips.
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
