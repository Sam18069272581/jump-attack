import { Platform } from 'react-native';

// The in-app camera (vision-camera) only exists in a native build: not in Expo Go, not on the web.
function load(env: string, os: typeof Platform.OS): typeof import('@/media/runtime') {
  jest.resetModules();
  jest.doMock('expo-constants', () => ({
    __esModule: true,
    default: { executionEnvironment: env },
    ExecutionEnvironment: { Bare: 'bare', Standalone: 'standalone', StoreClient: 'storeClient' },
  }));
  let mod!: typeof import('@/media/runtime');
  jest.isolateModules(() => {
    /* eslint-disable @typescript-eslint/no-require-imports -- a fresh copy of the module for each platform */
    jest.replaceProperty(require('react-native').Platform as typeof Platform, 'OS', os);
    mod = require('@/media/runtime');
    /* eslint-enable @typescript-eslint/no-require-imports */
  });
  return mod;
}

afterEach(() => jest.restoreAllMocks());

it('uses the in-app camera only in a native build', () => {
  expect(load('standalone', 'ios').hasInAppCamera).toBe(true);
  expect(load('storeClient', 'ios').hasInAppCamera).toBe(false);
  expect(load('bare', 'web').hasInAppCamera).toBe(false);
});

it('flags the web build', () => {
  expect(load('bare', 'web').isWeb).toBe(true);
  expect(load('storeClient', 'ios').isWeb).toBe(false);
});
