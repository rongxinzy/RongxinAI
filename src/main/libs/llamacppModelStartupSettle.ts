import path from 'node:path';

import type {
  LlamaCppModel,
  LlamaCppRunningModel,
  LlamaCppStatusSnapshot,
} from '../../shared/llamacpp';
import { LlamaCppModelLaunchLogLevel, LlamaCppModelLaunchLogPhase } from '../../shared/llamacpp';
import type { LlamaCppModelLaunchLogReporter } from './llamacppModelLaunchLog';

export const LlamaCppModelStartupSettleStatus = {
  Loaded: 'loaded',
  Failed: 'failed',
  ServiceUnavailable: 'service-unavailable',
  NotFound: 'not-found',
  StartupTimeout: 'startup-timeout',
  UnknownTimeout: 'unknown-timeout',
} as const;

export type LlamaCppModelStartupSettleStatus =
  (typeof LlamaCppModelStartupSettleStatus)[keyof typeof LlamaCppModelStartupSettleStatus];

export const LlamaCppModelStartupObservedState = {
  Loaded: 'loaded',
  Loading: 'loading',
  Sleeping: 'sleeping',
  Unloaded: 'unloaded',
  Error: 'error',
  NotFound: 'not-found',
  Unknown: 'unknown',
} as const;

export type LlamaCppModelStartupObservedState =
  (typeof LlamaCppModelStartupObservedState)[keyof typeof LlamaCppModelStartupObservedState];

export type LlamaCppModelStartupSettleResult =
  | {
      status: typeof LlamaCppModelStartupSettleStatus.Loaded;
      runningModels: LlamaCppRunningModel[];
      model: LlamaCppModel;
    }
  | {
      status: Exclude<
        LlamaCppModelStartupSettleStatus,
        typeof LlamaCppModelStartupSettleStatus.Loaded
      >;
      observedState: LlamaCppModelStartupObservedState;
      runningModels: LlamaCppRunningModel[];
      model?: LlamaCppModel;
      serviceStatus?: LlamaCppStatusSnapshot;
      detail?: string;
      unloadedAfterTimeout?: boolean;
    };

/**
 * Inputs are intentionally function-based so the later orchestrator can wire this module
 * to LlamaCppManager without coupling the settle loop to a concrete manager class.
 */
export type LlamaCppModelStartupSettleInput = {
  modelName: string;
  detectService: () => Promise<LlamaCppStatusSnapshot>;
  listModels: (timeoutMs: number) => Promise<LlamaCppModel[]>;
  unloadModel?: (modelName: string) => Promise<void>;
  timeoutMs?: number;
  deadlineMs?: number;
  pollIntervalMs?: number;
  requestTimeoutMs?: number;
  now?: () => number;
  wait?: (delayMs: number) => Promise<void>;
  onLog?: LlamaCppModelLaunchLogReporter;
};

const LlamaCppServerStatusValue = {
  Running: 'running',
} as const;

const LlamaCppModelStatusValue = {
  Loaded: 'loaded',
  Loading: 'loading',
  Sleeping: 'sleeping',
  Unloaded: 'unloaded',
  Error: 'error',
} as const;

const LLAMACPP_MODEL_STARTUP_SETTLE_TIMEOUT_MS = 15 * 60 * 1000;
const LLAMACPP_MODEL_STARTUP_SETTLE_POLL_INTERVAL_MS = 2000;
const LLAMACPP_MODEL_STARTUP_SETTLE_REQUEST_TIMEOUT_MS = 10_000;

/**
 * Observes llama.cpp after a load request returns, times out, or becomes ambiguous.
 * A request timeout is not treated as failure here; the loop keeps polling service/model
 * state until the target is ready, clearly failed, or the shared startup budget expires.
 */
