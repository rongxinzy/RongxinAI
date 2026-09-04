import {
  type ApiFormat,
  isProviderEnabled,
  type ModelCapabilities,
  normalizeProviderModelPiRuntimeConfig,
  type ProviderConfig,
  type ProviderModelPiRuntimeConfig,
  ProviderName,
  ProviderRegistry,
  parseOllamaRuntimeCapabilities,
  resolveModelEndpoint,
  type ResolvedModelEndpoint,
  type RuntimeModelSnapshot,
  resolveCodingPlanBaseUrl,
} from '../../shared/providers';
import type { SqliteStore } from '../sqliteStore';
import type { CoworkApiConfig } from './coworkConfigStore';
import { type AnthropicApiFormat, normalizeProviderApiFormat } from './coworkFormatTransform';
import {
  configureCoworkOpenAICompatProxy,
  getCoworkOpenAICompatProxyBaseURL,
  getCoworkOpenAICompatProxyStatus,
  getCoworkOpenAICompatProxyToken,
  type OpenAICompatProxyTarget,
} from './coworkOpenAICompatProxy';
import type { LlamaCppAgentEligibility } from './llamacppAgentBinding';
import { readOpenAICodexAuthFile } from './openaiCodexAuth';

type LocalProviderConfig = Omit<ProviderConfig, 'apiFormat'> & { apiFormat?: ApiFormat | 'native' };

const gwDiagTs = (): string => {
  const d = new Date();
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  const tz = d.getTimezoneOffset();
  const sign = tz <= 0 ? '+' : '-';
  const abs = Math.abs(tz);
  return `[GW-RESTART-DIAG] ${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}${sign}${p(Math.floor(abs / 60))}:${p(abs % 60)}`;
};

type AppConfig = {
  model?: {
    defaultModel?: string;
    defaultModelProvider?: string;
  };
  providers?: Record<string, LocalProviderConfig>;
};

type ProviderModelConfig = {
  id: string;
  name: string;
  supportsImage?: boolean;
  contextWindow?: number;
  contextTokens?: number;
  maxTokens?: number;
  capabilities?: Partial<ModelCapabilities>;
  piRuntime?: ProviderModelPiRuntimeConfig;
  agentEligibility?: LlamaCppAgentEligibility;
};

type ProviderModelInputConfig = {
  id: string;
  name?: string;
  supportsImage?: boolean;
  contextWindow?: number;
  contextTokens?: number;
  maxTokens?: number;
  capabilities?: Partial<ModelCapabilities>;
  piRuntime?: ProviderModelPiRuntimeConfig;
  agentEligibility?: LlamaCppAgentEligibility;
};

export type ApiConfigResolution = {
  config: CoworkApiConfig | null;
  error?: string;
  endpoint?: ResolvedModelEndpoint;
  providerMetadata?: {
    providerName: string;
    authType?: ProviderConfig['authType'];
    codingPlanEnabled: boolean;
    supportsImage?: boolean;
    modelName?: string;
    contextWindow?: number;
    contextTokens?: number;
    maxTokens?: number;
    capabilities?: Partial<ModelCapabilities>;
    piRuntime?: ProviderModelPiRuntimeConfig;
  };
};

// Store getter function injected from main.ts
let storeGetter: (() => SqliteStore | null) | null = null;

export function setStoreGetter(getter: () => SqliteStore | null): void {
  storeGetter = getter;
}

let llamaCppRunningModelCache: ProviderModelConfig[] = [];
type OllamaRuntimeModelState = {
  runtimeModelId: string;
  status: RuntimeModelSnapshot['status'];
  runtimeContextWindow?: number;
  detectedCapabilities?: Partial<ModelCapabilities>;
};
let ollamaRuntimeModelCache = new Map<string, OllamaRuntimeModelState>();

function serializeLlamaCppRunningModels(models: ProviderModelConfig[]): string {
  return JSON.stringify(
    models
      .map(model => ({
        id: model.id,
        name: model.name,
        supportsImage: model.supportsImage,
        contextWindow: model.contextWindow,
        contextTokens: model.contextTokens,
        maxTokens: model.maxTokens,
        capabilities: model.capabilities,
        agentEligibility: model.agentEligibility,
      }))
      .sort((a, b) => a.id.localeCompare(b.id)),
  );
}

export function updateLlamaCppRunningModels(models: ProviderModelInputConfig[]): boolean {
  const normalized = normalizeProviderModels(ProviderName.LlamaCpp, models);
  const previous = serializeLlamaCppRunningModels(llamaCppRunningModelCache);
  const next = serializeLlamaCppRunningModels(normalized);
  llamaCppRunningModelCache = normalized;
  return previous !== next;
}

export function getLlamaCppRunningModels(): ProviderModelConfig[] {
  return llamaCppRunningModelCache.map(model => ({
    ...model,
    capabilities: model.capabilities ? { ...model.capabilities } : undefined,
    agentEligibility: model.agentEligibility ? { ...model.agentEligibility } : undefined,
  }));
}

