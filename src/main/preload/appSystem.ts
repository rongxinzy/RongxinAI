import { ipcRenderer } from 'electron';

import type { ContextMenuAction, ContextMenuOpenEvent } from '../../shared/contextMenu';
import { AppUpdateIpc } from '../../shared/appUpdate/constants';
import { ContextMenuIpc, NetworkIpc, WindowIpc } from '../../shared/ipc/channels';
import { appSystemContractChannels } from '../../shared/ipc/appSystemContract.channels';
import type { appSystemContract } from '../../shared/ipc/appSystemContract';
import type { IpcContractApi } from '../../shared/ipc/contract';
import { onPush, onPushVoid } from './pushChannel';
import { createIpcInvokers } from './createIpcInvokers';

type AppSystemContractApi = IpcContractApi<typeof appSystemContract>;
const invokers = createIpcInvokers(appSystemContractChannels);

// Rename a contract invoker to its preload-facing method name, keeping the
// contract-derived signature.
const asApi = <K extends keyof AppSystemContractApi>(method: K): AppSystemContractApi[K] =>
  invokers[method] as AppSystemContractApi[K];

/** Maps contract method names onto the preload-facing member names. */
type Renamed<M extends Record<string, keyof AppSystemContractApi>> = {
  [K in keyof M]: AppSystemContractApi[M[K]];
};

/** Contract invokers renamed to preload names, plus hand-wired members. */
type WithExtra<E, M extends Record<string, keyof AppSystemContractApi>> = Renamed<M> & E;

