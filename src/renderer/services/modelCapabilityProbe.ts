import {
  type ModelCapabilities,
  ModelCapabilityStatus,
  ProviderName,
} from '../../shared/providers';
import {
  parseLlamaCppRuntimeCapabilities,
  parseOllamaRuntimeCapabilities,
} from '../../shared/providers/modelEndpoint';

type CapabilityProbeConfig = {
  apiKey: string;
  baseUrl: string;
};

type MutableModelCapabilities = {
  -readonly [Key in keyof ModelCapabilities]?: ModelCapabilities[Key];
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const stringArray = (value: unknown): string[] | undefined =>
  Array.isArray(value) && value.every(item => typeof item === 'string')
    ? value.map(item => item.toLowerCase())
    : undefined;

const capabilityStatus = (supported: boolean): ModelCapabilityStatus =>
  supported ? ModelCapabilityStatus.Supported : ModelCapabilityStatus.Unsupported;

export function parseOpenRouterModelCapabilities(
  payload: unknown,
  modelId: string,
): Partial<ModelCapabilities> {
  if (!isRecord(payload) || !Array.isArray(payload.data)) return {};
  const model = payload.data.find(candidate => isRecord(candidate) && candidate.id === modelId);
  if (!isRecord(model)) return {};

  const capabilities: MutableModelCapabilities = {};
  const supportedParameters = stringArray(model.supported_parameters);
  if (supportedParameters) {
    capabilities.toolCalling = capabilityStatus(supportedParameters.includes('tools'));
    if (
      supportedParameters.includes('reasoning') ||
      supportedParameters.includes('include_reasoning')
    ) {
      capabilities.reasoning = ModelCapabilityStatus.Supported;
    }
  }

  const architecture = isRecord(model.architecture) ? model.architecture : undefined;
  const inputModalities = stringArray(architecture?.input_modalities);
  if (inputModalities) {
    capabilities.imageInput = capabilityStatus(inputModalities.includes('image'));
    capabilities.videoInput = capabilityStatus(inputModalities.includes('video'));
    capabilities.audioInput = capabilityStatus(inputModalities.includes('audio'));
    capabilities.documentInput = capabilityStatus(inputModalities.includes('file'));
  }
  return capabilities;
}

export function parseOllamaModelCapabilities(payload: unknown): Partial<ModelCapabilities> {
  return parseOllamaRuntimeCapabilities(payload);
}

export function parseLlamaCppModelCapabilities(payload: unknown): Partial<ModelCapabilities> {
  return parseLlamaCppRuntimeCapabilities(payload);
}

export function buildOpenRouterModelsUrl(baseUrl: string): string {
  const normalized = baseUrl
    .trim()
    .replace(/\/+$/, '')
    .replace(/\/(?:chat\/completions|messages)$/, '');
  if (!normalized) return 'https://openrouter.ai/api/v1/models';
  if (normalized.endsWith('/api')) return `${normalized}/v1/models`;
  if (/\/v\d+$/.test(normalized)) return `${normalized}/models`;
  return `${normalized}/v1/models`;
}

export async function probeRuntimeModelCapabilities(
  provider: string,
  modelId: string,
  config: CapabilityProbeConfig,
): Promise<Partial<ModelCapabilities>> {
  try {
    if (provider === ProviderName.OpenRouter) {
      const response = await window.electron.api.fetch({
        url: buildOpenRouterModelsUrl(config.baseUrl),
        method: 'GET',
        headers: config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {},
      });
      if (!response.ok) return {};
      return parseOpenRouterModelCapabilities(response.data, modelId);
    }

    if (provider === ProviderName.Ollama) {
      return parseOllamaModelCapabilities(await window.electron.ollama.showModel(modelId));
    }

    if (provider === ProviderName.LlamaCpp) {
      const declaredCapabilities = parseLlamaCppModelCapabilities(
        await window.electron.llamacpp.showModel(modelId),
      );
      if (Object.keys(declaredCapabilities).length > 0) return declaredCapabilities;

      const [status, serviceConfig] = await Promise.all([
        window.electron.llamacpp.status(),
        window.electron.llamacpp.getServiceConfig(),
      ]);
      if (status.managedByApp && serviceConfig.jinja !== 'on') {
        return {
          ...declaredCapabilities,
          toolCalling: ModelCapabilityStatus.Unsupported,
        };
      }
      return declaredCapabilities;
    }
  } catch (error) {
    console.warn(`[model-capability] failed to inspect ${provider}/${modelId}:`, error);
  }
  return {};
}
