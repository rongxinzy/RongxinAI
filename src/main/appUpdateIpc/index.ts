/** App auto-update IPC: state, check, retry, pause/resume/cancel, install. */
import { shell } from 'electron';

import { AppUpdateStatus } from '../../shared/appUpdate/constants';
import { appSystemContract } from '../../shared/ipc/appSystemContract';
import type { AppUpdateCoordinator } from '../libs/appUpdateCoordinator';
import { handleIpcContractSubset } from '../ipc/handleIpcContract';
import { t } from '../i18n';

export interface AppUpdateIpcDeps {
  getAppUpdateCoordinator: () => AppUpdateCoordinator;
  hasRunningSessions: () => boolean;
}

export const registerAppUpdateIpc = (deps: AppUpdateIpcDeps): void => {
  handleIpcContractSubset(appSystemContract, {
    appUpdateGetChannel: async () => {
      return deps.getAppUpdateCoordinator().getChannelPreference();
    },

    appUpdateSetChannel: async (_event, channel) => {
      deps.getAppUpdateCoordinator().setChannelPreference(channel);
      return deps.getAppUpdateCoordinator().getChannelPreference();
    },

    appUpdateGetState: async () => {
      return deps.getAppUpdateCoordinator().getState();
    },

    appUpdateCheckNow: async (_event, options) => {
      return deps.getAppUpdateCoordinator().checkNow(options);
    },

    appUpdateRetryDownload: async () => {
      const state = await deps.getAppUpdateCoordinator().retryDownload();
      return { success: true, state };
    },

    appUpdatePauseDownload: async () => {
      const state = deps.getAppUpdateCoordinator().pauseDownload();
      return { success: true, state };
    },

    appUpdateResumeDownload: async () => {
      const state = deps.getAppUpdateCoordinator().resumeDownload();
      return { success: true, state };
    },

    appUpdateCancelDownload: async () => {
      const state = deps.getAppUpdateCoordinator().cancelDownload();
      return { success: true, state };
    },

    appUpdateInstallReady: async () => {
      if (deps.hasRunningSessions()) {
        return {
          success: false,
          state: deps.getAppUpdateCoordinator().getState(),
          error: t('update.activeTask'),
        };
      }
      return deps.getAppUpdateCoordinator().installReadyUpdate();
    },

    // The downloaded installer lives in electron-updater's cache directory,
    // which is not discoverable from the UI. Reveal it in the file manager so
    // users can find, back up, or manually run the exact verified payload.
    appUpdateRevealDownload: async () => {
      const state = deps.getAppUpdateCoordinator().getState();
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
    },
  });
};
