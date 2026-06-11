export type LlamaCppLaunchContextLimitViolation = {
  requestedContextLength: number;
  trainedContextLength: number;
};

export function getLlamaCppLaunchContextLimitViolation(input: {
  requestedContextLength?: number;
  trainedContextLength?: number;
}): LlamaCppLaunchContextLimitViolation | null {
  const requestedContextLength = normalizePositiveInteger(input.requestedContextLength);
  const trainedContextLength = normalizePositiveInteger(input.trainedContextLength);
  if (!requestedContextLength || !trainedContextLength) return null;
  if (requestedContextLength <= trainedContextLength) return null;
  return {
    requestedContextLength,
    trainedContextLength,
  };
}

function normalizePositiveInteger(value: number | undefined): number | undefined {
  if (value === undefined || !Number.isInteger(value) || value <= 0) return undefined;
  return value;
}

export type LlamaCppModelsMaxLimitViolation = {
  limit: number;
  next: number;
};

export function getLlamaCppModelsMaxLimitViolation(input: {
  modelsMax: string | undefined;
  runningModelNames: string[];
  targetModelName: string;
}): LlamaCppModelsMaxLimitViolation | null {
  const trimmedLimit = input.modelsMax?.trim();
  if (!trimmedLimit || !/^\d+$/.test(trimmedLimit)) return null;
  const limit = Number.parseInt(trimmedLimit, 10);
  if (!Number.isFinite(limit) || limit <= 0) return null;
  const normalizedTarget = input.targetModelName.trim();
  if (normalizedTarget && input.runningModelNames.includes(normalizedTarget)) {
    return null;
  }
  if (input.runningModelNames.length < limit) return null;
  return {
    limit,
    next: input.runningModelNames.length + 1,
  };
}
