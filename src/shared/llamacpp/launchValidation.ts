export type LlamaCppLaunchContextResolution = {
  effectiveContextLength?: number;
  requestedContextLength?: number;
  trainedContextLength?: number;
  clamped: boolean;
};

export function resolveLlamaCppLaunchContext(input: {
  requestedContextLength?: number;
  trainedContextLength?: number;
}): LlamaCppLaunchContextResolution {
  const requestedContextLength = normalizePositiveInteger(input.requestedContextLength);
  const trainedContextLength = normalizePositiveInteger(input.trainedContextLength);
  const clamped = Boolean(
    requestedContextLength
      && trainedContextLength
      && requestedContextLength > trainedContextLength,
  );
  return {
    effectiveContextLength: clamped ? trainedContextLength : requestedContextLength,
    requestedContextLength,
    trainedContextLength,
    clamped,
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
