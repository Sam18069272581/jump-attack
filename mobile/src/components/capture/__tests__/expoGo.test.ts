import pkg from '../../../../package.json';

import Capture from '@/app/measure/capture';

/**
 * The app only runs in Expo Go, which ships a fixed set of native modules; a library with its own native code crashes
 * there at startup. Expo SDK packages are all in Expo Go, and so are these community libraries (Expo Go's bundled
 * list for SDK 58). Adding anything else means checking Expo Go supports it first.
 */
const IN_EXPO_GO = new Set([
  'react',
  'react-native',
  '@react-native-community/slider',
  'react-native-safe-area-context',
  'react-native-screens',
  'react-native-svg',
  'react-native-webview',
]);

const inExpoGo = (name: string) => IN_EXPO_GO.has(name) || name === 'expo' || name.startsWith('expo-') || name.startsWith('@expo-google-fonts/');

it('depends only on libraries Expo Go ships', () => {
  expect(Object.keys(pkg.dependencies).filter((d) => !inExpoGo(d))).toEqual([]);
});

it('does not need a development build for anything', () => {
  // expo-dev-client and expo-updates only matter for builds of our own, which this app doesn't make.
  expect(Object.keys(pkg.dependencies)).not.toContain('expo-dev-client');
  expect(Object.keys(pkg.dependencies)).not.toContain('expo-updates');
});

it('loads the capture screen', () => {
  expect(Capture).toBeInstanceOf(Function);
});
