/** macOS traffic lights only exist inside Electron. The browser preview has none. */
export function needsTrafficLightInset(): boolean {
  return window.electron.platform === 'darwin' && navigator.userAgent.includes('Electron');
}
