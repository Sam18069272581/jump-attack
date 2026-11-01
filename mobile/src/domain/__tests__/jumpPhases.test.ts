import { comSamples, jumpPhases, MAX_JITTER_M, phaseFrames } from '../jumpPhases';
import { centreOfMass, LM, type Pose } from '../pose';
import type { PoseFrame } from '../technique';
import { cmjScene } from '../testing/cmjScene';
import { standing } from '../testing/standing';

const read = (scene: ReturnType<typeof cmjScene>, over: Partial<Parameters<typeof jumpPhases>[0]> = {}) =>
  jumpPhases({ samples: scene.samples, takeoffS: scene.truth.takeoffS, landingS: scene.truth.landingS, fps: 240, ...over });

describe('jumpPhases', () => {
  it('reads the phases and the depth of a clean CMJ', () => {
    // Synthetic CMJ (testing/cmjScene): take-off at 2.86 m/s (41.7 cm), 22 cm down.
    const scene = cmjScene();
    const r = read(scene);
    if (!r.ok) throw new Error(r.problem);
    const { truth } = scene;
    expect(r.result.pxPerM).toBeCloseTo(500, -1);
    expect(Math.abs(r.result.lowS! - truth.lowS)).toBeLessThan(2 / 240);
    expect(Math.abs(r.result.startS - truth.startS)).toBeLessThan(0.04);
    expect(Math.abs(r.result.depthM - truth.depthM)).toBeLessThan(0.005);
    expect(r.result.concentricS).toBeCloseTo(truth.takeoffS - truth.lowS, 2);
    expect(r.result.eccentricS!).toBeCloseTo(truth.lowS - truth.startS, 1);
  });

  it('holds the lowest point, the start and the depth with 3 mm of jitter', () => {
    // 1.5 px at 500 px/m is 3 mm, about the 2.8 mm measured on the athlete's own whole-body clip. Over 40 seeds the
    // lowest point stays within 4 ms and the depth within 5 mm; the start comes 32 ms late on average, 63 ms at most.
    const late: number[] = [];
    for (let seed = 1; seed <= 40; seed++) {
      const scene = cmjScene({ noisePx: 1.5, seed });
      const r = read(scene);
      if (!r.ok) throw new Error(r.problem);
      expect(Math.abs(r.result.lowS! - scene.truth.lowS)).toBeLessThan(0.005);
      expect(Math.abs(r.result.startS - scene.truth.startS)).toBeLessThan(0.07);
      expect(Math.abs(r.result.depthM - scene.truth.depthM)).toBeLessThan(0.005);
      expect(r.result.jitterM).toBeCloseTo(0.003, 3);
      late.push(r.result.startS - scene.truth.startS);
    }
    expect(late.reduce((a, b) => a + b, 0) / late.length).toBeLessThan(0.04);
  });

  it('takes the centre of mass wandering off the parabola in flight for what it is, not jitter', () => {
    // The athlete's own clip strayed 8 mm from the parabola as the legs tucked and reached, with 2.8 mm of jitter.
    const scene = cmjScene({ noisePx: 1.4, driftPx: 5 });
    const r = read(scene);
    if (!r.ok) throw new Error(r.problem);
    expect(r.result.jitterM).toBeLessThan(MAX_JITTER_M);
    expect(Math.abs(r.result.lowS! - scene.truth.lowS)).toBeLessThan(0.01);
  });

  it('has no eccentric phase in a squat jump', () => {
    // A squat jump starts low and only pushes: no unweighting, no braking.
    const scene = cmjScene({ unweightDip: 0, unweightS: 0.001, brakeS: 0.12, peak: 2.4 });
    const r = read(scene);
    if (!r.ok) throw new Error(r.problem);
    expect(r.result.eccentricS).toBeNull();
    expect(r.result.lowS).toBeNull();
  });

  it('turns away a clip that jitters too much from frame to frame', () => {
    const r = read(cmjScene({ noisePx: 6 }));
    expect(r).toEqual({ ok: false, problem: 'jitter' });
  });

  it('turns away a clip with long stretches the pose model missed', () => {
    const scene = cmjScene();
    const samples = scene.samples.map((s, i) => (i > 150 && i < 190 ? { t: s.t, y: null } : s));
    expect(read(scene, { samples })).toEqual({ ok: false, problem: 'gaps' });
  });

  it('fills short gaps', () => {
    const scene = cmjScene();
    const samples = scene.samples.map((s, i) => (i % 17 === 0 ? { t: s.t, y: null } : s));
    expect(read(scene, { samples }).ok).toBe(true);
  });

  it('counts frames the pose model never answered for as gaps', () => {
    // A read that loses the athlete for 40 frames (1/6 s) sends nothing for them, not empty frames.
    const scene = cmjScene();
    const samples = scene.samples.filter((_, i) => i <= 150 || i >= 190);
    expect(read(scene, { samples })).toEqual({ ok: false, problem: 'gaps' });
  });

  it('turns away a clip that starts mid-movement', () => {
    const scene = cmjScene();
    const samples = scene.samples.filter((s) => s.t > 0.55);
    expect(read(scene, { samples })).toEqual({ ok: false, problem: 'no-quiet' });
  });

  it('turns away a flight too short to scale by', () => {
    const scene = cmjScene();
    expect(read(scene, { landingS: scene.truth.takeoffS + 0.05 })).toEqual({ ok: false, problem: 'flight' });
  });
});

