import Capture from '@/app/measure/capture';
import { isExpoGo } from '@/media/runtime';

// Expo Go has no vision-camera native module; importing it there crashes the app at startup.
jest.mock('expo-constants', () => ({
  __esModule: true,
  default: { executionEnvironment: 'storeClient' },
  ExecutionEnvironment: { Bare: 'bare', Standalone: 'standalone', StoreClient: 'storeClient' },
}));
jest.mock('react-native-vision-camera', () => {
  throw new Error('vision-camera must not load in Expo Go');
});

it('loads the capture screen in Expo Go without the camera module', () => {
  expect(isExpoGo).toBe(true);
  expect(Capture).toBeInstanceOf(Function);
});
