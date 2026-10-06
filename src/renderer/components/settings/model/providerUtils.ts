import { isProviderEnabled, ProviderName, ProviderRegistry } from '../../../../shared/providers';
import { defaultConfig, isCustomProvider } from '../../../config';
import { i18nService } from '../../../services/i18n';
import { TOKENS_PER_K } from '../tokenFormat';
import {
  NO_USER_KEY_PROVIDERS,
  providerKeys,
  type Model,
  type ProviderConfig,
  type ProvidersConfig,
  type ProviderType,
} from './constants';

export const getCustomProviderLabel = (provider: string): string => {
  const index = Number(provider.replace('custom_', '')) + 1;
  const baseLabel = i18nService.t('customProviderDefaultName');
  return index === 1 || !Number.isFinite(index) ? baseLabel : `${baseLabel} ${index}`;
};

export const resolveModelSupportsImageForProvider = (
  providerName: string,
  model: { id: string; supportsImage?: boolean },
): boolean =>
  ProviderRegistry.resolveModelSupportsImage(providerName, model.id, model.supportsImage);

export const parseTokenK = (value: string): number | undefined => {
  const parsed = Number.parseFloat(value.trim());
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
  return Math.round(parsed * TOKENS_PER_K);
};

export const providerRequiresApiKey = (provider: ProviderType) =>
  !NO_USER_KEY_PROVIDERS.has(provider) && !isCustomProvider(provider);

export const hasProviderAuthConfigured = (
  provider: ProviderType,
  config: ProviderConfig,
): boolean => {
  if (isCustomProvider(provider)) {
    return config.baseUrl.trim().length > 0;
  }
  if (
    provider === ProviderName.Zhiyuan ||
    provider === ProviderName.Ollama ||
    provider === ProviderName.LlamaCpp
  ) {
    return true;
  }

  if (provider === 'minimax') {
    if (config.authType === 'apikey') {
      return config.apiKey.trim().length > 0;
    }
    return (config.oauthAccessToken?.trim().length ?? 0) > 0;
  }

  // OpenAI in OAuth mode stores tokens in <CODEX_HOME>/auth.json (read by the
  // OAuth token store), not in the provider config — `authType === 'oauth'`
  // alone is the signal that ChatGPT login completed.
  if (provider === 'openai' && config.authType === 'oauth') {
    return true;
  }

  return config.apiKey.trim().length > 0;
};

export const normalizeBaseUrl = (baseUrl: string): string =>
  baseUrl.trim().replace(/\/+$/, '').toLowerCase();

export const normalizeApiFormat = (value: unknown): 'anthropic' | 'openai' =>
  value === 'openai' ? 'openai' : 'anthropic';

export async function generateMiniMaxPkce(): Promise<{
  verifier: string;
  challenge: string;
  state: string;
}> {
  const verifierArray = new Uint8Array(32);
  crypto.getRandomValues(verifierArray);
  const verifier = btoa(String.fromCharCode(...verifierArray))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
  const encoded = new TextEncoder().encode(verifier);
  const digest = await crypto.subtle.digest('SHA-256', encoded);
  const challenge = btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
  const stateArray = new Uint8Array(16);
  crypto.getRandomValues(stateArray);
  const state = btoa(String.fromCharCode(...stateArray))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
  return { verifier, challenge, state };
}

export const getFixedApiFormatForProvider = (
  provider: string,
): 'anthropic' | 'openai' | 'gemini' | null => {
  if (provider === 'openai' || provider === 'stepfun') {
    return 'openai';
  }
  if (provider === 'github-copilot' || provider === 'qianfan') {
    return 'openai';
  }
  // Moonshot /anthropic endpoint does not fully implement the Anthropic Messages
  // spec (tool use, streaming, etc.), so the Claude Agent SDK cannot use it.
  // Force OpenAI format — requests go through the built-in compat proxy instead.
  if (provider === 'moonshot') {
    return 'openai';
  }
  if (provider === 'anthropic') {
    return 'anthropic';
  }
  if (provider === 'gemini') {
    return 'gemini';
  }
  return null;
};

export const getEffectiveApiFormat = (
  provider: string,
  value: unknown,
): 'anthropic' | 'openai' | 'gemini' =>
  getFixedApiFormatForProvider(provider) ?? normalizeApiFormat(value);

export const shouldShowApiFormatSelector = (provider: string): boolean =>
  getFixedApiFormatForProvider(provider) === null;

