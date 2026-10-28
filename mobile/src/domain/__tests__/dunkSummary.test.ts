import { diagnose, type DunkInput } from '../dunk';
import { formatMetric, gapHeading, standingTouches, stateLine, touchNote } from '../dunkSummary';

it('says how far the targets give on each kind of day', () => {
  expect(stateLine('good')).toBe('今天状态好 · 按计划练');
  expect(stateLine('fair')).toBe('今天状态一般 · 力量达标线放宽 5%');
  expect(stateLine('poor')).toBe('今天状态差 · 力量达标线放宽 10%');
  expect(stateLine('unknown')).toContain('测一次 CMJ');
});

it('turns CMJ results into standing touch estimates', () => {
  expect(standingTouches([{ started_at: '2026-10-01T10:00:00Z', best: 45 }], 240)).toEqual([{ at: '2026-10-01T10:00:00Z', value: 285 }]);
  expect(standingTouches([{ started_at: '2026-10-01T10:00:00Z', best: 45 }], null)).toEqual([]);
});

it('adds the personal calibration to standing touch estimates', () => {
  // Wall reads 6.3 cm above reach + flight-time jump for this athlete (domain/touch.ts): 240 + 45 + 6.3 = 291.3.
  expect(standingTouches([{ started_at: '2026-10-01T10:00:00Z', best: 45 }], 240, 6.3)).toEqual([{ at: '2026-10-01T10:00:00Z', value: 291.3 }]);
  expect(standingTouches([{ started_at: '2026-10-01T10:00:00Z', best: 45 }], 240, null)).toEqual([{ at: '2026-10-01T10:00:00Z', value: 285 }]);
});

it('formats ratios with a ×', () => {
  expect(formatMetric({ value: 1.234, unit: '×', decimals: 2 })).toBe('1.23×');
  expect(formatMetric({ value: 212, unit: 'ms', decimals: 0 })).toBe('212 ms');
  expect(formatMetric({ value: null, unit: '', decimals: 2 })).toBe('—');
});

const input: DunkInput = { bodyMassKg: 75, standingReachCm: 240, cmj: [45], sj: [], approachTouch: [], squat1rm: [], dropJumps: [], fvPct: [] };

it('says what the approach touch is made of and how sure it is', () => {
  expect(touchNote(diagnose({ ...input, approachTouch: [317], approachSpread: { jumps: 3, errorCm: 2.3 } }))).toBe('助跑摸高 317.0 cm（最好 3 跳均值 ± 2.3）');
  expect(touchNote(diagnose({ ...input, approachTouch: [317], approachSpread: { jumps: 1, errorCm: 2 } }))).toBe('助跑摸高 317.0 cm（只有 1 跳 ± 2.0，测满 6 跳更准）');
  expect(touchNote(diagnose({ ...input, approachTouch: [317], approachSpread: { jumps: 3, errorCm: null } }))).toBe('助跑摸高 317.0 cm（最好 3 跳均值，录像估算的误差要校准 2 次后才知道）');
  expect(touchNote(diagnose(input))).toBe('原地估算 285.0 cm（站立摸高 + CMJ），测一次助跑摸高更准');
});

it('only claims the line once the whole error range clears it', () => {
  const at = (touch: number) => gapHeading(diagnose({ ...input, approachTouch: [touch], approachSpread: { jumps: 3, errorCm: 2.3 } }));
  expect(at(317)).toEqual({ label: '离扣篮线还差', hint: null });
  expect(at(318.5)).toEqual({ label: '离扣篮线还差', hint: '接近了，扣篮线在误差范围里，还不能确定' });
  expect(at(321)).toEqual({ label: '摸到扣篮线了', hint: '接近了，扣篮线在误差范围里，还不能确定' });
  expect(at(323)).toEqual({ label: '已过扣篮线', hint: '下一步是比赛里稳定扣：累了也能摸到这个高度。' });
});
