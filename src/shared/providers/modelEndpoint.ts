import {
  ApiFormat,
  ModelCapabilityStatus,
  type ModelCapabilities,
  ProviderRegistry,
} from './constants';
import type { ProviderConfig } from './types';
import { resolveCodingPlanBaseUrl } from './codingPlan';

export type RuntimeModelKind = 'cloud' | 'ollama' | 'llamacpp';
export type RuntimeModelStatus = 'unknown' | 'stopped' | 'running' | 'loaded';

export interface RuntimeModelSnapshot {
  kind: RuntimeModelKind;
  status: RuntimeModelStatus;
  runtimeModelId?: string;
  runtimeContextWindow?: number;
  trainedContextWindow?: number;
  detectedCapabilities?: Partial<ModelCapabilities>;
}

export interface ResolvedModelEndpoint {
  providerId: string;
  modelId: string;
  displayName: string;
  protocol: 'openai' | 'anthropic' | 'gemini';
  baseUrl: string;
  apiKey?: string;
  capabilities: ModelCapabilities;
  contextWindow?: number;
  maxTokens?: number;
  runtime: RuntimeModelSnapshot;
}

export interface ResolveModelEndpointOptions {
  providerConfig?: Partial<
    Omit<
      Pick<
        ProviderConfig,
        'apiKey' | 'baseUrl' | 'apiFormat' | 'codingPlanEnabled' | 'models' | 'enabled'
      >,
      'apiFormat'
    >
  > & { apiFormat?: ApiFormat | 'native' };
  apiKey?: string;
  baseUrl?: string;
  apiFormat?: ApiFormat | 'native' | string;
  codingPlanEnabled?: boolean;
  modelConfig?: NonNullable<ProviderConfig['models']>[number];
  runtime?: RuntimeModelSnapshot;
  runtimeSnapshot?: RuntimeModelSnapshot;
}

const UNKNOWN_CAPABILITIES: ModelCapabilities = {
  toolCalling: ModelCapabilityStatus.Unknown,
  imageInput: ModelCapabilityStatus.Unknown,
  videoInput: ModelCapabilityStatus.Unknown,
  audioInput: ModelCapabilityStatus.Unknown,
  documentInput: ModelCapabilityStatus.Unknown,
  reasoning: ModelCapabilityStatus.Unknown,
};

const positiveNumber = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const stringArray = (value: unknown): string[] | undefined =>
  Array.isArray(value) && value.every(item => typeof item === 'string')
    ? value.map(item => item.toLowerCase())
    : undefined;

const capabilityStatus = (supported: boolean): ModelCapabilityStatus =>
  supported ? ModelCapabilityStatus.Supported : ModelCapabilityStatus.Unsupported;

export function parseOllamaRuntimeCapabilities(payload: unknown): Partial<ModelCapabilities> {
  if (!isRecord(payload)) return {};
  const declared = stringArray(payload.capabilities);
  if (!declared) return {};
  return {
    toolCalling: capabilityStatus(declared.includes('tools')),
    imageInput: capabilityStatus(declared.includes('vision')),
    ...(declared.includes('thinking')
      ? { reasoning: ModelCapabilityStatus.Supported }
      : {}),
  };
}

export function parseLlamaCppRuntimeCapabilities(payload: unknown): Partial<ModelCapabilities> {
  if (!isRecord(payload)) return {};
  const capabilities = {} as { -readonly [Key in keyof ModelCapabilities]?: ModelCapabilities[Key] };
  const templateCapabilities = isRecord(payload.chat_template_caps)
    ? payload.chat_template_caps
    : undefined;
  const toolCapabilityKeys = ['supports_tools', 'supports_tool_calls', 'tools', 'tool_use'];
  const declaredToolCapabilities = toolCapabilityKeys
    .map(key => templateCapabilities?.[key])
    .filter((value): value is boolean => typeof value === 'boolean');
  if (typeof payload.chat_template_tool_use === 'string' && payload.chat_template_tool_use.trim()) {
    capabilities.toolCalling = ModelCapabilityStatus.Supported;
  } else if (declaredToolCapabilities.some(Boolean)) {
    capabilities.toolCalling = ModelCapabilityStatus.Supported;
  } else if (declaredToolCapabilities.length > 0) {
    capabilities.toolCalling = ModelCapabilityStatus.Unsupported;
  }
  const modalities = isRecord(payload.modalities) ? payload.modalities : undefined;
  if (typeof modalities?.vision === 'boolean') {
    capabilities.imageInput = capabilityStatus(modalities.vision);
  }
  return capabilities;
}

