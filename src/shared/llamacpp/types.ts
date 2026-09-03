import type {
  LlamaCppModelLaunchLogLevel,
  LlamaCppModelLaunchLogPhase,
  LlamaCppModelLaunchLogSessionStatus,
  LlamaCppModelLaunchLogSource,
  LlamaCppMemoryPolicy,
  LlamaCppRuntimeBackend,
  LlamaCppRuntimeCudaMajor,
  LlamaCppServiceConfigFieldKey,
} from './constants';
import type { ModelCapabilities } from '../providers';

export type LlamaCppServerStatus =
  | 'unknown'
  | 'not-installed'
  | 'installing'
  | 'installed'
  | 'starting'
  | 'running'
  | 'stopped'
  | 'error';

export type LlamaCppStatusSnapshot = {
  status: LlamaCppServerStatus;
  version?: string;
  executablePath?: string;
  pid?: number;
  managedByApp?: boolean;
  runtimeVersion?: string;
  runtimeBackendId?: string;
  versionBackend?: string;
  recommendedVersionBackend?: string;
  runtimeSource?: string;
  runtimeTargetId?: string;
  runtimeBackend?: LlamaCppRuntimeBackend;
  runtimeCudaMajor?: LlamaCppRuntimeCudaMajor;
  runtimeRoot?: string;
  deviceProbeAvailable?: boolean;
  error?: string;
  checkedAt: string;
};

export type LlamaCppBackendAccelerator =
  | 'cpu'
  | 'cuda'
  | 'metal'
  | 'vulkan'
  | 'hip'
  | 'openvino'
  | 'sycl'
  | 'unknown';

export type LlamaCppBackendRef = {
  version: string;
  backend: string;
  versionBackend: string;
};

export type LlamaCppBackendArchivePart = {
  assetName: string;
  url?: string;
  sha256?: string;
  size?: number;
};

export type LlamaCppBackendManifestEntry = {
  version: string;
  backend: string;
  platform: NodeJS.Platform | 'windows' | 'macos';
  arch: string;
  accelerator: LlamaCppBackendAccelerator;
  cudaMajor?: LlamaCppRuntimeCudaMajor;
  archive?: {
    assetName: string;
    url?: string;
    sha256?: string;
    size?: number;
    parts?: LlamaCppBackendArchivePart[];
  };
  companions?: Array<{
    assetName: string;
    url?: string;
    sha256?: string;
    size?: number;
    parts?: LlamaCppBackendArchivePart[];
  }>;
};

export type LlamaCppBackendManifest = {
  schemaVersion: 1;
  defaultVersion?: string;
  releaseBaseUrl?: string;
  backends: LlamaCppBackendManifestEntry[];
};

export type LlamaCppBackendInfo = LlamaCppBackendRef & {
  platform: string;
  arch: string;
  accelerator: LlamaCppBackendAccelerator;
  cudaMajor?: LlamaCppRuntimeCudaMajor;
  installed: boolean;
  recommended: boolean;
  current: boolean;
  source: 'manifest' | 'local';
  downloadSizeBytes?: number;
};

export type LlamaCppBackendListResult = {
  success: boolean;
  backends: LlamaCppBackendInfo[];
  selection?: LlamaCppBackendRef;
  recommended?: LlamaCppBackendRef;
  error?: string;
};

export type LlamaCppBackendDownloadSizeResult = {
  success: boolean;
  sizeBytes?: number;
  error?: string;
};

export type LlamaCppRuntimeInstallPlan =
  | {
      kind: 'ready';
      executablePath: string;
    }
  | {
      kind: 'download';
      targetId: string;
      runtimeRoot: string;
      executablePath: string;
      url: string;
      fallbackUrls?: string[];
      companionDownloads?: Array<{
        assetName: string;
        url: string;
        fallbackUrls?: string[];
      }>;
    }
  | {
      kind: 'needs-manual';
      message: string;
    };

export type LlamaCppRuntimeInstallResult = {
  success: boolean;
  cancelled?: boolean;
  plan: LlamaCppRuntimeInstallPlan;
  executablePath?: string;
  backend?: LlamaCppBackendRef;
  error?: string;
};

