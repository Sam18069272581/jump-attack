import type { MetricDef } from './metrics';

/**
 * Whether today's result beats every earlier session's, and by how much (always positive). The first session of a
 * metric is no record: there is nothing to beat yet.
 */
export function personalRecord(previousBests: number[], today: number, lowerIsBetter = false): { previous: number; by: number } | null {
  if (previousBests.length === 0) return null;
  const previous = lowerIsBetter ? Math.min(...previousBests) : Math.max(...previousBests);
  const by = lowerIsBetter ? previous - today : today - previous;
  return by > 0 ? { previous, by } : null;
}

/**
 * Whether a metric's result can be celebrated as a record. Not bar speeds (they only compare at the same load), not
 * recovery readings (not performances), not set means (a repeated-sprint set is judged on its fade too).
 */
export function recordable(def: MetricDef): boolean {
  return def.category !== 'vbt' && def.category !== 'recovery' && !def.neutral && def.aggregate !== 'mean';
}
