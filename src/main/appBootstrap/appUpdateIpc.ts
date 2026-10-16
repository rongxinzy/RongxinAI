/** App auto-update IPC: state, check, retry, pause/resume/cancel, install. */
import { ipcMain, shell } from 'electron';

import { rt } from './runtimeState';

import { getAppUpdateCoordinator } from './runtimeServices';
import { AppUpdateIpc, AppUpdateStatus } from '../../shared/appUpdate/constants';
import { t } from '../i18n';

export const registerAppUpdateIpc = (): void => {
  ipcMain.handle(AppUpdateIpc.GetState, async () => {
    return getAppUpdateCoordinator().getState();
  });

  ipcMain.handle(AppUpdateIpc.CheckNow, async (_event, options?: { manual?: boolean }) => {
    return getAppUpdateCoordinator().checkNow(options);
  });

  ipcMain.handle(AppUpdateIpc.RetryDownload, async () => {
    const state = await getAppUpdateCoordinator().retryDownload();
    return { success: true, state };
  });

  ipcMain.handle(AppUpdateIpc.PauseDownload, async () => {
    const state = getAppUpdateCoordinator().pauseDownload();
    return { success: true, state };
  });

  ipcMain.handle(AppUpdateIpc.ResumeDownload, async () => {
    const state = getAppUpdateCoordinator().resumeDownload();
    return { success: true, state };
  });

  ipcMain.handle(AppUpdateIpc.CancelDownload, async () => {
    const state = getAppUpdateCoordinator().cancelDownload();
    return { success: true, state };
  });

  ipcMain.handle(AppUpdateIpc.InstallReady, async () => {
    if (rt.piRuntimeAdapter?.hasRunningSessions()) {
      return {
        success: false,
        state: getAppUpdateCoordinator().getState(),
        error: t('update.activeTask'),
      };
    }
    return getAppUpdateCoordinator().installReadyUpdate();
  });

  // The downloaded installer lives in electron-updater's cache directory,
  // which is not discoverable from the UI. Reveal it in the file manager so
  // users can find, back up, or manually run the exact verified payload.
  ipcMain.handle(AppUpdateIpc.RevealDownload, async () => {
    const state = getAppUpdateCoordinator().getState();
    if (state.status !== AppUpdateStatus.Ready || !state.readyFilePath) {
      return { success: false, error: 'No downloaded update file is ready to reveal.' };
    }
    try {
      shell.showItemInFolder(state.readyFilePath);
      return { success: true, path: state.readyFilePath };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to reveal the update file.',
      };
    }
  });
};
