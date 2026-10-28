import { analyseJumps } from '../jumpAnalysis';
import { analysisKindFor, analysisTrials } from '../analysisTrials';
import { APPROACH_TOUCH, DROP_JUMP, getMetric, REPEATED_JUMP, sprintMetric } from '../metrics';

describe('analysisKindFor', () => {
  it('reads the kind of clip from how a metric is captured', () => {
    expect(analysisKindFor(getMetric('cmj')!)).toBe('jump');
    expect(analysisKindFor(APPROACH_TOUCH)).toBe('jump');
    expect(analysisKindFor(DROP_JUMP)).toBe('drop');
    expect(analysisKindFor(REPEATED_JUMP)).toBe('repeat');
    expect(analysisKindFor(sprintMetric(30))).toBeNull();
  });
});

describe('analysisTrials', () => {
  it('saves each counted jump of a CMJ clip as its own attempt, marked as found automatically', () => {
    // Flights of 132, 130 and 190 frames at 240 fps; the last is an outlier and stays out.
    const a = analyseJumps(
      [132, 130, 128, 190].map((ft, i) => ({ takeoff: 1000 * i, landing: 1000 * i + ft })),
      { kind: 'jump', captureFps: 240 },
    );
    const trials = analysisTrials(getMetric('cmj')!, a, { captureFps: 240, context: { asset: 'A1' } });
    expect(trials).toHaveLength(3);
    expect(trials[0]).toMatchObject({ value: 37.1, fps: 240, takeoff_frame: 0, landing_frame: 132, detail: { source: 'video', auto: true, asset_id: 'A1' } });
  });

  it('keeps the flags of a jump the athlete chose to count anyway', () => {
    const a = analyseJumps([{ takeoff: 100, landing: 232, flags: ['edge'] }], { kind: 'jump', captureFps: 240, keep: [0] });
    expect(analysisTrials(getMetric('cmj')!, a, { captureFps: 240, context: {} })[0].detail).toMatchObject({ flags: ['edge'] });
  });

  it('saves a drop jump with its contact and box, the RSI as its value', () => {
    const a = analyseJumps([{ touchdown: 100, takeoff: 150, landing: 254 }], { kind: 'drop', captureFps: 240, boxCm: 30 });
    const [t] = analysisTrials(DROP_JUMP, a, { captureFps: 240, context: { box: '30', from: 'dj' } });
    expect(t).toMatchObject({ value: 1.11, takeoff_frame: 150, landing_frame: 254, detail: { contact_frame: 100, contact_ms: 208, box_cm: 30, auto: true } });
  });

  it('adds standing reach to a filmed touch, and the athlete’s calibration', () => {
    const a = analyseJumps([{ takeoff: 100, landing: 232 }], { kind: 'jump', captureFps: 240 });
    const [t] = analysisTrials(APPROACH_TOUCH, a, { captureFps: 240, context: {}, reachCm: 250, offsetCm: 3 });
    // 250 + 37.1 + 3.
    expect(t.value).toBeCloseTo(290.1, 9);
    expect(t.detail).toMatchObject({ jump_cm: 37.1, standing_reach_cm: 250, offset_cm: 3 });
  });

  it('saves a set of repeated jumps as one attempt: the 10/5 RSI, with every jump in the detail', () => {
    // Six jumps, five rebounds. Contacts 48, 60, 48, 60, 48 frames.
    const a = analyseJumps(
      [
        { takeoff: 100, landing: 200 },
        { takeoff: 248, landing: 350 },
        { takeoff: 410, landing: 510 },
        { takeoff: 558, landing: 658 },
        { takeoff: 718, landing: 818 },
        { takeoff: 866, landing: 966 },
      ],
      { kind: 'repeat', captureFps: 240 },
    );
    const trials = analysisTrials(REPEATED_JUMP, a, { captureFps: 240, context: {} });
    expect(trials).toHaveLength(1);
    expect(trials[0].value).toBeCloseTo(a.summary.rsi105!, 2);
    // GCT-CV: contacts 0.20, 0.25, 0.20, 0.25, 0.20 s, mean 0.22, SD √(0.003 / 4) = 0.0274 → 12.4 %.
    expect(trials[0].detail).toMatchObject({ source: 'video', auto: true, gct_cv: 12.4 });
    const jumps = trials[0].detail!.jumps as object[];
    expect(jumps).toHaveLength(6);
    expect(jumps.slice(0, 3)).toMatchObject([{ takeoff: 100, landing: 200, ft_ms: 417 }, { gct_ms: 200 }, { gct_ms: 250 }]);
  });

  it('saves nothing for a set with fewer than five rebounds, which has no 10/5 RSI', () => {
    const a = analyseJumps(
      [
        { takeoff: 100, landing: 200 },
        { takeoff: 248, landing: 350 },
        { takeoff: 410, landing: 510 },
      ],
      { kind: 'repeat', captureFps: 240 },
    );
    expect(analysisTrials(REPEATED_JUMP, a, { captureFps: 240, context: {} })).toEqual([]);
  });
});
