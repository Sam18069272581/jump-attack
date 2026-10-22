/**
 * Drop jumps from a ladder of box heights: the reactive strength index (jump height ÷ ground contact) at each
 * height, and the height where it peaks, which is the height to train drop jumps from.
 */
import { G, heightFromFlightTime, MAX_FLIGHT_S, MIN_FLIGHT_S, rsi } from './jump';

/** Contact shorter than this is a mis-marked frame; longer than this is a squat, not a rebound. */
export const MIN_CONTACT_S = 0.08;
export const MAX_CONTACT_S = 1;
/** Rebounds slower than this use the slow stretch-shortening cycle rather than the fast, stiff one. */
export const FAST_CONTACT_S = 0.25;

export const BOX_HEIGHTS_CM = [20, 30, 40, 50, 60, 70];

export type DropJump = { contactS: number; flightS: number; heightCm: number; rsi: number };

export type DropJumpProblem = 'missing' | 'order' | 'contact-short' | 'contact-long' | 'flight-short' | 'flight-long';

/** Frames: first touch after the drop, take-off from the rebound, landing. */
export function dropJumpFromMarks(
  contactFrame: number | null,
  takeoffFrame: number | null,
  landingFrame: number | null,
  fps: number,
): { ok: true; value: DropJump } | { ok: false; problem: DropJumpProblem } {
  if (contactFrame == null || takeoffFrame == null || landingFrame == null) return { ok: false, problem: 'missing' };
  if (fps <= 0) throw new Error('fps must be positive');
  if (takeoffFrame <= contactFrame || landingFrame <= takeoffFrame) return { ok: false, problem: 'order' };
  return dropJump((takeoffFrame - contactFrame) / fps, (landingFrame - takeoffFrame) / fps);
}

/** Validates contact and flight times, from video marks or typed in from another app. */
export function dropJump(contactS: number, flightS: number): { ok: true; value: DropJump } | { ok: false; problem: DropJumpProblem } {
  if (contactS < MIN_CONTACT_S) return { ok: false, problem: 'contact-short' };
  if (contactS > MAX_CONTACT_S) return { ok: false, problem: 'contact-long' };
  if (flightS < MIN_FLIGHT_S) return { ok: false, problem: 'flight-short' };
  if (flightS > MAX_FLIGHT_S) return { ok: false, problem: 'flight-long' };
  return { ok: true, value: { contactS, flightS, heightCm: heightFromFlightTime(flightS) * 100, rsi: rsi(contactS, flightS) } };
}

/** Flight time that gives a jump height, for jumps typed in as height. */
export function flightFromHeight(heightCm: number): number {
  return Math.sqrt((8 * heightCm) / 100 / G);
}

export type LadderJump = { boxCm: number; rsi: number; contactMs: number; heightCm: number };
export type LadderStep = LadderJump & { attempts: number };

export type Ladder = {
  /** Best jump at each box height, lowest box first. */
  steps: LadderStep[];
  best: LadderStep | null;
  /** RSI was still rising at the highest box tried, so a higher box might be better. */
  tryHigher: boolean;
  /** The best rebound took longer than the fast-contact limit. */
  slowContact: boolean;
};

export function ladder(jumps: LadderJump[]): Ladder {
  const byBox = new Map<number, LadderJump[]>();
  for (const j of jumps) byBox.set(j.boxCm, [...(byBox.get(j.boxCm) ?? []), j]);
  const steps = [...byBox.entries()]
    .sort(([a], [b]) => a - b)
    .map(([, js]) => ({ ...js.reduce((a, b) => (b.rsi > a.rsi ? b : a)), attempts: js.length }));
  const best = steps.length ? steps.reduce((a, b) => (b.rsi > a.rsi ? b : a)) : null;
  return {
    steps,
    best,
    tryHigher: best != null && steps.length > 0 && best === steps.at(-1),
    slowContact: best != null && best.contactMs > FAST_CONTACT_S * 1000,
  };
}
