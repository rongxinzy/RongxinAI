import type { LlamaCppModel, LlamaCppModelPreference, LlamaCppRunningModel } from '../../../../shared/llamacpp';

export const MODEL_INSPECTOR_CONTEXT_MIN = 4 * 1024;
export const MODEL_INSPECTOR_CONTEXT_MAX = 128 * 1024;
const TOKENS_PER_K = 1024;

export function formatModelInspectorContext(value?: number): string | undefined {
  if (!value || !Number.isFinite(value) || value <= 0) return undefined;

  const normalized = value / TOKENS_PER_K;
  const display = Number.isInteger(normalized) ? String(normalized) : normalized.toFixed(1);
  return `${display}K`;
}

export function getModelInspectorContextLimit(model: LlamaCppModel): number {
  const trainedLimit = model.trained_context_length ?? model.details?.context_length;
  if (!trainedLimit || !Number.isFinite(trainedLimit) || trainedLimit <= 0) {
    return MODEL_INSPECTOR_CONTEXT_MAX;
  }

  return Math.min(MODEL_INSPECTOR_CONTEXT_MAX, trainedLimit);
}

export function getModelInspectorContextValue(input: {
  model: LlamaCppModel;
  preference?: LlamaCppModelPreference;
  runningModel?: LlamaCppRunningModel;
}): number {
  const { model, preference, runningModel } = input;
  const candidate =
    preference?.ctxSize ??
    runningModel?.runtime_context_length ??
    runningModel?.context_length ??
    model.effective_options?.ctxSize ??
    model.runtime_context_length ??
    model.trained_context_length ??
    model.details?.context_length;
  const contextLimit = getModelInspectorContextLimit(model);

  if (!candidate || !Number.isFinite(candidate) || candidate <= 0) {
    return Math.min(32 * TOKENS_PER_K, contextLimit);
  }

  return Math.max(MODEL_INSPECTOR_CONTEXT_MIN, Math.min(candidate, contextLimit));
}

export function parseModelInspectorContextK(value: string, contextLimit: number): number | undefined {
  const parsedK = Number(value.trim());
  if (!Number.isFinite(parsedK) || !Number.isInteger(parsedK)) return undefined;

  const contextSize = parsedK * TOKENS_PER_K;
  if (contextSize < MODEL_INSPECTOR_CONTEXT_MIN || contextSize > contextLimit) return undefined;

  return contextSize;
}
