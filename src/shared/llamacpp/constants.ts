export const LlamaCppIpcChannel = {
  Status: 'llamacpp:status',
  Install: 'llamacpp:install',
  GetRuntimeInstallSnapshot: 'llamacpp:runtime:install:snapshot',
  CancelRuntimeInstall: 'llamacpp:runtime:install:cancel',
  UninstallRuntime: 'llamacpp:runtime:uninstall',
  Start: 'llamacpp:start',
  Stop: 'llamacpp:stop',
  Restart: 'llamacpp:restart',
  GetServiceConfig: 'llamacpp:service-config:get',
  SetServiceConfig: 'llamacpp:service-config:set',
  ModelsDir: 'llamacpp:models-dir',
  SetModelsDir: 'llamacpp:models-dir:set',
  ListLocalModels: 'llamacpp:list-local-models',
  ListRunningModels: 'llamacpp:list-running-models',
  RefreshRunningModelBindings: 'llamacpp:running-model-bindings:refresh',
  ImportModelFiles: 'llamacpp:import-model-files',
  DeleteModel: 'llamacpp:delete-model',
  ShowModel: 'llamacpp:show-model',
  GetModelPreferences: 'llamacpp:model-preferences:get',
  SetModelPreference: 'llamacpp:model-preference:set',
  LoadModel: 'llamacpp:load-model',
  CancelModelLoad: 'llamacpp:model-load:cancel',
  UnloadModel: 'llamacpp:unload-model',
  InstallModel: 'llamacpp:install-model',
  CancelInstall: 'llamacpp:cancel-install',
  ImportRuntime: 'llamacpp:import-runtime',
  ListRuntimeDevices: 'llamacpp:runtime:list-devices',
  ListBackends: 'llamacpp:backends:list',
  GetBackendDownloadSize: 'llamacpp:backends:download-size',
  GetBackendSelection: 'llamacpp:backends:selection:get',
  SetBackendSelection: 'llamacpp:backends:selection:set',
  InstallBackend: 'llamacpp:backends:install',
  UninstallBackend: 'llamacpp:backends:uninstall',
  GetRuntimeCapabilities: 'llamacpp:runtime:get-capabilities',
  StatusChanged: 'llamacpp:status-changed',
  ModelBindingsChanged: 'llamacpp:model-bindings-changed',
  InstallProgress: 'llamacpp:install-progress',
  ModelLaunchLog: 'llamacpp:model-launch-log',
  ModelLaunchLogCleared: 'llamacpp:model-launch-log:cleared',
  GetLatestModelLaunchLogSession: 'llamacpp:model-launch-log-session:latest',
  ReadModelLaunchLogFile: 'llamacpp:model-launch-log-file:read',
  OpenModelLaunchLogWindow: 'llamacpp:model-launch-log-window:open',
  ModelLaunchLogWindowTargetChanged: 'llamacpp:model-launch-log-window:target-changed',
} as const;

export const LLAMACPP_RUNTIME_INSTALL_PROGRESS_ID = '__llamacpp_runtime__';

export type LlamaCppIpcChannel = (typeof LlamaCppIpcChannel)[keyof typeof LlamaCppIpcChannel];

export const LlamaCppModelLaunchLogWindowView = {
  ModelLaunchLog: 'llamacpp-model-launch-log',
} as const;

export type LlamaCppModelLaunchLogWindowView =
  (typeof LlamaCppModelLaunchLogWindowView)[keyof typeof LlamaCppModelLaunchLogWindowView];

export const LlamaCppModelLaunchLogWindowQuery = {
  View: 'view',
  SessionId: 'sessionId',
  ModelName: 'modelName',
} as const;

export type LlamaCppModelLaunchLogWindowQuery =
  (typeof LlamaCppModelLaunchLogWindowQuery)[keyof typeof LlamaCppModelLaunchLogWindowQuery];

export const LlamaCppRuntimeBackend = {
  Auto: 'auto',
  Cpu: 'cpu',
  Cuda: 'cuda',
} as const;

export type LlamaCppRuntimeBackend =
  (typeof LlamaCppRuntimeBackend)[keyof typeof LlamaCppRuntimeBackend];

export const LlamaCppRuntimeCudaMajor = {
  Cuda12: '12',
  Cuda13: '13',
} as const;

export type LlamaCppRuntimeCudaMajor =
  (typeof LlamaCppRuntimeCudaMajor)[keyof typeof LlamaCppRuntimeCudaMajor];

export const LlamaCppMemoryPolicy = {
  Auto: 'auto',
  Manual: 'manual',
} as const;

export type LlamaCppMemoryPolicy =
  (typeof LlamaCppMemoryPolicy)[keyof typeof LlamaCppMemoryPolicy];

export const LlamaCppBackendError = {
  CudaRequiresNvidiaGpu: 'cuda-requires-nvidia-gpu',
  SwitchRequiresStoppedService: 'backend-switch-requires-stopped-service',
} as const;
export type LlamaCppBackendError =
  (typeof LlamaCppBackendError)[keyof typeof LlamaCppBackendError];

export const LlamaCppServiceConfigFieldKey = {
  ModelsMax: 'modelsMax',
  ModelsAutoload: 'modelsAutoload',
  Timeout: 'timeout',
  ThreadsHttp: 'threadsHttp',
  Parallel: 'parallel',
  KvUnified: 'kvUnified',
  CachePrompt: 'cachePrompt',
  CacheReuse: 'cacheReuse',
  CacheRam: 'cacheRam',
  Device: 'device',
  SplitMode: 'splitMode',
  TensorSplit: 'tensorSplit',
  MainGpu: 'mainGpu',
  FlashAttn: 'flashAttn',
  Jinja: 'jinja',
  Mlock: 'mlock',
} as const;

export type LlamaCppServiceConfigFieldKey =
  (typeof LlamaCppServiceConfigFieldKey)[keyof typeof LlamaCppServiceConfigFieldKey];

export const LlamaCppModelLaunchLogLevel = {
  Debug: 'debug',
  Info: 'info',
  Warn: 'warn',
  Error: 'error',
} as const;

export type LlamaCppModelLaunchLogLevel =
  (typeof LlamaCppModelLaunchLogLevel)[keyof typeof LlamaCppModelLaunchLogLevel];

export const LlamaCppModelLaunchLogPhase = {
  Requested: 'requested',
  CheckingService: 'checking-service',
  StartingService: 'starting-service',
  ServiceReady: 'service-ready',
  PreparingModel: 'preparing-model',
  CheckingRuntime: 'checking-runtime',
  LoadingModel: 'loading-model',
  WaitingReady: 'waiting-ready',
  ProbingModel: 'probing-model',
  Retrying: 'retrying',
  Succeeded: 'succeeded',
  Failed: 'failed',
} as const;

export type LlamaCppModelLaunchLogPhase =
  (typeof LlamaCppModelLaunchLogPhase)[keyof typeof LlamaCppModelLaunchLogPhase];

export const LlamaCppModelLaunchLogSource = {
  LaunchFlow: 'launch-flow',
} as const;

export type LlamaCppModelLaunchLogSource =
  (typeof LlamaCppModelLaunchLogSource)[keyof typeof LlamaCppModelLaunchLogSource];

export const LlamaCppModelLaunchLogSessionStatus = {
  Starting: 'starting',
  Succeeded: 'succeeded',
  Failed: 'failed',
} as const;

export type LlamaCppModelLaunchLogSessionStatus =
  (typeof LlamaCppModelLaunchLogSessionStatus)[keyof typeof LlamaCppModelLaunchLogSessionStatus];
