import { formatMetric, standingTouches, stateLine } from '../dunkSummary';

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
