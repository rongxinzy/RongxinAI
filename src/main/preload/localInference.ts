import { ipcRenderer } from 'electron';

import { HardwareIpc } from '../../shared/ipc/channels';
import { LlamaCppIpcChannel } from '../../shared/llamacpp/constants';
import { ollamaContractChannels } from '../../shared/ipc/ollamaContract.channels';
import { llamacppContractChannels } from '../../shared/ipc/llamacppContract.channels';
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
    ...createIpcInvokers(llamacppContractChannels),
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
