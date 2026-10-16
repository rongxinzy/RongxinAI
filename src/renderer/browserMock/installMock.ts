/**
 * Installs the browser mock into window.electron.
 * Called only when running in plain browser (Vite dev without Electron).
 */

import { browserMockElectron } from './index';
import { shouldUseBrowserMock } from './detectEnvironment';

export function installBrowserMock(): void {
  if (shouldUseBrowserMock()) {
    console.log('[Browser Mock] Installing window.electron mock for browser preview');
    (window as any).electron = browserMockElectron;
  }
}
