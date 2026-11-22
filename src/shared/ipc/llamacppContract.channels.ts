/**
 * Channel map for the llama.cpp IPC contract, importable by the sandboxed
 * preload (zod-free; see contract.ts layering notes).
 */
import type { IpcContractChannels } from './contract';
import type { llamacppContract } from './llamacppContract';
import { LlamaCppIpcChannel } from '../llamacpp/constants';

export const llamacppContractChannels: IpcContractChannels<typeof llamacppContract> = {
  status: LlamaCppIpcChannel.Status,
  install: LlamaCppIpcChannel.Install,
  getRuntimeInstallSnapshot: LlamaCppIpcChannel.GetRuntimeInstallSnapshot,
  cancelRuntimeInstall: LlamaCppIpcChannel.CancelRuntimeInstall,
  uninstallRuntime: LlamaCppIpcChannel.UninstallRuntime,
  listBackends: LlamaCppIpcChannel.ListBackends,
  installBackend: LlamaCppIpcChannel.InstallBackend,
  uninstallBackend: LlamaCppIpcChannel.UninstallBackend,
  importRuntime: LlamaCppIpcChannel.ImportRuntime,
  start: LlamaCppIpcChannel.Start,
  stop: LlamaCppIpcChannel.Stop,
  restart: LlamaCppIpcChannel.Restart,
  getServiceConfig: LlamaCppIpcChannel.GetServiceConfig,
  setServiceConfig: LlamaCppIpcChannel.SetServiceConfig,
  getGatewayLanToken: LlamaCppIpcChannel.GetGatewayLanToken,
  regenerateGatewayLanToken: LlamaCppIpcChannel.RegenerateGatewayLanToken,
  modelsDir: LlamaCppIpcChannel.ModelsDir,
  setModelsDir: LlamaCppIpcChannel.SetModelsDir,
  listLocalModels: LlamaCppIpcChannel.ListLocalModels,
  listRunningModels: LlamaCppIpcChannel.ListRunningModels,
  importModelFiles: LlamaCppIpcChannel.ImportModelFiles,
  deleteModel: LlamaCppIpcChannel.DeleteModel,
  getModelPreferences: LlamaCppIpcChannel.GetModelPreferences,
  setModelPreference: LlamaCppIpcChannel.SetModelPreference,
  loadModel: LlamaCppIpcChannel.LoadModel,
  cancelModelLoad: LlamaCppIpcChannel.CancelModelLoad,
  unloadModel: LlamaCppIpcChannel.UnloadModel,
  getLatestModelLaunchLogSession: LlamaCppIpcChannel.GetLatestModelLaunchLogSession,
  readModelLaunchLogFile: LlamaCppIpcChannel.ReadModelLaunchLogFile,
  openModelLaunchLogWindow: LlamaCppIpcChannel.OpenModelLaunchLogWindow,
  installModel: LlamaCppIpcChannel.InstallModel,
  cancelInstall: LlamaCppIpcChannel.CancelInstall,
};
