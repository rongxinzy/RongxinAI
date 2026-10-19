/**
 * llama.cpp IPC contract (work package M.4, second domain): the 37 invoke
 * methods of the local-inference surface bound to one zod definition.
 *
 * Strategy for this slice: **arguments are validated strictly** (launch and
 * install inputs, config writes, log-session reads, backend references and
 * preference writes).
 * **Results are typed pass-through** (`z.custom<T>()`): the renderer API
 * derives exact types today, and runtime result validation tightens
 * incrementally per result type without wire changes.
 */
import { z } from 'zod';

import { LlamaCppIpcChannel } from '../llamacpp/constants';
import { defineIpcContract } from './contract';
import type {
  LlamaCppBackendDownloadSizeResult,
  LlamaCppBackendListResult,
  LlamaCppBackendRef,
  LlamaCppCancelInstallResult,
  LlamaCppCancelModelLoadResult,
  LlamaCppGatewayLanTokenResult,
  LlamaCppImportModelFilesResult,
  LlamaCppModelLaunchLogSession,
  LlamaCppModelLaunchResult,
  LlamaCppModelPreferences,
  LlamaCppModelUnloadResult,
  LlamaCppOpenModelLaunchLogWindowResult,
  LlamaCppReadModelLaunchLogFileResult,
  LlamaCppRuntimeCapabilities,
  LlamaCppRuntimeImportResult,
  LlamaCppRuntimeInstallResult,
  LlamaCppRuntimeInstallSnapshot,
  LlamaCppRuntimeListDevicesResult,
  LlamaCppRuntimeUninstallResult,
  LlamaCppServiceConfig,
  LlamaCppStatusSnapshot,
  LlamaCppModel,
  LlamaCppRunningModel,
  LlamaCppDeleteModelResult,
} from '../llamacpp';

/** Typed pass-through: keeps the renderer type, defers runtime checking. */
const typed = <T>() => z.custom<T>();

const emptyArgs = z.tuple([]);