export const getProviderDefaultBaseUrl = (
  provider: ProviderType,
  apiFormat: 'anthropic' | 'openai' | 'gemini',
): string | null => {
  if (apiFormat === 'gemini') return null;
  return ProviderRegistry.getSwitchableBaseUrl(provider, apiFormat) ?? null;
};

export const resolveBaseUrl = (
  provider: ProviderType,
  baseUrl: string,
  apiFormat: 'anthropic' | 'openai' | 'gemini',
): string => {
  if (baseUrl.trim()) {
    if (
      shouldAutoSwitchProviderBaseUrl(provider, baseUrl) &&
      (apiFormat === 'anthropic' || apiFormat === 'openai')
    ) {
      const switchedUrl = ProviderRegistry.getSwitchableBaseUrl(provider, apiFormat);
      if (switchedUrl) return switchedUrl;
    }
    return baseUrl;
  }
  return (
    getProviderDefaultBaseUrl(provider, apiFormat) ||
    defaultConfig.providers?.[provider]?.baseUrl ||
    ''
  );
};

export const shouldAutoSwitchProviderBaseUrl = (
  provider: ProviderType,
  currentBaseUrl: string,
): boolean => {
  const anthropicUrl = ProviderRegistry.getSwitchableBaseUrl(provider, 'anthropic');
  const openaiUrl = ProviderRegistry.getSwitchableBaseUrl(provider, 'openai');
  if (!anthropicUrl && !openaiUrl) {
    return false;
  }

  const normalizedCurrent = normalizeBaseUrl(currentBaseUrl);
  return (
    (anthropicUrl ? normalizedCurrent === normalizeBaseUrl(anthropicUrl) : false) ||
    (openaiUrl ? normalizedCurrent === normalizeBaseUrl(openaiUrl) : false)
  );
};

export const shouldShowProviderModels = (
  providerKey: string,
  providerConfig: ProviderConfig,
): boolean => {
  if (
    providerKey === ProviderName.Zhiyuan ||
    providerKey === ProviderName.Ollama ||
    providerKey === ProviderName.LlamaCpp
  )
    return true;
  if (isCustomProvider(providerKey)) return Boolean(providerConfig.baseUrl?.trim());
  return Boolean(providerConfig.apiKey?.trim());
};

export const getDefaultProviders = (): ProvidersConfig => {
  const providers = (defaultConfig.providers ?? {}) as ProvidersConfig;
  const entries = Object.entries(providers) as Array<[string, ProviderConfig]>;
  const secureSuffix = i18nService.t('modelSuffixSecure');
  return Object.fromEntries(
    entries.map(([providerKey, providerConfig]) => [
      providerKey,
      {
        ...providerConfig,
        models: providerConfig.enabled
          ? providerConfig.models?.map(model => ({
              ...model,
              name: model.name.replace('(Secure)', secureSuffix),
              supportsImage: resolveModelSupportsImageForProvider(providerKey, model),
            }))
          : [],
      },
    ]),
  ) as ProvidersConfig;
};

export const getDefaultActiveProvider = (): ProviderType => {
  const providers = (defaultConfig.providers ?? {}) as ProvidersConfig;
  const visibleProviderKeys = providerKeys;
  const firstEnabledProvider = visibleProviderKeys.find(providerKey =>
    isProviderEnabled(providerKey, providers[providerKey]),
  );
  return firstEnabledProvider ?? visibleProviderKeys[0];
};

export const normalizeProviderModelsForSettings = (
  providerKey: string,
  models: ProviderConfig['models'],
): ProviderConfig['models'] =>
  models?.map((model, idx) => {
    let id = model.id;
    if (providerKey === 'qwen' && (id === 'vision-model' || id === 'coder-model')) {
      const defaultModel = defaultConfig.providers?.qwen?.models?.[idx];
      id = defaultModel?.id || (model.supportsImage ? 'qwen3.5-plus' : 'qwen3-coder-plus');
    }
    return {
      ...model,
      id,
      supportsImage: ProviderRegistry.resolveModelSupportsImage(
        providerKey,
        id,
        model.supportsImage,
      ),
    };
  });

export const normalizeModels = (providerKey: string, models?: Model[]) =>
  models?.map(model => ({
    ...model,
    supportsImage: resolveModelSupportsImageForProvider(providerKey, model),
  }));
