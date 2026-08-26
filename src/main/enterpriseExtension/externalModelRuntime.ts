import { ExternalModelThinkingFormat, type ExternalModel } from '../../shared/externalModels';
import {
  ProviderModelPiThinkingFormat,
  type ProviderModelPiRuntimeConfig,
} from '../../shared/providers';

export function resolveExternalModelRuntime(
  model: ExternalModel,
): ProviderModelPiRuntimeConfig | undefined {
  const compatibility = model.reasoningCompatibility;
  if (!compatibility) return undefined;

  switch (compatibility.thinkingFormat) {
    case ExternalModelThinkingFormat.DeepSeek:
      return Object.freeze({
        reasoning: true,
        compat: Object.freeze({
          thinkingFormat: ProviderModelPiThinkingFormat.DeepSeek,
          supportsReasoningEffort: compatibility.supportsReasoningEffort,
          requiresReasoningContentOnAssistantMessages:
            compatibility.requiresReasoningContentOnAssistantMessages,
        }),
      });
  }
  return undefined;
}
