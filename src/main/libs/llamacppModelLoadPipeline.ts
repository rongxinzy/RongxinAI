import type { NvidiaSmiSnapshot, SystemMemorySnapshot } from '../../shared/hardware';
import type {
  LlamaCppMemoryPolicy,
  LlamaCppModelLaunchInput,
  LlamaCppModelLaunchResult,
  LlamaCppRunningModel,
  LlamaCppRuntimeCapabilities,
} from '../../shared/llamacpp';
import { LlamaCppModelStatus, LlamaCppRuntimeBackend } from '../../shared/llamacpp';
import { planLlamaCppModelGpuPlacement } from './llamacppModelGpuPlacement';
import type { LlamaCppModelLaunchLogReporter } from './llamacppModelLaunchLog';
import { LlamaCppModelLoadError, LlamaCppModelLoadFailureReason } from './llamacppModelLoadErrors';
import { loadLlamaCppModelWithRetry } from './llamacppModelLoadRetry';

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
  cacheTypeK?: string;
  cacheTypeV?: string;
  signal?: AbortSignal;
  loadModel: (input: LlamaCppModelLaunchInput) => Promise<LlamaCppModelLaunchResult>;
  listRunningModels: () => Promise<LlamaCppRunningModel[]>;
  unloadModel?: (modelName: string) => Promise<void>;
  maxRetries?: number;
  minContextSize?: number;
  onLog?: LlamaCppModelLaunchLogReporter;
};

/**
 * Applies placement and retry policy. The orchestrator owns startup readiness.
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

  const placedInput = await applyGpuPlacement(input);
  throwIfAborted(input.signal);
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
      if (
        !loadResult.runningModels.some(
          model =>
            (model.name === modelName || model.id === modelName || model.model === modelName) &&
            (model.status === LlamaCppModelStatus.Loaded ||
              model.status === LlamaCppModelStatus.Sleeping),
        )
      ) {
        throw new LlamaCppModelLoadError({
          reason: LlamaCppModelLoadFailureReason.StartupTimeout,
          detail: 'The local inference service did not confirm the requested model is ready.',
        });
      }
      return loadResult;
    },
  });

  return {
    ...retryResult.result,
    finalInput: retryResult.finalInput,
  };
}

async function applyGpuPlacement(
  input: LlamaCppModelLoadPipelineInput,
): Promise<LlamaCppModelLaunchInput> {
  const placementResult = await planLlamaCppModelGpuPlacement(input);

  if (placementResult.success === true) {
    return placementResult.input;
  }

  throw new LlamaCppModelLoadError({
    reason: placementResult.reason,
    detail: placementResult.detail,
  });
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw signal.reason ?? new DOMException('Aborted', 'AbortError');
}
