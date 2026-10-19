/**
 * System IPC contracts (channel + args + result), single source of truth for
 * the `appSystem` preload namespace, the main-side registrations it reaches
 * (store, permissions, dialog, project, shell, app, appUpdate, log,
 * appConfig), and the renderer-facing types under
 * `src/renderer/types/electron/appSystemApi.ts`.
 *
 * Arg/result shapes mirror what the renderer sends today (call sites noted per
 * method). Results are not stripped at runtime; the schemas document the fields
 * the renderer reads. Fire-and-forget `ipcRenderer.send` channels
 * (contextMenu.execute, window controls, log.fromRenderer, networkStatus.send)
 * and push subscriptions stay hand-wired in the preload — contracts only cover
 * invoke methods.
 */
import { z } from 'zod';

import { defineIpcContract } from './contract';
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
import { ProjectCreateDirectorySchema } from './schemas';

// ─── Shared result shapes ───────────────────────────────────────────────────

const PathResultSchema = z.object({
  success: z.boolean(),
  path: z.string().nullable(),
  error: z.string().optional(),
});

const FileFilterSchema = z.object({
  name: z.string(),
  extensions: z.array(z.string()),
});

/**
 * `AppUpdateRuntimeState` from src/shared/appUpdate/constants.ts; the update
 * coordinator owns the full shape and the renderer forwards it opaquely to
 * the update panel, so only the envelope is pinned here.
 */
const AppUpdateRuntimeStateSchema = z.custom<
  import('../appUpdate/constants').AppUpdateRuntimeState
>(value => typeof value === 'object' && value !== null);

// ─── Contract ───────────────────────────────────────────────────────────────

