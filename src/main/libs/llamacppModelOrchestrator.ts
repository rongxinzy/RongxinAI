import type { LlamaCppModelDaemonStatus } from './llamacppModelDaemonProtocol';
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
  reconnect(options?: { requireResponsive?: boolean }): Promise<LlamaCppModelDaemonStatus | null>;
  start(): Promise<LlamaCppStatusSnapshot>;
  listRunningModels(): Promise<LlamaCppRunningModel[]>;
  ensureModel(input: LlamaCppModelLaunchInput): Promise<LlamaCppModelDaemonStatus>;
  stopModel(modelName: string): Promise<LlamaCppModelDaemonStatus>;
  deleteModelFile(modelName: string, modelPath: string): Promise<void>;
  stopAll(): Promise<LlamaCppModelDaemonStatus>;
  applyConfig(config: LlamaCppServiceConfig): Promise<LlamaCppModelDaemonStatus>;
  applyConfigIfRunning(config: LlamaCppServiceConfig): Promise<LlamaCppModelDaemonStatus>;
  restart(config: LlamaCppServiceConfig): Promise<LlamaCppStatusSnapshot>;
  stopService(options?: { requireIdle?: boolean }): Promise<void>;
  getCachedRunningModels(): LlamaCppRunningModel[];
  /** Capture shutdown settings synchronously. Process teardown may outlive SQLite. */
  shutdownForQuit(): Promise<void>;
  gatewayBaseUrl(): string | null;
  getLanToken(): string;
  regenerateLanToken(): Promise<string>;
}
