import type { BrowserWindow } from 'electron';

import type { AppUpdateCoordinator } from '../libs/appUpdateCoordinator';

/**
 * Window/app-lifecycle state carved out of the shared `rt` locator (work
 * package I.1, final domain): the main window, quit/reload bookkeeping,
 * window-state save timer, prevent-sleep blocker, and the app update
 * coordinator with its poll timer. Owned by the window/lifecycle bootstrap
 * modules.
 */
export interface LifecycleRuntimeState {
  mainWindow: BrowserWindow | null;
  isQuitting: boolean;
  /** True once initApp finished wiring startup; guards late window recreation. */
  bootstrapComplete: boolean;
  lastReloadAt: number;
  windowStateSaveTimer: ReturnType<typeof setTimeout> | null;
  preventSleepBlockerId: number | null;
  appUpdateCoordinator: AppUpdateCoordinator | null;
  appUpdatePollTimer: NodeJS.Timeout | null;
  lastSuccessfulAppUpdateCheckAt: number;
}

export const lifecycleRuntime: LifecycleRuntimeState = {
  mainWindow: null,
  isQuitting: false,
  bootstrapComplete: false,
  lastReloadAt: 0,
  windowStateSaveTimer: null,
  preventSleepBlockerId: null,
  appUpdateCoordinator: null,
  appUpdatePollTimer: null,
  lastSuccessfulAppUpdateCheckAt: 0,
};
