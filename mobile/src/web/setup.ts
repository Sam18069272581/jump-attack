import { Alert, Platform } from 'react-native';

import { installWebDialogs } from './dialogs';

/** Browser-only wiring, run once before the first screen renders. */
export function setupWeb(): void {
  if (Platform.OS === 'web') installWebDialogs(Alert, window);
}

/**
 * The local database needs SharedArrayBuffer, so a cross-origin-isolated page (headers from
 * public/sw.js or the dev server). On a first visit the page reloads once the service worker is in.
 */
export function webDatabaseBlocked(): boolean {
  return Platform.OS === 'web' && !globalThis.crossOriginIsolated;
}
