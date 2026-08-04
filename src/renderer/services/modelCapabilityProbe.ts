import {
  type ModelCapabilities,
  ModelCapabilityStatus,
  ProviderName,
} from '../../shared/providers';

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
  if (!isRecord(payload)) return {};
  const declaredCapabilities = stringArray(payload.capabilities);
  if (!declaredCapabilities) return {};

  return {
    toolCalling: capabilityStatus(declaredCapabilities.includes('tools')),
    imageInput: capabilityStatus(declaredCapabilities.includes('vision')),
    ...(declaredCapabilities.includes('thinking')
      ? { reasoning: ModelCapabilityStatus.Supported }
      : {}),
  };
}

export function parseLlamaCppModelCapabilities(payload: unknown): Partial<ModelCapabilities> {
  if (!isRecord(payload)) return {};
  const capabilities: MutableModelCapabilities = {};
  const templateCapabilities = isRecord(payload.chat_template_caps)
    ? payload.chat_template_caps
    : undefined;
  const toolCapabilityKeys = ['supports_tools', 'supports_tool_calls', 'tools', 'tool_use'];
  const declaredToolCapabilities = toolCapabilityKeys
    .map(key => templateCapabilities?.[key])
    .filter((value): value is boolean => typeof value === 'boolean');
  const toolTemplate = payload.chat_template_tool_use;

  if (typeof toolTemplate === 'string' && toolTemplate.trim()) {
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
      if (declaredCapabilities.toolCalling) return declaredCapabilities;

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