// App, window, dialog, shell, and other system-level bridges for the renderer.
// Invoke methods come from the contract channel map via createIpcInvokers;
// fire-and-forget sends (contextMenu.execute, window controls, network status)
// and push subscriptions stay hand-wired below.
export const appSystemApi = {
  store: {
    get: asApi('storeGet'),
    set: asApi('storeSet'),
    remove: asApi('storeRemove'),
  },

  triage: {
    getConfig: asApi('triageGetConfig'),
    setConfig: asApi('triageSetConfig'),
  },

  permissions: {
    checkCalendar: asApi('permissionsCheckCalendar'),
    requestCalendar: asApi('permissionsRequestCalendar'),
  },

  // Internal app-level events (replaces raw ipcRenderer.on usage in App.tsx)
  appEvents: {
    onOpenSettings: (callback: () => void) => onPushVoid('app:openSettings', callback),
    onNewTask: (callback: () => void) => onPushVoid('app:newTask', callback),
  },

  contextMenu: {
    execute: (action: ContextMenuAction) => ipcRenderer.send(ContextMenuIpc.Execute, action),
    onOpen: (callback: (event: ContextMenuOpenEvent) => void) =>
      onPush<ContextMenuOpenEvent>(ContextMenuIpc.Open, callback),
  },

  window: {
    minimize: () => ipcRenderer.send(WindowIpc.Minimize),
    toggleMaximize: () => ipcRenderer.send(WindowIpc.ToggleMaximize),
    close: () => ipcRenderer.send(WindowIpc.Close),
    isMaximized: asApi('windowIsMaximized'),
    showSystemMenu: (position: { x: number; y: number }) =>
      ipcRenderer.send(WindowIpc.ShowSystemMenu, position),
    toggleDevTools: asApi('windowToggleDevTools'), // 切换调试面板
    openDevTools: asApi('windowOpenDevTools'),
    onStateChanged: (
      callback: (state: {
        isMaximized: boolean;
        isFullscreen: boolean;
        isFocused: boolean;
      }) => void,
    ) => onPush(WindowIpc.StateChanged, callback),
  },

  checkApiConfig: asApi('checkApiConfig'),
  generateSessionTitle: asApi('generateSessionTitle'),
  getRecentCwds: asApi('getRecentCwds'),

  dialog: {
    selectDirectory: asApi('dialogSelectDirectory'),
    selectFile: asApi('dialogSelectFile'),
    selectFiles: asApi('dialogSelectFiles'),
    saveInlineFile: asApi('dialogSaveInlineFile'),
    readFileAsDataUrl: asApi('dialogReadFileAsDataUrl'),
    checkArtifactFile: asApi('dialogCheckArtifactFile'),
    generateThumbnail: asApi('dialogGenerateThumbnail'),
    showMessageBox: asApi('dialogShowMessageBox'),
  },

  project: {
    getDefaultBaseDir: asApi('projectGetDefaultBaseDir'),
    createDirectory: asApi('projectCreateDirectory'),
    ensureScratchDir: asApi('projectEnsureScratchDir'),
    createRandomWorkspace: asApi('projectCreateRandomWorkspace'),
  },

  shell: {
    openPath: asApi('shellOpenPath'),
    showItemInFolder: asApi('shellShowItemInFolder'),
    openExternal: asApi('shellOpenExternal'),
    openHtmlInBrowser: asApi('shellOpenHtmlInBrowser'),
    resolveLocalPath: asApi('shellResolveLocalPath'),
  },

  autoLaunch: {
    get: asApi('autoLaunchGet'),
    set: asApi('autoLaunchSet'),
  },

  preventSleep: {
    get: asApi('preventSleepGet'),
    set: asApi('preventSleepSet'),
  },

  appInfo: {
    getVersion: asApi('appGetVersion'),
    isDev: asApi('appIsDev'),
    isEnterprise: asApi('appIsEnterprise'),
    getSystemLocale: asApi('appGetSystemLocale'),
    consumePendingLocalInferenceInstall: asApi('appConsumePendingLocalInferenceInstall'),
    getInferenceEdition: asApi('appGetInferenceEdition'),
    usesBundledLlamaCppRuntime: asApi('appUsesBundledLlamaCppRuntime'),
    relaunch: asApi('appRelaunch'),
  },

  appUpdate: {
    getChannel: asApi('appUpdateGetChannel'),
    setChannel: asApi('appUpdateSetChannel'),
    getState: asApi('appUpdateGetState'),
    checkNow: asApi('appUpdateCheckNow'),
    retryDownload: asApi('appUpdateRetryDownload'),
    pauseDownload: asApi('appUpdatePauseDownload'),
    resumeDownload: asApi('appUpdateResumeDownload'),
    cancelDownload: asApi('appUpdateCancelDownload'),
    installReady: asApi('appUpdateInstallReady'),
    revealDownload: asApi('appUpdateRevealDownload'),
    onStateChanged: (callback: (data: unknown) => void) =>
      onPush(AppUpdateIpc.StateChanged, callback),
  },

  log: {
    getPath: asApi('logGetPath'),
    openFolder: asApi('logOpenFolder'),
    exportZip: asApi('logExportZip'),
    fromRenderer: (level: string, tag: string, message: string) =>
      ipcRenderer.send('log:fromRenderer', level, tag, message),
  },

  runtimeNotices: {
    onNotice: (
      callback: (notice: import('../../common/runtimeNotice').RuntimeRetryNotice) => void,
    ) => onPush('runtime:notice', callback),
  },

  networkStatus: {
    send: (status: 'online' | 'offline') => ipcRenderer.send(NetworkIpc.StatusChange, status),
  },
} satisfies {
  appEvents: {
    onOpenSettings: (callback: () => void) => () => void;
    onNewTask: (callback: () => void) => () => void;
  };
  contextMenu: {
    execute: (action: ContextMenuAction) => void;
    onOpen: (callback: (event: ContextMenuOpenEvent) => void) => () => void;
  };
  runtimeNotices: {
    onNotice: (
      callback: (notice: import('../../common/runtimeNotice').RuntimeRetryNotice) => void,
    ) => () => void;
  };
  networkStatus: {
    send: (status: 'online' | 'offline') => void;
  };
  store: Renamed<{ get: 'storeGet'; set: 'storeSet'; remove: 'storeRemove' }>;
  triage: Renamed<{ getConfig: 'triageGetConfig'; setConfig: 'triageSetConfig' }>;
  permissions: Renamed<{
    checkCalendar: 'permissionsCheckCalendar';
    requestCalendar: 'permissionsRequestCalendar';
  }>;
  window: WithExtra<
    {
      minimize: () => void;
      toggleMaximize: () => void;
      close: () => void;
      showSystemMenu: (position: { x: number; y: number }) => void;
      onStateChanged: (
        callback: (state: {
          isMaximized: boolean;
          isFullscreen: boolean;
          isFocused: boolean;
        }) => void,
      ) => () => void;
    },
    {
      isMaximized: 'windowIsMaximized';
      toggleDevTools: 'windowToggleDevTools';
      openDevTools: 'windowOpenDevTools';
    }
  >;
  checkApiConfig: AppSystemContractApi['checkApiConfig'];
  generateSessionTitle: AppSystemContractApi['generateSessionTitle'];
  getRecentCwds: AppSystemContractApi['getRecentCwds'];
  dialog: Renamed<{
    selectDirectory: 'dialogSelectDirectory';
    selectFile: 'dialogSelectFile';
    selectFiles: 'dialogSelectFiles';
    saveInlineFile: 'dialogSaveInlineFile';
    readFileAsDataUrl: 'dialogReadFileAsDataUrl';
    checkArtifactFile: 'dialogCheckArtifactFile';
    generateThumbnail: 'dialogGenerateThumbnail';
    showMessageBox: 'dialogShowMessageBox';
  }>;
  project: Renamed<{
    getDefaultBaseDir: 'projectGetDefaultBaseDir';
    createDirectory: 'projectCreateDirectory';
    ensureScratchDir: 'projectEnsureScratchDir';
    createRandomWorkspace: 'projectCreateRandomWorkspace';
  }>;
  shell: Renamed<{
    openPath: 'shellOpenPath';
    showItemInFolder: 'shellShowItemInFolder';
    openExternal: 'shellOpenExternal';
    openHtmlInBrowser: 'shellOpenHtmlInBrowser';
    resolveLocalPath: 'shellResolveLocalPath';
  }>;
  autoLaunch: Renamed<{ get: 'autoLaunchGet'; set: 'autoLaunchSet' }>;
  preventSleep: Renamed<{ get: 'preventSleepGet'; set: 'preventSleepSet' }>;
  appInfo: Renamed<{
    getVersion: 'appGetVersion';
    isDev: 'appIsDev';
    isEnterprise: 'appIsEnterprise';
    getSystemLocale: 'appGetSystemLocale';
    consumePendingLocalInferenceInstall: 'appConsumePendingLocalInferenceInstall';
    getInferenceEdition: 'appGetInferenceEdition';
    usesBundledLlamaCppRuntime: 'appUsesBundledLlamaCppRuntime';
    relaunch: 'appRelaunch';
  }>;
  appUpdate: WithExtra<
    {
      onStateChanged: (callback: (data: unknown) => void) => () => void;
    },
    {
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
    }
  >;
  log: WithExtra<
    {
      fromRenderer: (level: string, tag: string, message: string) => void;
    },
    {
      getPath: 'logGetPath';
      openFolder: 'logOpenFolder';
      exportZip: 'logExportZip';
    }
  >;
};
