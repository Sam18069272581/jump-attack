import { dayState, diagnose, dunkLine, reachRuler, tolerance, warmupState, worstState, type DunkInput } from '../dunk';
import type { DayReadiness } from '../readiness';

const base: DunkInput = { bodyMassKg: 75, standingReachCm: 240, cmj: [], sj: [], approachTouch: [], squat1rm: [], dropJumps: [], fvPct: [] };

describe('gap to the dunk line', () => {
  it('measures from the approach touch, falling back to standing reach + CMJ', () => {
    expect(diagnose(base).gapCm).toBeNull();

    const standing = diagnose({ ...base, cmj: [45] });
    expect(standing.line).toBe(320);
    expect(standing.touch).toEqual({ standing: 285, approach: null, value: 285, source: 'standing' });
    expect(standing.gapCm).toBe(35);

    const approach = diagnose({ ...base, cmj: [45], approachTouch: [290, 292] });
    expect(approach.touch).toEqual({ standing: 285, approach: 292, value: 292, source: 'approach' });
    expect(approach.gapCm).toBe(28);
  });

  it('takes the rim height and clearance from the athlete when set', () => {
    expect(dunkLine(null, null)).toBe(320);
    expect(dunkLine(300, 25)).toBe(325);
    expect(diagnose({ ...base, rimCm: 300, clearanceCm: 25, approachTouch: [330] }).gapCm).toBe(-5);
  });
});

describe('how sure the gap is', () => {
  it('carries the error of the latest approach touch and says whether the line is inside it', () => {
    const d = diagnose({ ...base, approachTouch: [317], approachSpread: { jumps: 3, errorCm: 2.3 } });
    expect(d.touchError).toEqual({ jumps: 3, errorCm: 2.3 });
    expect(d.verdict).toBe('short');
    expect(diagnose({ ...base, approachTouch: [318.5], approachSpread: { jumps: 3, errorCm: 2.3 } }).verdict).toBe('close');
    expect(diagnose({ ...base, approachTouch: [323], approachSpread: { jumps: 3, errorCm: 2.3 } }).verdict).toBe('over');
  });

  it('has no error for the standing estimate, and no verdict without a touch', () => {
    const standing = diagnose({ ...base, cmj: [45] });
    expect(standing.touchError).toBeNull();
    expect(standing.verdict).toBe('short');
    expect(diagnose(base).verdict).toBeNull();
  });
});