const normalizeProtocol = (
  providerId: string,
  value: unknown,
): ResolvedModelEndpoint['protocol'] => {
  if (value === ApiFormat.Gemini || providerId === 'gemini') return 'gemini';
  if (value === ApiFormat.OpenAI) return 'openai';
  if (value === ApiFormat.Anthropic) return 'anthropic';
  return ProviderRegistry.get(providerId)?.defaultApiFormat === ApiFormat.OpenAI
    ? 'openai'
    : ProviderRegistry.get(providerId)?.defaultApiFormat === ApiFormat.Gemini
      ? 'gemini'
      : 'anthropic';
};

const normalizeRuntime = (
  providerId: string,
  runtime?: RuntimeModelSnapshot,
): RuntimeModelSnapshot => ({
  kind:
    runtime?.kind ??
    (providerId === 'ollama' ? 'ollama' : providerId === 'llamacpp' ? 'llamacpp' : 'cloud'),
  status: runtime?.status ?? 'unknown',
  ...(runtime?.runtimeModelId ? { runtimeModelId: runtime.runtimeModelId } : {}),
  ...(positiveNumber(runtime?.runtimeContextWindow)
    ? { runtimeContextWindow: positiveNumber(runtime?.runtimeContextWindow) }
    : {}),
  ...(positiveNumber(runtime?.trainedContextWindow)
    ? { trainedContextWindow: positiveNumber(runtime?.trainedContextWindow) }
    : {}),
  ...(runtime?.detectedCapabilities ? { detectedCapabilities: runtime.detectedCapabilities } : {}),
});

/** Keep runtime context inside the model's trained limit. */
export function clampRuntimeContextWindow(
  runtimeContextWindow?: number,
  trainedContextWindow?: number,
): number | undefined {
  const runtime = positiveNumber(runtimeContextWindow);
  const trained = positiveNumber(trainedContextWindow);
  if (!runtime) return undefined;
  return trained ? Math.min(runtime, trained) : runtime;
}

/**
 * Resolve one provider/model pair without reading IPC or storage. Callers pass
 * their process-local config and runtime snapshot, making Chat and Work share
 * exactly the same model metadata rules.
 */
export function resolveModelEndpoint(
  providerId: string,
  modelId: string,
  options: ResolveModelEndpointOptions = {},
): ResolvedModelEndpoint {
  const normalizedProviderId = providerId.trim();
  const requestedModelId = modelId.trim();
  const providerConfig = options.providerConfig;
  const catalogModel = ProviderRegistry.getModel(normalizedProviderId, requestedModelId);
  const userModel =
    options.modelConfig ??
    providerConfig?.models?.find(model => {
      if (model.id.trim().toLowerCase() === requestedModelId.toLowerCase()) return true;
      return ProviderRegistry.getModel(normalizedProviderId, model.id)?.id === catalogModel?.id;
    });
  const runtime = normalizeRuntime(
    normalizedProviderId,
    options.runtimeSnapshot ?? options.runtime,
  );
  const runtimeContextWindow = clampRuntimeContextWindow(
    runtime.runtimeContextWindow,
    runtime.trainedContextWindow,
  );
  let protocol = normalizeProtocol(
    normalizedProviderId,
    options.apiFormat ?? providerConfig?.apiFormat,
  );
  const userSupportsImage = userModel?.supportsImage;

  const explicitBaseUrl = options.baseUrl ?? providerConfig?.baseUrl;
  let baseUrl =
    explicitBaseUrl?.trim() || ProviderRegistry.get(normalizedProviderId)?.defaultBaseUrl || '';
  const codingPlanEnabled = options.codingPlanEnabled ?? providerConfig?.codingPlanEnabled;
  if (codingPlanEnabled && (protocol === 'openai' || protocol === 'anthropic')) {
    const codingPlan = resolveCodingPlanBaseUrl(normalizedProviderId, true, protocol, baseUrl);
    baseUrl = codingPlan.baseUrl;
    protocol = codingPlan.effectiveFormat;
  }
  // ProviderRegistry owns both per-model metadata and the verified capability
  // fact tables. Keep it as the catalog layer, then apply runtime evidence and
  // explicit user overrides in the documented priority order.
  const catalogCapabilities = ProviderRegistry.resolveModelCapabilities(
    normalizedProviderId,
    requestedModelId,
    protocol,
    catalogModel
      ? undefined
      : {
          ...(userSupportsImage === undefined ? {} : { supportsImage: userSupportsImage }),
          ...(userModel?.capabilities ? { capabilities: userModel.capabilities } : {}),
        },
  );
  const capabilities = {
    ...UNKNOWN_CAPABILITIES,
    ...catalogCapabilities,
    ...(runtime.detectedCapabilities ?? {}),
    ...(userModel?.capabilities ?? {}),
  } as { -readonly [K in keyof ModelCapabilities]: ModelCapabilities[K] };
  if (userSupportsImage !== undefined) {
    capabilities.imageInput = userSupportsImage
      ? ModelCapabilityStatus.Supported
      : ModelCapabilityStatus.Unsupported;
  }
  const explicitApiKey = options.apiKey ?? providerConfig?.apiKey;
  const contextWindow =
    positiveNumber(userModel?.contextWindow) ??
    positiveNumber(userModel?.contextTokens) ??
    runtimeContextWindow ??
    positiveNumber(catalogModel?.contextWindow);
  const maxTokens = positiveNumber(userModel?.maxTokens) ?? positiveNumber(catalogModel?.maxTokens);

  return {
    providerId: normalizedProviderId,
    modelId: catalogModel?.id ?? userModel?.id ?? requestedModelId,
    displayName: userModel?.name?.trim() || catalogModel?.name || requestedModelId,
    protocol,
    baseUrl,
    ...(explicitApiKey?.trim() ? { apiKey: explicitApiKey.trim() } : {}),
    capabilities,
    ...(contextWindow ? { contextWindow } : {}),
    ...(maxTokens ? { maxTokens } : {}),
    runtime,
  };
}

