import type { LlamaCppModelPreference } from '../../../../shared/llamacpp';
import type { ModelCapabilities } from '../../../../shared/providers';

type LocalCapabilityModel = {
  id?: string;
  name: string;
  capabilities?: Partial<ModelCapabilities>;
  supportsThinkingToggle?: boolean;
  contextWindow?: number;
  maxTokens?: number;
  runtime_context_length?: number;
  trained_context_length?: number;
  details?: { context_length?: number };
  llamaCppRuntimeContextWindow?: number;
  llamaCppTrainedContextWindow?: number;
};

export function resolveModelCapabilityContextWindow({
  model,
  preference,
  runtimeContextWindow,
}: {
  model: LocalCapabilityModel;
  preference?: LlamaCppModelPreference;
  runtimeContextWindow?: number;
}): number | undefined {
  return (
    preference?.ctxSize ??
    runtimeContextWindow ??
    model.contextWindow ??
    model.llamaCppRuntimeContextWindow ??
    model.runtime_context_length ??
    model.llamaCppTrainedContextWindow ??
    model.trained_context_length ??
    model.details?.context_length
  );
}
