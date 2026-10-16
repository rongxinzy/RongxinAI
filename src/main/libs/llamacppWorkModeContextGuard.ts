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