export function updateOllamaRuntimeModels(
  models: Array<{
    name?: string;
    model?: string;
    context_length?: number;
  }>,
): void {
  const next = new Map<string, OllamaRuntimeModelState>();
  models.forEach(model => {
    const modelId = (model.name || model.model || '').trim();
    if (!modelId) return;
    next.set(modelId.toLowerCase(), {
      runtimeModelId: modelId,
      status: 'loaded',
      ...(model.context_length && model.context_length > 0
        ? { runtimeContextWindow: model.context_length }
        : {}),
      ...(ollamaRuntimeModelCache.get(modelId.toLowerCase())?.detectedCapabilities
        ? { detectedCapabilities: ollamaRuntimeModelCache.get(modelId.toLowerCase())?.detectedCapabilities }
        : {}),
    });
  });
  ollamaRuntimeModelCache.forEach((state, key) => {
    if (!next.has(key)) next.set(key, { ...state, status: 'stopped' });
  });
  ollamaRuntimeModelCache = next;
}

export function updateOllamaRuntimeModelCapabilities(
  modelId: string,
  payload: unknown,
): void {
  const normalizedId = modelId.trim().toLowerCase();
  if (!normalizedId) return;
  const previous = ollamaRuntimeModelCache.get(normalizedId);
  ollamaRuntimeModelCache.set(normalizedId, {
    runtimeModelId: previous?.runtimeModelId ?? modelId.trim(),
    status: previous?.status ?? 'unknown',
    ...(previous?.runtimeContextWindow
      ? { runtimeContextWindow: previous.runtimeContextWindow }
      : {}),
    detectedCapabilities: parseOllamaRuntimeCapabilities(payload),
  });
}

export function clearOllamaRuntimeModels(): void {
  ollamaRuntimeModelCache.clear();
}

function findLlamaCppRunningModel(modelId: string): ProviderModelConfig | undefined {
  const normalized = modelId.trim();
  if (!normalized) return undefined;
  return llamaCppRunningModelCache.find(model => model.id === normalized);
}

export function isLlamaCppModelRunning(modelId: string): boolean {
  return Boolean(findLlamaCppRunningModel(modelId));
}

export function getLlamaCppModelContextWindow(modelId: string): number | undefined {
  return findLlamaCppRunningModel(modelId)?.contextWindow;
}

export function getLlamaCppModelAgentEligibility(
  modelId: string,
): LlamaCppAgentEligibility | undefined {
  const eligibility = findLlamaCppRunningModel(modelId)?.agentEligibility;
  return eligibility ? { ...eligibility } : undefined;
}


function normalizeProviderModels(
  providerName: string,
  models?: readonly ProviderModelInputConfig[],
  apiFormat: ApiFormat = ProviderRegistry.get(providerName)?.defaultApiFormat ?? 'anthropic',
): ProviderModelConfig[] {
  return (models ?? [])
    .filter(model => model.id?.trim())
    .map(model => {
      const registeredModel = ProviderRegistry.getModel(providerName, model.id);
      const supportsImage = model.supportsImage ?? registeredModel?.supportsImage;
      const capabilities =
        registeredModel || model.capabilities
          ? ProviderRegistry.resolveModelCapabilities(providerName, model.id, apiFormat, {
              ...model,
              ...(supportsImage === undefined ? {} : { supportsImage }),
            })
          : undefined;
      return {
        ...model,
        id: registeredModel?.id ?? model.id,
        name: model.name || model.id,
        supportsImage,
        capabilities,
        contextWindow:
          typeof model.contextWindow === 'number' && model.contextWindow > 0
            ? model.contextWindow
            : registeredModel?.contextWindow,
        contextTokens:
          typeof model.contextTokens === 'number' && model.contextTokens > 0
            ? model.contextTokens
            : undefined,
        maxTokens:
          typeof model.maxTokens === 'number' && model.maxTokens > 0
            ? model.maxTokens
            : registeredModel?.maxTokens,
        piRuntime: normalizeProviderModelPiRuntimeConfig(model.piRuntime),
        agentEligibility: model.agentEligibility
          ? { ...model.agentEligibility }
          : undefined,
      };
    });
}

const getStore = (): SqliteStore | null => {
  if (!storeGetter) {
    return null;
  }
  return storeGetter();
};

type MatchedProvider = {
  providerName: string;
  providerConfig: LocalProviderConfig;
  modelId: string;
  apiFormat: AnthropicApiFormat;
  baseURL: string;
  supportsImage?: boolean;
  modelName?: string;
  contextWindow?: number;
  contextTokens?: number;
  maxTokens?: number;
  capabilities?: Partial<ModelCapabilities>;
  piRuntime?: ProviderModelPiRuntimeConfig;
  userModelConfig?: ProviderModelConfig;
  agentEligibility?: LlamaCppAgentEligibility;
};

