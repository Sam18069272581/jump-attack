import Constants, { ExecutionEnvironment } from 'expo-constants';
import { Platform } from 'react-native';

/** Expo Go has no custom native modules, so the high-frame-rate camera is unavailable there. */
export const isExpoGo = Constants.executionEnvironment === ExecutionEnvironment.StoreClient;

export const isWeb = Platform.OS === 'web';

/** vision-camera needs a native build: not Expo Go, not the browser. */
export const hasInAppCamera = !isExpoGo && !isWeb;
