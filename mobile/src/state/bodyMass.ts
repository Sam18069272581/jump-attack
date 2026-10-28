import type { SQLiteDatabase } from 'expo-sqlite';

import { listBodyMass } from '@/db/bodyMass';
import { listLoadedJumps, profileSessions } from '@/db/jumps';
import type { Athlete } from '@/db/repo';
import { massGainCm, massGainText, massNear } from '@/domain/bodyMass';
import { toISODate } from '@/domain/dates';
import { fvProfile, pushOff } from '@/domain/fvp';

/**
 * The diagnosis's body-mass line: centimetres per kilo lost from the latest force-velocity profile, read at the
 * mass of its own week. A hint instead when there is no profile to read it from.
 */
export async function loadMassGain(db: SQLiteDatabase, athlete: Athlete): Promise<{ text: string; estimated: boolean }> {
  const hpo = athlete.leg_length_cm != null && athlete.squat_height_cm != null ? pushOff(athlete.leg_length_cm, athlete.squat_height_cm) : null;
  const [loaded, weighIns] = await Promise.all([listLoadedJumps(db, athlete.id), listBodyMass(db, athlete.id)]);
  const latest = profileSessions(loaded).at(-1);
  const mass = latest ? (massNear(weighIns, toISODate(new Date(latest.startedAt))) ?? athlete.body_mass_kg) : null;
  const profile = latest && mass != null && hpo != null ? fvProfile(mass, hpo, latest.jumps) : null;
  if (!profile || mass == null || hpo == null) return { text: '先测力-速度曲线，才能估算减体重能多摸几厘米', estimated: false };
  const p = { f0: profile.f0, v0: profile.v0, massKg: mass, hpoM: hpo };
  return { text: massGainText(massGainCm(p, 1)!, massGainCm(p, 3)!), estimated: true };
}