function getMatchedRuntimeSnapshot(matched: MatchedProvider): RuntimeModelSnapshot | undefined {
  if (matched.providerName === ProviderName.Ollama) {
    const runtime = ollamaRuntimeModelCache.get(matched.modelId.trim().toLowerCase());
    if (!runtime) return undefined;
    return {
      kind: 'ollama',
      status: runtime.status,
      runtimeModelId: runtime.runtimeModelId,
      ...(runtime.runtimeContextWindow
        ? { runtimeContextWindow: runtime.runtimeContextWindow }
        : {}),
      ...(runtime.detectedCapabilities
        ? { detectedCapabilities: runtime.detectedCapabilities }
        : {}),
    };
  }
  if (matched.providerName !== ProviderName.LlamaCpp) return undefined;
  const trainedContextWindow =
    matched.userModelConfig?.agentEligibility?.trainedContextWindow ??
    matched.agentEligibility?.trainedContextWindow;
  const detectedCapabilities = matched.capabilities;
  return {
    kind: 'llamacpp',
    status: isLlamaCppModelRunning(matched.modelId) ? 'loaded' : 'unknown',
    ...(matched.contextWindow ? { runtimeContextWindow: matched.contextWindow } : {}),
    ...(trainedContextWindow ? { trainedContextWindow } : {}),
    ...(detectedCapabilities ? { detectedCapabilities } : {}),
    runtimeModelId: matched.modelId,
  };
}

function getEffectiveProviderApiFormat(
  providerName: string,
  apiFormat: unknown,
): AnthropicApiFormat {
  if (
    providerName === ProviderName.OpenAI ||
    providerName === ProviderName.Gemini ||
    providerName === ProviderName.StepFun ||
    providerName === ProviderName.Copilot
  ) {
    return 'openai';
  }
  if (providerName === ProviderName.Anthropic) {
    return 'anthropic';
  }
  return normalizeProviderApiFormat(apiFormat);
}

function providerRequiresApiKey(providerName: string): boolean {
  return (
    providerName !== ProviderName.Zhiyuan &&
    providerName !== ProviderName.Ollama &&
    providerName !== ProviderName.LlamaCpp
  );
}

function resolveEffectiveApiKey(providerName: string, apiKey: string): string {
  if (apiKey) return apiKey;
  if (providerName === ProviderName.Zhiyuan) return 'sk-zhiyuan-managed';
  return providerRequiresApiKey(providerName) ? '' : 'sk-zhiyuan-local';
}

function getEffectiveProviderModels(
  providerName: string,
  providerConfig: LocalProviderConfig,
): ProviderModelConfig[] {
  if (providerName === ProviderName.LlamaCpp) {
    return getLlamaCppRunningModels();
  }
  const providerDefinition = ProviderRegistry.get(providerName);
  const configuredModels =
    providerConfig.codingPlanEnabled && providerDefinition?.codingPlanModels
      ? providerDefinition.codingPlanModels
      : providerConfig.models;
  const configuredApiFormat = getEffectiveProviderApiFormat(providerName, providerConfig.apiFormat);
  const effectiveApiFormat = providerConfig.codingPlanEnabled
    ? resolveCodingPlanBaseUrl(
        providerName,
        true,
        configuredApiFormat,
        providerConfig.baseUrl ?? '',
      ).effectiveFormat
    : configuredApiFormat;
  return normalizeProviderModels(providerName, configuredModels, effectiveApiFormat);
}

function getAgentEligibleProviderModels(
  providerName: string,
  providerConfig: LocalProviderConfig,
): ProviderModelConfig[] {
  const models = getEffectiveProviderModels(providerName, providerConfig);
  if (providerName !== ProviderName.LlamaCpp) {
    return models;
  }
  return models.filter(model => model.agentEligibility?.eligible === true);
}

function shouldUseOpenAICodexOAuth(
  providerName: string,
  providerConfig: LocalProviderConfig,
): boolean {
  if (providerName !== ProviderName.OpenAI) {
    return false;
  }
  if (providerConfig.authType === 'oauth') {
    return true;
  }
  if (providerConfig.apiKey?.trim()) {
    return false;
  }
  return readOpenAICodexAuthFile() !== null;
}

function buildLlamaCppRunningProviderConfig(
  appConfig: AppConfig,
  modelId: string,
): LocalProviderConfig | null {
  if (!findLlamaCppRunningModel(modelId)) {
    return null;
  }

  const storedProviderConfig = appConfig.providers?.[ProviderName.LlamaCpp];
  const providerDefinition = ProviderRegistry.get(ProviderName.LlamaCpp);

  return {
    ...(storedProviderConfig ?? {}),
    enabled: true,
    userEnabled: true,
    apiKey: storedProviderConfig?.apiKey ?? '',
    baseUrl:
      storedProviderConfig?.baseUrl?.trim() || providerDefinition?.defaultBaseUrl || '',
    apiFormat:
      storedProviderConfig?.apiFormat === 'native'
        ? providerDefinition?.defaultApiFormat ?? 'openai'
        : storedProviderConfig?.apiFormat ?? providerDefinition?.defaultApiFormat ?? 'openai',
    models: storedProviderConfig?.models ?? [],
    codingPlanEnabled: false,
  };
}

