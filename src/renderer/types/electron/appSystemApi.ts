/**
 * System preload surface, split from `../electron.d.ts`.
 *
 * Native dialogs, project directory helpers, shell integration and app
 * lifecycle: version info, update flow and log export.
 *
 * Method signatures derive from the zod IPC contract
 * (`src/shared/ipc/appSystemContract.ts`) — the contract is the single source
 * of truth shared with main and preload. The hand-written member names map to
 * contract methods via the `Renamed` helper below.
 */
import type { IpcContractApi } from '../../../shared/ipc/contract';
import type { appSystemContract } from '../../../shared/ipc/appSystemContract';

type AppSystemContractApi = IpcContractApi<typeof appSystemContract>;

/** Maps contract method names onto the preload-facing member names. */
type Renamed<M extends Record<string, keyof AppSystemContractApi>> = {
  [K in keyof M]: AppSystemContractApi[M[K]];
};

export interface DialogApi extends Renamed<{
  selectDirectory: 'dialogSelectDirectory';
  selectFile: 'dialogSelectFile';
  selectFiles: 'dialogSelectFiles';
  saveInlineFile: 'dialogSaveInlineFile';
  readFileAsDataUrl: 'dialogReadFileAsDataUrl';
  checkArtifactFile: 'dialogCheckArtifactFile';
  generateThumbnail: 'dialogGenerateThumbnail';
  showMessageBox: 'dialogShowMessageBox';
}> {}

export interface ProjectApi extends Renamed<{
  getDefaultBaseDir: 'projectGetDefaultBaseDir';
  createDirectory: 'projectCreateDirectory';
  ensureScratchDir: 'projectEnsureScratchDir';
  createRandomWorkspace: 'projectCreateRandomWorkspace';
}> {}

export interface ShellApi extends Renamed<{
  openPath: 'shellOpenPath';
  showItemInFolder: 'shellShowItemInFolder';
  openExternal: 'shellOpenExternal';
  openHtmlInBrowser: 'shellOpenHtmlInBrowser';
  resolveLocalPath: 'shellResolveLocalPath';
}> {}

export interface AppInfoApi extends Renamed<{
  getVersion: 'appGetVersion';
  isDev: 'appIsDev';
  isEnterprise: 'appIsEnterprise';
  getSystemLocale: 'appGetSystemLocale';
  getInferenceEdition: 'appGetInferenceEdition';
  usesBundledLlamaCppRuntime: 'appUsesBundledLlamaCppRuntime';
  relaunch: 'appRelaunch';
}> {}

export interface AppUpdateApi extends Renamed<{
  getChannel: 'appUpdateGetChannel';
  setChannel: 'appUpdateSetChannel';
  getState: 'appUpdateGetState';
  checkNow: 'appUpdateCheckNow';
  retryDownload: 'appUpdateRetryDownload';
  pauseDownload: 'appUpdatePauseDownload';
  resumeDownload: 'appUpdateResumeDownload';
  cancelDownload: 'appUpdateCancelDownload';
  installReady: 'appUpdateInstallReady';
  revealDownload: 'appUpdateRevealDownload';
}> {
  onStateChanged: (
    callback: (data: import('../../../shared/appUpdate/constants').AppUpdateRuntimeState) => void,
  ) => () => void;
}

export interface LogApi extends Renamed<{
  getPath: 'logGetPath';
  openFolder: 'logOpenFolder';
  exportZip: 'logExportZip';
}> {
  fromRenderer: (level: string, tag: string, message: string) => void;
}
