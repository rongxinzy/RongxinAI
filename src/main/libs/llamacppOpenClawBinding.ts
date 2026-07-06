import type { LlamaCppRunningModel } from '../../shared/llamacpp';
import type { ProviderConfig } from '../../shared/providers';
import { ApiFormat, ProviderName, ProviderRegistry } from '../../shared/providers';

const LLAMACPP_MIN_OPENCLAW_MAX_TOKENS = 512;
const LLAMACPP_MAX_OPENCLAW_MAX_TOKENS = 4096;
const LLAMACPP_OUTPUT_TOKEN_RATIO = 0.25;

export type LlamaCppOpenClawAppConfig = {
  model?: {
    defaultModel?: string;
    defaultModelProvider?: string;
  };
  providers?: Record<string, ProviderConfig>;
};

function serializeLlamaCppProviderConfig(provider?: ProviderConfig): string {
  if (!provider) {
    return '';
  }

  return JSON.stringify({
    enabled: provider.enabled,
    userEnabled: provider.userEnabled,
    apiKey: provider.apiKey,
    baseUrl: provider.baseUrl,
    apiFormat: provider.apiFormat,
    models: normalizeLlamaCppProviderModels(provider.models ?? []),
  });
}

function normalizeLlamaCppProviderModels(
  models: NonNullable<ProviderConfig['models']>,
): NonNullable<ProviderConfig['models']> {
  return models
    .map(model => ({ ...model }))
    .sort((modelA, modelB) => {
      const keyA = `${modelA.id.trim()}::${modelA.name.trim()}`;
      const keyB = `${modelB.id.trim()}::${modelB.name.trim()}`;
      return keyA.localeCompare(keyB);
    });
}

function buildManagedLlamaCppProviderConfig(
  currentProvider: ProviderConfig | undefined,
  models: NonNullable<ProviderConfig['models']>,
): ProviderConfig {
  const providerDef = ProviderRegistry.get(ProviderName.LlamaCpp);
  const userEnabled = currentProvider?.userEnabled === true;

  return {
    ...currentProvider,
    enabled: userEnabled,
    userEnabled,
    apiKey: currentProvider?.apiKey ?? '',
    baseUrl: providerDef?.defaultBaseUrl ?? 'http://127.0.0.1:8080/v1',
    apiFormat: ApiFormat.OpenAI,
    models: normalizeLlamaCppProviderModels(models),
  };
}

export function upsertLlamaCppProviderInAppConfig(
  current: LlamaCppOpenClawAppConfig,
  models: NonNullable<ProviderConfig['models']>,
): { config: LlamaCppOpenClawAppConfig; changed: boolean; clearedDefaultModel: boolean } {
  const currentProvider = current.providers?.[ProviderName.LlamaCpp];
  const nextProvider = buildManagedLlamaCppProviderConfig(currentProvider, models);
  const availableModelIds = new Set(
    (nextProvider.models ?? [])
      .map(model => model.id.trim())
      .filter(Boolean),
  );
  const clearedDefaultModel =
    current.model?.defaultModelProvider === ProviderName.LlamaCpp
    && (!current.model.defaultModel?.trim()
      || !availableModelIds.has(current.model.defaultModel.trim()));
  const changed =
    serializeLlamaCppProviderConfig(currentProvider) !== serializeLlamaCppProviderConfig(nextProvider)
    || clearedDefaultModel;

  if (!changed) {
    return {
      config: current,
      changed: false,
      clearedDefaultModel: false,
    };
  }

  return {
    config: {
      ...current,
      providers: {
        ...(current.providers ?? {}),
        [ProviderName.LlamaCpp]: nextProvider,
      },
      model: clearedDefaultModel
        ? {
            ...(current.model ?? {}),
            defaultModel: '',
          }
        : current.model,
    },
    changed: true,
    clearedDefaultModel,
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
  const next = upsertLlamaCppProviderInAppConfig(current, nextProviderModels);

  return {
    config: next.config,
    clearedDefaultModel: next.clearedDefaultModel,
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
  if (!modelName || !model.runtime_context_length) {
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