function resolveMatchedProviderFromSelection(
  providerName: string,
  storedProviderConfig: LocalProviderConfig,
  modelId: string,
): { matched: MatchedProvider | null; error?: string } {
  const providerConfig = shouldUseOpenAICodexOAuth(providerName, storedProviderConfig)
    ? { ...storedProviderConfig, authType: 'oauth' as const }
    : storedProviderConfig;
  const normalizedProviderModels = getEffectiveProviderModels(providerName, providerConfig);

  // MiniMax OAuth mode guard: if OAuth is selected but login has not been completed
  // (no access token), do not use the stale API key as an OAuth token.
  if (
    providerName === ProviderName.Minimax &&
    (providerConfig as any).authType === 'oauth' &&
    !(providerConfig as any).oauthAccessToken
  ) {
    return { matched: null, error: 'MiniMax OAuth mode selected but login not completed.' };
  }

  let apiFormat = getEffectiveProviderApiFormat(providerName, providerConfig.apiFormat);
  let baseURL = providerConfig.baseUrl?.trim();

  if (providerConfig.codingPlanEnabled) {
    const resolved = resolveCodingPlanBaseUrl(providerName, true, apiFormat, baseURL ?? '');
    baseURL = resolved.baseUrl;
    apiFormat = resolved.effectiveFormat;
  }

  if (!baseURL) {
    return { matched: null, error: `Provider ${providerName} is missing base URL.` };
  }

  const hasApiKey = providerConfig.apiKey?.trim();
  const hasOAuthCreds =
    (providerName === ProviderName.Minimax &&
      (providerConfig as any).authType === 'oauth' &&
      !!(providerConfig as any).oauthAccessToken?.trim()) ||
    shouldUseOpenAICodexOAuth(providerName, providerConfig);
  if (
    apiFormat === 'anthropic' &&
    providerRequiresApiKey(providerName) &&
    !providerConfig.apiKey?.trim() &&
    !hasApiKey &&
    !hasOAuthCreds
  ) {
    return {
      matched: null,
      error: `Provider ${providerName} requires API key for Anthropic-compatible mode.`,
    };
  }

  const matchedModel = normalizedProviderModels.find(
    model => model.id.toLowerCase() === modelId.toLowerCase(),
  );
  if (!matchedModel) {
    return { matched: null, error: `No enabled provider found for model: ${modelId}` };
  }

  return {
    matched: {
      providerName,
      providerConfig: {
        ...providerConfig,
        models: normalizedProviderModels,
      },
      modelId,
      apiFormat,
      baseURL,
      supportsImage: ProviderRegistry.resolveModelSupportsImage(
        providerName,
        matchedModel.id,
        matchedModel.supportsImage,
      ),
      modelName: matchedModel.name,
      contextWindow: matchedModel.contextWindow,
      contextTokens: matchedModel.contextTokens,
      maxTokens: matchedModel.maxTokens,
      capabilities: matchedModel.capabilities,
      piRuntime: matchedModel.piRuntime,
      userModelConfig: storedProviderConfig.models?.find(
        model => model.id.toLowerCase() === modelId.toLowerCase(),
      ),
      agentEligibility: matchedModel.agentEligibility,
    },
  };
}

function resolveMatchedProviderForModelRef(
  appConfig: AppConfig,
  modelRef: string,
): { matched: MatchedProvider | null; error?: string } {
  const normalizedRef = modelRef.trim();
  if (!normalizedRef) {
    return { matched: null, error: 'Model ref is empty.' };
  }
  const slashIndex = normalizedRef.indexOf('/');
  if (slashIndex <= 0 || slashIndex === normalizedRef.length - 1) {
    return { matched: null, error: `Invalid model ref: ${normalizedRef}` };
  }

  const requestedProviderName = normalizedRef.slice(0, slashIndex);
  const modelId = normalizedRef.slice(slashIndex + 1).trim();
  if (!modelId) {
    return { matched: null, error: `Invalid model ref: ${normalizedRef}` };
  }

  const configuredProviderName = appConfig.providers?.[requestedProviderName]
    ? requestedProviderName
    : (ProviderRegistry.getProviderNameByAgentProviderId(requestedProviderName) ??
      requestedProviderName);

  if (configuredProviderName === ProviderName.LlamaCpp) {
    const runningProviderConfig = buildLlamaCppRunningProviderConfig(appConfig, modelId);
    if (runningProviderConfig) {
      return resolveMatchedProviderFromSelection(
        configuredProviderName,
        runningProviderConfig,
        modelId,
      );
    }
  }

  const storedProviderConfig = appConfig.providers?.[configuredProviderName];
  if (!storedProviderConfig || !isProviderEnabled(configuredProviderName, storedProviderConfig)) {
    return { matched: null, error: `Provider ${requestedProviderName} is not enabled.` };
  }

  return resolveMatchedProviderFromSelection(
    configuredProviderName,
    storedProviderConfig,
    modelId,
  );
}

