/**
 * Local inference preload surface, split from `../electron.d.ts`.
 *
 * Covers the Ollama and llama.cpp runtimes, the model marketplace search,
 * triage config and hardware snapshots.
 */
import type { NvidiaSmiSnapshot, SystemMemorySnapshot } from '../../../shared/hardware';
import type {
  LlamaCppCancelModelLoadResult,
  LlamaCppCancelInstallResult,
  LlamaCppGatewayLanTokenResult,
  LlamaCppImportModelFilesResult,
  LlamaCppInstallModelInput,
  LlamaCppInstallProgress,
  LlamaCppLatestModelLaunchLogSessionInput,
  LlamaCppModel,
  LlamaCppModelLaunchInput,
  LlamaCppModelLaunchLogClearedEvent,
  LlamaCppModelLaunchLogEvent,
  LlamaCppModelLaunchLogSession,
  LlamaCppModelLaunchLogWindowTarget,
  LlamaCppModelLaunchResult,
  LlamaCppModelPreferences,
  LlamaCppModelUnloadResult,
  LlamaCppOpenModelLaunchLogWindowInput,
  LlamaCppOpenModelLaunchLogWindowResult,
  LlamaCppReadModelLaunchLogFileInput,
  LlamaCppReadModelLaunchLogFileResult,
  LlamaCppRunningModel,
  LlamaCppRuntimeCapabilities,
  LlamaCppRuntimeImportResult,
  LlamaCppRuntimeInstallResult,
  LlamaCppRuntimeListDevicesResult,
  LlamaCppRuntimeUninstallResult,
  LlamaCppServiceConfig,
  LlamaCppSetModelPreferenceInput,
  LlamaCppStatusSnapshot,
} from '../../../shared/llamacpp';
import type {
  MarketplaceSearchRequest,
  MarketplaceSearchResult,
} from '../../../shared/marketplace';
import type {
  OllamaCancelPullResult,
  OllamaChatChunk,
  OllamaChatPayload,
  OllamaInstallProgress,
  OllamaModel,
  OllamaModelLaunchInput,
  OllamaModelLaunchResult,
  OllamaRunningModel,
  OllamaServiceConfig,
  OllamaStatusSnapshot,
} from '../../../shared/ollama';
import type { TriageConfig } from '../../../shared/triage';

export interface OllamaApi {
  status: () => Promise<OllamaStatusSnapshot>;
  install: () => Promise<OllamaStatusSnapshot>;
  start: () => Promise<OllamaStatusSnapshot>;
  stop: () => Promise<OllamaStatusSnapshot>;
  restart: () => Promise<OllamaStatusSnapshot>;
  getServiceConfig: () => Promise<OllamaServiceConfig>;
  setServiceConfig: (config: OllamaServiceConfig) => Promise<OllamaServiceConfig>;
  modelsDir: () => Promise<string>;
  listLocalModels: () => Promise<OllamaModel[]>;
  listRunningModels: () => Promise<OllamaRunningModel[]>;
  deleteModel: (name: string) => Promise<{ success: boolean }>;
  showModel: (name: string) => Promise<unknown>;
  createModel: (name: string, modelfile: string) => Promise<{ success: boolean }>;
  preloadModel: (input: OllamaModelLaunchInput) => Promise<OllamaModelLaunchResult>;
  unloadModel: (name: string) => Promise<OllamaModelLaunchResult>;
  pullModel: (name: string) => Promise<{ success: boolean }>;
  cancelPull: (name: string) => Promise<OllamaCancelPullResult>;
  chat: (payload: OllamaChatPayload) => Promise<OllamaChatChunk>;
  chatStream: (requestId: string, payload: OllamaChatPayload) => Promise<{ success: boolean }>;
  cancelChatStream: (requestId: string) => Promise<{ success: boolean; cancelled: boolean }>;
  onStatusChanged: (callback: (snapshot: OllamaStatusSnapshot) => void) => () => void;
  onInstallProgress: (callback: (progress: OllamaInstallProgress) => void) => () => void;
  onPullProgress: (
    callback: (payload: { name: string; chunk: Record<string, unknown> }) => void,
  ) => () => void;
  onChatStreamChunk: (
    callback: (payload: { requestId: string; chunk: OllamaChatChunk }) => void,
  ) => () => void;
}

