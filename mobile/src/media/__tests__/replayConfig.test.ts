import { jumpPhases } from '@/domain/jumpPhases';
import { analyseJumps } from '@/domain/jumpAnalysis';
import { cmjScene } from '@/domain/testing/cmjScene';
import { getMetric, REPEATED_JUMP } from '@/domain/metrics';

import { replayConfig } from '../replayConfig';

const colors = { ink: '#000', paper: '#fff', card: '#fff', accent: '#00f', rim: '#f60', muted: '#666', touch: '#909' };

describe('replayConfig', () => {
  const analysis = analyseJumps(
    [
      { takeoff: 100, landing: 232 },
      { takeoff: 600, landing: 730 },
    ],
    { kind: 'jump', captureFps: 240 },
  );
  const c = replayConfig({ def: getMetric('cmj')!, kind: 'jump', analysis, video: 'clip.mov', fileFps: 240, captureFps: 240, from: 50, to: 800, date: '2026-10-28', colors });

  it('shows a 240 fps clip at quarter speed: two frames for every frame of a 30 fps video', () => {
    expect(c).toMatchObject({ stride: 2, outFps: 30, speed: '1/4 慢放' });
  });

  it('steps a slow-motion file exported at 30 fps by its real-time rate', () => {
    const slow = replayConfig({ def: getMetric('cmj')!, kind: 'jump', analysis, video: 'clip.mov', fileFps: 30, captureFps: 240, from: 50, to: 800, date: '', colors });
    expect(slow.stride).toBe(2);
    expect(slow.captureFps).toBe(240);
  });

  it('carries the centre-of-mass curve for every frame shown', () => {
    expect(c.curve).toHaveLength(751);
    // Rounded to the millimetre: the peak is the jump height, 37.09 cm.
    expect(Math.max(...c.curve)).toBeCloseTo(37.1, 6);
  });

  it('labels each jump with its height and the set with its best', () => {
    expect(c.jumps[0]).toMatchObject({ label: '37.1 cm', detail: '滞空 550 ms', counted: true });
    expect(c.headline).toEqual({ label: '最高', value: '37.1', unit: 'cm' });
    // √2 × 0.56 cm: one frame on each of the two marks (see jumpAnalysis).
    expect(c.note).toBe('每个关键帧 ±1 帧：跳高 ±0.8 cm');
    expect(c.brand).toBe('JUMP ATTACK');
  });

  it('labels a rebound with its RSI and contact, and the set with its 10/5 score and spreads', () => {
    const rj = analyseJumps(
      [
        { takeoff: 100, landing: 200 },
        { takeoff: 248, landing: 350 },
        { takeoff: 410, landing: 510 },
      ],
      { kind: 'repeat', captureFps: 240 },
    );
    const r = replayConfig({ def: REPEATED_JUMP, kind: 'repeat', analysis: rj, video: 'clip.mov', fileFps: 240, captureFps: 240, from: 0, to: 600, date: '', colors });
    // FT 100 / 240 s: 9.81 × 0.4167² / 8 = 21.3 cm; the first jump has no contact before it.
    expect(r.jumps[0].label).toBe('21.3 cm');
    expect(r.jumps[1]).toMatchObject({ detail: '22.1 cm · 触地 200 ms' });
    expect(r.jumps[1].label).toMatch(/^\d\.\d\d RSI$/);
    expect(r.headline).toMatchObject({ label: '10/5 RSI', unit: '' });
    expect(r.stats.map((s) => s.label)).toEqual(['GCT-CV', 'DRI-CV', '平均触地']);
  });

  describe('with the phases', () => {
    // The synthetic CMJ of domain/testing/cmjScene: take-off at 2.86 m/s, 22 cm down, filmed at 240 fps.
    const scene = cmjScene();
    const jp = jumpPhases({ samples: scene.samples, takeoffS: scene.truth.takeoffS, landingS: scene.truth.landingS, fps: 240 });
    if (!jp.ok) throw new Error(jp.problem);
    const takeoff = Math.round(scene.truth.takeoffS * 240);
    const landing = Math.round(scene.truth.landingS * 240);
    const cmj = analyseJumps([{ takeoff, landing }], { kind: 'jump', captureFps: 240 });
    const f = replayConfig({ def: getMetric('cmj')!, kind: 'jump', analysis: cmj, video: 'clip.mov', fileFps: 240, captureFps: 240, from: 0, to: landing + 60, date: '', colors, phases: jp.result }).phases!;

    it('names the phases with their times, in file frames', () => {
      expect(f.phases.map((p) => [p.label, p.tone])).toEqual([
        ['离心', 'ecc'],
        ['向心', 'con'],
        ['腾空', 'air'],
      ]);
      expect(f.phases[0].from).toBe(Math.round(jp.result.startS * 240));
      expect(f.phases[1].to).toBe(takeoff);
      expect(f.phases[2]).toMatchObject({ from: takeoff, to: landing });
      // Flight 2v/g = 2 × 2.86 / 9.81 = 583 ms.
      expect(f.phases[2].time).toBe('583 ms');
    });

    it('sums up the depth and the take-off speed, g × flight / 2', () => {
      // 9.81 × 0.583 / 2 = 2.86 m/s.
      expect(f.stats).toEqual([
        { label: '下蹲', value: '22 cm', at: Math.round(jp.result.lowS! * 240) },
        { label: '起跳速度', value: '2.86 m/s', at: takeoff },
      ]);
    });

    it('has no eccentric phase in a squat jump', () => {
      const sj = cmjScene({ unweightDip: 0, unweightS: 0.001, brakeS: 0.12, peak: 2.4 });
      const r = jumpPhases({ samples: sj.samples, takeoffS: sj.truth.takeoffS, landingS: sj.truth.landingS, fps: 240 });
      if (!r.ok) throw new Error(r.problem);
      const g = replayConfig({ def: getMetric('sj')!, kind: 'jump', analysis: cmj, video: 'clip.mov', fileFps: 240, captureFps: 240, from: 0, to: 600, date: '', colors, phases: r.result }).phases!;
      expect(g.phases.map((p) => p.label)).toEqual(['向心', '腾空']);
      expect(g.stats.map((x) => x.label)).toEqual(['起跳速度']);
    });

    it('is left out when there is none', () => {
      expect(c.phases).toBeUndefined();
    });
  });
});
