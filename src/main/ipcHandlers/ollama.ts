import { BrowserWindow, ipcMain, shell } from 'electron';
import os from 'os';

import type {
  OllamaChatPayload,
  OllamaInstallProgress,
  OllamaModelLaunchInput,
  OllamaServiceConfig,
  OllamaStatusSnapshot,
} from '../../shared/ollama';
import { OllamaIpcChannel } from '../../shared/ollama';
import {
  updateOllamaRuntimeModelCapabilities,
  updateOllamaRuntimeModels,
} from '../libs/claudeSettings';
import { OllamaManager } from '../libs/ollamaManager';
import type { SqliteStore } from '../sqliteStore';

const OLLAMA_SERVICE_CONFIG_KEY = 'ollama_service_config';
const DEFAULT_OLLAMA_SERVICE_CONFIG: OllamaServiceConfig = {};

export function registerOllamaIpcHandlers(
  manager: OllamaManager,
  options: {
    getStore: () => SqliteStore;
  },
): void {
  const broadcast = (channel: string, payload: unknown): void => {
    BrowserWindow.getAllWindows().forEach(win => {
      if (win.isDestroyed()) return;
      win.webContents.send(channel, payload);
    });
  };
  const sendStatus = (status: OllamaStatusSnapshot) =>
    broadcast(OllamaIpcChannel.StatusChanged, status);
  const sendProgress = (progress: OllamaInstallProgress) =>
    broadcast(OllamaIpcChannel.InstallProgress, progress);

  manager.on('status', sendStatus);
  manager.on('install-progress', sendProgress);
  const activePulls = new Map<string, AbortController>();
  const activeChats = new Map<string, AbortController>();

  ipcMain.handle(OllamaIpcChannel.Status, async () => manager.detect());
  ipcMain.handle(OllamaIpcChannel.Install, async () => {
    const status = await manager.install();
    if (status.status === 'not-installed' || status.status === 'error') {
      await shell.openExternal('https://ollama.com/download').catch(error => {
        console.warn('[Ollama] failed to open download page:', error);
      });
    }
    return status;
  });
  ipcMain.handle(OllamaIpcChannel.Start, async () => manager.start());
  ipcMain.handle(OllamaIpcChannel.Stop, async () => manager.stop());
  ipcMain.handle(OllamaIpcChannel.Restart, async () => manager.restart());
  ipcMain.handle(OllamaIpcChannel.GetServiceConfig, async () =>
    getOllamaServiceConfig(options.getStore()),
  );
  ipcMain.handle(OllamaIpcChannel.SetServiceConfig, async (_event, config: OllamaServiceConfig) => {
    const sanitized = sanitizeOllamaServiceConfig(config);
    options.getStore().set(OLLAMA_SERVICE_CONFIG_KEY, sanitized);
    return sanitized;
  });
  ipcMain.handle(OllamaIpcChannel.ModelsDir, async () => {
    return process.env.OLLAMA_MODELS || `${os.homedir()}/.ollama/models`;
  });

  ipcMain.handle(OllamaIpcChannel.ListLocalModels, async () => {
    const client = await manager.client();
    return await client.listModels();
  });
  ipcMain.handle(OllamaIpcChannel.ListRunningModels, async () => {
    const client = await manager.client();
    const runningModels = await client.runningModels();
    updateOllamaRuntimeModels(runningModels);
    return runningModels;
  });
  ipcMain.handle(OllamaIpcChannel.DeleteModel, async (_event, name: string) => {
    const client = await manager.client();
    await client.deleteModel(name);
    return { success: true };
  });
  ipcMain.handle(OllamaIpcChannel.ShowModel, async (_event, name: string) => {
    const client = await manager.client();
    const model = await client.showModel(name);
    updateOllamaRuntimeModelCapabilities(name, model);
    return model;
  });
  ipcMain.handle(OllamaIpcChannel.CreateModel, async (_event, name: string, modelfile: string) => {
    const client = await manager.client();
    await client.createModel(name, modelfile);
    return { success: true };
  });
  ipcMain.handle(OllamaIpcChannel.PreloadModel, async (_event, input: OllamaModelLaunchInput) => {
    const modelName = input.model.trim();
    if (!modelName) throw new Error('Model name is required');
    const client = await manager.client();
    const result = await client.preloadModel({ ...input, model: modelName });
    updateOllamaRuntimeModels(result.runningModels);
    return result;
  });
  ipcMain.handle(OllamaIpcChannel.UnloadModel, async (_event, name: string) => {
    const modelName = name.trim();
    if (!modelName) throw new Error('Model name is required');
    const client = await manager.client();
    await client.unloadModel(modelName);
    const runningModels = await client.runningModels();
    updateOllamaRuntimeModels(runningModels);
    return { success: true, runningModels };
  });
  ipcMain.handle(OllamaIpcChannel.PullModel, async (_event, name: string) => {
    const modelName = name.trim();
    if (!modelName) throw new Error('Model name is required');
    if (activePulls.has(modelName)) {
      throw new Error(`Pull already in progress: ${modelName}`);
    }
    const controller = new AbortController();
    activePulls.set(modelName, controller);
    try {
      const client = await manager.client();
      await client.pullModel(
        modelName,
        chunk => {
          broadcast(OllamaIpcChannel.PullProgress, { name: modelName, chunk });
        },
        { signal: controller.signal },
      );
      broadcast(OllamaIpcChannel.PullProgress, { name: modelName, chunk: { status: 'success' } });
      return { success: true };
    } catch (error) {
      if (controller.signal.aborted || isAbortError(error)) {
        broadcast(OllamaIpcChannel.PullProgress, {
          name: modelName,
          chunk: { status: 'cancelled' },
        });
        throw new Error('Pull cancelled', { cause: error });
      }
      throw error;
    } finally {
      activePulls.delete(modelName);
    }
  });
  ipcMain.handle(OllamaIpcChannel.CancelPull, async (_event, name: string) => {
    const modelName = name.trim();
    const controller = activePulls.get(modelName);
    if (!controller) return { success: true, cancelled: false };
    broadcast(OllamaIpcChannel.PullProgress, { name: modelName, chunk: { status: 'cancelling' } });
    controller.abort(new Error('Pull cancelled'));
    return { success: true, cancelled: true };
  });
  ipcMain.handle(OllamaIpcChannel.Chat, async (_event, payload: OllamaChatPayload) => {
    const client = await manager.client();
    return await client.chat({ ...payload, stream: false });
  });
  ipcMain.handle(
    OllamaIpcChannel.ChatStream,
    async (_event, requestId: string, payload: OllamaChatPayload) => {
      if (typeof requestId !== 'string' || !requestId.trim())
        throw new Error('Request ID is required');
      if (activeChats.has(requestId))
        throw new Error(`Chat stream already in progress: ${requestId}`);
      const controller = new AbortController();
      activeChats.set(requestId, controller);
      const client = await manager.client();
      try {
        await client.chat(
          { ...payload, stream: true },
          chunk => {
            broadcast(OllamaIpcChannel.ChatStreamChunk, { requestId, chunk });
          },
          { signal: controller.signal },
        );
        return { success: true };
      } catch (error) {
        if (controller.signal.aborted || isAbortError(error)) {
          throw new Error('Generation cancelled', { cause: error });
        }
        throw error;
      } finally {
        activeChats.delete(requestId);
      }
    },
  );
  ipcMain.handle(OllamaIpcChannel.CancelChatStream, async (_event, requestId: string) => {
    const controller = activeChats.get(requestId);
    if (!controller) return { success: true, cancelled: false };
    controller.abort(new Error('Generation cancelled'));
    return { success: true, cancelled: true };
  });
}

