import { daysBetween, type ISODate } from './dates';
import { maxJumpHeight } from './fvp';

import { decimal, tr } from '@/i18n';

/**
 * Body mass in centimetres: how much higher the athlete would jump a few kilos lighter. The athlete's own
 * force-velocity line (fvp.ts) is re-run at the lighter mass, assuming the loss is fat: absolute force (F0 × mass)
 * and v0 stay, so F0 per kg rises. Shown as an estimate only; it never changes the diagnosis.
 */

export type MassProfile = { f0: number; v0: number; massKg: number; hpoM: number };

/** Losses outside this range are past what the straight-line model can be trusted for. */
export const MASS_LOSS_KG = [1, 3] as const;

/** Squat-jump height gained by losing `lossKg`, cm; null outside {@link MASS_LOSS_KG}. */
export function massGainCm(p: MassProfile, lossKg: number): number | null {
  if (lossKg < MASS_LOSS_KG[0] || lossKg > MASS_LOSS_KG[1]) return null;
  const force = p.f0 * p.massKg;
  return (maxJumpHeight(force / (p.massKg - lossKg), p.v0, p.hpoM) - maxJumpHeight(p.f0, p.v0, p.hpoM)) * 100;
}

const cm = (x: number) => decimal(x, 1);

export function massGainText(oneKg: number, threeKg: number): string {
  return tr('体重 −1 kg ≈ 摸高 +{oneKg} cm，−3 kg ≈ +{threeKg} cm（按你的力-速度曲线估算，假设减的是脂肪、力量和速度不变）', { oneKg: cm(oneKg), threeKg: cm(threeKg) });
}

/** A weigh-in this many days from a test still stands for the test day. */
export const MASS_NEAR_DAYS = 7;

/** The weigh-in closest to `date` within {@link MASS_NEAR_DAYS}, or null. */
export function massNear(history: { date: ISODate; kg: number }[], date: ISODate): number | null {
  let found: { kg: number; off: number } | null = null;
  for (const h of history) {
    const off = Math.abs(daysBetween(h.date, date));
    if (off <= MASS_NEAR_DAYS && (found == null || off < found.off)) found = { kg: h.kg, off };
  }
  return found?.kg ?? null;
}