describe('limiter', () => {
  it('asks for strength first under 1.5× body mass, whatever the RSI', () => {
    const d = diagnose({ ...base, squat1rm: [100, 105], dropJumps: [{ rsi: 2.4, contactMs: 180 }] });
    expect(d.limiter).toBe('strength');
    expect(d.confirmed).toBe(true);
    expect(d.reasons).toEqual(['深蹲 1RM 约 105 kg，是体重的 1.40 倍，不到 1.5 倍：先练力量。']);
    const squat = d.metrics.find((m) => m.key === 'squat_ratio')!;
    expect(squat.value).toBeCloseTo(1.4);
    expect(squat.status).toBe('low');
    // The drop jump isn't needed to decide, so it isn't asked for.
    expect(d.missing).toEqual(['approach', 'cmj']);
  });

  it('trains reactive strength when the squat is strong enough but RSI lags', () => {
    const d = diagnose({ ...base, squat1rm: [120, 130], dropJumps: [{ rsi: 1.7, contactMs: 200 }, { rsi: 1.8, contactMs: 190 }] });
    expect(d.limiter).toBe('reactive');
    expect(d.confirmed).toBe(true);
    expect(d.reasons[0]).toBe('深蹲是体重的 1.73 倍，力量够了；跳深 RSI 1.80，不到 2.0：练反应。');
    expect(d.metrics.find((m) => m.key === 'squat_ratio')!.status).toBe('mid');
    expect(d.metrics.find((m) => m.key === 'rsi')!.status).toBe('mid');
  });

  it('counts a slow contact as a reactive limiter even with a high RSI', () => {
    const d = diagnose({ ...base, squat1rm: [130], dropJumps: [{ rsi: 2.2, contactMs: 270 }] });
    expect(d.limiter).toBe('reactive');
    expect(d.reasons[0]).toBe('深蹲是体重的 1.73 倍，力量够了；触地 270 ms，超过 250 ms，反弹偏慢：练反应。');
    expect(d.metrics.find((m) => m.key === 'contact')!.status).toBe('low');
  });

  it('moves to transfer once both are past the line, keeping heavy squats under 2×', () => {
    const d = diagnose({ ...base, squat1rm: [130], dropJumps: [{ rsi: 2.1, contactMs: 180 }] });
    expect(d.limiter).toBe('transfer');
    expect(d.confirmed).toBe(false);
    expect(d.reasons).toEqual([
      '深蹲是体重的 1.73 倍，跳深 RSI 2.10，两项都过线：把能力转成摸高，多练助跑摸高跳和冲刺。',
      '深蹲还没到 2.0 倍体重，块里每周保留 2 次大重量。',
      '这个结论只有一次测试支持，再测一次结论一致才建议换训练块。',
    ]);
  });

  it('confirms only when the test before gave the same answer', () => {
    // Strength last time, reactive now.
    expect(diagnose({ ...base, squat1rm: [100, 130], dropJumps: [{ rsi: 1.8, contactMs: 200 }, { rsi: 1.8, contactMs: 200 }] }).confirmed).toBe(false);
    // Still reactive, but only one drop jump to go on.
    expect(diagnose({ ...base, squat1rm: [125, 130], dropJumps: [{ rsi: 1.8, contactMs: 200 }] }).confirmed).toBe(false);
  });

  it('trusts a single drop jump that is clearly below the RSI floor', () => {
    // RSI 1.3 is under the 1.5 line that holds an athlete back, not just under the 2.0 target: one test is enough,
    // as long as the squat was past 1.5× in the test before too.
    expect(diagnose({ ...base, squat1rm: [125, 130], dropJumps: [{ rsi: 1.3, contactMs: 200 }] }).confirmed).toBe(true);
    expect(diagnose({ ...base, squat1rm: [100, 130], dropJumps: [{ rsi: 1.3, contactMs: 200 }] }).confirmed).toBe(false);
    // Passing 2.0 once still needs a second test before moving on to transfer.
    expect(diagnose({ ...base, squat1rm: [125, 130], dropJumps: [{ rsi: 2.6, contactMs: 160 }] }).confirmed).toBe(false);
  });

  it('waits for a drop jump once the squat is past 1.5×', () => {
    const d = diagnose({ ...base, squat1rm: [130] });
    expect(d.limiter).toBeNull();
    expect(d.missing).toContain('drop_jump');
    expect(d.reasons).toEqual([]);
  });

  it('lists everything still to measure, in order', () => {
    expect(diagnose({ ...base, bodyMassKg: null, standingReachCm: null }).missing).toEqual(['body_mass', 'standing_reach', 'squat', 'drop_jump', 'approach', 'cmj']);
  });
});

