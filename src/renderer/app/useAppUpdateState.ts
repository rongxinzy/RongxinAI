import { useSyncExternalStore } from 'react';

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

let snapshot: AppUpdateRuntimeState = INITIAL_APP_UPDATE_STATE;
let release: (() => void) | null = null;
const listeners = new Set<() => void>();

const publish = (next: AppUpdateRuntimeState): void => {
  snapshot = next;
  for (const listener of listeners) listener();
};

const start = (): void => {
  if (release) return;
  const api = window.electron?.appUpdate;
  if (!api) return;
  release = api.onStateChanged(publish);
  void api
    .getState()
    .then(state => {
      if (release) publish(state);
    })
    .catch(error => {
      console.error('[App] failed to load initial app update state:', error);
    });
};

const stop = (): void => {
  release?.();
  release = null;
};

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  start();
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) stop();
  };
};

/**
 * Mirrors the main-process app update state for the components that show it.
 *
 * The state lives in this module rather than the App component: progress
 * arrives about once per second while downloading, and holding it at the root
 * re-rendered the whole chat tree on every tick.
 */
export function useAppUpdateState(): AppUpdateRuntimeState {
  return useSyncExternalStore(subscribe, () => snapshot);
}