export type LlamaCppRuntimeUninstallResult = {
  success: boolean;
  deleted: boolean;
  runtimeRoot: string;
  status: LlamaCppStatusSnapshot;
  backend?: LlamaCppBackendRef;
  error?: string;
};

export type LlamaCppRuntimeImportResult = {
  success: boolean;
  executablePath?: string;
  backend?: LlamaCppBackendRef;
  error?: string;
};

export type LlamaCppRuntimeDevice = {
  id: string;
  name: string;
  backend: string;
};

export type LlamaCppRuntimeListDevicesResult = {
  success: boolean;
  executablePath?: string;
  runtimeTargetId?: string;
  backend?: LlamaCppBackendRef;
  rawOutput?: string;
  devices: LlamaCppRuntimeDevice[];
  error?: string;
};

export type LlamaCppRuntimeCapabilities = {
  success: boolean;
  executablePath?: string;
  version?: string;
  runtimeTargetId?: string;
  flags: string[];
  deviceProbeSucceeded: boolean;
  devices: LlamaCppRuntimeDevice[];
  backendKinds: string[];
  gpuDeviceCount: number;
  supports: Partial<Record<LlamaCppServiceConfigFieldKey, boolean>>;
  error?: string;
};

export type LlamaCppInstallProgressPhase =
  | 'starting'
  | 'detecting'
  | 'downloading'
  | 'downloading-progress'
  | 'cancelling'
  | 'installing'
  | 'done'
  | 'failed'
  | 'cancelled'
  | 'needs-manual';

export type LlamaCppInstallProgress = {
  phase: LlamaCppInstallProgressPhase;
  modelId?: string;
  modelName?: string;
  message?: string;
  percent?: number;
  completed?: number;
  total?: number;
  speed?: number;
  targetPath?: string;
  error?: string;
};

export type LlamaCppRuntimeInstallSnapshot = {
  active: boolean;
  progress?: LlamaCppInstallProgress;
};

export type LlamaCppModelLaunchLogEvent = {
  sessionId: string;
  modelName: string;
  sequence: number;
  createdAt: string;
  level: LlamaCppModelLaunchLogLevel;
  phase: LlamaCppModelLaunchLogPhase;
  source: LlamaCppModelLaunchLogSource;
  message?: string;
  detail?: string;
};

export type LlamaCppModelLaunchLogClearedEvent = {
  modelName: string;
};

export type LlamaCppModelLaunchLogSession = {
  sessionId: string;
  modelName: string;
  fileName: string;
  filePath: string;
  startedAt: string;
  updatedAt: string;
  status: LlamaCppModelLaunchLogSessionStatus;
  sequence: number;
};

export type LlamaCppLatestModelLaunchLogSessionInput = {
  modelName?: string;
};

export type LlamaCppReadModelLaunchLogFileInput = {
  sessionId: string;
};

export type LlamaCppReadModelLaunchLogFileResult = {
  success: boolean;
  session?: LlamaCppModelLaunchLogSession;
  content?: string;
  error?: string;
};

export type LlamaCppModelLaunchLogWindowTarget = {
  sessionId?: string;
  modelName?: string;
};

export type LlamaCppOpenModelLaunchLogWindowInput = LlamaCppModelLaunchLogWindowTarget;

export type LlamaCppOpenModelLaunchLogWindowResult = {
  success: boolean;
  session?: LlamaCppModelLaunchLogSession;
  error?: string;
};

export type LlamaCppServiceConfig = {
  host?: string;
  listenHost?: string;
  port?: string;
  modelsDir?: string;
  runtimeVersion?: string;
  runtimeBackend?: LlamaCppRuntimeBackend;
  runtimeCudaMajor?: LlamaCppRuntimeCudaMajor;
  memoryPolicy?: LlamaCppMemoryPolicy;
  memoryBudgetPercent?: number;
  modelsMax?: string;
  modelsAutoload?: boolean;
  keepRunningOnAppQuit?: boolean;
  timeout?: string;
  threadsHttp?: string;
  cachePrompt?: boolean;
  cacheReuse?: string;
  cacheRam?: string;
  ctxCheckpoints?: string;
  checkpointEveryNt?: string;
  ctxSize?: string;
  parallel?: string;
  kvUnified?: boolean;
  batchSize?: string;
  ubatchSize?: string;
  gpuLayers?: string;
  threads?: string;
  threadsBatch?: string;
  device?: string;
  mainGpu?: string;
  splitMode?: 'none' | 'layer' | 'row' | 'tensor';
  tensorSplit?: string;
  flashAttn?: 'on' | 'off' | 'auto';
  jinja?: 'on' | 'off' | 'auto';
  reasoning?: 'on' | 'off' | 'auto';
  reasoningFormat?: 'none' | 'deepseek' | 'deepseek-legacy' | 'auto';
  reasoningBudget?: string;
  reasoningBudgetMessage?: string;
  chatTemplate?: string;
  chatTemplateFile?: string;
  skipChatParsing?: boolean;
  prefillAssistant?: boolean;
  noMmap?: boolean;
  mlock?: boolean;
};

