import { DeviceMotion } from 'expo-sensors';

import type { Vec } from './gravity';

// expo-sensors' Accelerometer reports orientation angles on the web, not a gravity vector,
// so read gravity from the devicemotion event instead. Units are m/s²; only the direction matters.
export async function startGravity(onReading: (v: Vec) => void): Promise<{ remove: () => void } | null> {
  if (typeof DeviceMotionEvent === 'undefined' && !(await DeviceMotion.isAvailableAsync())) return null;
  DeviceMotion.setUpdateInterval(100);
  return DeviceMotion.addListener((m) => {
    const g = m.accelerationIncludingGravity;
    if (g && g.x != null && g.y != null && g.z != null) onReading({ x: g.x, y: g.y, z: g.z });
  });
}

/** iOS Safari hides motion data until the user allows it, and only asks from a tap. */
export function needsMotionPermission(): boolean {
  return typeof DeviceMotionEvent !== 'undefined' && typeof (DeviceMotionEvent as unknown as { requestPermission?: unknown }).requestPermission === 'function';
}

export async function requestMotionPermission(): Promise<boolean> {
  return (await DeviceMotion.requestPermissionsAsync()).granted;
}
