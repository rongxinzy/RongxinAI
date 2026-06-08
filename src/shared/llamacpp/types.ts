import type { LlamaCppRuntimeBackend, LlamaCppRuntimeCudaMajor } from './constants';

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
};

export type LlamaCppBackendListResult = {
  success: boolean;
  backends: LlamaCppBackendInfo[];
  selection?: LlamaCppBackendRef;
  recommended?: LlamaCppBackendRef;
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

export type LlamaCppServiceConfig = {
  host?: string;
  port?: string;
  modelsDir?: string;
  runtimeVersion?: string;
  runtimeBackend?: LlamaCppRuntimeBackend;
  runtimeCudaMajor?: LlamaCppRuntimeCudaMajor;
  modelsMax?: string;
  modelsAutoload?: boolean;
  timeout?: string;
  threadsHttp?: string;
  cachePrompt?: boolean;
  cacheReuse?: string;
  cacheRam?: string;
  ctxCheckpoints?: string;
  checkpointEveryNt?: string;
  ctxSize?: string;
  parallel?: string;
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
};

export type LlamaCppModelUnloadResult = {
  success: true;
  runningModels: LlamaCppRunningModel[];
  confirmed: boolean;
  warning?: string;
};

export type LlamaCppChatMessage = {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  thinking?: string;
  tool_calls?: LlamaCppToolCall[];
  tool_name?: string;
};

export type LlamaCppChatPayload = {
  model: string;
  messages: LlamaCppChatMessage[];
  stream?: boolean;
  options?: Record<string, unknown>;
};

export type LlamaCppToolCall = {
  function: {
    name: string;
    arguments: Record<string, unknown>;
  };
};

export type LlamaCppChatChunk = {
  model?: string;
  created_at?: string;
  message?: LlamaCppChatMessage;
  done?: boolean;
  done_reason?: string;
  error?: string;
  prompt_eval_count?: number;
  eval_count?: number;
  predicted_per_second?: number;
  timings?: Record<string, unknown>;
  usage?: Record<string, unknown>;
};

export type LlamaCppInstallModelInput = {
  modelId: string;
  filePath?: string;
  mmprojFilePath?: string;
  revision?: string;
  displayName?: string;
  downloadUrl?: string;
};
