import { ipcRenderer } from 'electron';

import type { ContextMenuAction, ContextMenuOpenEvent } from '../../shared/contextMenu';
import { AppUpdateIpc } from '../../shared/appUpdate/constants';
import { TriageIpcChannel } from '../../shared/triage';
import type { ApiRequestPurpose } from '../../shared/ipc/apiRequest';
import {
  ApiIpc,
  AppConfigIpc,
  AppIpc,
  ContextMenuIpc,
  DevNetworkIpc,
  DialogIpc,
  LogIpc,
  NetworkIpc,
  PermissionsIpc,
  ProjectIpc,
  RuntimeNoticeIpc,
  ShellIpc,
  StoreIpc,
  WindowIpc,
} from '../../shared/ipc/channels';
import { onPush, onPushVoid } from './pushChannel';

// App, window, dialog, shell, and other system-level bridges for the renderer.
export const appSystemApi = {
  store: {
    get: (key: string) => ipcRenderer.invoke(StoreIpc.Get, key),
    set: (key: string, value: unknown) => ipcRenderer.invoke(StoreIpc.Set, key, value),
    remove: (key: string) => ipcRenderer.invoke(StoreIpc.Remove, key),
  },

  triage: {
    getConfig: () => ipcRenderer.invoke(TriageIpcChannel.GetConfig),
    setConfig: (config: unknown) => ipcRenderer.invoke(TriageIpcChannel.SetConfig, config),
  },

  permissions: {
    checkCalendar: () => ipcRenderer.invoke(PermissionsIpc.CheckCalendar),
    requestCalendar: () => ipcRenderer.invoke(PermissionsIpc.RequestCalendar),
  },

  api: {
    fetch: (options: {
      url: string;
      method: string;
      headers: Record<string, string>;
      body?: string;
      timeoutMs?: number;
      purpose?: ApiRequestPurpose;
    }) => ipcRenderer.invoke(ApiIpc.Fetch, options),
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
    isMaximized: () => ipcRenderer.invoke(WindowIpc.IsMaximized),
    showSystemMenu: (position: { x: number; y: number }) =>
      ipcRenderer.send(WindowIpc.ShowSystemMenu, position),
    toggleDevTools: () => ipcRenderer.invoke(WindowIpc.ToggleDevTools), // 切换调试面板
    openDevTools: () => ipcRenderer.invoke(WindowIpc.OpenDevTools),
    onStateChanged: (
      callback: (state: {
        isMaximized: boolean;
        isFullscreen: boolean;
        isFocused: boolean;
      }) => void,
    ) => onPush(WindowIpc.StateChanged, callback),
  },

  checkApiConfig: (options?: { probeModel?: boolean }) =>
    ipcRenderer.invoke(AppConfigIpc.CheckApiConfig, options),
  generateSessionTitle: (userInput: string | null) =>
    ipcRenderer.invoke(AppConfigIpc.GenerateSessionTitle, userInput),
  getRecentCwds: (limit?: number) => ipcRenderer.invoke(AppConfigIpc.GetRecentCwds, limit),

  dialog: {
    selectDirectory: (options?: { defaultPath?: string }) =>
      ipcRenderer.invoke(DialogIpc.SelectDirectory, options),
    selectFile: (options?: {
      title?: string;
      filters?: { name: string; extensions: string[] }[];
    }) => ipcRenderer.invoke(DialogIpc.SelectFile, options),
    selectFiles: (options?: {
      title?: string;
      filters?: { name: string; extensions: string[] }[];
    }) => ipcRenderer.invoke(DialogIpc.SelectFiles, options),
    saveInlineFile: (options: {
      dataBase64: string;
      fileName?: string;
      mimeType?: string;
      cwd?: string;
    }) => ipcRenderer.invoke(DialogIpc.SaveInlineFile, options),
    readFileAsDataUrl: (filePath: string) =>
      ipcRenderer.invoke(DialogIpc.ReadFileAsDataUrl, filePath),
    checkArtifactFile: (filePath: string) =>
      ipcRenderer.invoke(DialogIpc.CheckArtifactFile, filePath),
    generateThumbnail: (filePath: string) =>
      ipcRenderer.invoke(DialogIpc.GenerateThumbnail, filePath),
    showMessageBox: (options: {
      message: string;
      type?: 'none' | 'info' | 'error' | 'question' | 'warning';
      title?: string;
    }) => ipcRenderer.invoke(DialogIpc.ShowMessageBox, options),
  },

  project: {
    getDefaultBaseDir: () => ipcRenderer.invoke(ProjectIpc.GetDefaultBaseDir),
    createDirectory: (options: { name: string; baseDir?: string }) =>
      ipcRenderer.invoke(ProjectIpc.CreateDirectory, options),
    ensureScratchDir: () => ipcRenderer.invoke(ProjectIpc.EnsureScratchDir),
    createRandomWorkspace: () => ipcRenderer.invoke(ProjectIpc.CreateRandomWorkspace),
  },

  shell: {
    openPath: (filePath: string) => ipcRenderer.invoke(ShellIpc.OpenPath, filePath),
    showItemInFolder: (filePath: string) => ipcRenderer.invoke(ShellIpc.ShowItemInFolder, filePath),
    openExternal: (url: string) => ipcRenderer.invoke(ShellIpc.OpenExternal, url),
    openHtmlInBrowser: (htmlContent: string) =>
      ipcRenderer.invoke(ShellIpc.OpenHtmlInBrowser, htmlContent),
    pathExists: (filePath: string) => ipcRenderer.invoke(ShellIpc.PathExists, filePath),
  },

  autoLaunch: {
    get: () => ipcRenderer.invoke(AppIpc.GetAutoLaunch),
    set: (enabled: boolean) => ipcRenderer.invoke(AppIpc.SetAutoLaunch, enabled),
  },

  preventSleep: {
    get: () => ipcRenderer.invoke(AppIpc.GetPreventSleep),
    set: (enabled: boolean) => ipcRenderer.invoke(AppIpc.SetPreventSleep, enabled),
  },

  appInfo: {
    getVersion: () => ipcRenderer.invoke(AppIpc.GetVersion),
    isDev: () => ipcRenderer.invoke(AppIpc.IsDev),
    isEnterprise: () => ipcRenderer.invoke(AppIpc.IsEnterprise),
    getSystemLocale: () => ipcRenderer.invoke(AppIpc.GetSystemLocale),
    consumePendingLocalInferenceInstall: () =>
      ipcRenderer.invoke(AppIpc.ConsumePendingLocalInferenceInstall),
    relaunch: () => ipcRenderer.invoke(AppIpc.Relaunch),
  },

  appUpdate: {
    getState: () => ipcRenderer.invoke(AppUpdateIpc.GetState),
    checkNow: (options?: { manual?: boolean; userId?: string | null }) =>
      ipcRenderer.invoke(AppUpdateIpc.CheckNow, options),
    retryDownload: () => ipcRenderer.invoke(AppUpdateIpc.RetryDownload),
    pauseDownload: () => ipcRenderer.invoke(AppUpdateIpc.PauseDownload),
    resumeDownload: () => ipcRenderer.invoke(AppUpdateIpc.ResumeDownload),
    cancelDownload: () => ipcRenderer.invoke(AppUpdateIpc.CancelDownload),
    installReady: () => ipcRenderer.invoke(AppUpdateIpc.InstallReady),
    revealDownload: () => ipcRenderer.invoke(AppUpdateIpc.RevealDownload),
    onStateChanged: (callback: (data: unknown) => void) =>
      onPush(AppUpdateIpc.StateChanged, callback),
  },

  log: {
    getPath: () => ipcRenderer.invoke(LogIpc.GetPath),
    openFolder: () => ipcRenderer.invoke(LogIpc.OpenFolder),
    exportZip: () => ipcRenderer.invoke(LogIpc.ExportZip),
    fromRenderer: (level: string, tag: string, message: string) =>
      ipcRenderer.send(LogIpc.FromRenderer, level, tag, message),
  },

  runtimeNotices: {
    onNotice: (
      callback: (notice: import('../../common/runtimeNotice').RuntimeRetryNotice) => void,
    ) => onPush(RuntimeNoticeIpc.Notice, callback),
  },

  networkStatus: {
    send: (status: 'online' | 'offline') => ipcRenderer.send(NetworkIpc.StatusChange, status),
  },

  // 2026/09/17 lixiang  开发态主进程网络日志 → 渲染进程 Network beacon
  devNetwork: {
    onEntry: (callback: (entry: import('../../shared/devNetworkLog').DevNetworkLogEntry) => void) =>
      onPush(DevNetworkIpc.Entry, callback),
  },
};
