import type { BrowserWindow } from 'electron';

/** Shared app and main-window lifecycle state. */
export interface LifecycleRuntimeState {
  mainWindow: BrowserWindow | null;
  isQuitting: boolean;
  /** True once initApp finished wiring startup; guards late window recreation. */
  bootstrapComplete: boolean;
}

export const lifecycleRuntime: LifecycleRuntimeState = {
  mainWindow: null,
  isQuitting: false,
  bootstrapComplete: false,
};
