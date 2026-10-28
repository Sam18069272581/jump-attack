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
  // JavaScript only, for the web version: nothing native to load.
  'react-native-web',
]);

const inExpoGo = (name: string) => IN_EXPO_GO.has(name) || name === 'expo' || name.startsWith('expo-') || name.startsWith('@expo/') || name.startsWith('@expo-google-fonts/');

it('depends only on libraries Expo Go ships', () => {
  expect(Object.keys(pkg.dependencies).filter((d) => !inExpoGo(d))).toEqual([]);
});

it('does not need a development build for anything', () => {
  // expo-dev-client only matters for builds of our own, which this app doesn't make. (expo-updates stays: `eas update`
  // needs it to publish the version Expo Go opens without a computer.)
  expect(Object.keys(pkg.dependencies)).not.toContain('expo-dev-client');
});

it('loads the capture screen', () => {
  expect(Capture).toBeInstanceOf(Function);
});
