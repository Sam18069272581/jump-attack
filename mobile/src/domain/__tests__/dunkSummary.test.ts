import { diagnose, type DunkInput } from '../dunk';
import { formatMetric, limiterLine, standingTouches, stateLine, touchProgress } from '../dunkSummary';

const base: DunkInput = { bodyMassKg: 80, standingReachCm: 240, cmj: [45], sj: [40], approachTouch: [], squat1rm: [], dropJumps: [], fvPct: [] };

describe('limiterLine', () => {
  it('names the first thing to measure while the limiter is unknown', () => {
    expect(limiterLine(diagnose(base))).toEqual({ title: '还不能判断短板', detail: '下一步：在 VBT 页测一次后蹲（两个以上重量），估出 1RM' });
  });

  it('gives the squat ratio for a strength limiter, flagged until a second test agrees', () => {
    const line = limiterLine(diagnose({ ...base, squat1rm: [100] }));
    expect(line).toEqual({ title: '当前短板：力量', detail: '深蹲 1.25× 体重，目标 1.5× · 建议练力量块（再测一次确认）' });
    expect(limiterLine(diagnose({ ...base, squat1rm: [100, 104] })).detail).not.toContain('再测一次');
  });

  it('points at the RSI, or at the contact time when the RSI is fine', () => {
    const strong = { ...base, squat1rm: [140, 140] };
    expect(limiterLine(diagnose({ ...strong, dropJumps: [{ rsi: 1.6, contactMs: 200 }] })).detail).toBe('跳深 RSI 1.60，目标 2.0 · 建议练反应块（再测一次确认）');
    expect(limiterLine(diagnose({ ...strong, dropJumps: [{ rsi: 2.2, contactMs: 280 }] })).detail).toContain('跳深触地 280 ms，目标 250 ms 以内');
  });

  it('moves on to transfer when strength and reactive strength are both past their lines', () => {
    const line = limiterLine(diagnose({ ...base, squat1rm: [140, 140], dropJumps: [{ rsi: 2.1, contactMs: 200 }, { rsi: 2.2, contactMs: 190 }] }));
    expect(line).toEqual({ title: '当前短板：转化', detail: '力量和反应都过线了，把它们练成助跑摸高 · 建议练转化块' });
  });
});

it('says how far the targets give on each kind of day', () => {
  expect(stateLine('good')).toBe('今天状态好 · 按计划练');
  expect(stateLine('fair')).toBe('今天状态一般 · 力量达标线放宽 5%');
  expect(stateLine('poor')).toBe('今天状态差 · 力量达标线放宽 10%');
  expect(stateLine('unknown')).toContain('测一次 CMJ');
});

it('measures progress from the standing reach to the dunk line', () => {
  expect(touchProgress(280, 320, 240)).toBe(0.5);
  expect(touchProgress(330, 320, 240)).toBe(1);
  expect(touchProgress(288, 320, null)).toBe(0.9);
});

it('turns CMJ results into standing touch estimates', () => {
  expect(standingTouches([{ started_at: '2026-10-01T10:00:00Z', best: 45 }], 240)).toEqual([{ at: '2026-10-01T10:00:00Z', value: 285 }]);
  expect(standingTouches([{ started_at: '2026-10-01T10:00:00Z', best: 45 }], null)).toEqual([]);
});

it('formats ratios with a ×', () => {
  expect(formatMetric({ value: 1.234, unit: '×', decimals: 2 })).toBe('1.23×');
  expect(formatMetric({ value: 212, unit: 'ms', decimals: 0 })).toBe('212 ms');
  expect(formatMetric({ value: null, unit: '', decimals: 2 })).toBe('—');
});
