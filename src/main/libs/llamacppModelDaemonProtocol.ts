import type {
  LlamaCppModelLaunchInput,
  LlamaCppRunningModel,
  LlamaCppServiceConfig,
  LlamaCppStatusSnapshot,
} from '../../shared/llamacpp';

export const LLAMACPP_MODEL_DAEMON_HANDOFF = 'llamacpp-daemon-handoff';

export const LlamaCppModelDaemonCommand = {
  Status: 'status',
  ListRunningModels: 'list-running-models',
  EnsureModel: 'ensure-model',
  StopModel: 'stop-model',
  DeleteModelFile: 'delete-model-file',
  StopAll: 'stop-all',
  ApplyConfig: 'apply-config',
  Shutdown: 'shutdown',
  ShutdownIfIdle: 'shutdown-if-idle',
} as const;

export type LlamaCppModelDaemonCommand =
  (typeof LlamaCppModelDaemonCommand)[keyof typeof LlamaCppModelDaemonCommand];

export type LlamaCppModelDaemonBootstrap = {
  controlPort: number;
  controlToken: string;
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
  | {
      command: typeof LlamaCppModelDaemonCommand.DeleteModelFile;
      modelName: string;
      modelPath: string;
    }
  | { command: typeof LlamaCppModelDaemonCommand.StopAll }
  | {
      command: typeof LlamaCppModelDaemonCommand.ApplyConfig;
      serviceConfig: LlamaCppServiceConfig;
    }
  | {
      command:
        | typeof LlamaCppModelDaemonCommand.Shutdown
        | typeof LlamaCppModelDaemonCommand.ShutdownIfIdle;
    };

export type LlamaCppModelDaemonResponse =
  | { success: true; status: LlamaCppModelDaemonStatus }
  | { success: false; error: string };
