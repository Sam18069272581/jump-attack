import { Accelerometer } from 'expo-sensors';

export type Vec = { x: number; y: number; z: number };

/** The accelerometer at rest reads gravity, so its direction gives the phone's tilt. Null when there is no sensor. */
export async function startGravity(onReading: (v: Vec) => void): Promise<{ remove: () => void } | null> {
  if (!(await Accelerometer.isAvailableAsync())) return null;
  Accelerometer.setUpdateInterval(100);
  return Accelerometer.addListener(onReading);
}

export function needsMotionPermission(): boolean {
  return false;
}

export async function requestMotionPermission(): Promise<boolean> {
  return true;
}
