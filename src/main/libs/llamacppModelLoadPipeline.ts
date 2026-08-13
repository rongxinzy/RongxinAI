import type { NvidiaSmiSnapshot, SystemMemorySnapshot } from '../../shared/hardware';
import type {
  LlamaCppMemoryPolicy,
  LlamaCppModel,
  LlamaCppModelLaunchInput,
  LlamaCppModelLaunchResult,
  LlamaCppRunningModel,
  LlamaCppRuntimeCapabilities,
  LlamaCppStatusSnapshot,
} from '../../shared/llamacpp';
import { LlamaCppRuntimeBackend } from '../../shared/llamacpp';
import { planLlamaCppModelGpuPlacement } from './llamacppModelGpuPlacement';
import type { LlamaCppModelLaunchLogReporter } from './llamacppModelLaunchLog';
import {
  LlamaCppModelLoadError,
  LlamaCppModelLoadFailureReason,
  type LlamaCppModelLoadFailureReason as LlamaCppModelLoadFailureReasonType,
} from './llamacppModelLoadErrors';
import { loadLlamaCppModelWithRetry } from './llamacppModelLoadRetry';
import {
  LlamaCppModelStartupSettleStatus,
  settleLlamaCppModelStartup,
} from './llamacppModelStartupSettle';

export const LlamaCppModelLoadPipelineDefaults = {
  StartupBudgetMs: 15 * 60 * 1000,
  StartupPollIntervalMs: 2000,
  StartupRequestTimeoutMs: 10_000,
} as const;

export type LlamaCppModelLoadPipelineResult = LlamaCppModelLaunchResult & {
  finalInput: LlamaCppModelLaunchInput;
};

export type LlamaCppModelLoadPipelineInput = {
  launchInput: LlamaCppModelLaunchInput;
  runtimeBackend?: LlamaCppRuntimeBackend;
  runtimeCapabilities?: LlamaCppRuntimeCapabilities | null;
  nvidiaSnapshot?: NvidiaSmiSnapshot | null;
  systemMemorySnapshot?: SystemMemorySnapshot | null;
  memoryPolicy?: LlamaCppMemoryPolicy;
  memoryBudgetPercent?: number;
  modelSizeBytes?: number;
  signal?: AbortSignal;
  loadModel: (input: LlamaCppModelLaunchInput) => Promise<LlamaCppModelLaunchResult>;
  listModels: (timeoutMs: number) => Promise<LlamaCppModel[]>;
  listRunningModels: () => Promise<LlamaCppRunningModel[]>;
  detectService: () => Promise<LlamaCppStatusSnapshot>;
  unloadModel?: (modelName: string) => Promise<void>;
  maxRetries?: number;
  minContextSize?: number;
  startupBudgetMs?: number;
  now?: () => number;
  onLog?: LlamaCppModelLaunchLogReporter;
};

/**
 * Coordinates the model-only startup path after llama.cpp service is available.
 * This module keeps policy orchestration outside the large IPC handler while the
 * actual llama.cpp load call remains delegated to LlamaCppManager.
 */
export async function loadLlamaCppModelThroughPipeline(
  input: LlamaCppModelLoadPipelineInput,
): Promise<LlamaCppModelLoadPipelineResult> {
  throwIfAborted(input.signal);
  const modelName = input.launchInput.model.trim();
  if (!modelName) {
    throw new LlamaCppModelLoadError({
      reason: LlamaCppModelLoadFailureReason.ModelNotFound,
      detail: 'Model name is required.',
    });
  }

  const placedInput = applyGpuPlacement(input);
  const startedAtMs = input.now?.() ?? Date.now();
  const startupBudgetMs =
    input.startupBudgetMs ?? LlamaCppModelLoadPipelineDefaults.StartupBudgetMs;
  const deadlineMs = startedAtMs + startupBudgetMs;

  const retryResult = await loadLlamaCppModelWithRetry<LlamaCppModelLaunchResult>({
    initialInput: {
      ...placedInput,
      model: modelName,
    },
    maxRetries: input.maxRetries,
    minContextSize: input.minContextSize,
    signal: input.signal,
    listRunningModels: input.listRunningModels,
    unloadModel: input.unloadModel,
    onLog: input.onLog,
    attemptLoad: async attemptInput => {
      throwIfAborted(input.signal);
      const loadResult = await input.loadModel(attemptInput);
      throwIfAborted(input.signal);
      const settleResult = await settleLlamaCppModelStartup({
        modelName,
        detectService: input.detectService,
        listModels: input.listModels,
        unloadModel: input.unloadModel,
        deadlineMs,
        pollIntervalMs: LlamaCppModelLoadPipelineDefaults.StartupPollIntervalMs,
        requestTimeoutMs: LlamaCppModelLoadPipelineDefaults.StartupRequestTimeoutMs,
        signal: input.signal,
        onLog: input.onLog,
      });

      if (settleResult.status !== LlamaCppModelStartupSettleStatus.Loaded) {
        throw new LlamaCppModelLoadError({
          reason: mapSettleStatusToFailureReason(settleResult.status),
          detail: settleResult.detail,
        });
      }

      return {
        ...loadResult,
        runningModels: settleResult.runningModels,
      };
    },
  });

  return {
    ...retryResult.result,
    finalInput: retryResult.finalInput,
  };
}

function applyGpuPlacement(input: LlamaCppModelLoadPipelineInput): LlamaCppModelLaunchInput {
  const placementResult = planLlamaCppModelGpuPlacement({
    launchInput: input.launchInput,
    runtimeBackend: input.runtimeBackend,
    runtimeCapabilities: input.runtimeCapabilities,
    nvidiaSnapshot: input.nvidiaSnapshot,
    systemMemorySnapshot: input.systemMemorySnapshot,
    memoryPolicy: input.memoryPolicy,
    memoryBudgetPercent: input.memoryBudgetPercent,
    modelSizeBytes: input.modelSizeBytes,
  });

  if (placementResult.success === true) {
    return placementResult.input;
  }

  throw new LlamaCppModelLoadError({
    reason: placementResult.reason,
    detail: placementResult.detail,
  });
}

function mapSettleStatusToFailureReason(
  status: Exclude<LlamaCppModelStartupSettleStatus, typeof LlamaCppModelStartupSettleStatus.Loaded>,
): LlamaCppModelLoadFailureReasonType {
  switch (status) {
    case LlamaCppModelStartupSettleStatus.ServiceUnavailable:
      return LlamaCppModelLoadFailureReason.ServiceUnavailable;
    case LlamaCppModelStartupSettleStatus.NotFound:
      return LlamaCppModelLoadFailureReason.ModelNotFound;
    case LlamaCppModelStartupSettleStatus.StartupTimeout:
    case LlamaCppModelStartupSettleStatus.UnknownTimeout:
      return LlamaCppModelLoadFailureReason.StartupTimeout;
    case LlamaCppModelStartupSettleStatus.Failed:
      return LlamaCppModelLoadFailureReason.Unknown;
  }
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw signal.reason ?? new DOMException('Aborted', 'AbortError');
}
