import { Platform } from 'react-native';

function load(os: typeof Platform.OS): typeof import('@/media/runtime') {
  jest.resetModules();
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

it('flags the web build', () => {
  expect(load('web').isWeb).toBe(true);
  expect(load('ios').isWeb).toBe(false);
});
