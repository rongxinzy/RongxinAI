/** Zod-free channel maps keyed by their public preload method names. */
import type { IpcContractApi } from './contract';
import type { appSystemContract } from './appSystemContract';
import {
  AppIpc,
  AppConfigIpc,
  DialogIpc,
  LogIpc,
  PermissionsIpc,
  ProjectIpc,
  ShellIpc,
  StoreIpc,
  WindowIpc,
} from './channels';
import { AppUpdateIpc } from '../appUpdate/constants';

type MethodByChannel = {
  [K in keyof typeof appSystemContract as (typeof appSystemContract)[K]['channel']]: IpcContractApi<
    typeof appSystemContract
  >[K];
};

export type AppSystemInvokers<Channels extends Record<string, keyof MethodByChannel>> = {
  [K in keyof Channels]: MethodByChannel[Channels[K]];
};

export const storeChannels = {
  get: StoreIpc.Get,
  set: StoreIpc.Set,
  remove: StoreIpc.Remove,
} as const satisfies Record<string, keyof MethodByChannel>;

export const permissionsChannels = {
  checkCalendar: PermissionsIpc.CheckCalendar,
  requestCalendar: PermissionsIpc.RequestCalendar,
} as const satisfies Record<string, keyof MethodByChannel>;

export const windowChannels = {
  isMaximized: WindowIpc.IsMaximized,
  openDevTools: WindowIpc.OpenDevTools,
} as const satisfies Record<string, keyof MethodByChannel>;

export const dialogChannels = {
  selectDirectory: DialogIpc.SelectDirectory,
  selectFiles: DialogIpc.SelectFiles,
  saveInlineFile: DialogIpc.SaveInlineFile,
  readFileAsDataUrl: DialogIpc.ReadFileAsDataUrl,
  checkArtifactFile: DialogIpc.CheckArtifactFile,
} as const satisfies Record<string, keyof MethodByChannel>;

export const projectChannels = {
  getDefaultBaseDir: ProjectIpc.GetDefaultBaseDir,
  ensureScratchDir: ProjectIpc.EnsureScratchDir,
  createRandomWorkspace: ProjectIpc.CreateRandomWorkspace,
} as const satisfies Record<string, keyof MethodByChannel>;

export const shellChannels = {
  openPath: ShellIpc.OpenPath,
  showItemInFolder: ShellIpc.ShowItemInFolder,
  openExternal: ShellIpc.OpenExternal,
  openHtmlInBrowser: ShellIpc.OpenHtmlInBrowser,
  resolveLocalPath: ShellIpc.ResolveLocalPath,
} as const satisfies Record<string, keyof MethodByChannel>;

export const autoLaunchChannels = {
  get: AppIpc.GetAutoLaunch,
  set: AppIpc.SetAutoLaunch,
} as const satisfies Record<string, keyof MethodByChannel>;

export const preventSleepChannels = {
  get: AppIpc.GetPreventSleep,
  set: AppIpc.SetPreventSleep,
} as const satisfies Record<string, keyof MethodByChannel>;

export const appInfoChannels = {
  getVersion: AppIpc.GetVersion,
  isDev: AppIpc.IsDev,
  isEnterprise: AppIpc.IsEnterprise,
  getSystemLocale: AppIpc.GetSystemLocale,
  getInferenceEdition: AppIpc.GetInferenceEdition,
  usesBundledLlamaCppRuntime: AppIpc.UsesBundledLlamaCppRuntime,
  relaunch: AppIpc.Relaunch,
} as const satisfies Record<string, keyof MethodByChannel>;

export const appUpdateChannels = {
  getChannel: AppUpdateIpc.GetChannel,
  setChannel: AppUpdateIpc.SetChannel,
  getState: AppUpdateIpc.GetState,
  checkNow: AppUpdateIpc.CheckNow,
  retryDownload: AppUpdateIpc.RetryDownload,
  pauseDownload: AppUpdateIpc.PauseDownload,
  resumeDownload: AppUpdateIpc.ResumeDownload,
  cancelDownload: AppUpdateIpc.CancelDownload,
  installReady: AppUpdateIpc.InstallReady,
  revealDownload: AppUpdateIpc.RevealDownload,
} as const satisfies Record<string, keyof MethodByChannel>;

export const logChannels = {
  getPath: LogIpc.GetPath,
  openFolder: LogIpc.OpenFolder,
  exportZip: LogIpc.ExportZip,
} as const satisfies Record<string, keyof MethodByChannel>;

export const appConfigChannels = {
  checkApiConfig: AppConfigIpc.CheckApiConfig,
  generateSessionTitle: AppConfigIpc.GenerateSessionTitle,
  getRecentCwds: AppConfigIpc.GetRecentCwds,
} as const satisfies Record<string, keyof MethodByChannel>;
