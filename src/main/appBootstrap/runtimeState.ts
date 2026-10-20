import type { BrowserWindow } from 'electron';

import type { AppUpdateCoordinator } from '../libs/appUpdateCoordinator';

/**
 * Mutable singleton state shared across the main-process bootstrap modules.
 * Everything here is initialized lazily by the owning module; the object shape
 * keeps cross-module reads/writes identical to the previous single-closure
 * behavior in main.ts.
 */
export const rt = {
  preventSleepBlockerId: null as number | null,
  appUpdateCoordinator: null as AppUpdateCoordinator | null,
  appUpdatePollTimer: null as NodeJS.Timeout | null,
  lastSuccessfulAppUpdateCheckAt: 0,

  mainWindow: null as BrowserWindow | null,

  isQuitting: false,
  lastReloadAt: 0,
  windowStateSaveTimer: null as ReturnType<typeof setTimeout> | null,
};
