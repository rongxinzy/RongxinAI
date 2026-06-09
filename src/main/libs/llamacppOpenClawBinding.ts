import type { ProviderConfig } from '../../shared/providers';
import { ApiFormat, ProviderName } from '../../shared/providers';
import type { LlamaCppRunningModel } from '../../shared/llamacpp';

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

export function buildLlamaCppOpenClawAppConfig(
  current: LlamaCppOpenClawAppConfig,
  modelName: string,
  baseUrl = 'http://127.0.0.1:8080/v1',
): LlamaCppOpenClawAppConfig {
  const trimmedModelName = modelName.trim();
  if (!trimmedModelName) {
    throw new Error('Model name is required');
  }

  const providers = { ...(current.providers ?? {}) };
  const existing =
    providers[ProviderName.LlamaCpp] ??
    migrateLegacyOllamaProvider(providers[ProviderName.Ollama], baseUrl);
  const existingModels = existing.models ?? [];
  const hasModel = existingModels.some(model => model.id === trimmedModelName);
  const models = hasModel
    ? existingModels
    : [...existingModels, { id: trimmedModelName, name: trimmedModelName, supportsImage: false }];

  providers[ProviderName.LlamaCpp] = {
    ...existing,
    enabled: true,
    apiKey: existing.apiKey ?? 'no-key',
    baseUrl: existing.baseUrl?.trim() || baseUrl,
    apiFormat: ApiFormat.OpenAI,
    models,
  };

  return {
    ...current,
    providers,
    model: {
      ...(current.model ?? {}),
      defaultModel: trimmedModelName,
      defaultModelProvider: ProviderName.LlamaCpp,
    },
  };
}

export function migrateLegacyOllamaProvider(
  provider: ProviderConfig | undefined,
  baseUrl = 'http://127.0.0.1:8080/v1',
): ProviderConfig {
  return {
    enabled: provider?.enabled ?? false,
    apiKey: provider?.apiKey?.trim() || 'no-key',
    baseUrl,
    apiFormat: ApiFormat.OpenAI,
    models: provider?.models ?? [],
  };
}

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