function buildRawApiResolutionFromMatched(matched: MatchedProvider): ApiConfigResolution {
  let apiKey = matched.providerConfig.apiKey?.trim() || '';
  let effectiveBaseURL = matched.baseURL;
  let effectiveApiFormat = matched.apiFormat;

  // Handle MiniMax OAuth: use oauthAccessToken and oauthBaseUrl (independent of apiKey)
  if (
    matched.providerName === ProviderName.Minimax &&
    (matched.providerConfig as any).authType === 'oauth'
  ) {
    const oauthToken = (matched.providerConfig as any).oauthAccessToken?.trim();
    const oauthBaseUrl = (matched.providerConfig as any).oauthBaseUrl?.trim();
    if (oauthToken) {
      apiKey = oauthToken;
      if (oauthBaseUrl) effectiveBaseURL = oauthBaseUrl;
      effectiveApiFormat = 'anthropic';
    }
  }

  console.log(
    '[ClaudeSettings] resolved raw API config:',
    JSON.stringify({
      ...matched,
      providerConfig: { ...matched.providerConfig, apiKey: apiKey ? '***' : '' },
    }),
  );
  const effectiveApiKey = resolveEffectiveApiKey(matched.providerName, apiKey);
  const endpoint = resolveModelEndpoint(matched.providerName, matched.modelId, {
    providerConfig: matched.providerConfig,
    modelConfig: matched.userModelConfig,
    apiKey: effectiveApiKey,
    baseUrl: effectiveBaseURL,
    apiFormat: effectiveApiFormat,
    runtime: getMatchedRuntimeSnapshot(matched),
  });
  return {
    endpoint,
    config: {
      apiKey: effectiveApiKey,
      baseURL: effectiveBaseURL,
      model: matched.modelId,
      apiType: effectiveApiFormat === 'anthropic' ? 'anthropic' : 'openai',
    },
    providerMetadata: {
      providerName: matched.providerName,
      authType: matched.providerConfig.authType,
      codingPlanEnabled: !!matched.providerConfig.codingPlanEnabled,
      supportsImage: matched.supportsImage,
      modelName: matched.modelName,
      contextWindow: matched.contextWindow,
      contextTokens: matched.contextTokens,
      maxTokens: matched.maxTokens,
      ...(matched.capabilities ? { capabilities: matched.capabilities } : {}),
      ...(matched.piRuntime ? { piRuntime: matched.piRuntime } : {}),
    },
  };
}

function resolveMatchedProvider(appConfig: AppConfig): {
  matched: MatchedProvider | null;
  error?: string;
} {
  const providers = appConfig.providers ?? {};

  const resolveFallbackModel = (): {
    providerName: string;
    providerConfig: LocalProviderConfig;
    modelId: string;
  } | null => {
    for (const [providerName, providerConfig] of Object.entries(providers)) {
      const models = getAgentEligibleProviderModels(providerName, providerConfig);
      if (!isProviderEnabled(providerName, providerConfig) || models.length === 0) {
        continue;
      }
      const fallbackModel = models.find(model => model.id?.trim());
      if (!fallbackModel) {
        continue;
      }
      return {
        providerName,
        providerConfig,
        modelId: fallbackModel.id.trim(),
      };
    }
    return null;
  };

  const configuredModelId = appConfig.model?.defaultModel?.trim();
  let modelId = configuredModelId || '';
  if (!modelId) {
    const fallback = resolveFallbackModel();
    if (!fallback) {
      return { matched: null, error: 'No available model configured in enabled providers.' };
    }
    modelId = fallback.modelId;
  }

  let providerEntry: [string, LocalProviderConfig] | undefined;
  const preferredProviderName = appConfig.model?.defaultModelProvider?.trim();

  if (preferredProviderName === ProviderName.LlamaCpp) {
    const runningProviderConfig = buildLlamaCppRunningProviderConfig(appConfig, modelId);
    if (runningProviderConfig) {
      return resolveMatchedProviderFromSelection(preferredProviderName, runningProviderConfig, modelId);
    }
  }

  if (preferredProviderName) {
    const preferredProvider = providers[preferredProviderName];
    const preferredModels = preferredProvider
      ? getEffectiveProviderModels(preferredProviderName, preferredProvider)
      : [];
    if (
      isProviderEnabled(preferredProviderName, preferredProvider) &&
      preferredModels.some(model => model.id === modelId)
    ) {
      providerEntry = [preferredProviderName, preferredProvider];
    }
  }

  if (!providerEntry) {
    providerEntry = Object.entries(providers).find(([providerName, provider]) => {
      const models = getEffectiveProviderModels(providerName, provider);
      if (!isProviderEnabled(providerName, provider) || models.length === 0) {
        return false;
      }
      return models.some(model => model.id === modelId);
    });
  }

  if (!providerEntry) {
    const fallback = resolveFallbackModel();
    if (fallback) {
      modelId = fallback.modelId;
      providerEntry = [fallback.providerName, fallback.providerConfig];
    } else {
      return { matched: null, error: `No enabled provider found for model: ${modelId}` };
    }
  }

  const [providerName, storedProviderConfig] = providerEntry;
  return resolveMatchedProviderFromSelection(providerName, storedProviderConfig, modelId);
}