export type LlamaCppDeleteModelResult = {
  success: boolean;
  deleted?: boolean;
  reason?: 'not-local-file' | 'not-app-managed';
  error?: string;
  removedModelName?: string;
  clearedDefaultModel?: boolean;
};

export type LlamaCppCancelInstallResult = {
  success: true;
  cancelled: boolean;
};

export type LlamaCppModelPreference = {
  ctxSize?: number;
  maxTokens?: number;
  capabilities?: Partial<ModelCapabilities>;
};

export type LlamaCppModelPreferences = Record<string, LlamaCppModelPreference>;

export type LlamaCppModel = {
  name: string;
  id?: string;
  model?: string;
  path?: string;
  modified_at?: string;
  size?: number;
  source?: 'local' | 'modelscope' | 'cache';
  status?: 'loaded' | 'loading' | 'unloaded' | 'sleeping' | 'error';
  args?: string[];
  details?: {
    format?: string;
    family?: string;
    parameter_size?: string;
    quantization_level?: string;
    context_length?: number;
  };
  trained_context_length?: number;
  runtime_context_length?: number;
  effective_options?: {
    ctxSize?: number;
  };
  supportsThinkingToggle?: boolean;
};

export type LlamaCppRunningModel = LlamaCppModel & {
  context_length?: number;
  size_vram?: number;
};

export type LlamaCppModelLaunchInput = {
  model: string;
  modelPath?: string;
  options?: {
    ctxSize?: number;
    batchSize?: number;
    ubatchSize?: number;
    gpuLayers?: number | 'auto' | 'all';
    threads?: number;
    device?: string;
    mainGpu?: number;
    splitMode?: 'none' | 'layer' | 'row' | 'tensor';
    tensorSplit?: string;
    mmap?: boolean;
    flashAttn?: 'on' | 'off' | 'auto';
    parallel?: number;
    reasoning?: 'on' | 'off' | 'auto';
    reasoningFormat?: 'none' | 'deepseek' | 'deepseek-legacy' | 'auto';
    chatTemplate?: string;
  };
};

export type LlamaCppModelLaunchResult = {
  success: true;
  runningModels: LlamaCppRunningModel[];
  warning?: string;
};

export type LlamaCppCancelModelLoadResult = {
  success: true;
  cancelled: boolean;
  modelName?: string;
};

export type LlamaCppModelUnloadResult = {
  success: true;
  runningModels: LlamaCppRunningModel[];
  confirmed: boolean;
  warning?: string;
};

export type LlamaCppInstallExtraFile = {
  path: string;
  downloadUrl?: string;
  revision?: string;
  sha256?: string;
  sizeBytes?: number;
};

export type LlamaCppInstallModelInput = {
  modelId: string;
  filePath?: string;
  mmprojFilePath?: string;
  mmprojDownloadUrl?: string;
  revision?: string;
  displayName?: string;
  downloadUrl?: string;
  sha256?: string;
  mmprojSha256?: string;
  fileSizeBytes?: number;
  // Remaining parts of a split-GGUF variant. The primary file (filePath) is
  // the first part; llama.cpp loads the sharded model from the whole set.
  extraFiles?: LlamaCppInstallExtraFile[];
};

export type LlamaCppSetModelPreferenceInput = {
  modelName: string;
  preference: LlamaCppModelPreference;
};

export type LlamaCppImportModelFilesResult = {
  success: boolean;
  importedModels: LlamaCppModel[];
  skippedPaths: string[];
  error?: string;
};
