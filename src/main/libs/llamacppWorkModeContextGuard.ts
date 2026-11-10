import { ProviderName } from '../../shared/providers';
import { LlamaCppAgentEligibilityReason } from '../../shared/llamacpp';
import { t } from '../i18n';
import {
  getLlamaCppModelAgentEligibility,
  isLlamaCppModelRunning,
} from './llamacppRunningModelRegistry';

export function assertLlamaCppWorkModeContext(input: {
  providerName: string;
  modelId: string;
}): void {
  if (input.providerName !== ProviderName.LlamaCpp) {
    return;
  }

  const normalizedModelId = normalizeLlamaCppModelId(input.modelId);
  if (!normalizedModelId) {
    return;
  }

  if (!isLlamaCppModelRunning(normalizedModelId)) {
    throw new Error(t('coworkLlamaCppModelNotRunning'));
  }

  const eligibility = getLlamaCppModelAgentEligibility(normalizedModelId);
  if (!eligibility || eligibility.eligible) {
    return;
  }

  switch (eligibility.reason) {
    case LlamaCppAgentEligibilityReason.RuntimeContextUnknown:
      throw new Error(t('coworkLlamaCppContextWindowUnknown'));
    case LlamaCppAgentEligibilityReason.RuntimeContextTooSmall:
      throw new Error(
        t('coworkLlamaCppContextWindowTooSmall', {
          current: String(eligibility.runtimeContextWindow ?? '?'),
          required: String(eligibility.requiredContextWindow),
        }),
      );
    case LlamaCppAgentEligibilityReason.TrainedContextTooSmall:
      throw new Error(
        t('coworkLlamaCppTrainingContextTooSmall', {
          trained: String(eligibility.trainedContextWindow ?? '?'),
          required: String(eligibility.requiredContextWindow),
        }),
      );
    case LlamaCppAgentEligibilityReason.Eligible:
    default:
      return;
  }
}

function normalizeLlamaCppModelId(modelId: string): string {
  const trimmed = modelId.trim();
  if (!trimmed) return '';
  const prefix = `${ProviderName.LlamaCpp}/`;
  return trimmed.startsWith(prefix) ? trimmed.slice(prefix.length) : trimmed;
}

export const WORK_MODE_MIN_CONTEXT_WINDOW = 16384;

export function assertWorkModeContextWindow(input: {
  providerName: string;
  modelId: string;
  contextWindow?: number;
}): void {
  if (
    typeof input.contextWindow === 'number' &&
    Number.isFinite(input.contextWindow) &&
    input.contextWindow > 0 &&
    input.contextWindow < WORK_MODE_MIN_CONTEXT_WINDOW
  ) {
    throw new Error(
      `Model "${input.modelId}" context window (${input.contextWindow} tokens) is below the minimum ${WORK_MODE_MIN_CONTEXT_WINDOW} required for Work mode. Work mode requires at least ${WORK_MODE_MIN_CONTEXT_WINDOW} tokens to load system prompts, skills, and tools. Please select a model with at least ${WORK_MODE_MIN_CONTEXT_WINDOW} context tokens or switch to Chat mode.`,
    );
  }
}
