import {
  LlamaCppAgentEligibilityReason,
  type LlamaCppAgentEligibility,
} from '../../shared/llamacpp';
import { t } from '../i18n';

export function assertLlamaCppWorkModeContext(eligibility: LlamaCppAgentEligibility | null): void {
  if (!eligibility) throw new Error(t('coworkLlamaCppModelNotRunning'));
  if (eligibility.eligible) return;

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

export const WORK_MODE_MIN_CONTEXT_WINDOW = 16384;

export function isWorkModeContextTooSmall(contextWindow?: number): contextWindow is number {
  return (
    typeof contextWindow === 'number' &&
    Number.isFinite(contextWindow) &&
    contextWindow > 0 &&
    contextWindow < WORK_MODE_MIN_CONTEXT_WINDOW
  );
}

export function assertWorkModeContextWindow(input: {
  modelId: string;
  contextWindow?: number;
}): void {
  if (isWorkModeContextTooSmall(input.contextWindow)) {
    throw new Error(
      t('coworkWorkContextWindowTooSmall', {
        model: input.modelId,
        current: String(input.contextWindow),
        required: String(WORK_MODE_MIN_CONTEXT_WINDOW),
      }),
    );
  }
}
