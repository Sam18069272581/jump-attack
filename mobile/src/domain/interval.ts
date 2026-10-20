/** Timing between two marked video frames: sprint start → finish, or the start → end of a lift's concentric phase. */

export type IntervalProblem = 'missing' | 'order' | 'too-short' | 'too-long';

export type IntervalLimits = { minS: number; maxS: number };

export function intervalFromMarks(
  startFrame: number | null,
  endFrame: number | null,
  fps: number,
  limits: IntervalLimits,
): { ok: true; seconds: number } | { ok: false; problem: IntervalProblem } {
  if (startFrame == null || endFrame == null) return { ok: false, problem: 'missing' };
  if (fps <= 0) throw new Error('fps must be positive');
  if (endFrame <= startFrame) return { ok: false, problem: 'order' };
  const seconds = (endFrame - startFrame) / fps;
  if (seconds < limits.minS) return { ok: false, problem: 'too-short' };
  if (seconds > limits.maxS) return { ok: false, problem: 'too-long' };
  return { ok: true, seconds };
}

/** Distance in metres from a sprint metric code such as `sprint_30`. */
export function sprintDistance(code: string): number | null {
  const m = /^sprint_(\d+)$/.exec(code);
  return m ? Number(m[1]) : null;
}

/**
 * Plausible sprint times for a distance: faster than 12 m/s on average is beyond any human,
 * slower than a 2 m/s walk (plus a slow start) is a mis-marked frame.
 */
export function sprintLimits(metres: number): IntervalLimits {
  return { minS: metres / 12, maxS: metres / 2 + 5 };
}

/** Concentric phases of the tracked lifts, from a fast jump squat to a grinding max squat. */
export const LIFT_LIMITS: IntervalLimits = { minS: 0.1, maxS: 4 };

/** Mean concentric velocity (m/s) from the bar's range of motion and the time it took. */
export function meanVelocity(romCm: number, seconds: number): number {
  if (seconds <= 0) throw new Error('time must be positive');
  return romCm / 100 / seconds;
}

/** Rounds to the precision results are stored at, so a saved value matches what was shown. */
export function roundTo(value: number, decimals: number): number {
  const f = 10 ** decimals;
  return Math.round(value * f) / f;
}
