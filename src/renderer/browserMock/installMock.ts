/**
 * Installs the browser preview mock as `window.electron` when no preload bridge exists.
 * Imported dynamically from main.tsx behind `import.meta.env.DEV`, so production
 * bundles never include it.
 */
import { browserMockElectron } from './index';

export function installBrowserMock(): void {
  if (typeof window.electron?.platform === 'string') return;
  console.info('[Browser Mock] Installing window.electron mock for browser preview');
  window.electron = browserMockElectron;
}
