import type { ContextMenuOpenEvent } from '../../shared/contextMenu';
import { AppUpdateIpc, type AppUpdateRuntimeState } from '../../shared/appUpdate/constants';
import { DesktopPetIpc } from '../../shared/desktopPet/constants';
import { desktopPetContractChannels } from '../../shared/desktopPet/contract.channels';
import type { DesktopPetApi } from '../../shared/desktopPet/types';
import { ContextMenuIpc, WindowIpc } from '../../shared/ipc/channels';
import type { appEventContract } from '../../shared/ipc/appEventContract';
import { appEventChannels } from '../../shared/ipc/appEventContract.channels';
import {
  storeChannels,
  permissionsChannels,
  windowChannels,
  dialogChannels,
  projectChannels,
  shellChannels,
  autoLaunchChannels,
  preventSleepChannels,
  appInfoChannels,
  appUpdateChannels,
  logChannels,
  appConfigChannels,
  type AppSystemInvokers,
} from '../../shared/ipc/appSystemContract.channels';
import { onPush, onPushVoid } from './pushChannel';
import { createIpcEventSenders, createIpcInvokers } from './createIpcInvokers';

const events = createIpcEventSenders<typeof appEventContract>(appEventChannels);

// App, window, dialog, shell, and other system-level bridges for the renderer.
// Invokes use the contract channel map. Renderer events use the same channels
// as their main-side validation without loading zod into preload.
export const appSystemApi = {
  desktopPet: {
    ...createIpcInvokers(desktopPetContractChannels),
    onSettingsChanged: listener => onPush(DesktopPetIpc.SettingsChanged, listener),
    onOpenTask: listener => onPush(DesktopPetIpc.OpenTask, listener),
  } as DesktopPetApi,
  store: {
    ...(createIpcInvokers(storeChannels) as AppSystemInvokers<typeof storeChannels>),
  },

  permissions: {
    ...(createIpcInvokers(permissionsChannels) as AppSystemInvokers<typeof permissionsChannels>),
  },

  // Internal app-level events (replaces raw ipcRenderer.on usage in App.tsx)
  appEvents: {
    onOpenSettings: (callback: () => void) => onPushVoid('app:openSettings', callback),
    onNewTask: (callback: () => void) => onPushVoid('app:newTask', callback),
  },

  contextMenu: {
    execute: events.contextMenuExecute,
    onOpen: (callback: (event: ContextMenuOpenEvent) => void) =>
      onPush<ContextMenuOpenEvent>(ContextMenuIpc.Open, callback),
  },

  window: {
    minimize: events.windowMinimize,
    toggleMaximize: events.windowToggleMaximize,
    close: events.windowClose,
    ...(createIpcInvokers(windowChannels) as AppSystemInvokers<typeof windowChannels>),
    showSystemMenu: events.windowShowSystemMenu,
    onStateChanged: (
      callback: (state: {
        isMaximized: boolean;
        isFullscreen: boolean;
        isFocused: boolean;
      }) => void,
    ) => onPush(WindowIpc.StateChanged, callback),
  },

  ...(createIpcInvokers(appConfigChannels) as AppSystemInvokers<typeof appConfigChannels>),

  dialog: {
    ...(createIpcInvokers(dialogChannels) as AppSystemInvokers<typeof dialogChannels>),
  },

  project: {
    ...(createIpcInvokers(projectChannels) as AppSystemInvokers<typeof projectChannels>),
  },

  shell: {
    ...(createIpcInvokers(shellChannels) as AppSystemInvokers<typeof shellChannels>),
  },

  autoLaunch: {
    ...(createIpcInvokers(autoLaunchChannels) as AppSystemInvokers<typeof autoLaunchChannels>),
  },

  preventSleep: {
    ...(createIpcInvokers(preventSleepChannels) as AppSystemInvokers<typeof preventSleepChannels>),
  },

  appInfo: {
    ...(createIpcInvokers(appInfoChannels) as AppSystemInvokers<typeof appInfoChannels>),
  },

  appUpdate: {
    ...(createIpcInvokers(appUpdateChannels) as AppSystemInvokers<typeof appUpdateChannels>),
    onStateChanged: (callback: (data: AppUpdateRuntimeState) => void) =>
      onPush(AppUpdateIpc.StateChanged, callback),
  },

  log: {
    ...(createIpcInvokers(logChannels) as AppSystemInvokers<typeof logChannels>),
    fromRenderer: events.logFromRenderer,
  },

  runtimeNotices: {
    onNotice: (
      callback: (notice: import('../../common/runtimeNotice').RuntimeRetryNotice) => void,
    ) => onPush('runtime:notice', callback),
  },

  networkStatus: {
    send: events.networkStatusChange,
  },
};
