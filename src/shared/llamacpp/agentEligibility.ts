export const LLAMACPP_AGENT_MIN_CONTEXT_WINDOW = 32768;

export const LlamaCppAgentEligibilityReason = {
  Eligible: 'eligible',
  RuntimeContextUnknown: 'runtime-context-unknown',
  RuntimeContextTooSmall: 'runtime-context-too-small',
  TrainedContextTooSmall: 'trained-context-too-small',
} as const;

export type LlamaCppAgentEligibilityReason =
  (typeof LlamaCppAgentEligibilityReason)[keyof typeof LlamaCppAgentEligibilityReason];

export type LlamaCppAgentEligibility = {
  eligible: boolean;
  reason: LlamaCppAgentEligibilityReason;
  requiredContextWindow: number;
  runtimeContextWindow?: number;
  trainedContextWindow?: number;
  canIncreaseContextWindow: boolean;
};

function normalizePositiveInteger(value: number | undefined): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined;
}

export function assessLlamaCppAgentEligibility(input: {
  runtimeContextWindow?: number;
  trainedContextWindow?: number;
  requiredContextWindow?: number;
}): LlamaCppAgentEligibility {
  const requiredContextWindow =
    normalizePositiveInteger(input.requiredContextWindow) ?? LLAMACPP_AGENT_MIN_CONTEXT_WINDOW;
  const runtimeContextWindow = normalizePositiveInteger(input.runtimeContextWindow);
  const trainedContextWindow = normalizePositiveInteger(input.trainedContextWindow);

  if (runtimeContextWindow && runtimeContextWindow >= requiredContextWindow) {
    return {
      eligible: true,
      reason: LlamaCppAgentEligibilityReason.Eligible,
      requiredContextWindow,
      runtimeContextWindow,
      trainedContextWindow,
      canIncreaseContextWindow: false,
    };
  }

  if (!runtimeContextWindow) {
    return {
      eligible: false,
      reason: LlamaCppAgentEligibilityReason.RuntimeContextUnknown,
      requiredContextWindow,
      trainedContextWindow,
      canIncreaseContextWindow: false,
    };
  }

  if (trainedContextWindow && trainedContextWindow < requiredContextWindow) {
    return {
      eligible: false,
      reason: LlamaCppAgentEligibilityReason.TrainedContextTooSmall,
      requiredContextWindow,
      runtimeContextWindow,
      trainedContextWindow,
      canIncreaseContextWindow: false,
    };
  }

  return {
    eligible: false,
    reason: LlamaCppAgentEligibilityReason.RuntimeContextTooSmall,
    requiredContextWindow,
    runtimeContextWindow,
    trainedContextWindow,
    canIncreaseContextWindow: true,
  };
}
