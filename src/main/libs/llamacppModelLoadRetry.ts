import path from 'node:path';

import type {
  LlamaCppModelLaunchInput,
  LlamaCppRunningModel,
} from '../../shared/llamacpp';
import {
  LlamaCppModelLaunchLogLevel,
  LlamaCppModelLaunchLogPhase,
} from '../../shared/llamacpp';
import type { LlamaCppModelLaunchLogReporter } from './llamacppModelLaunchLog';
import {
  classifyLlamaCppModelLoadError,
  isRetryableLlamaCppModelLoadError,
  LlamaCppModelLoadError,
  type LlamaCppModelLoadFailureReason,
} from './llamacppModelLoadErrors';

export const LlamaCppModelLoadRetryDefaults = {
  MaxRetries: 1,
  MinContextSize: 128,
} as const;

export type LlamaCppModelLoadAttemptRecord = {
  attemptIndex: number;
  input: LlamaCppModelLaunchInput;
  failureReason?: LlamaCppModelLoadFailureReason;
};

export type LlamaCppModelLoadRetryResult<T> = {
  result: T;
  attempts: LlamaCppModelLoadAttemptRecord[];
  finalInput: LlamaCppModelLaunchInput;
};

export type LlamaCppModelLoadRetryInput<T> = {
  initialInput: LlamaCppModelLaunchInput;
  attemptLoad: (
    input: LlamaCppModelLaunchInput,
    context: {
      attemptIndex: number;
      remainingRetries: number;
    },
  ) => Promise<T>;
  listRunningModels?: () => Promise<LlamaCppRunningModel[]>;
  unloadModel?: (modelName: string) => Promise<void>;
  maxRetries?: number;
  minContextSize?: number;
  onLog?: LlamaCppModelLaunchLogReporter;
};

const LlamaCppRetryRunningModelStatus = {
  Loaded: 'loaded',
  Loading: 'loading',
  Sleeping: 'sleeping',
} as const;

/**
 * Runs a model-load attempt with a small, deterministic retry policy.
 * The default policy is exactly one retry: first use the caller input, then
 * halve ctxSize once if the failure reason is retryable.
 */
export async function loadLlamaCppModelWithRetry<T>(
  input: LlamaCppModelLoadRetryInput<T>,
): Promise<LlamaCppModelLoadRetryResult<T>> {
  const maxRetries = Math.max(0, input.maxRetries ?? LlamaCppModelLoadRetryDefaults.MaxRetries);
  const minContextSize = Math.max(
    1,
    input.minContextSize ?? LlamaCppModelLoadRetryDefaults.MinContextSize,
  );
  const attempts: LlamaCppModelLoadAttemptRecord[] = [];
  let currentInput = normalizeModelLoadInput(input.initialInput);

  for (let attemptIndex = 0; attemptIndex <= maxRetries; attemptIndex += 1) {
    input.onLog?.({
      level: LlamaCppModelLaunchLogLevel.Info,
      phase: LlamaCppModelLaunchLogPhase.LoadingModel,
      detail: describeRetryAttempt(currentInput, attemptIndex, maxRetries - attemptIndex),
    });
    try {
      const result = await input.attemptLoad(currentInput, {
        attemptIndex,
        remainingRetries: maxRetries - attemptIndex,
      });
      attempts.push({ attemptIndex, input: currentInput });
      return {
        result,
        attempts,
        finalInput: currentInput,
      };
    } catch (error) {
      const failureReason = classifyLlamaCppModelLoadError(error);
      attempts.push({ attemptIndex, input: currentInput, failureReason });

      if (
        attemptIndex >= maxRetries ||
        !isRetryableLlamaCppModelLoadError(failureReason)
      ) {
        throw toRetryFailureError(error, failureReason);
      }

      // Clean a half-loaded target before retrying so the next attempt starts from a known state.
      await unloadTargetModelBeforeRetry({
        modelName: currentInput.model,
        listRunningModels: input.listRunningModels,
        unloadModel: input.unloadModel,
      });
      currentInput = halveLlamaCppModelLoadContext(currentInput, minContextSize);
      input.onLog?.({
        level: LlamaCppModelLaunchLogLevel.Warn,
        phase: LlamaCppModelLaunchLogPhase.Retrying,
        detail: describeRetryInput(currentInput, attemptIndex + 1, failureReason),
      });
    }
  }

  throw new LlamaCppModelLoadError({
    reason: classifyLlamaCppModelLoadError(undefined),
  });
}