export interface LlamaCppApi {
  status: () => Promise<LlamaCppStatusSnapshot>;
  install: () => Promise<LlamaCppRuntimeInstallResult>;
  cancelRuntimeInstall: () => Promise<LlamaCppCancelInstallResult>;
  importRuntime: () => Promise<LlamaCppRuntimeImportResult>;
  fetchWindowsRuntimeManifest: (url: string) => Promise<unknown | null>;
  listRuntimeDevices: (
    input?: import('../../../shared/llamacpp').LlamaCppBackendRef,
  ) => Promise<LlamaCppRuntimeListDevicesResult>;
  getRuntimeCapabilities: () => Promise<LlamaCppRuntimeCapabilities>;
  listBackends: () => Promise<import('../../../shared/llamacpp').LlamaCppBackendListResult>;
  getBackendDownloadSize: (
    input: import('../../../shared/llamacpp').LlamaCppBackendRef,
  ) => Promise<import('../../../shared/llamacpp').LlamaCppBackendDownloadSizeResult>;
  getBackendSelection: () => Promise<
    import('../../../shared/llamacpp').LlamaCppBackendRef | undefined
  >;
  setBackendSelection: (
    input: import('../../../shared/llamacpp').LlamaCppBackendRef,
  ) => Promise<LlamaCppRuntimeInstallResult>;
  installBackend: (
    input?: import('../../../shared/llamacpp').LlamaCppBackendRef,
  ) => Promise<LlamaCppRuntimeInstallResult>;
  getRuntimeInstallSnapshot: () => Promise<
    import('../../../shared/llamacpp').LlamaCppRuntimeInstallSnapshot
  >;
  uninstallBackend: (
    input?: import('../../../shared/llamacpp').LlamaCppBackendRef,
  ) => Promise<LlamaCppRuntimeUninstallResult>;
  uninstallRuntime: () => Promise<LlamaCppRuntimeUninstallResult>;
  start: () => Promise<LlamaCppStatusSnapshot>;
  stop: () => Promise<LlamaCppStatusSnapshot>;
  restart: () => Promise<LlamaCppStatusSnapshot>;
  getServiceConfig: () => Promise<LlamaCppServiceConfig>;
  setServiceConfig: (config: LlamaCppServiceConfig) => Promise<LlamaCppServiceConfig>;
  getGatewayLanToken: () => Promise<LlamaCppGatewayLanTokenResult>;
  regenerateGatewayLanToken: () => Promise<LlamaCppGatewayLanTokenResult>;
  modelsDir: () => Promise<string>;
  setModelsDir: (modelsDir: string) => Promise<string>;
  listLocalModels: () => Promise<LlamaCppModel[]>;
  listRunningModels: () => Promise<LlamaCppRunningModel[]>;
  refreshRunningModelBindings: () => Promise<void>;
  importModelFiles: (paths: string[]) => Promise<LlamaCppImportModelFilesResult>;
  deleteModel: (name: string) => Promise<{
    success: boolean;
    deleted?: boolean;
    reason?: 'not-local-file' | 'not-app-managed';
    error?: string;
    removedModelName?: string;
    clearedDefaultModel?: boolean;
  }>;
  showModel: (name: string) => Promise<unknown>;
  getModelPreferences: () => Promise<LlamaCppModelPreferences>;
  setModelPreference: (input: LlamaCppSetModelPreferenceInput) => Promise<LlamaCppModelPreferences>;
  loadModel: (input: LlamaCppModelLaunchInput) => Promise<LlamaCppModelLaunchResult>;
  cancelModelLoad: (modelName?: string) => Promise<LlamaCppCancelModelLoadResult>;
  unloadModel: (name: string) => Promise<LlamaCppModelUnloadResult>;
  getLatestModelLaunchLogSession: (
    input?: LlamaCppLatestModelLaunchLogSessionInput,
  ) => Promise<LlamaCppModelLaunchLogSession | null>;
  readModelLaunchLogFile: (
    input: LlamaCppReadModelLaunchLogFileInput,
  ) => Promise<LlamaCppReadModelLaunchLogFileResult>;
  openModelLaunchLogWindow: (
    input?: LlamaCppOpenModelLaunchLogWindowInput,
  ) => Promise<LlamaCppOpenModelLaunchLogWindowResult>;
  installModel: (
    input: LlamaCppInstallModelInput,
  ) => Promise<{ success: boolean; cancelled?: boolean }>;
  cancelInstall: (modelId: string) => Promise<LlamaCppCancelInstallResult>;
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

export interface MarketplaceApi {
  search: (request: MarketplaceSearchRequest) => Promise<MarketplaceSearchResult>;
  cancelSearch: (requestId: string) => Promise<{ cancelled: boolean }>;
}

export interface TriageApi {
  getConfig: () => Promise<TriageConfig>;
  setConfig: (config: TriageConfig) => Promise<TriageConfig>;
}

export interface HardwareApi {
  nvidiaSmi: () => Promise<NvidiaSmiSnapshot>;
  systemMemory: () => Promise<SystemMemorySnapshot>;
}
