export const LlamaCppIpcChannel = {
  Status: 'llamacpp:status',
  Install: 'llamacpp:install',
  UninstallRuntime: 'llamacpp:runtime:uninstall',
  Start: 'llamacpp:start',
  Stop: 'llamacpp:stop',
  Restart: 'llamacpp:restart',
  GetServiceConfig: 'llamacpp:service-config:get',
  SetServiceConfig: 'llamacpp:service-config:set',
  ModelsDir: 'llamacpp:models-dir',
  ListLocalModels: 'llamacpp:list-local-models',
  ListRunningModels: 'llamacpp:list-running-models',
  DeleteModel: 'llamacpp:delete-model',
  ShowModel: 'llamacpp:show-model',
  LoadModel: 'llamacpp:load-model',
  UnloadModel: 'llamacpp:unload-model',
  InstallModel: 'llamacpp:install-model',
  CancelInstall: 'llamacpp:cancel-install',
  Chat: 'llamacpp:chat',
  ChatStream: 'llamacpp:chat-stream',
  CancelChatStream: 'llamacpp:cancel-chat-stream',
  SetOpenClawModel: 'llamacpp:set-openclaw-model',
  ImportRuntime: 'llamacpp:import-runtime',
  ListRuntimeDevices: 'llamacpp:runtime:list-devices',
  StatusChanged: 'llamacpp:status-changed',
  InstallProgress: 'llamacpp:install-progress',
  ChatStreamChunk: 'llamacpp:chat-stream-chunk',
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
} as const;

export type LlamaCppRuntimeCudaMajor =
  typeof LlamaCppRuntimeCudaMajor[keyof typeof LlamaCppRuntimeCudaMajor];
