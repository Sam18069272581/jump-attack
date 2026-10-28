import { analyseJumps } from '@/domain/jumpAnalysis';
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
    expect(c.note).toBe('每个关键帧 ±1 帧：跳高 ±0.6 cm');
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
});
