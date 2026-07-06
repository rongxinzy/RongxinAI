export const LlamaCppIpcChannel = {
  Status: 'llamacpp:status',
  Install: 'llamacpp:install',
  UninstallRuntime: 'llamacpp:runtime:uninstall',
  Start: 'llamacpp:start',
  Stop: 'llamacpp:stop',
  Restart: 'llamacpp:restart',
  ModelsDir: 'llamacpp:models-dir',
  ListLocalModels: 'llamacpp:list-local-models',
  ListRunningModels: 'llamacpp:list-running-models',
  DeleteModel: 'llamacpp:delete-model',
  ShowModel: 'llamacpp:show-model',
  LoadModel: 'llamacpp:load-model',
  UnloadModel: 'llamacpp:unload-model',
  InstallModel: 'llamacpp:install-model',
  CancelInstall: 'llamacpp:cancel-install',
  ImportRuntime: 'llamacpp:import-runtime',
  ListRuntimeDevices: 'llamacpp:runtime:list-devices',
  ListBackends: 'llamacpp:backends:list',
  GetBackendSelection: 'llamacpp:backends:selection:get',
  SetBackendSelection: 'llamacpp:backends:selection:set',
  InstallBackend: 'llamacpp:backends:install',
  UninstallBackend: 'llamacpp:backends:uninstall',
  GetRuntimeCapabilities: 'llamacpp:runtime:get-capabilities',
  StatusChanged: 'llamacpp:status-changed',
  InstallProgress: 'llamacpp:install-progress',
} as const;

export type LlamaCppIpcChannel = typeof LlamaCppIpcChannel[keyof typeof LlamaCppIpcChannel];

export const LlamaCppRuntimeBackend = {
  Auto: 'auto',
  Cpu: 'cpu',
  Cuda: 'cuda',
} as const;

export type LlamaCppRuntimeBackend =
  typeof LlamaCppRuntimeBackend[keyof typeof LlamaCppRuntimeBackend];

export const LlamaCppRuntimeCudaMajor = {
  Cuda12: '12',
  Cuda13: '13',
} as const;

export type LlamaCppRuntimeCudaMajor =
  typeof LlamaCppRuntimeCudaMajor[keyof typeof LlamaCppRuntimeCudaMajor];

export const LlamaCppServiceConfigFieldKey = {
  ModelsMax: 'modelsMax',
  ModelsAutoload: 'modelsAutoload',
  Timeout: 'timeout',
  ThreadsHttp: 'threadsHttp',
  Parallel: 'parallel',
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
  typeof LlamaCppServiceConfigFieldKey[keyof typeof LlamaCppServiceConfigFieldKey];