describe('comSamples', () => {
  const picture = { width: 1080, height: 1920 };
  const lift = (p: Pose, dy: number): Pose => p.map((l) => ({ ...l, y: l.y + dy }));
  const athlete = standing({ x: 540, floor: 1700, stature: 1000 });
  const frames = (dys: number[], over: (p: Pose, i: number) => Pose = (p) => p): PoseFrame[] =>
    dys.map((dy, i) => ({ frame: 100 + i, t: (100 + i) / 240, poses: [over(lift(athlete, dy), i)] }));

  it('follows the centre of mass of the athlete, frame by frame', () => {
    const s = comSamples(frames([0, -10, -25]), picture);
    const y0 = centreOfMass(athlete).y;
    expect(s.map((x) => x.t)).toEqual([100 / 240, 101 / 240, 102 / 240]);
    expect(s.map((x) => x.y! - y0)).toEqual([0, -10, -25].map((d) => expect.closeTo(d, 6)));
  });

  it('leaves out frames where part of the body is out of the picture', () => {
    // The head above the top edge: the segment model's centre of mass would be guessed, not seen.
    const s = comSamples(
      frames([0, 0, 0], (p, i) => (i === 1 ? p.map((l, k) => (k === LM.leftEar || k === LM.rightEar ? { ...l, y: -20 } : l)) : p)),
      picture,
    );
    expect(s.map((x) => x.y === null)).toEqual([false, true, false]);
  });

  it('leaves out frames the pose model barely sees', () => {
    const s = comSamples(
      frames([0, 0], (p, i) => (i === 0 ? p.map((l) => ({ ...l, v: 0.2 })) : p)),
      picture,
    );
    expect(s.map((x) => x.y === null)).toEqual([true, false]);
  });

  it('leaves out frames with nobody', () => {
    const f = frames([0, 0]);
    f[1].poses = [];
    expect(comSamples(f, picture)[1].y).toBeNull();
  });
});

describe('phaseFrames', () => {
  it('reads every frame from 1.3 s before take-off to landing', () => {
    // 240 fps: 312 frames before take-off, enough for standing still and the slowest countermovement.
    const f = phaseFrames({ takeoff: 1000, landing: 1100 }, 240, 0);
    expect(f[0]).toBe(688);
    expect(f.at(-1)).toBe(1100);
    expect(f).toHaveLength(413);
  });

  it('starts no earlier than the part of the clip shown', () => {
    expect(phaseFrames({ takeoff: 300, landing: 400 }, 240, 150)[0]).toBe(150);
  });
});