export const appSystemContract = defineIpcContract({
  // store (src/renderer/services/store.ts localStore)
  storeGet: {
    channel: StoreIpc.Get,
    args: z.tuple([z.string()]),
    // SQLite KV values are arbitrary JSON the renderer deserializes per key.
    result: z.unknown(),
  },
  storeSet: {
    channel: StoreIpc.Set,
    args: z.tuple([z.string(), z.unknown()]),
    result: z.void(),
  },
  storeRemove: {
    channel: StoreIpc.Remove,
    args: z.tuple([z.string()]),
    result: z.void(),
  },

  // calendar permissions (settings → permissions section)
  permissionsCheckCalendar: {
    channel: PermissionsIpc.CheckCalendar,
    args: z.tuple([]),
    result: z.object({
      success: z.boolean(),
      status: z.string().optional(),
      error: z.string().optional(),
      autoRequested: z.boolean().optional(),
    }),
  },
  permissionsRequestCalendar: {
    channel: PermissionsIpc.RequestCalendar,
    args: z.tuple([]),
    result: z.object({
      success: z.boolean(),
      granted: z.boolean().optional(),
      status: z.string().optional(),
      error: z.string().optional(),
    }),
  },

  // window (WindowTitleBar)
  windowIsMaximized: {
    channel: WindowIpc.IsMaximized,
    args: z.tuple([]),
    result: z.boolean(),
  },
  windowToggleDevTools: {
    channel: WindowIpc.ToggleDevTools,
    args: z.tuple([]),
    result: z.boolean(),
  },
  windowOpenDevTools: {
    channel: WindowIpc.OpenDevTools,
    args: z.tuple([]),
    result: z.boolean(),
  },

  // app config (coworkService.checkApiConfig / generateSessionTitle / getRecentCwds)
  checkApiConfig: {
    channel: AppConfigIpc.CheckApiConfig,
    args: z.tuple([z.object({ probeModel: z.boolean().optional() }).optional()]),
    result: z.object({
      hasConfig: z.boolean(),
      config: z.null(),
      error: z.string().optional(),
    }),
  },
  generateSessionTitle: {
    channel: AppConfigIpc.GenerateSessionTitle,
    args: z.tuple([z.string().nullable()]),
    result: z.string(),
  },
  getRecentCwds: {
    channel: AppConfigIpc.GetRecentCwds,
    args: z.tuple([z.number().optional()]),
    result: z.array(z.string()),
  },

  // dialog (folder pickers, skill zip picker, inline attachments, artifacts)
  dialogSelectDirectory: {
    channel: DialogIpc.SelectDirectory,
    args: z.tuple([z.object({ defaultPath: z.string().optional() }).optional()]),
    result: z.object({ success: z.boolean(), path: z.string().nullable() }),
  },
  dialogSelectFile: {
    channel: DialogIpc.SelectFile,
    args: z.tuple([
      z
        .object({
          title: z.string().optional(),
          filters: z.array(FileFilterSchema).optional(),
        })
        .optional(),
    ]),
    result: z.object({ success: z.boolean(), path: z.string().nullable() }),
  },
  dialogSelectFiles: {
    channel: DialogIpc.SelectFiles,
    args: z.tuple([
      z
        .object({
          title: z.string().optional(),
          filters: z.array(FileFilterSchema).optional(),
        })
        .optional(),
    ]),
    result: z.object({ success: z.boolean(), paths: z.array(z.string()) }),
  },
  dialogSaveInlineFile: {
    channel: DialogIpc.SaveInlineFile,
    args: z.tuple([
      z.object({
        dataBase64: z.string(),
        fileName: z.string().optional(),
        mimeType: z.string().optional(),
        cwd: z.string().optional(),
      }),
    ]),
    result: PathResultSchema,
  },
  dialogReadFileAsDataUrl: {
    channel: DialogIpc.ReadFileAsDataUrl,
    args: z.tuple([z.string()]),
    result: z.object({
      success: z.boolean(),
      dataUrl: z.string().optional(),
      error: z.string().optional(),
    }),
  },
  dialogCheckArtifactFile: {
    channel: DialogIpc.CheckArtifactFile,
    args: z.tuple([z.string()]),
    result: z.object({ success: z.boolean() }),
  },
  dialogGenerateThumbnail: {
    channel: DialogIpc.GenerateThumbnail,
    args: z.tuple([z.string()]),
    result: z.object({
      success: z.boolean(),
      dataUrl: z.string().optional(),
      error: z.string().optional(),
    }),
  },
  dialogShowMessageBox: {
    channel: DialogIpc.ShowMessageBox,
    args: z.tuple([
      z.object({
        message: z.string(),
        type: z.enum(['none', 'info', 'error', 'question', 'warning']).optional(),
        title: z.string().optional(),
      }),
    ]),
    result: z.object({ response: z.number() }),
  },

  // project (CreateProjectDialog, FolderSelectorPopover)
  projectGetDefaultBaseDir: {
    channel: ProjectIpc.GetDefaultBaseDir,
    args: z.tuple([]),
    result: PathResultSchema,
  },
  projectCreateDirectory: {
    channel: ProjectIpc.CreateDirectory,
    args: z.tuple([ProjectCreateDirectorySchema.input]),
    result: PathResultSchema.extend({
      code: z.enum(['invalid-name', 'already-exists']).optional(),
    }),
  },
  projectEnsureScratchDir: {
    channel: ProjectIpc.EnsureScratchDir,
    args: z.tuple([]),
    result: PathResultSchema,
  },
  projectCreateRandomWorkspace: {
    channel: ProjectIpc.CreateRandomWorkspace,
    args: z.tuple([]),
    result: PathResultSchema,
  },

  // shell (MarkdownContent links, artifact reveal, external URLs)
  shellOpenPath: {
    channel: ShellIpc.OpenPath,
    args: z.tuple([z.string()]),
    result: z.object({ success: z.boolean(), error: z.string().optional() }),
  },
  shellShowItemInFolder: {
    channel: ShellIpc.ShowItemInFolder,
    args: z.tuple([z.string()]),
    result: z.object({ success: z.boolean(), error: z.string().optional() }),
  },
  shellOpenExternal: {
    channel: ShellIpc.OpenExternal,
    args: z.tuple([z.string()]),
    result: z.object({ success: z.boolean(), error: z.string().optional() }),
  },
  shellOpenHtmlInBrowser: {
    channel: ShellIpc.OpenHtmlInBrowser,
    args: z.tuple([z.string()]),
    result: z.object({ success: z.boolean(), error: z.string().optional() }),
  },
  shellResolveLocalPath: {
    channel: ShellIpc.ResolveLocalPath,
    args: z.tuple([z.string(), z.string().optional()]),
    result: z.object({ path: z.string().nullable(), error: z.string().optional() }),
  },

  // auto-launch / prevent-sleep (SettingsPage)
  autoLaunchGet: {
    channel: AppIpc.GetAutoLaunch,
    args: z.tuple([]),
    result: z.object({ enabled: z.boolean() }),
  },
  autoLaunchSet: {
    channel: AppIpc.SetAutoLaunch,
    args: z.tuple([z.boolean()]),
    result: z.object({ success: z.boolean(), error: z.string().optional() }),
  },
  preventSleepGet: {
    channel: AppIpc.GetPreventSleep,
    args: z.tuple([]),
    result: z.object({ enabled: z.boolean() }),
  },
  preventSleepSet: {
    channel: AppIpc.SetPreventSleep,
    args: z.tuple([z.boolean()]),
    result: z.object({ success: z.boolean(), error: z.string().optional() }),
  },

  // app info (AboutSettingsPanel, i18nService, InitErrorView)
  appGetVersion: {
    channel: AppIpc.GetVersion,
    args: z.tuple([]),
    result: z.string(),
  },
  appIsDev: {
    channel: AppIpc.IsDev,
    args: z.tuple([]),
    result: z.boolean(),
  },
  appIsEnterprise: {
    channel: AppIpc.IsEnterprise,
    args: z.tuple([]),
    result: z.boolean(),
  },
  appGetSystemLocale: {
    channel: AppIpc.GetSystemLocale,
    args: z.tuple([]),
    result: z.string(),
  },
  appConsumePendingLocalInferenceInstall: {
    channel: AppIpc.ConsumePendingLocalInferenceInstall,
    args: z.tuple([]),
    result: z.string().nullable(),
  },
  appGetInferenceEdition: {
    channel: AppIpc.GetInferenceEdition,
    args: z.tuple([]),
    result: z.enum(['lite', 'cpu', 'cuda']),
  },
  appUsesBundledLlamaCppRuntime: {
    channel: AppIpc.UsesBundledLlamaCppRuntime,
    args: z.tuple([]),
    result: z.boolean(),
  },
  appRelaunch: {
    channel: AppIpc.Relaunch,
    args: z.tuple([]),
    result: z.void(),
  },

  // app update (AboutSettingsPanel update section)
  appUpdateGetChannel: {
    channel: AppUpdateIpc.GetChannel,
    args: z.tuple([]),
    result: z.enum(['stable', 'beta']),
  },
  appUpdateSetChannel: {
    channel: AppUpdateIpc.SetChannel,
    args: z.tuple([z.enum(['stable', 'beta'])]),
    result: z.enum(['stable', 'beta']),
  },
  appUpdateGetState: {
    channel: AppUpdateIpc.GetState,
    args: z.tuple([]),
    result: AppUpdateRuntimeStateSchema,
  },
  appUpdateCheckNow: {
    channel: AppUpdateIpc.CheckNow,
    args: z.tuple([
      z
        .object({
          manual: z.boolean().optional(),
          userId: z.string().nullable().optional(),
        })
        .optional(),
    ]),
    result: z.object({
      success: z.boolean(),
      state: AppUpdateRuntimeStateSchema,
      updateFound: z.boolean(),
      error: z.string().optional(),
    }),
  },
  appUpdateRetryDownload: {
    channel: AppUpdateIpc.RetryDownload,
    args: z.tuple([]),
    result: z.object({ success: z.boolean(), state: AppUpdateRuntimeStateSchema }),
  },
  appUpdatePauseDownload: {
    channel: AppUpdateIpc.PauseDownload,
    args: z.tuple([]),
    result: z.object({ success: z.boolean(), state: AppUpdateRuntimeStateSchema }),
  },
  appUpdateResumeDownload: {
    channel: AppUpdateIpc.ResumeDownload,
    args: z.tuple([]),
    result: z.object({ success: z.boolean(), state: AppUpdateRuntimeStateSchema }),
  },
  appUpdateCancelDownload: {
    channel: AppUpdateIpc.CancelDownload,
    args: z.tuple([]),
    result: z.object({ success: z.boolean(), state: AppUpdateRuntimeStateSchema }),
  },
  appUpdateInstallReady: {
    channel: AppUpdateIpc.InstallReady,
    args: z.tuple([]),
    result: z.object({
      success: z.boolean(),
      state: AppUpdateRuntimeStateSchema,
      error: z.string().optional(),
    }),
  },
  appUpdateRevealDownload: {
    channel: AppUpdateIpc.RevealDownload,
    args: z.tuple([]),
    result: z.object({
      success: z.boolean(),
      path: z.string().optional(),
      error: z.string().optional(),
    }),
  },

  // log (AboutSettingsPanel export; getPath/openFolder used by settings links)
  logGetPath: {
    channel: LogIpc.GetPath,
    args: z.tuple([]),
    result: z.string(),
  },
  logOpenFolder: {
    channel: LogIpc.OpenFolder,
    args: z.tuple([]),
    result: z.void(),
  },
  logExportZip: {
    channel: LogIpc.ExportZip,
    args: z.tuple([]),
    result: z.object({
      success: z.boolean(),
      canceled: z.boolean().optional(),
      path: z.string().optional(),
      missingEntries: z.array(z.string()).optional(),
      error: z.string().optional(),
    }),
  },
});