export function resolveCurrentApiConfig(
  target: OpenAICompatProxyTarget = 'local',
): ApiConfigResolution {
  const sqliteStore = getStore();
  if (!sqliteStore) {
    return {
      config: null,
      error: 'Store is not initialized.',
    };
  }

  const appConfig = sqliteStore.get<AppConfig>('app_config');
  if (!appConfig) {
    return {
      config: null,
      error: 'Application config not found.',
    };
  }

  const { matched, error } = resolveMatchedProvider(appConfig);
  if (!matched) {
    return {
      config: null,
      error,
    };
  }

  const resolvedBaseURL = matched.baseURL;
  let resolvedApiKey = matched.providerConfig.apiKey?.trim() || '';

  // Providers that don't require auth (e.g. Ollama) still need a non-empty
  // placeholder so downstream components such as the compatibility proxy
  // don't reject the request with "No API key found for provider".
  const effectiveApiKey = resolveEffectiveApiKey(matched.providerName, resolvedApiKey);

  if (matched.apiFormat === 'anthropic') {
    const endpoint = resolveModelEndpoint(matched.providerName, matched.modelId, {
      providerConfig: matched.providerConfig,
      modelConfig: matched.userModelConfig,
      apiKey: effectiveApiKey,
      baseUrl: resolvedBaseURL,
      apiFormat: matched.apiFormat,
      runtime: getMatchedRuntimeSnapshot(matched),
    });
    return {
      endpoint,
      config: {
        apiKey: effectiveApiKey,
        baseURL: resolvedBaseURL,
        model: matched.modelId,
        apiType: 'anthropic',
      },
      providerMetadata: {
        providerName: matched.providerName,
        codingPlanEnabled: !!matched.providerConfig.codingPlanEnabled,
        supportsImage: matched.supportsImage,
        modelName: matched.modelName,
        contextWindow: matched.contextWindow,
        contextTokens: matched.contextTokens,
        maxTokens: matched.maxTokens,
        ...(matched.capabilities ? { capabilities: matched.capabilities } : {}),
        ...(matched.piRuntime ? { piRuntime: matched.piRuntime } : {}),
      },
    };
  }

  const proxyStatus = getCoworkOpenAICompatProxyStatus();
  if (!proxyStatus.running) {
    return {
      config: null,
      error: 'OpenAI compatibility proxy is not running.',
    };
  }

  configureCoworkOpenAICompatProxy({
    baseURL: resolvedBaseURL,
    apiKey: resolvedApiKey || undefined,
    model: matched.modelId,
    provider: matched.providerName,
  });

  const proxyBaseURL = getCoworkOpenAICompatProxyBaseURL(target);
  if (!proxyBaseURL) {
    return {
      config: null,
      error: 'OpenAI compatibility proxy base URL is unavailable.',
    };
  }

  const proxyToken = getCoworkOpenAICompatProxyToken();
  if (!proxyToken) {
    return {
      config: null,
      error: 'OpenAI compatibility proxy token is unavailable.',
    };
  }

  return {
    endpoint: resolveModelEndpoint(matched.providerName, matched.modelId, {
      providerConfig: matched.providerConfig,
      modelConfig: matched.userModelConfig,
      apiKey: effectiveApiKey,
      baseUrl: resolvedBaseURL,
      apiFormat: matched.apiFormat,
      runtime: getMatchedRuntimeSnapshot(matched),
    }),
    config: {
      apiKey: proxyToken,
      baseURL: proxyBaseURL,
      model: matched.modelId,
      apiType: 'openai',
    },
    providerMetadata: {
      providerName: matched.providerName,
      codingPlanEnabled: !!matched.providerConfig.codingPlanEnabled,
      supportsImage: matched.supportsImage,
      modelName: matched.modelName,
      contextWindow: matched.contextWindow,
      contextTokens: matched.contextTokens,
      maxTokens: matched.maxTokens,
      ...(matched.capabilities ? { capabilities: matched.capabilities } : {}),
      ...(matched.piRuntime ? { piRuntime: matched.piRuntime } : {}),
    },
  };
}

export function getCurrentApiConfig(
  target: OpenAICompatProxyTarget = 'local',
): CoworkApiConfig | null {
  return resolveCurrentApiConfig(target).config;
}

/**
 * Resolve the raw API config directly from the app config,
 * without requiring the OpenAI compatibility proxy.
 * Used by Pi model routing without requiring the compatibility proxy.
 */
