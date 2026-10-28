/**
 * How a sprint was timed. Video starts the clock at first movement, timing gates when the body breaks a beam past the
 * start line, and a hand stopwatch carries the timer's reaction time: the methods differ by 0.1–0.3 s (Haugen &
 * Buchheit 2016, Sports Med 46:641), more than a training block changes a 10–30 m time, so times only compare within
 * one method. `manual` is a typed-in time whose method wasn't recorded.
 */
export type Timing = 'video' | 'gates' | 'stopwatch' | 'manual';

export const TIMING_NAME: Record<Timing, string> = { video: '录像', gates: '光电门', stopwatch: '秒表', manual: '手填' };

/** How a result's timing reads next to it. */
export const TIMING_NOTE: Record<Timing, string> = { video: '录像计时', gates: '光电门计时', stopwatch: '秒表计时', manual: '手填（未注明计时方式）' };

/** The methods a typed-in time can name. */
export const TYPED_TIMINGS = ['gates', 'stopwatch'] as const;

export function timingOf(detail: Record<string, unknown> | null | undefined): Timing {
  if (detail?.source !== 'manual') return 'video';
  return detail.timing === 'gates' || detail.timing === 'stopwatch' ? detail.timing : 'manual';
}

/** For each result, the latest earlier one timed the same way, or undefined when there is none. */
export function previousSameTiming<T extends { timing: Timing }>(rows: T[]): (T | undefined)[] {
  const last: Partial<Record<Timing, T>> = {};
  return rows.map((r) => {
    const prev = last[r.timing];
    last[r.timing] = r;
    return prev;
  });
}
