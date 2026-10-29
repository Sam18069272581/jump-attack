import { analyseTechnique, findJumpWindow, PASS_LINE, polyFit, TAP_PX, type MetricKey, type TechniqueInput, type TechniqueResult } from '../technique';
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
  // The full check is tools/pose-validation (16 ways of filming, 40 clips each). Here a sample of it: 8 ways × 6 clips.
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

  it('no lines, the phone rolled 1–3° either way: the floor is levelled as on a level phone', () => {
    // The floor fit keeps the lower part of a sloping floor's points, which trims one end of the run-up more than the
    // other: one turn falls short of level, and what is left of it leaks the run-up's speed into the take-off's.
    for (const seed of [1, 2, 3]) {
      const level = resultOf(analyse({ seed, markers: null }).r).metrics.vz!.value;
      for (const rollDeg of [-3, -1, 2]) expect([seed, rollDeg, Math.abs(resultOf(analyse({ seed, markers: null, rollDeg }).r).metrics.vz!.value - level) < 0.005]).toEqual([seed, rollDeg, true]);
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