export async function settleLlamaCppModelStartup(
  input: LlamaCppModelStartupSettleInput,
): Promise<LlamaCppModelStartupSettleResult> {
  const now = input.now ?? Date.now;
  const wait = input.wait ?? defaultWait;
  const startedAtMs = now();
  const deadlineMs =
    input.deadlineMs ?? startedAtMs + (input.timeoutMs ?? LLAMACPP_MODEL_STARTUP_SETTLE_TIMEOUT_MS);
  const pollIntervalMs = input.pollIntervalMs ?? LLAMACPP_MODEL_STARTUP_SETTLE_POLL_INTERVAL_MS;
  const requestTimeoutMs =
    input.requestTimeoutMs ?? LLAMACPP_MODEL_STARTUP_SETTLE_REQUEST_TIMEOUT_MS;

  let lastObservedState: LlamaCppModelStartupObservedState | null = null;

  while (true) {
    // Each iteration first verifies service health, then reads the model table.
    // This separates service failures from model-level loading states.
    const remainingMs = Math.max(0, deadlineMs - now());
    const observation = await inspectModelStartup({
      modelName: input.modelName,
      detectService: input.detectService,
      listModels: input.listModels,
      requestTimeoutMs: Math.max(1, Math.min(requestTimeoutMs, remainingMs || requestTimeoutMs)),
    });
    if (observation.status !== LlamaCppModelStartupSettleStatus.Loaded) {
      if (observation.observedState !== lastObservedState) {
        lastObservedState = observation.observedState;
        input.onLog?.({
          level:
            observation.status === LlamaCppModelStartupSettleStatus.Failed ||
            observation.status === LlamaCppModelStartupSettleStatus.ServiceUnavailable
              ? LlamaCppModelLaunchLogLevel.Warn
              : LlamaCppModelLaunchLogLevel.Info,
          phase: LlamaCppModelLaunchLogPhase.WaitingReady,
          detail: {
            observedState: observation.observedState,
            serviceStatus: observation.serviceStatus?.status,
            detail: observation.detail,
          },
        });
      }
    }

    // loaded and sleeping both mean the model is usable for the UI.
    if (observation.status === LlamaCppModelStartupSettleStatus.Loaded) {
      input.onLog?.({
        level: LlamaCppModelLaunchLogLevel.Info,
        phase: LlamaCppModelLaunchLogPhase.ProbingModel,
      });
      return {
        status: LlamaCppModelStartupSettleStatus.Loaded,
        runningModels: observation.runningModels,
        model: observation.model,
      };
    }

    if (
      observation.status === LlamaCppModelStartupSettleStatus.Failed ||
      observation.status === LlamaCppModelStartupSettleStatus.ServiceUnavailable
    ) {
      return observation;
    }

    // The 15-minute budget is global for the full startup flow, not per retry.
    if (now() >= deadlineMs) {
      return await finalizeTimedOutObservation({
        modelName: input.modelName,
        observation,
        unloadModel: input.unloadModel,
      });
    }

    await wait(Math.min(pollIntervalMs, Math.max(1, deadlineMs - now())));
  }
}

type ModelStartupObservation =
  | {
      status: typeof LlamaCppModelStartupSettleStatus.Loaded;
      runningModels: LlamaCppRunningModel[];
      model: LlamaCppModel;
    }
  | {
      status: Exclude<
        LlamaCppModelStartupSettleStatus,
        typeof LlamaCppModelStartupSettleStatus.Loaded
      >;
      observedState: LlamaCppModelStartupObservedState;
      runningModels: LlamaCppRunningModel[];
      model?: LlamaCppModel;
      serviceStatus?: LlamaCppStatusSnapshot;
      detail?: string;
    };