export function getOllamaServiceConfig(store: SqliteStore): OllamaServiceConfig {
  return sanitizeOllamaServiceConfig(
    store.get<OllamaServiceConfig>(OLLAMA_SERVICE_CONFIG_KEY) ?? DEFAULT_OLLAMA_SERVICE_CONFIG,
  );
}

function sanitizeOllamaServiceConfig(config: OllamaServiceConfig | undefined): OllamaServiceConfig {
  const next: OllamaServiceConfig = {};
  const cudaVisibleDevices = normalizeCsvIntegerList(config?.cudaVisibleDevices);
  const maxLoadedModels = normalizeIntegerString(config?.maxLoadedModels);
  const numParallel = normalizeIntegerString(config?.numParallel);

  if (cudaVisibleDevices) next.cudaVisibleDevices = cudaVisibleDevices;
  if (maxLoadedModels) next.maxLoadedModels = maxLoadedModels;
  if (numParallel) next.numParallel = numParallel;
  if (typeof config?.schedSpread === 'boolean') next.schedSpread = config.schedSpread;
  return next;
}

function normalizeIntegerString(
  value: string | undefined,
  options: { allowMinusOne?: boolean } = {},
): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  if (options.allowMinusOne && trimmed === '-1') return trimmed;
  if (!/^\d+$/.test(trimmed)) return undefined;
  return trimmed;
}

function normalizeCsvIntegerList(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  const parts = trimmed
    .split(',')
    .map(part => part.trim())
    .filter(Boolean);
  if (parts.length === 0 || parts.some(part => !/^\d+$/.test(part))) return undefined;
  return parts.join(',');
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}
