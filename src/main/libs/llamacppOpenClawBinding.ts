import type { LlamaCppRunningModel } from '../../shared/llamacpp';
import type { ProviderConfig } from '../../shared/providers';
import { ProviderName } from '../../shared/providers';

const LLAMACPP_MIN_OPENCLAW_MAX_TOKENS = 512;
const LLAMACPP_MAX_OPENCLAW_MAX_TOKENS = 4096;
const LLAMACPP_OUTPUT_TOKEN_RATIO = 0.25;
const LLAMACPP_OPENCLAW_MIN_CTX = 32000;

export type LlamaCppOpenClawAppConfig = {
  model?: {
    defaultModel?: string;
    defaultModelProvider?: string;
  };
  providers?: Record<string, ProviderConfig>;
};

export function removeLlamaCppModelFromAppConfig(
  current: LlamaCppOpenClawAppConfig,
  modelName: string,
): { config: LlamaCppOpenClawAppConfig; clearedDefaultModel: boolean } {
  const trimmedModelName = modelName.trim();
  if (!trimmedModelName) {
    return { config: current, clearedDefaultModel: false };
  }

  const provider = current.providers?.[ProviderName.LlamaCpp];
  const nextProviderModels = (provider?.models ?? []).filter(model => {
    const id = typeof model?.id === 'string' ? model.id.trim() : '';
    const name = typeof model?.name === 'string' ? model.name.trim() : '';
    return id !== trimmedModelName && name !== trimmedModelName;
  });
  const clearedDefaultModel =
    current.model?.defaultModelProvider === ProviderName.LlamaCpp &&
    current.model?.defaultModel?.trim() === trimmedModelName;

  return {
    config: {
      ...current,
      providers: current.providers
        ? {
            ...current.providers,
            [ProviderName.LlamaCpp]: provider
              ? {
                  ...provider,
                  models: nextProviderModels,
                }
              : provider,
          }
        : current.providers,
      model: clearedDefaultModel
        ? {
            ...(current.model ?? {}),
            defaultModel: '',
          }
        : current.model,
    },
    clearedDefaultModel,
  };
}

export function buildLlamaCppRunningModelBinding(
  model: Pick<LlamaCppRunningModel, 'name' | 'model' | 'id' | 'runtime_context_length'>,
): {
  id: string;
  name: string;
  supportsImage: false;
  contextWindow: number;
  contextTokens: number;
  maxTokens: number;
} | null {
  const modelName = model.name?.trim() || model.model?.trim() || model.id?.trim() || '';
  if (!modelName || !model.runtime_context_length || model.runtime_context_length < LLAMACPP_OPENCLAW_MIN_CTX) {
    return null;
  }
  const runtimeContextLength = model.runtime_context_length;
  return {
    id: modelName,
    name: modelName,
    supportsImage: false,
    contextWindow: runtimeContextLength,
    contextTokens: runtimeContextLength,
    maxTokens: deriveLlamaCppOpenClawMaxTokens(runtimeContextLength),
  };
}

export function deriveLlamaCppOpenClawMaxTokens(runtimeContextLength: number): number {
  if (!Number.isFinite(runtimeContextLength) || runtimeContextLength <= 0) {
    return LLAMACPP_MIN_OPENCLAW_MAX_TOKENS;
  }

  return Math.max(
    LLAMACPP_MIN_OPENCLAW_MAX_TOKENS,
    Math.min(
      LLAMACPP_MAX_OPENCLAW_MAX_TOKENS,
      Math.floor(runtimeContextLength * LLAMACPP_OUTPUT_TOKEN_RATIO),
    ),
  );
}
