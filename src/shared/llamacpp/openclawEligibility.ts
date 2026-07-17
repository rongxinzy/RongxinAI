export const LLAMACPP_OPENCLAW_MIN_CONTEXT_WINDOW = 32768;

export const LlamaCppOpenClawEligibilityReason = {
  Eligible: 'eligible',
  RuntimeContextUnknown: 'runtime-context-unknown',
  RuntimeContextTooSmall: 'runtime-context-too-small',
  TrainedContextTooSmall: 'trained-context-too-small',
} as const;

export type LlamaCppOpenClawEligibilityReason =
  (typeof LlamaCppOpenClawEligibilityReason)[keyof typeof LlamaCppOpenClawEligibilityReason];

export type LlamaCppOpenClawEligibility = {
  eligible: boolean;
  reason: LlamaCppOpenClawEligibilityReason;
  requiredContextWindow: number;
  runtimeContextWindow?: number;
  trainedContextWindow?: number;
  canIncreaseContextWindow: boolean;
};

function normalizePositiveInteger(value: number | undefined): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined;
}

export function assessLlamaCppOpenClawEligibility(input: {
  runtimeContextWindow?: number;
  trainedContextWindow?: number;
  requiredContextWindow?: number;
}): LlamaCppOpenClawEligibility {
  const requiredContextWindow =
    normalizePositiveInteger(input.requiredContextWindow) ?? LLAMACPP_OPENCLAW_MIN_CONTEXT_WINDOW;
  const runtimeContextWindow = normalizePositiveInteger(input.runtimeContextWindow);
  const trainedContextWindow = normalizePositiveInteger(input.trainedContextWindow);

  if (runtimeContextWindow && runtimeContextWindow >= requiredContextWindow) {
    return {
      eligible: true,
      reason: LlamaCppOpenClawEligibilityReason.Eligible,
      requiredContextWindow,
      runtimeContextWindow,
      trainedContextWindow,
      canIncreaseContextWindow: false,
    };
  }

  if (!runtimeContextWindow) {
    return {
      eligible: false,
      reason: LlamaCppOpenClawEligibilityReason.RuntimeContextUnknown,
      requiredContextWindow,
      trainedContextWindow,
      canIncreaseContextWindow: false,
    };
  }

  if (trainedContextWindow && trainedContextWindow < requiredContextWindow) {
    return {
      eligible: false,
      reason: LlamaCppOpenClawEligibilityReason.TrainedContextTooSmall,
      requiredContextWindow,
      runtimeContextWindow,
      trainedContextWindow,
      canIncreaseContextWindow: false,
    };
  }

  return {
    eligible: false,
    reason: LlamaCppOpenClawEligibilityReason.RuntimeContextTooSmall,
    requiredContextWindow,
    runtimeContextWindow,
    trainedContextWindow,
    canIncreaseContextWindow: true,
  };
}
