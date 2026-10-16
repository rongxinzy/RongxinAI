/**
 * Detects whether we're running in Electron or a plain browser.
 */
export function isElectronEnvironment(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.electron !== 'undefined' &&
    typeof window.electron.platform === 'string'
  );
}

/**
 * Returns true if we should use the browser mock (running in plain browser via Vite dev).
 */
export function shouldUseBrowserMock(): boolean {
  return !isElectronEnvironment() && import.meta.env.DEV;
}