export function createOllamaRuntimeSnapshot(input: {
  serviceStatus?: string;
  modelId?: string;
  runningModel?: { name?: string; model?: string; context_length?: number };
  showModel?: {
    capabilities?: string[];
    details?: { families?: string[] };
    model_info?: Record<string, unknown>;
  };
}): RuntimeModelSnapshot {
  const runningModelId = input.runningModel?.name || input.runningModel?.model;
  const capabilities: Record<string, ModelCapabilityStatus> = {};
  const detected = new Set((input.showModel?.capabilities ?? []).map(value => value.toLowerCase()));
  if (detected.has('tools')) capabilities.toolCalling = ModelCapabilityStatus.Supported;
  if (detected.has('vision')) capabilities.imageInput = ModelCapabilityStatus.Supported;
  if (detected.has('thinking')) capabilities.reasoning = ModelCapabilityStatus.Supported;
  return {
    kind: 'ollama',
    status: runningModelId
      ? 'loaded'
      : input.serviceStatus === 'running'
        ? 'running'
        : input.serviceStatus === 'stopped'
          ? 'stopped'
          : 'unknown',
    ...(input.modelId ? { runtimeModelId: input.modelId } : {}),
    ...(positiveNumber(input.runningModel?.context_length)
      ? { runtimeContextWindow: input.runningModel?.context_length }
      : {}),
    ...(Object.keys(capabilities).length
      ? { detectedCapabilities: capabilities as Partial<ModelCapabilities> }
      : {}),
  };
}

export function createLlamaCppRuntimeSnapshot(input: {
  serviceStatus?: string;
  modelId?: string;
  model?: {
    name?: string;
    id?: string;
    status?: string;
    runtime_context_length?: number;
    trained_context_length?: number;
    details?: { context_length?: number };
    supportsThinkingToggle?: boolean;
  };
  detectedCapabilities?: Partial<ModelCapabilities>;
}): RuntimeModelSnapshot {
  const model = input.model;
  const loaded = model?.status === 'loaded' || model?.status === 'sleeping';
  const detectedCapabilities: Record<string, ModelCapabilityStatus> = {
    ...(input.detectedCapabilities ?? {}),
    ...(model?.supportsThinkingToggle ? { reasoning: ModelCapabilityStatus.Supported } : {}),
  };
  return {
    kind: 'llamacpp',
    status: loaded
      ? 'loaded'
      : input.serviceStatus === 'running'
        ? 'running'
        : input.serviceStatus === 'stopped'
          ? 'stopped'
          : 'unknown',
    ...(input.modelId || model?.name || model?.id
      ? { runtimeModelId: input.modelId ?? model?.name ?? model?.id }
      : {}),
    ...(positiveNumber(model?.runtime_context_length)
      ? { runtimeContextWindow: model?.runtime_context_length }
      : {}),
    ...(positiveNumber(model?.trained_context_length ?? model?.details?.context_length)
      ? { trainedContextWindow: model?.trained_context_length ?? model?.details?.context_length }
      : {}),
    ...(Object.keys(detectedCapabilities).length
      ? { detectedCapabilities: detectedCapabilities as Partial<ModelCapabilities> }
      : {}),
  };
}

export const parseOllamaRuntimeSnapshot = createOllamaRuntimeSnapshot;
export const parseLlamaCppRuntimeSnapshot = createLlamaCppRuntimeSnapshot;
