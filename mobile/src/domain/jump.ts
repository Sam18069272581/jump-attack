/** Standard gravity, m/s². */
export const G = 9.81;

/** Flight times outside this window are almost certainly mis-marked frames. */
export const MIN_FLIGHT_S = 0.15;
export const MAX_FLIGHT_S = 1.2;

/**
 * Jump height from flight time, assuming take-off and landing happen at the same body position:
 * h = g·t² / 8.
 */
export function heightFromFlightTime(flightS: number): number {
  return (G * flightS * flightS) / 8;
}

/** Flight time between the last frame on the ground and the first frame back on the ground. */
export function flightTimeFromFrames(takeoffFrame: number, landingFrame: number, fps: number): number {
  if (fps <= 0) throw new Error('fps must be positive');
  return (landingFrame - takeoffFrame) / fps;
}

export type JumpMeasurement = {
  flightS: number;
  heightCm: number;
};

export type FrameMarks = {
  takeoffFrame: number | null;
  landingFrame: number | null;
  fps: number;
};

export type MarkProblem = 'missing' | 'order' | 'too-short' | 'too-long';

/** Validates marked frames and returns either the measurement or why it can't be computed. */
export function measureFromMarks(marks: FrameMarks): { ok: true; value: JumpMeasurement } | { ok: false; problem: MarkProblem } {
  const { takeoffFrame, landingFrame, fps } = marks;
  if (takeoffFrame == null || landingFrame == null) return { ok: false, problem: 'missing' };
  if (landingFrame <= takeoffFrame) return { ok: false, problem: 'order' };
  const flightS = flightTimeFromFrames(takeoffFrame, landingFrame, fps);
  if (flightS < MIN_FLIGHT_S) return { ok: false, problem: 'too-short' };
  if (flightS > MAX_FLIGHT_S) return { ok: false, problem: 'too-long' };
  return { ok: true, value: { flightS, heightCm: heightFromFlightTime(flightS) * 100 } };
}

/**
 * Reactive strength index.
 * - `height`: jump height (m) ÷ ground contact (s), the usual drop-jump RSI.
 * - `flight`: flight time ÷ ground contact time.
 */
export function rsi(contactS: number, flightS: number, method: 'height' | 'flight' = 'height'): number {
  if (contactS <= 0) throw new Error('contact time must be positive');
  return method === 'flight' ? flightS / contactS : heightFromFlightTime(flightS) / contactS;
}

/** Seek position (seconds) that lands in the middle of a frame, so rounding never shows its neighbour. */
export function frameToSeconds(frame: number, fps: number): number {
  return (frame + 0.5) / fps;
}

export function frameCount(durationS: number, fps: number): number {
  return Math.max(0, Math.floor(durationS * fps));
}