const ModelLaunchInputSchema = z
  .object({
    model: z.string().min(1),
    modelPath: z.string().optional(),
    options: z
      .object({
        ctxSize: z.number().optional(),
        batchSize: z.number().optional(),
        ubatchSize: z.number().optional(),
        gpuLayers: z.union([z.number(), z.literal('auto'), z.literal('all')]).optional(),
        threads: z.number().optional(),
        device: z.string().optional(),
        mainGpu: z.number().optional(),
        splitMode: z.enum(['none', 'layer', 'row', 'tensor']).optional(),
        tensorSplit: z.string().optional(),
        mmap: z.boolean().optional(),
        flashAttn: z.enum(['on', 'off', 'auto']).optional(),
        parallel: z.number().optional(),
        reasoning: z.enum(['on', 'off', 'auto']).optional(),
        reasoningFormat: z.enum(['none', 'deepseek', 'deepseek-legacy', 'auto']).optional(),
        chatTemplate: z.string().optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

const InstallModelInputSchema = z
  .object({
    modelId: z.string().min(1),
    filePath: z.string().optional(),
    mmprojFilePath: z.string().optional(),
    mmprojDownloadUrl: z.string().optional(),
    revision: z.string().optional(),
    displayName: z.string().optional(),
    downloadUrl: z.string().optional(),
    sha256: z.string().optional(),
    mmprojSha256: z.string().optional(),
    fileSizeBytes: z.number().optional(),
    extraFiles: z
      .array(
        z
          .object({
            path: z.string(),
            downloadUrl: z.string().optional(),
            revision: z.string().optional(),
            sha256: z.string().optional(),
            sizeBytes: z.number().optional(),
          })
          .passthrough(),
      )
      .optional(),
  })
  .passthrough();

const ServiceConfigSchema = z
  .object({
    host: z.string().optional(),
    listenHost: z.string().optional(),
    port: z.string().optional(),
    gatewayAccessMode: z.string().optional(),
    orchestrator: z.string().optional(),
    modelsDir: z.string().optional(),
    runtimeVersion: z.string().optional(),
  })
  .passthrough();

const ReadModelLaunchLogFileInputSchema = z
  .object({
    sessionId: z.string(),
    offset: z.number().optional(),
  })
  .passthrough();

const LatestModelLaunchLogSessionInputSchema = z
  .object({ modelName: z.string().optional() })
  .passthrough();

const OpenModelLaunchLogWindowInputSchema = z
  .object({ sessionId: z.string().optional(), modelName: z.string().optional() })
  .passthrough();

/**
 * Backend reference: the full {version, backend, versionBackend} triple or a
 * versionBackend shorthand — the handler sanitizer accepts both shapes, so
 * the schema must not reject the shorthand.
 */
const BackendRefInputSchema = z.union([
  z
    .object({
      version: z.string().optional(),
      backend: z.string().optional(),
      versionBackend: z.string().optional(),
    })
    .passthrough(),
  z.string(),
]);

const ModelPreferenceSchema = z
  .object({
    ctxSize: z.number().optional(),
    maxTokens: z.number().optional(),
    capabilities: z.record(z.string(), z.unknown()).optional(),
    residency: z
      .object({ mode: z.string(), idleMinutes: z.number().optional() })
      .passthrough()
      .optional(),
  })
  .passthrough();

const SetModelPreferenceInputSchema = z
  .object({
    modelName: z.string().min(1),
    preference: ModelPreferenceSchema.optional(),
  })
  .passthrough();

export const llamacppContract = defineIpcContract({
  status: {
    channel: LlamaCppIpcChannel.Status,
    args: emptyArgs,
    result: typed<LlamaCppStatusSnapshot>(),
  },
  install: {
    channel: LlamaCppIpcChannel.Install,
    args: emptyArgs,
    result: typed<LlamaCppRuntimeInstallResult>(),
  },
  getRuntimeInstallSnapshot: {
    channel: LlamaCppIpcChannel.GetRuntimeInstallSnapshot,
    args: emptyArgs,
    result: typed<LlamaCppRuntimeInstallSnapshot>(),
  },
  cancelRuntimeInstall: {
    channel: LlamaCppIpcChannel.CancelRuntimeInstall,
    args: emptyArgs,
    result: typed<{ success: true; cancelled: boolean }>(),
  },
  uninstallRuntime: {
    channel: LlamaCppIpcChannel.UninstallRuntime,
    args: emptyArgs,
    result: typed<LlamaCppRuntimeUninstallResult>(),
  },
  listRuntimeDevices: {
    channel: LlamaCppIpcChannel.ListRuntimeDevices,
    args: z.tuple([BackendRefInputSchema]),
    result: typed<LlamaCppRuntimeListDevicesResult>(),
  },
  listBackends: {
    channel: LlamaCppIpcChannel.ListBackends,
    args: emptyArgs,
    result: typed<LlamaCppBackendListResult>(),
  },
  getBackendDownloadSize: {
    channel: LlamaCppIpcChannel.GetBackendDownloadSize,
    args: z.tuple([BackendRefInputSchema]),
    result: typed<LlamaCppBackendDownloadSizeResult>(),
  },
  getBackendSelection: {
    channel: LlamaCppIpcChannel.GetBackendSelection,
    args: emptyArgs,
    result: typed<LlamaCppBackendRef | undefined>(),
  },
  setBackendSelection: {
    channel: LlamaCppIpcChannel.SetBackendSelection,
    args: z.tuple([BackendRefInputSchema]),
    result: typed<LlamaCppRuntimeInstallResult>(),
  },
  installBackend: {
    channel: LlamaCppIpcChannel.InstallBackend,
    args: z.tuple([BackendRefInputSchema]),
    result: typed<LlamaCppRuntimeInstallResult>(),
  },
  uninstallBackend: {
    channel: LlamaCppIpcChannel.UninstallBackend,
    args: z.tuple([BackendRefInputSchema]),
    result: typed<LlamaCppRuntimeUninstallResult>(),
  },
  getRuntimeCapabilities: {
    channel: LlamaCppIpcChannel.GetRuntimeCapabilities,
    args: emptyArgs,
    result: typed<LlamaCppRuntimeCapabilities>(),
  },
  importRuntime: {
    channel: LlamaCppIpcChannel.ImportRuntime,
    args: emptyArgs,
    result: typed<LlamaCppRuntimeImportResult>(),
  },
  start: {
    channel: LlamaCppIpcChannel.Start,
    args: emptyArgs,
    result: typed<LlamaCppStatusSnapshot>(),
  },
  stop: {
    channel: LlamaCppIpcChannel.Stop,
    args: emptyArgs,
    result: typed<LlamaCppStatusSnapshot>(),
  },
  restart: {
    channel: LlamaCppIpcChannel.Restart,
    args: emptyArgs,
    result: typed<LlamaCppStatusSnapshot>(),
  },
  getServiceConfig: {
    channel: LlamaCppIpcChannel.GetServiceConfig,
    args: emptyArgs,
    result: typed<LlamaCppServiceConfig>(),
  },
  setServiceConfig: {
    channel: LlamaCppIpcChannel.SetServiceConfig,
    args: z.tuple([ServiceConfigSchema]),
    result: typed<LlamaCppServiceConfig>(),
  },
  getGatewayLanToken: {
    channel: LlamaCppIpcChannel.GetGatewayLanToken,
    args: emptyArgs,
    result: typed<LlamaCppGatewayLanTokenResult>(),
  },
  regenerateGatewayLanToken: {
    channel: LlamaCppIpcChannel.RegenerateGatewayLanToken,
    args: emptyArgs,
    result: typed<LlamaCppGatewayLanTokenResult>(),
  },
  modelsDir: { channel: LlamaCppIpcChannel.ModelsDir, args: emptyArgs, result: z.string() },
  setModelsDir: {
    channel: LlamaCppIpcChannel.SetModelsDir,
    args: z.tuple([z.string()]),
    result: z.string(),
  },
  listLocalModels: {
    channel: LlamaCppIpcChannel.ListLocalModels,
    args: emptyArgs,
    result: z.array(typed<LlamaCppModel>()),
  },
  listRunningModels: {
    channel: LlamaCppIpcChannel.ListRunningModels,
    args: emptyArgs,
    result: z.array(typed<LlamaCppRunningModel>()),
  },
  refreshRunningModelBindings: {
    channel: LlamaCppIpcChannel.RefreshRunningModelBindings,
    args: emptyArgs,
    result: z.void(),
  },
  importModelFiles: {
    channel: LlamaCppIpcChannel.ImportModelFiles,
    args: z.tuple([z.array(z.string())]),
    result: typed<LlamaCppImportModelFilesResult>(),
  },
  deleteModel: {
    channel: LlamaCppIpcChannel.DeleteModel,
    args: z.tuple([z.string()]),
    result: typed<LlamaCppDeleteModelResult>(),
  },
  showModel: {
    channel: LlamaCppIpcChannel.ShowModel,
    args: z.tuple([z.string()]),
    result: typed<LlamaCppModel>(),
  },
  getModelPreferences: {
    channel: LlamaCppIpcChannel.GetModelPreferences,
    args: emptyArgs,
    result: typed<LlamaCppModelPreferences>(),
  },
  setModelPreference: {
    channel: LlamaCppIpcChannel.SetModelPreference,
    args: z.tuple([SetModelPreferenceInputSchema]),
    result: typed<LlamaCppModelPreferences>(),
  },
  loadModel: {
    channel: LlamaCppIpcChannel.LoadModel,
    args: z.tuple([ModelLaunchInputSchema]),
    result: typed<LlamaCppModelLaunchResult>(),
  },
  cancelModelLoad: {
    channel: LlamaCppIpcChannel.CancelModelLoad,
    args: z.tuple([z.string().optional()]),
    result: typed<LlamaCppCancelModelLoadResult>(),
  },
  unloadModel: {
    channel: LlamaCppIpcChannel.UnloadModel,
    args: z.tuple([z.string()]),
    result: typed<LlamaCppModelUnloadResult>(),
  },
  getLatestModelLaunchLogSession: {
    channel: LlamaCppIpcChannel.GetLatestModelLaunchLogSession,
    args: z.tuple([LatestModelLaunchLogSessionInputSchema.optional()]),
    result: typed<LlamaCppModelLaunchLogSession | null>(),
  },
  readModelLaunchLogFile: {
    channel: LlamaCppIpcChannel.ReadModelLaunchLogFile,
    args: z.tuple([ReadModelLaunchLogFileInputSchema]),
    result: typed<LlamaCppReadModelLaunchLogFileResult>(),
  },
  openModelLaunchLogWindow: {
    channel: LlamaCppIpcChannel.OpenModelLaunchLogWindow,
    args: z.tuple([OpenModelLaunchLogWindowInputSchema.optional()]),
    result: typed<LlamaCppOpenModelLaunchLogWindowResult>(),
  },
  installModel: {
    channel: LlamaCppIpcChannel.InstallModel,
    args: z.tuple([InstallModelInputSchema]),
    result: typed<{ success: boolean; cancelled?: boolean }>(),
  },
  cancelInstall: {
    channel: LlamaCppIpcChannel.CancelInstall,
    args: z.tuple([z.string()]),
    result: typed<LlamaCppCancelInstallResult>(),
  },
});
