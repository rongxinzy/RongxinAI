import { ipcRenderer } from 'electron';

import { HardwareIpc } from '../../shared/ipc/channels';
import { LlamaCppIpcChannel } from '../../shared/llamacpp/constants';
import { ollamaContractChannels } from '../../shared/ipc/ollamaContract.channels';
import { OllamaIpcChannel } from '../../shared/ollama/constants';
import { createIpcInvokers } from './createIpcInvokers';
import { onPush, onPushVoid } from './pushChannel';

// Local inference runtimes (Ollama and llama.cpp) plus hardware probes.
export const localInferenceApi = {
  // Ollama invokes come from the zod contract; pushes stay hand-wired.
  ollama: {
    ...createIpcInvokers(ollamaContractChannels),
    onStatusChanged: (callback: (snapshot: unknown) => void) =>
      onPush(OllamaIpcChannel.StatusChanged, callback),
    onInstallProgress: (callback: (progress: unknown) => void) =>
      onPush(OllamaIpcChannel.InstallProgress, callback),
    onPullProgress: (callback: (payload: unknown) => void) =>
      onPush(OllamaIpcChannel.PullProgress, callback),
    onChatStreamChunk: (callback: (payload: unknown) => void) =>
      onPush(OllamaIpcChannel.ChatStreamChunk, callback),
  },

  llamacpp: {
    status: () => ipcRenderer.invoke(LlamaCppIpcChannel.Status),
    install: () => ipcRenderer.invoke(LlamaCppIpcChannel.Install),
    cancelRuntimeInstall: () => ipcRenderer.invoke(LlamaCppIpcChannel.CancelRuntimeInstall),
    uninstallRuntime: () => ipcRenderer.invoke(LlamaCppIpcChannel.UninstallRuntime),
    listRuntimeDevices: (input?: unknown) =>
      ipcRenderer.invoke(LlamaCppIpcChannel.ListRuntimeDevices, input),
    listBackends: () => ipcRenderer.invoke(LlamaCppIpcChannel.ListBackends),
    getBackendDownloadSize: (input: unknown) =>
      ipcRenderer.invoke(LlamaCppIpcChannel.GetBackendDownloadSize, input),
    getBackendSelection: () => ipcRenderer.invoke(LlamaCppIpcChannel.GetBackendSelection),
    setBackendSelection: (input: unknown) =>
      ipcRenderer.invoke(LlamaCppIpcChannel.SetBackendSelection, input),
    installBackend: (input?: unknown) =>
      ipcRenderer.invoke(LlamaCppIpcChannel.InstallBackend, input),
    getRuntimeInstallSnapshot: () =>
      ipcRenderer.invoke(LlamaCppIpcChannel.GetRuntimeInstallSnapshot),
    uninstallBackend: (input?: unknown) =>
      ipcRenderer.invoke(LlamaCppIpcChannel.UninstallBackend, input),
    getRuntimeCapabilities: () => ipcRenderer.invoke(LlamaCppIpcChannel.GetRuntimeCapabilities),
    importRuntime: () => ipcRenderer.invoke(LlamaCppIpcChannel.ImportRuntime),
    start: () => ipcRenderer.invoke(LlamaCppIpcChannel.Start),
    stop: () => ipcRenderer.invoke(LlamaCppIpcChannel.Stop),
    restart: () => ipcRenderer.invoke(LlamaCppIpcChannel.Restart),
    getServiceConfig: () => ipcRenderer.invoke(LlamaCppIpcChannel.GetServiceConfig),
    setServiceConfig: (config: unknown) =>
      ipcRenderer.invoke(LlamaCppIpcChannel.SetServiceConfig, config),
    getGatewayLanToken: () => ipcRenderer.invoke(LlamaCppIpcChannel.GetGatewayLanToken),
    regenerateGatewayLanToken: () =>
      ipcRenderer.invoke(LlamaCppIpcChannel.RegenerateGatewayLanToken),
    modelsDir: () => ipcRenderer.invoke(LlamaCppIpcChannel.ModelsDir),
    setModelsDir: (modelsDir: string) =>
      ipcRenderer.invoke(LlamaCppIpcChannel.SetModelsDir, modelsDir),
    listLocalModels: () => ipcRenderer.invoke(LlamaCppIpcChannel.ListLocalModels),
    listRunningModels: () => ipcRenderer.invoke(LlamaCppIpcChannel.ListRunningModels),
    refreshRunningModelBindings: () =>
      ipcRenderer.invoke(LlamaCppIpcChannel.RefreshRunningModelBindings),
    importModelFiles: (paths: string[]) =>
      ipcRenderer.invoke(LlamaCppIpcChannel.ImportModelFiles, paths),
    deleteModel: (name: string) => ipcRenderer.invoke(LlamaCppIpcChannel.DeleteModel, name),
    showModel: (name: string) => ipcRenderer.invoke(LlamaCppIpcChannel.ShowModel, name),
    getModelPreferences: () => ipcRenderer.invoke(LlamaCppIpcChannel.GetModelPreferences),
    setModelPreference: (input: unknown) =>
      ipcRenderer.invoke(LlamaCppIpcChannel.SetModelPreference, input),
    loadModel: (input: unknown) => ipcRenderer.invoke(LlamaCppIpcChannel.LoadModel, input),
    cancelModelLoad: (modelName?: string) =>
      ipcRenderer.invoke(LlamaCppIpcChannel.CancelModelLoad, modelName),
    unloadModel: (name: string) => ipcRenderer.invoke(LlamaCppIpcChannel.UnloadModel, name),
    getLatestModelLaunchLogSession: (input?: unknown) =>
      ipcRenderer.invoke(LlamaCppIpcChannel.GetLatestModelLaunchLogSession, input),
    readModelLaunchLogFile: (input: unknown) =>
      ipcRenderer.invoke(LlamaCppIpcChannel.ReadModelLaunchLogFile, input),
    openModelLaunchLogWindow: (input?: unknown) =>
      ipcRenderer.invoke(LlamaCppIpcChannel.OpenModelLaunchLogWindow, input),
    installModel: (input: unknown) => ipcRenderer.invoke(LlamaCppIpcChannel.InstallModel, input),
    cancelInstall: (modelId: string) =>
      ipcRenderer.invoke(LlamaCppIpcChannel.CancelInstall, modelId),
    onStatusChanged: (callback: (snapshot: unknown) => void) =>
      onPush(LlamaCppIpcChannel.StatusChanged, callback),
    onModelBindingsChanged: (callback: () => void) =>
      onPushVoid(LlamaCppIpcChannel.ModelBindingsChanged, callback),
    onInstallProgress: (callback: (progress: unknown) => void) =>
      onPush(LlamaCppIpcChannel.InstallProgress, callback),
    onModelLaunchLog: (callback: (event: unknown) => void) =>
      onPush(LlamaCppIpcChannel.ModelLaunchLog, callback),
    onModelLaunchLogCleared: (callback: (event: unknown) => void) =>
      onPush(LlamaCppIpcChannel.ModelLaunchLogCleared, callback),
    onModelLaunchLogWindowTargetChanged: (callback: (target: unknown) => void) =>
      onPush(LlamaCppIpcChannel.ModelLaunchLogWindowTargetChanged, callback),
    onPullProgress: (
      callback: (payload: { name: string; chunk: Record<string, unknown> }) => void,
    ) => {
      const handler = (_event: Electron.IpcRendererEvent, progress: Record<string, unknown>) => {
        const name = String(progress?.modelId || progress?.modelName || '');
        callback({ name, chunk: { ...progress, status: progress?.phase } });
      };
      ipcRenderer.on(LlamaCppIpcChannel.InstallProgress, handler);
      return () => {
        ipcRenderer.removeListener(LlamaCppIpcChannel.InstallProgress, handler);
      };
    },
  },

  hardware: {
    nvidiaSmi: () => ipcRenderer.invoke(HardwareIpc.NvidiaSmi),
    systemMemory: () => ipcRenderer.invoke(HardwareIpc.SystemMemory),
  },
};
