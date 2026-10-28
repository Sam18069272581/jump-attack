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
