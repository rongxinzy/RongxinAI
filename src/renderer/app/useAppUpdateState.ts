import { useEffect, useState } from 'react';

import { type AppUpdateRuntimeState, AppUpdateStatus } from '../../shared/appUpdate/constants';

const INITIAL_APP_UPDATE_STATE: AppUpdateRuntimeState = {
  status: AppUpdateStatus.Idle,
  source: null,
  info: null,
  progress: null,
  readyFilePath: null,
  readyFileHash: null,
  errorMessage: null,
  lastCheckedAt: null,
  failureStage: null,
  lastInstallResult: null,
};

/**
 * Subscribes to the main-process app update state machine and mirrors its
 * latest state for the shell (badge, settings about panel).
 */
export function useAppUpdateState(): AppUpdateRuntimeState {
  const [appUpdateState, setAppUpdateState] =
    useState<AppUpdateRuntimeState>(INITIAL_APP_UPDATE_STATE);

  useEffect(() => {
    let mounted = true;

    const loadInitialUpdateState = async () => {
      try {
        const state = await window.electron.appUpdate.getState();
        if (mounted) {
          setAppUpdateState(state);
        }
      } catch (error) {
        console.error('[App] failed to load initial app update state:', error);
      }
    };

    void loadInitialUpdateState();

    const unsubscribe = window.electron.appUpdate.onStateChanged(state => {
      setAppUpdateState(state);
    });

    return () => {
      mounted = false;
      unsubscribe();
    };
  }, []);

  return appUpdateState;
}
