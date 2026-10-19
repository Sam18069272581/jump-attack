import Constants, { ExecutionEnvironment } from 'expo-constants';

/** Expo Go has no custom native modules, so the high-frame-rate camera is unavailable there. */
export const isExpoGo = Constants.executionEnvironment === ExecutionEnvironment.StoreClient;
