export const AppQuitOrigin = {
  ElectronBeforeQuit: 'electron-before-quit',
  OperatingSystemSessionEnd: 'operating-system-session-end',
  RendererRelaunch: 'renderer-relaunch',
  SignalInterrupt: 'signal-interrupt',
  SignalTerminate: 'signal-terminate',
  TrayMenu: 'tray-menu',
  UpdateInstall: 'update-install',
  WindowAllClosed: 'window-all-closed',
} as const;

export type AppQuitOrigin = (typeof AppQuitOrigin)[keyof typeof AppQuitOrigin];

let recordedOrigin: AppQuitOrigin | null = null;

export function recordAppQuitOrigin(origin: AppQuitOrigin): AppQuitOrigin {
  recordedOrigin ??= origin;
  return recordedOrigin;
}

export function getAppQuitOrigin(): AppQuitOrigin {
  return recordedOrigin ?? AppQuitOrigin.ElectronBeforeQuit;
}

export function resetAppQuitOriginForTesting(): void {
  recordedOrigin = null;
}
