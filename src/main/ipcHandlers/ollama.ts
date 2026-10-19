import { BrowserWindow, shell } from 'electron';
import os from 'os';

import type {
  OllamaChatPayload,
  OllamaInstallProgress,
  OllamaModelLaunchInput,
  OllamaServiceConfig,
  OllamaStatusSnapshot,
} from '../../shared/ollama';
import { OllamaIpcChannel } from '../../shared/ollama';
import { ollamaContract } from '../../shared/ipc/ollamaContract';
import { handleIpcContract } from '../ipc/handleIpcContract';
import {
  readOllamaProviderSnapshot,
  type OllamaProviderSnapshot,
} from '../magpie/ollamaProviderBinding';
import { OllamaManager } from '../libs/ollamaManager';
import type { SqliteStore } from '../sqliteStore';

const OLLAMA_SERVICE_CONFIG_KEY = 'ollama_service_config';
const DEFAULT_OLLAMA_SERVICE_CONFIG: OllamaServiceConfig = {};

export function registerOllamaIpcHandlers(
  manager: OllamaManager,
  options: {
    getStore: () => SqliteStore;
    onModelBindingsChanged?: (snapshot: OllamaProviderSnapshot) => void | Promise<void>;
  },
): void {
  const broadcast = (channel: string, payload: unknown): void => {
    BrowserWindow.getAllWindows().forEach(win => {
      if (win.isDestroyed()) return;
      win.webContents.send(channel, payload);
    });
  };
  const publishBindings = async (snapshot: OllamaProviderSnapshot): Promise<void> => {
    try {
      await options.onModelBindingsChanged?.(snapshot);
    } catch {
      console.warn('[Ollama] unified model catalog synchronization failed');
    }
  };
  let bindingEpoch = 0;
  const clearBindings = async (): Promise<void> => {
    bindingEpoch++;
    await publishBindings({ baseUrl: null, models: [] });
  };
  const refreshBindings = async (): Promise<void> => {
    const epoch = ++bindingEpoch;
    let snapshot: OllamaProviderSnapshot;
    try {
      snapshot = await readOllamaProviderSnapshot(manager);
    } catch {
      snapshot = { baseUrl: null, models: [] };
    }
    if (epoch === bindingEpoch) await publishBindings(snapshot);
  };
  const sendStatus = (status: OllamaStatusSnapshot) => {
    broadcast(OllamaIpcChannel.StatusChanged, status);
    if (status.status === 'running') void refreshBindings();
    else void clearBindings();
  };
  const sendProgress = (progress: OllamaInstallProgress) =>
    broadcast(OllamaIpcChannel.InstallProgress, progress);

  manager.on('status', sendStatus);
  manager.on('install-progress', sendProgress);
  const activePulls = new Map<string, AbortController>();
  const activeChats = new Map<string, AbortController>();

  handleIpcContract(ollamaContract, {
    status: async () => manager.detect(),
    install: async () => {
      const status = await manager.install();
      if (status.status === 'not-installed' || status.status === 'error') {
        await shell.openExternal('https://ollama.com/download').catch(error => {
          console.warn('[Ollama] failed to open download page:', error);
        });
      }
      return status;
    },
    start: async () => {
      const status = await manager.start();
      await refreshBindings();
      return status;
    },
    stop: async () => {
      const status = await manager.stop();
      await clearBindings();
      return status;
    },
    restart: async () => {
      const status = await manager.restart();
      await refreshBindings();
      return status;
    },
    getServiceConfig: async () => getOllamaServiceConfig(options.getStore()),
    setServiceConfig: async (_event, config: OllamaServiceConfig) => {
      const sanitized = sanitizeOllamaServiceConfig(config);
      options.getStore().set(OLLAMA_SERVICE_CONFIG_KEY, sanitized);
      return sanitized;
    },
    modelsDir: async () => process.env.OLLAMA_MODELS || `${os.homedir()}/.ollama/models`,

    listLocalModels: async () => {
      const client = await manager.client();
      return await client.listModels();
    },
    listRunningModels: async () => {
      const client = await manager.client();
      const runningModels = await client.runningModels();
      await refreshBindings();
      return runningModels;
    },
    deleteModel: async (_event, name: string) => {
      const client = await manager.client();
      await client.deleteModel(name);
      await refreshBindings();
      return { success: true } as const;
    },
    showModel: async (_event, name: string) => {
      const client = await manager.client();
      return (await client.showModel(name)) as Record<string, unknown>;
    },
    createModel: async (_event, name: string, modelfile: string) => {
      const client = await manager.client();
      await client.createModel(name, modelfile);
      return { success: true } as const;
    },
    preloadModel: async (_event, input: OllamaModelLaunchInput) => {
      const modelName = input.model.trim();
      if (!modelName) throw new Error('Model name is required');
      const client = await manager.client();
      const result = await client.preloadModel({ ...input, model: modelName });
      await refreshBindings();
      return result;
    },
    unloadModel: async (_event, name: string) => {
      const modelName = name.trim();
      if (!modelName) throw new Error('Model name is required');
      const client = await manager.client();
      await client.unloadModel(modelName);
      const runningModels = await client.runningModels();
      await refreshBindings();
      return { success: true as const, runningModels };
    },
    pullModel: async (_event, name: string) => {
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
        return { success: true } as const;
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
    },
    cancelPull: async (_event, name: string) => {
      const modelName = name.trim();
      const controller = activePulls.get(modelName);
      if (!controller) return { success: true as const, cancelled: false };
      broadcast(OllamaIpcChannel.PullProgress, {
        name: modelName,
        chunk: { status: 'cancelling' },
      });
      controller.abort(new Error('Pull cancelled'));
      return { success: true as const, cancelled: true };
    },
    chat: async (_event, payload: OllamaChatPayload) => {
      const client = await manager.client();
      return (await client.chat({ ...payload, stream: false })) as Record<string, unknown>;
    },
    chatStream: async (_event, requestId: string, payload: OllamaChatPayload) => {
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
        return { success: true } as const;
      } catch (error) {
        if (controller.signal.aborted || isAbortError(error)) {
          throw new Error('Generation cancelled', { cause: error });
        }
        throw error;
      } finally {
        activeChats.delete(requestId);
      }
    },
    cancelChatStream: async (_event, requestId: string) => {
      const controller = activeChats.get(requestId);
      if (!controller) return { success: true as const, cancelled: false };
      controller.abort(new Error('Generation cancelled'));
      return { success: true as const, cancelled: true };
    },
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