function describeRetryAttempt(
  input: LlamaCppModelLaunchInput,
  attemptIndex: number,
  remainingRetries: number,
): Record<string, unknown> {
  return {
    attemptIndex: attemptIndex + 1,
    remainingRetries,
    ...(input.options?.ctxSize ? { ctxSize: input.options.ctxSize } : {}),
  };
}

function describeRetryInput(
  input: LlamaCppModelLaunchInput,
  nextAttemptIndex: number,
  failureReason: LlamaCppModelLoadFailureReason,
): Record<string, unknown> {
  return {
    model: input.model,
    nextAttemptIndex: nextAttemptIndex + 1,
    failureReason,
    ...(input.options?.ctxSize ? { nextCtxSize: input.options.ctxSize } : {}),
  };
}

export function halveLlamaCppModelLoadContext(
  input: LlamaCppModelLaunchInput,
  minContextSize: number = LlamaCppModelLoadRetryDefaults.MinContextSize,
): LlamaCppModelLaunchInput {
  const currentContextSize = input.options?.ctxSize;
  if (!currentContextSize || currentContextSize <= 0) {
    return normalizeModelLoadInput(input);
  }

  const nextContextSize = Math.max(minContextSize, Math.floor(currentContextSize / 2));
  return normalizeModelLoadInput({
    ...input,
    options: {
      ...input.options,
      ctxSize: nextContextSize,
    },
  });
}

async function unloadTargetModelBeforeRetry(input: {
  modelName: string;
  listRunningModels?: () => Promise<LlamaCppRunningModel[]>;
  unloadModel?: (modelName: string) => Promise<void>;
}): Promise<void> {
  if (!input.listRunningModels || !input.unloadModel) return;

  let runningModels: LlamaCppRunningModel[];
  try {
    runningModels = await input.listRunningModels();
  } catch {
    return;
  }

  const targetModel = runningModels.find(model => shouldUnloadBeforeRetry(model, input.modelName));
  if (!targetModel) return;

  const modelName = (targetModel.name || targetModel.model || targetModel.id || input.modelName).trim();
  if (!modelName) return;
  await input.unloadModel(modelName);
}

function shouldUnloadBeforeRetry(model: LlamaCppRunningModel, modelName: string): boolean {
  if (
    model.status !== LlamaCppRetryRunningModelStatus.Loaded &&
    model.status !== LlamaCppRetryRunningModelStatus.Loading &&
    model.status !== LlamaCppRetryRunningModelStatus.Sleeping
  ) {
    return false;
  }
  return matchesModelName(model, modelName);
}

function toRetryFailureError(
  error: unknown,
  reason: LlamaCppModelLoadFailureReason,
): LlamaCppModelLoadError {
  if (error instanceof LlamaCppModelLoadError) return error;
  const detail = error instanceof Error ? error.message : String(error);
  return new LlamaCppModelLoadError({
    reason,
    detail,
  });
}

function normalizeModelLoadInput(input: LlamaCppModelLaunchInput): LlamaCppModelLaunchInput {
  return {
    ...input,
    model: input.model.trim(),
  };
}

function matchesModelName(model: LlamaCppRunningModel, modelName: string): boolean {
  const normalizedModelName = modelName.trim();
  const targetBaseName = path.basename(normalizedModelName);
  return [model.name, model.id, model.model, model.path].some(value => {
    const candidate = value?.trim();
    return candidate === normalizedModelName || path.basename(candidate ?? '') === targetBaseName;
  });
}
