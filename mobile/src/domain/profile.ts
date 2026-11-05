import { RIM_RANGE_CM } from './dunkAttempts';
import { parseNumber } from './entry';
import { BODY_MASS } from './metrics';

import { tr } from '@/i18n';

/** Standing reach, cm: from short juniors to the tallest centres, standing flat-footed with one arm up. */
export const STANDING_REACH_RANGE_CM: [number, number] = [150, 300];
/** How far above the rim the hand reaches to dunk, cm: 0 (a hand at rim height) to two hands well over it. */
export const CLEARANCE_RANGE_CM: [number, number] = [0, 50];

export type ProfileText = { mass: string; reach: string; leg: string; squat: string; rim: string; clearance: string };
export type ProfileNumbers = {
  body_mass_kg: number | null;
  standing_reach_cm: number | null;
  leg_length_cm: number | null;
  squat_height_cm: number | null;
  rim_height_cm: number | null;
  dunk_clearance_cm: number | null;
};

const RANGES: { key: keyof ProfileText; name: string; unit: string; range?: [number, number] }[] = [
  { key: 'mass', name: '体重', unit: 'kg', range: BODY_MASS.range },
  { key: 'reach', name: '站立摸高', unit: 'cm', range: STANDING_REACH_RANGE_CM },
  { key: 'leg', name: '腿长', unit: 'cm' },
  { key: 'squat', name: '下蹲高度', unit: 'cm' },
  { key: 'rim', name: '篮筐高度', unit: 'cm', range: RIM_RANGE_CM },
  { key: 'clearance', name: '过筐余量', unit: 'cm', range: CLEARANCE_RANGE_CM },
];

/**
 * The profile as typed, read into numbers; blank stays empty. A value the diagnosis can't use (text, Infinity, a
 * weight of −5, a 999 cm reach) is a problem rather than a number, so it never reaches the database or a backup.
 * Leg length and squat height are checked as a pair by pushOff (fvp.ts).
 */
export function readProfile(t: ProfileText): { ok: true; values: ProfileNumbers } | { ok: false; problem: string } {
  const out: Partial<Record<keyof ProfileText, number | null>> = {};
  for (const f of RANGES) {
    const raw = t[f.key];
    if (raw.trim() === '') {
      out[f.key] = null;
      continue;
    }
    const n = parseNumber(raw);
    if (n == null) return { ok: false, problem: tr('{name}要填一个数', { name: tr(f.name) }) };
    if (f.range && (n < f.range[0] || n > f.range[1])) {
      return { ok: false, problem: tr('{name}一般在 {span}，检查一下输入', { name: tr(f.name), span: `${f.range[0]}–${f.range[1]} ${f.unit}` }) };
    }
    out[f.key] = n;
  }
  return {
    ok: true,
    values: {
      body_mass_kg: out.mass ?? null,
      standing_reach_cm: out.reach ?? null,
      leg_length_cm: out.leg ?? null,
      squat_height_cm: out.squat ?? null,
      rim_height_cm: out.rim ?? null,
      dunk_clearance_cm: out.clearance ?? null,
    },
  };
}