// Reads the current service/model state once and normalizes raw llama.cpp statuses.
async function inspectModelStartup(input: {
  modelName: string;
  detectService: () => Promise<LlamaCppStatusSnapshot>;
  listModels: (timeoutMs: number) => Promise<LlamaCppModel[]>;
  requestTimeoutMs: number;
}): Promise<ModelStartupObservation> {
  let serviceStatus: LlamaCppStatusSnapshot;
  try {
    serviceStatus = await input.detectService();
  } catch (error) {
    return serviceUnavailableObservation(error);
  }

  if (serviceStatus.status !== LlamaCppServerStatusValue.Running) {
    return {
      status: LlamaCppModelStartupSettleStatus.ServiceUnavailable,
      observedState: LlamaCppModelStartupObservedState.Unknown,
      runningModels: [],
      serviceStatus,
      detail: serviceStatus.error,
    };
  }

  let models: LlamaCppModel[];
  try {
    models = await input.listModels(input.requestTimeoutMs);
  } catch (error) {
    return serviceUnavailableObservation(error, serviceStatus);
  }

  const runningModels = models.filter(isRunningModel);
  const targetModel = models.find(model => matchesModelName(model, input.modelName));
  if (!targetModel) {
    return {
      status: LlamaCppModelStartupSettleStatus.NotFound,
      observedState: LlamaCppModelStartupObservedState.NotFound,
      runningModels,
      serviceStatus,
    };
  }

  switch (targetModel.status) {
    case LlamaCppModelStatusValue.Loaded:
    case LlamaCppModelStatusValue.Sleeping:
      return {
        status: LlamaCppModelStartupSettleStatus.Loaded,
        runningModels,
        model: targetModel,
      };
    case LlamaCppModelStatusValue.Error:
      return {
        status: LlamaCppModelStartupSettleStatus.Failed,
        observedState: LlamaCppModelStartupObservedState.Error,
        runningModels,
        model: targetModel,
        serviceStatus,
      };
    case LlamaCppModelStatusValue.Loading:
      return {
        status: LlamaCppModelStartupSettleStatus.UnknownTimeout,
        observedState: LlamaCppModelStartupObservedState.Loading,
        runningModels,
        model: targetModel,
        serviceStatus,
      };
    case LlamaCppModelStatusValue.Unloaded:
      return {
        status: LlamaCppModelStartupSettleStatus.UnknownTimeout,
        observedState: LlamaCppModelStartupObservedState.Unloaded,
        runningModels,
        model: targetModel,
        serviceStatus,
      };
    default:
      return {
        status: LlamaCppModelStartupSettleStatus.UnknownTimeout,
        observedState: LlamaCppModelStartupObservedState.Unknown,
        runningModels,
        model: targetModel,
        serviceStatus,
      };
  }
}

// Converts the last observed non-terminal state into a terminal timeout result.
// If the model is still loading, try to unload it so the next attempt starts cleanly.
async function finalizeTimedOutObservation(input: {
  modelName: string;
  observation: ModelStartupObservation | null;
  unloadModel?: (modelName: string) => Promise<void>;
}): Promise<LlamaCppModelStartupSettleResult> {
  const observation = input.observation;
  if (!observation) {
    return {
      status: LlamaCppModelStartupSettleStatus.UnknownTimeout,
      observedState: LlamaCppModelStartupObservedState.Unknown,
      runningModels: [],
    };
  }

  if (observation.status === LlamaCppModelStartupSettleStatus.Loaded) {
    return observation;
  }

  if (observation.observedState === LlamaCppModelStartupObservedState.NotFound) {
    return {
      ...observation,
      status: LlamaCppModelStartupSettleStatus.NotFound,
    };
  }

  if (observation.observedState !== LlamaCppModelStartupObservedState.Loading) {
    return {
      ...observation,
      status: LlamaCppModelStartupSettleStatus.UnknownTimeout,
    };
  }

  let unloadedAfterTimeout = false;
  if (input.unloadModel) {
    try {
      await input.unloadModel(input.modelName);
      unloadedAfterTimeout = true;
    } catch {
      unloadedAfterTimeout = false;
    }
  }

  return {
    ...observation,
    status: LlamaCppModelStartupSettleStatus.StartupTimeout,
    unloadedAfterTimeout,
  };
}

function serviceUnavailableObservation(
  error: unknown,
  serviceStatus?: LlamaCppStatusSnapshot,
): ModelStartupObservation {
  return {
    status: LlamaCppModelStartupSettleStatus.ServiceUnavailable,
    observedState: LlamaCppModelStartupObservedState.Unknown,
    runningModels: [],
    serviceStatus,
    detail: error instanceof Error ? error.message : String(error),
  };
}

function isRunningModel(model: LlamaCppModel): model is LlamaCppRunningModel {
  return (
    model.status === LlamaCppModelStatusValue.Loaded ||
    model.status === LlamaCppModelStatusValue.Loading ||
    model.status === LlamaCppModelStatusValue.Sleeping
  );
}

function matchesModelName(model: LlamaCppModel, modelName: string): boolean {
  const normalizedModelName = modelName.trim();
  const targetBaseName = path.basename(normalizedModelName);
  return [model.name, model.id, model.model, model.path].some(value => {
    const candidate = value?.trim();
    return candidate === normalizedModelName || path.basename(candidate ?? '') === targetBaseName;
  });
}

function defaultWait(delayMs: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, delayMs));
}
