import { decimal, localized, tr } from '@/i18n';

import { G } from './jump';
import type { Measured } from './technique';

/**
 * Real dunk attempts: the outcome the whole app works towards. Touch height says whether a dunk should be possible;
 * these say whether it happened. A lower rim or a smaller ball is practice and is counted on its own.
 */

export type Ball = 'basketball' | 'volleyball';

/** Made it, hit the rim but didn't finish, or didn't get the ball to the rim. */
export type Outcome = 'made' | 'rim' | 'short';

/**
 * A filmed attempt also has its video (the app's own copy) and, when the take-off analysis found the jump, that
 * analysis: a technique take (db/technique.ts) by its trial id. Both are left out when there is none.
 */
export type DunkAttempt = { id: number; at: string; rimCm: number; ball: Ball; outcome: Outcome; trialId?: number; videoUri?: string };

export type Setup = { rimCm: number; ball: Ball };

export const BALL_NAME: Record<Ball, string> = localized({ basketball: '篮球', volleyball: '排球' });

export const OUTCOME_NAME: Record<Outcome, string> = localized({ made: '扣进', rim: '碰框没进', short: '没够到' });

export const OUTCOMES: Outcome[] = ['made', 'rim', 'short'];

/** Only the latest attempts at a setup count, so misses from weeks ago fade out as the athlete improves. */
export const RECENT_ATTEMPTS = 10;

/** Adjustable hoops go down to about 2 m; nobody sets one above regulation by more than a few cm. */
export const RIM_RANGE_CM: [number, number] = [200, 320];

export type AttemptSummary = Setup & { total: number } & Record<Outcome, number>;

const sameSetup = (a: DunkAttempt, s: Setup) => a.rimCm === s.rimCm && a.ball === s.ball;

/** The latest attempts at `setup` (default: the setup of the latest attempt), by outcome. Null when there are none. */
export function attemptSummary(attempts: DunkAttempt[], setup?: Setup): AttemptSummary | null {
  const last = attempts.at(-1);
  const s = setup ?? (last ? { rimCm: last.rimCm, ball: last.ball } : null);
  if (!s) return null;
  const recent = attempts.filter((a) => sameSetup(a, s)).slice(-RECENT_ATTEMPTS);
  if (recent.length === 0) return null;
  const count = (o: Outcome) => recent.filter((a) => a.outcome === o).length;
  return { rimCm: s.rimCm, ball: s.ball, total: recent.length, made: count('made'), rim: count('rim'), short: count('short') };
}

/** The first dunk that counts for the goal: a basketball at or above the athlete's rim. Attempts are oldest first. */
export function firstDunk(attempts: DunkAttempt[], rimCm: number): DunkAttempt | null {
  return attempts.find((a) => a.outcome === 'made' && a.ball === 'basketball' && a.rimCm >= rimCm) ?? null;
}

export function rimProblem(rimCm: number): string | null {
  const [lo, hi] = RIM_RANGE_CM;
  return Number.isFinite(rimCm) && rimCm >= lo && rimCm <= hi ? null : tr('篮筐高度一般在 {lo}–{hi} cm，标准篮筐是 305', { lo, hi });
}

/**
 * How high a take-off velocity lifts the centre of mass after leaving the floor, cm: h = v² ÷ 2g (free flight), the
 * jump height a force plate reports. Its error is half the spread across v ± e: ((v + e)² − (v − e)²) ÷ 4g = v·e ÷ g.
 * It is the jump itself, not the touch: the centre of mass is already above standing height at take-off.
 */
export function jumpHeightCm(vz: Measured): Measured {
  return { value: ((vz.value * vz.value) / (2 * G)) * 100, error: ((Math.abs(vz.value) * vz.error) / G) * 100, status: vz.status };
}

/** "56 ± 1 cm", to the cm; a height less sure than its velocity's pass line says so. */
export function formatJumpHeight(h: Measured): string {
  const text = `${decimal(h.value, 0)} ± ${decimal(Math.max(h.error, 1), 0)} cm`;
  return h.status === 'ok' ? text : tr('{text}（不够准）', { text });
}