describe('secondary signals', () => {
  it('tilts the block by the force-velocity profile', () => {
    const d = diagnose({ ...base, squat1rm: [130], dropJumps: [{ rsi: 2.1, contactMs: 180 }], fvPct: [80] });
    expect(d.reasons).toContain('力-速度曲线偏力量不足（FV% 80），块里多放一个力量练习。');
    expect(d.metrics.find((m) => m.key === 'fv')!.status).toBe('mid');
    const fast = diagnose({ ...base, squat1rm: [130], dropJumps: [{ rsi: 2.1, contactMs: 180 }], fvPct: [125] });
    expect(fast.reasons).toContain('力-速度曲线偏速度不足（FV% 125），块里多放一个速度练习。');
    // A strength block is already about force.
    expect(diagnose({ ...base, squat1rm: [100], fvPct: [80] }).reasons.some((r) => r.includes('FV%'))).toBe(false);
  });

  it('flags a poor eccentric utilisation ratio', () => {
    const d = diagnose({ ...base, cmj: [40], sj: [42] });
    expect(d.reasons).toContain('CMJ ÷ SJ 只有 0.95，不到 1.0：下蹲反弹的弹性没用上，加反向跳和连续跳。');
    expect(d.metrics.find((m) => m.key === 'eur')!.status).toBe('low');
  });

  it('flags a run-up that adds little over a standing jump', () => {
    const d = diagnose({ ...base, cmj: [45], approachTouch: [286] });
    expect(d.technique).toBe(true);
    expect(d.reasons).toContain('助跑摸高只比原地高 1.0 cm（精英篮球运动员平均高约 5.7 cm）：练最后两步和摆臂。');
    expect(diagnose({ ...base, cmj: [45], approachTouch: [292] }).technique).toBe(false);
  });
});

describe('tolerance', () => {
  it('relaxes nothing on a good or unknown day', () => {
    expect(tolerance('good', 'strength', true)).toEqual({ loadFactor: 1, velocityTolerance: 0 });
    expect(tolerance('unknown', 'reactive')).toEqual({ loadFactor: 1, velocityTolerance: 0 });
  });

  it('lets a strength block keep the load and move slower when bar speed is tracked', () => {
    expect(tolerance('fair', 'strength', true)).toEqual({ loadFactor: 1, velocityTolerance: 0.05 });
    expect(tolerance('poor', 'strength', true)).toEqual({ loadFactor: 1, velocityTolerance: 0.1 });
  });

  it('takes weight off to keep the speed in other blocks, and whenever speed is not tracked', () => {
    for (const [state, factor] of [['fair', 0.95], ['poor', 0.9]] as const) {
      for (const t of [tolerance(state, 'reactive', true), tolerance(state, 'transfer', true), tolerance(state, null, true), tolerance(state, 'strength')]) {
        expect(t.loadFactor).toBeCloseTo(factor);
        expect(t.velocityTolerance).toBe(0);
      }
    }
  });
});

describe('day state', () => {
  const day = (readiness: DayReadiness['readiness'], status: DayReadiness['recovery']['status']) =>
    ({ today: null, readiness, dropPct: 0, recovery: { status, reasons: [], warnings: [], hrv: null, rhr: null }, signals: [] }) as DayReadiness;

  it('reads recovery and the CMJ check', () => {
    expect(dayState(day('fatigued', 'good'))).toBe('poor');
    expect(dayState(day('unknown', 'poor'))).toBe('poor');
    expect(dayState(day('ready', 'fair'))).toBe('fair');
    expect(dayState(day('unknown', 'good'))).toBe('good');
    expect(dayState(day('ready', 'unknown'))).toBe('good');
    expect(dayState(day('unknown', 'unknown'))).toBe('unknown');
  });

  it('rates warm-up bar speed against its recent mean', () => {
    const recent = [1.0, 1.02, 0.98];
    expect(warmupState(0.96, recent)).toBe('good');
    expect(warmupState(0.92, recent)).toBe('fair');
    expect(warmupState(0.85, recent)).toBe('poor');
    expect(warmupState(0.85, [1.0, 1.0])).toBe('unknown');
  });

  it('takes the worst known signal', () => {
    expect(worstState('good', 'fair', 'unknown')).toBe('fair');
    expect(worstState('unknown', 'good')).toBe('good');
    expect(worstState()).toBe('unknown');
  });
});