export function resolveRawApiConfig(): ApiConfigResolution {
  const sqliteStore = getStore();
  if (!sqliteStore) {
    console.debug('[ClaudeSettings] resolveRawApiConfig: store is null, storeGetter not set yet');
    return { config: null, error: 'Store is not initialized.' };
  }
  const appConfig = sqliteStore.get<AppConfig>('app_config');
  if (!appConfig) {
    console.debug('[ClaudeSettings] resolveRawApiConfig: app_config not found in store');
    return { config: null, error: 'Application config not found.' };
  }
  const { matched, error } = resolveMatchedProvider(appConfig);
  if (!matched) {
    const providerKeys = Object.keys(appConfig.providers ?? {});
    const defaultModel = appConfig.model?.defaultModel;
    const defaultProvider = appConfig.model?.defaultModelProvider;
    console.debug(
      `[ClaudeSettings] resolveRawApiConfig: no matched provider, error=${error}, providers=[${providerKeys.join(',')}], defaultModel=${defaultModel}, defaultProvider=${defaultProvider}`,
    );
    return { config: null, error };
  }
  let apiKey = matched.providerConfig.apiKey?.trim() || '';
  let effectiveBaseURL = matched.baseURL;
  let effectiveApiFormat = matched.apiFormat;

  // Handle MiniMax OAuth: use oauthAccessToken and oauthBaseUrl (independent of apiKey)
  if (
    matched.providerName === ProviderName.Minimax &&
    (matched.providerConfig as any).authType === 'oauth'
  ) {
    const oauthToken = (matched.providerConfig as any).oauthAccessToken?.trim();
    const oauthBaseUrl = (matched.providerConfig as any).oauthBaseUrl?.trim();
    if (oauthToken) {
      apiKey = oauthToken;
      if (oauthBaseUrl) effectiveBaseURL = oauthBaseUrl;
      effectiveApiFormat = 'anthropic';
    }
  }

  console.log(
    '[ClaudeSettings] resolved raw API config:',
    JSON.stringify({
      ...matched,
      providerConfig: { ...matched.providerConfig, apiKey: apiKey ? '***' : '' },
    }),
  );
  // The compatibility layer requires a non-empty apiKey for every provider, even
  // local servers that do not enforce auth. When the user leaves the key blank,
  // supply a placeholder so request validation does not reject
  // the request with "No API key found for provider".
  const effectiveApiKey = resolveEffectiveApiKey(matched.providerName, apiKey);
  const endpoint = resolveModelEndpoint(matched.providerName, matched.modelId, {
    providerConfig: matched.providerConfig,
    modelConfig: matched.userModelConfig,
    apiKey: effectiveApiKey,
    baseUrl: effectiveBaseURL,
    apiFormat: effectiveApiFormat,
    runtime: getMatchedRuntimeSnapshot(matched),
  });
  return {
    endpoint,
    config: {
      apiKey: effectiveApiKey,
      baseURL: effectiveBaseURL,
      model: matched.modelId,
      apiType: effectiveApiFormat === 'anthropic' ? 'anthropic' : 'openai',
    },
    providerMetadata: {
      providerName: matched.providerName,
      authType: matched.providerConfig.authType,
      codingPlanEnabled: !!matched.providerConfig.codingPlanEnabled,
      supportsImage: matched.supportsImage,
      modelName: matched.modelName,
      contextWindow: matched.contextWindow,
      contextTokens: matched.contextTokens,
      maxTokens: matched.maxTokens,
      ...(matched.capabilities ? { capabilities: matched.capabilities } : {}),
      ...(matched.piRuntime ? { piRuntime: matched.piRuntime } : {}),
    },
  };
}

export function resolveRawApiConfigForModelRef(modelRef: string): ApiConfigResolution {
  const sqliteStore = getStore();
  if (!sqliteStore) {
    return { config: null, error: 'Store is not initialized.' };
  }
  const appConfig = sqliteStore.get<AppConfig>('app_config');
  if (!appConfig) {
    return { config: null, error: 'Application config not found.' };
  }
  const { matched, error } = resolveMatchedProviderForModelRef(appConfig, modelRef);
  if (!matched) {
    return { config: null, error };
  }
  return buildRawApiResolutionFromMatched(matched);
}

/**
 * Collect apiKeys for ALL configured providers (not just the currently selected one).
 * Used to pre-register provider credentials for local compatibility routes.
 *
 * Returns a map of env-var-safe provider name → apiKey.
 */
export function resolveAllProviderApiKeys(): Record<string, string> {
  const result: Record<string, string> = {};

  // All configured custom providers
  const sqliteStore = getStore();
  if (!sqliteStore) return result;
  const appConfig = sqliteStore.get<AppConfig>('app_config');
  if (!appConfig?.providers) return result;

  for (const [providerName, providerConfig] of Object.entries(appConfig.providers)) {
    if (!isProviderEnabled(providerName, providerConfig)) continue;
    if (shouldUseOpenAICodexOAuth(providerName, providerConfig)) {
      continue;
    }
    // For MiniMax OAuth, inject oauthAccessToken instead of apiKey
    let apiKey = providerConfig.apiKey?.trim();
    if (providerName === ProviderName.Minimax && (providerConfig as any).authType === 'oauth') {
      const oauthToken = (providerConfig as any).oauthAccessToken?.trim();
      if (!oauthToken) continue; // OAuth not completed, skip
      apiKey = oauthToken;
    } else if (!apiKey && providerRequiresApiKey(providerName)) {
      continue;
    }
    const envName = providerName.toUpperCase().replace(/[^A-Z0-9]/g, '_');
    result[envName] = apiKey || 'sk-zhiyuan-local';
  }

  const D = gwDiagTs;
  console.log(
    `${D()} resolveAllProviderApiKeys: hasServer=${!!result.SERVER} providers=[${Object.keys(result)
      .filter(k => k !== 'SERVER')
      .join(',')}]`,
  );

  return result;
}

