import type {
  LlamaCppModelLaunchInput,
  LlamaCppRunningModel,
  LlamaCppServiceConfig,
  LlamaCppStatusSnapshot,
} from '../../shared/llamacpp';

export const LlamaCppModelDaemonCommand = {
  Status: 'status',
  ListRunningModels: 'list-running-models',
  EnsureModel: 'ensure-model',
  StopModel: 'stop-model',
  StopAll: 'stop-all',
  ApplyConfig: 'apply-config',
  Shutdown: 'shutdown',
} as const;

export type LlamaCppModelDaemonCommand =
  (typeof LlamaCppModelDaemonCommand)[keyof typeof LlamaCppModelDaemonCommand];

export type LlamaCppModelDaemonBootstrap = {
  controlPort: number;
  controlToken: string;
  lanToken?: string;
  userDataPath: string;
  executablePath: string;
  serviceConfig: LlamaCppServiceConfig;
};

export type LlamaCppModelDaemonStatus = {
  status: LlamaCppStatusSnapshot;
  runningModels: LlamaCppRunningModel[];
  modelProcesses: Array<{
    modelName: string;
    modelPath: string;
    port: number;
  }>;
  gatewayBaseUrl: string | null;
};

export type LlamaCppModelDaemonRequest =
  | { command: typeof LlamaCppModelDaemonCommand.Status }
  | { command: typeof LlamaCppModelDaemonCommand.ListRunningModels }
  | {
      command: typeof LlamaCppModelDaemonCommand.EnsureModel;
      input: LlamaCppModelLaunchInput;
    }
  | { command: typeof LlamaCppModelDaemonCommand.StopModel; modelName: string }
  | { command: typeof LlamaCppModelDaemonCommand.StopAll }
  | {
      command: typeof LlamaCppModelDaemonCommand.ApplyConfig;
      serviceConfig: LlamaCppServiceConfig;
      lanToken?: string;
    }
  | { command: typeof LlamaCppModelDaemonCommand.Shutdown };

export type LlamaCppModelDaemonResponse =
  | { success: true; status: LlamaCppModelDaemonStatus }
  | { success: false; error: string };
