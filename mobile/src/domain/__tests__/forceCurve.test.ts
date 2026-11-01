import { forceCurve, MAX_JITTER_M } from '../forceCurve';
import { cmjScene } from '../testing/cmjScene';

const read = (scene: ReturnType<typeof cmjScene>, over: Partial<Parameters<typeof forceCurve>[0]> = {}) =>
  forceCurve({ samples: scene.samples, takeoffS: scene.truth.takeoffS, landingS: scene.truth.landingS, fps: 240, ...over });

describe('forceCurve', () => {
  it('reads the phases, depth and peak force of a clean CMJ', () => {
    // Synthetic CMJ (testing/cmjScene): peak 2.7 × body weight, take-off at 2.86 m/s (41.7 cm), 22 cm down.
    const scene = cmjScene();
    const r = read(scene);
    if (!r.ok) throw new Error(r.problem);
    const { truth } = scene;
    expect(r.result.pxPerM).toBeCloseTo(500, -1);
    // The 6 Hz filter rounds the peak off a little and smears the onset by a few tens of ms.
    expect(Math.abs(r.result.peak.value - truth.peak)).toBeLessThan(0.1);
    expect(Math.abs(r.result.lowS! - truth.lowS)).toBeLessThan(2 / 240);
    expect(Math.abs(r.result.startS - truth.startS)).toBeLessThan(0.04);
    expect(Math.abs(r.result.depthM - truth.depthM)).toBeLessThan(0.005);
    expect(r.result.concentricS).toBeCloseTo(truth.takeoffS - truth.lowS, 2);
    expect(r.result.eccentricS!).toBeCloseTo(truth.lowS - truth.startS, 1);
    // One force per frame from the window's start to take-off, standing at 1 × body weight.
    expect(r.result.force.length).toBe(r.result.t.length);
    expect(r.result.t[r.result.t.length - 1]).toBeLessThanOrEqual(truth.takeoffS);
    expect(r.result.force[40]).toBeCloseTo(1, 1);
  });

  it('stays within 0.25 × body weight of the peak with 3 mm of jitter', () => {
    // 1.5 px at 500 px/m is 3 mm: the jitter of the centre of mass assumed for a 1080p clip filmed whole-body.
    for (const seed of [1, 2, 3, 4, 5]) {
      const scene = cmjScene({ noisePx: 1.5, seed });
      const r = read(scene);
      if (!r.ok) throw new Error(r.problem);
      expect(Math.abs(r.result.peak.value - scene.truth.peak)).toBeLessThan(0.25);
      expect(Math.abs(r.result.lowS! - scene.truth.lowS)).toBeLessThan(0.01);
      expect(r.result.jitterM).toBeLessThan(MAX_JITTER_M);
    }
  });

  it('has no eccentric phase in a squat jump', () => {
    // A squat jump starts low and only pushes: no unweighting, no braking.
    const scene = cmjScene({ unweightDip: 0, unweightS: 0.001, brakeS: 0.12, peak: 2.4 });
    const r = read(scene);
    if (!r.ok) throw new Error(r.problem);
    expect(r.result.eccentricS).toBeNull();
    expect(r.result.lowS).toBeNull();
  });

  it('turns away a clip too shaky to differentiate twice', () => {
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