describe('stale results', () => {
  // A block is 4 weeks with a retest at the end, so a result over 6 weeks old has missed a retest.
  const asOf = '2026-10-28';
  const input: DunkInput = {
    ...base,
    cmj: [45],
    squat1rm: [130, 130],
    dropJumps: [{ rsi: 1.8, contactMs: 200 }, { rsi: 1.8, contactMs: 200 }],
    approachTouch: [290],
    asOf,
  };

  it('flags the deciding results and the touch older than 6 weeks, and asks for a retest', () => {
    const d = diagnose({ ...input, latestAt: { squat: '2026-10-20', drop_jump: '2026-09-02', approach: '2026-09-16' } });
    // 56 days and 42 days: only the drop jump is past 42.
    expect(d.stale).toEqual(['drop_jump']);
    expect(d.reasons.at(-1)).toBe('跳深 RSI 是 8 周前测的，建议复测，结论才跟得上现在的你。');
  });

  it('ignores results that don’t decide anything now', () => {
    // Strength-limited: the drop jump doesn't count. The touch comes from the approach, so the CMJ doesn't either.
    const d = diagnose({ ...input, squat1rm: [100, 100], latestAt: { squat: '2026-10-20', drop_jump: '2026-01-01', cmj: '2026-01-01', approach: '2026-10-20' } });
    expect(d.limiter).toBe('strength');
    expect(d.stale).toEqual([]);
  });

  it('has nothing to compare without dates', () => {
    expect(diagnose(input).stale).toEqual([]);
  });
});

describe('touch calibration', () => {
  it('adds the athlete’s calibration to the standing estimate', () => {
    // 240 + 45 + 6.
    const d = diagnose({ ...base, cmj: [45], touchOffsetCm: 6 });
    expect(d.touch).toMatchObject({ standing: 291, value: 291, source: 'standing' });
  });

  it('compares a wall-read approach touch with the standing estimate only once calibrated', () => {
    // Read off the wall: 290. Uncalibrated, 240 + 45 = 285 would make the run-up look like it adds only 5 cm.
    const raw = diagnose({ ...base, cmj: [45], approachTouch: [290], approachMethod: 'wall' });
    expect(raw.metrics.find((m) => m.key === 'approach_gain')!.value).toBeNull();
    expect(raw.technique).toBe(false);
    expect(raw.reasons).toContain('助跑摸高是在墙上读的，原地摸高是用录像算的，两种口径差几厘米。录一次助跑摸高视频并填上墙上摸到的刻度，校准后才能比较助跑比原地高多少。');

    const calibrated = diagnose({ ...base, cmj: [45], approachTouch: [290], approachMethod: 'wall', touchOffsetCm: 6 });
    // 290 − (240 + 45 + 6) = −1: the run-up adds nothing.
    expect(calibrated.metrics.find((m) => m.key === 'approach_gain')!.value).toBe(-1);
    expect(calibrated.technique).toBe(true);
  });

  it('compares two video estimates as they are: the same offset is in both', () => {
    const d = diagnose({ ...base, cmj: [45], approachTouch: [290], approachMethod: 'video' });
    expect(d.metrics.find((m) => m.key === 'approach_gain')!.value).toBe(5);
  });
});

describe('reach ruler', () => {
  it('places the touch and the rim between the standing reach and the dunk line', () => {
    // Standing reach 240, dunk line 320: an 80 cm ruler. Touch 292 is 52 cm along (0.65), the rim 305 is 65 cm (0.8125).
    expect(reachRuler(292, 240, 320)).toEqual({ progress: 0.65, rim: 0.8125 });
  });

  it('pins a touch past either end to the end', () => {
    expect(reachRuler(330, 240, 320)!.progress).toBe(1);
    expect(reachRuler(230, 240, 320)!.progress).toBe(0);
  });

  it('leaves the rim off when it is not between the ends', () => {
    // A 300 cm dunk line (rim 285 + 15) sits under the regulation rim.
    expect(reachRuler(292, 240, 300)!.rim).toBeNull();
    expect(reachRuler(312, 310, 320)!.rim).toBeNull();
  });

  it('draws no ruler without a standing reach, a touch, or room up to the line', () => {
    expect(reachRuler(null, 240, 320)).toBeNull();
    expect(reachRuler(292, null, 320)).toBeNull();
    expect(reachRuler(325, 320, 320)).toBeNull();
  });
});