export function buildEnvForConfig(config: CoworkApiConfig): Record<string, string> {
  const baseEnv = { ...process.env } as Record<string, string>;

  baseEnv.ANTHROPIC_AUTH_TOKEN = config.apiKey;
  baseEnv.ANTHROPIC_API_KEY = config.apiKey;
  baseEnv.ANTHROPIC_BASE_URL = config.baseURL;
  baseEnv.ANTHROPIC_MODEL = config.model;
  return baseEnv;
}

export type ProviderRawConfig = {
  providerName: string;
  baseURL: string;
  apiKey: string;
  apiType: 'anthropic' | 'openai';
  authType?: ProviderConfig['authType'];
  codingPlanEnabled: boolean;
  models: ProviderModelConfig[];
};

export function resolveAllEnabledProviderConfigs(): ProviderRawConfig[] {
  const sqliteStore = getStore();
  if (!sqliteStore) return [];
  const appConfig = sqliteStore.get<AppConfig>('app_config');
  if (!appConfig?.providers) return [];

  const result: ProviderRawConfig[] = [];

  for (const [providerName, providerConfig] of Object.entries(appConfig.providers)) {
    if (!isProviderEnabled(providerName, providerConfig)) continue;
    // When minimax is in OAuth mode, use oauthAccessToken and oauthBaseUrl
    // (independent from the user's manually entered apiKey/baseUrl).
    // This must come before the apiKey emptiness check below.
    if (providerName === ProviderName.Minimax && (providerConfig as any).authType === 'oauth') {
      const oauthToken = (providerConfig as any).oauthAccessToken?.trim();
      if (!oauthToken) continue; // OAuth not completed, skip
      const oauthBaseUrl =
        (providerConfig as any).oauthBaseUrl?.trim() || providerConfig.baseUrl?.trim() || '';
      if (!oauthBaseUrl) continue;
      const models = getEffectiveProviderModels(providerName, providerConfig);
      if (models.length === 0) continue;
      result.push({
        providerName,
        baseURL: oauthBaseUrl,
        apiKey: oauthToken,
        apiType: 'anthropic',
        authType: providerConfig.authType,
        codingPlanEnabled: false,
        models,
      });
      continue;
    }

    if (shouldUseOpenAICodexOAuth(providerName, providerConfig)) {
      const baseURL = providerConfig.baseUrl?.trim() || 'https://api.openai.com/v1';
      const models = normalizeProviderModels(providerName, providerConfig.models, 'openai');
      if (models.length === 0) continue;
      result.push({
        providerName,
        baseURL,
        apiKey: '',
        apiType: 'openai',
        authType: 'oauth',
        codingPlanEnabled: false,
        models,
      });
      continue;
    }

    const apiKey = providerConfig.apiKey?.trim() || '';
    if (!apiKey && providerRequiresApiKey(providerName)) continue;

    const baseURL = providerConfig.baseUrl?.trim() || '';

    let effectiveBaseURL = baseURL;
    let effectiveApiFormat = getEffectiveProviderApiFormat(providerName, providerConfig.apiFormat);

    if (providerConfig.codingPlanEnabled) {
      const resolved = resolveCodingPlanBaseUrl(
        providerName,
        true,
        effectiveApiFormat,
        effectiveBaseURL,
      );
      effectiveBaseURL = resolved.baseUrl;
      effectiveApiFormat = resolved.effectiveFormat;
    }

    if (!effectiveBaseURL) continue;

    const models = getAgentEligibleProviderModels(providerName, providerConfig);
    if (models.length === 0) continue;

    result.push({
      providerName,
      baseURL: effectiveBaseURL,
      apiKey: apiKey || 'sk-zhiyuan-local',
      apiType: effectiveApiFormat === 'anthropic' ? 'anthropic' : 'openai',
      authType: providerConfig.authType,
      codingPlanEnabled: !!providerConfig.codingPlanEnabled,
      models,
    });
  }

  return result;
}

/**
 * Returns the long-lived GitHub OAuth token used to exchange for short-lived
 * Copilot API tokens.
 */
export function getCopilotGithubToken(): string | null {
  const sqliteStore = getStore();
  if (!sqliteStore) return null;
  const token = sqliteStore.get<string>('github_copilot_github_token');
  return token?.trim() || null;
}
