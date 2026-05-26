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
