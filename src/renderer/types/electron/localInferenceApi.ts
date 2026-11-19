/**
 * Local inference preload surface, split from `../electron.d.ts`.
 *
 * Covers the Ollama and llama.cpp runtimes, the model marketplace search,
 * hardware snapshots.
 */
import type { NvidiaSmiSnapshot, SystemMemorySnapshot } from '../../../shared/hardware';
import type {
  LlamaCppModelLaunchLogClearedEvent,
  LlamaCppModelLaunchLogEvent,
  LlamaCppModelLaunchLogWindowTarget,
} from '../../../shared/llamacpp';
import type { LlamaCppStatusSnapshot, LlamaCppInstallProgress } from '../../../shared/llamacpp';
import type { IpcContractApi } from '../../../shared/ipc/contract';
import type { marketplaceContract } from '../../../shared/marketplace/contract';
import type { ollamaContract } from '../../../shared/ipc/ollamaContract';
import type { llamacppContract } from '../../../shared/ipc/llamacppContract';
import type {
  OllamaChatChunk,
  OllamaInstallProgress,
  OllamaStatusSnapshot,
} from '../../../shared/ollama';

/**
 * Ollama surface: invoke methods derive from the zod contract (work package
 * M.4); push subscriptions stay hand-typed.
 */
export interface OllamaApi extends Omit<
  IpcContractApi<typeof ollamaContract>,
  'onStatusChanged' | 'onInstallProgress' | 'onPullProgress' | 'onChatStreamChunk'
> {
  onStatusChanged: (callback: (snapshot: OllamaStatusSnapshot) => void) => () => void;
  onInstallProgress: (callback: (progress: OllamaInstallProgress) => void) => () => void;
  onPullProgress: (
    callback: (payload: { name: string; chunk: Record<string, unknown> }) => void,
  ) => () => void;
  onChatStreamChunk: (
    callback: (payload: { requestId: string; chunk: OllamaChatChunk }) => void,
  ) => () => void;
}

/**
 * llama.cpp surface: invoke methods derive from the zod contract (work
 * package M.4); push subscriptions stay hand-typed.
 */
export interface LlamaCppApi extends Omit<
  IpcContractApi<typeof llamacppContract>,
  | 'onStatusChanged'
  | 'onModelBindingsChanged'
  | 'onInstallProgress'
  | 'onModelLaunchLog'
  | 'onModelLaunchLogCleared'
  | 'onModelLaunchLogWindowTargetChanged'
  | 'onPullProgress'
> {
  onStatusChanged: (callback: (snapshot: LlamaCppStatusSnapshot) => void) => () => void;
  onModelBindingsChanged: (callback: () => void) => () => void;
  onInstallProgress: (callback: (progress: LlamaCppInstallProgress) => void) => () => void;
  onModelLaunchLog: (callback: (event: LlamaCppModelLaunchLogEvent) => void) => () => void;
  onModelLaunchLogCleared: (
    callback: (event: LlamaCppModelLaunchLogClearedEvent) => void,
  ) => () => void;
  onModelLaunchLogWindowTargetChanged: (
    callback: (target: LlamaCppModelLaunchLogWindowTarget) => void,
  ) => () => void;
  onPullProgress: (
    callback: (payload: { name: string; chunk: Record<string, unknown> }) => void,
  ) => () => void;
}

export interface MarketplaceApi extends IpcContractApi<typeof marketplaceContract> {}

export interface HardwareApi {
  nvidiaSmi: () => Promise<NvidiaSmiSnapshot>;
  systemMemory: () => Promise<SystemMemorySnapshot>;
}
