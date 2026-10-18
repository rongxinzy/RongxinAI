import type {
  LlamaCppModelDaemonStatus,
} from './llamacppModelDaemonProtocol';
import type {
  LlamaCppModelLaunchInput,
  LlamaCppRunningModel,
  LlamaCppServiceConfig,
  LlamaCppStatusSnapshot,
} from '../../shared/llamacpp';

/**
 * Process orchestration surface shared by the per-model daemon
 * (LlamaCppModelDaemonController) and the llama-server router orchestrator
 * (LlamaCppRouterOrchestrator). The IPC layer, bootstrap and Magpie bindings
 * depend on this interface only; the implementation is chosen from the
 * `orchestrator` service config field at registration time.
 */
export interface LlamaCppModelOrchestrator {
  reconnect(): Promise<LlamaCppModelDaemonStatus | null>;
  status(): Promise<LlamaCppStatusSnapshot>;
  listRunningModels(): Promise<LlamaCppRunningModel[]>;
  ensureModel(input: LlamaCppModelLaunchInput): Promise<LlamaCppModelDaemonStatus>;
  stopModel(modelName: string): Promise<LlamaCppModelDaemonStatus>;
  stopAll(): Promise<LlamaCppModelDaemonStatus>;
  applyConfig(config: LlamaCppServiceConfig): Promise<LlamaCppModelDaemonStatus>;
  applyConfigIfRunning(config: LlamaCppServiceConfig): Promise<LlamaCppModelDaemonStatus>;
  restart(config: LlamaCppServiceConfig): Promise<LlamaCppStatusSnapshot>;
  stopService(): Promise<void>;
  getCachedRunningModels(): LlamaCppRunningModel[];
  shutdownForQuit(): Promise<void>;
  gatewayBaseUrl(): string | null;
  getLanToken(): string;
  regenerateLanToken(): Promise<string>;
}
