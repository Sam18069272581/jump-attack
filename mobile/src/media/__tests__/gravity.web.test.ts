import { angleBetween } from '@/domain/mobility';
import { needsMotionPermission, requestMotionPermission, startGravity } from '@/media/gravity.web';

// On the web expo-sensors' Accelerometer reports orientation angles, not a gravity vector,
// so the inclinometer reads DeviceMotion's accelerationIncludingGravity instead.
const mockListeners: ((m: unknown) => void)[] = [];
const mockRequest = jest.fn(async () => ({ granted: true }));
jest.mock('expo-sensors', () => ({
  DeviceMotion: {
    isAvailableAsync: async () => true,
    setUpdateInterval: jest.fn(),
    requestPermissionsAsync: () => mockRequest(),
    addListener: (cb: (m: unknown) => void) => (mockListeners.push(cb), { remove: () => mockListeners.splice(mockListeners.indexOf(cb), 1) }),
  },
}));

it('reports gravity from DeviceMotion and measures the angle between two poses', async () => {
  const seen: { x: number; y: number; z: number }[] = [];
  const sub = await startGravity((v) => seen.push(v));
  expect(sub).not.toBeNull();

  // Phone flat (gravity along z), then tilted 90° onto its side (gravity along x), in m/s².
  mockListeners.forEach((l) => l({ accelerationIncludingGravity: { x: 0, y: 0, z: -9.81 } }));
  mockListeners.forEach((l) => l({ accelerationIncludingGravity: { x: -9.81, y: 0, z: 0 } }));
  // Some browsers send motion events without gravity; they are skipped.
  mockListeners.forEach((l) => l({ accelerationIncludingGravity: null }));

  expect(seen).toHaveLength(2);
  expect(angleBetween(seen[0], seen[1])).toBeCloseTo(90);
  sub?.remove();
  expect(mockListeners).toHaveLength(0);
});

it('asks for motion access only where the browser requires it (iOS Safari)', async () => {
  expect(needsMotionPermission()).toBe(false);
  (globalThis as { DeviceMotionEvent?: unknown }).DeviceMotionEvent = { requestPermission: jest.fn() };
  expect(needsMotionPermission()).toBe(true);
  await expect(requestMotionPermission()).resolves.toBe(true);
  expect(mockRequest).toHaveBeenCalled();
  delete (globalThis as { DeviceMotionEvent?: unknown }).DeviceMotionEvent;
});
