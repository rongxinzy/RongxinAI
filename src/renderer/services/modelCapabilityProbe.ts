import {
  type ModelCapabilities,
  ModelCapabilityStatus,
  parseLlamaCppRuntimeCapabilities,
} from '../../shared/providers';

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

// llama.cpp capability parsing lives in the shared provider layer so the
// local-runtime probe and remote model discovery cannot drift apart; this
// alias keeps the historical import sites stable.
export const parseLlamaCppModelCapabilities = parseLlamaCppRuntimeCapabilities;

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
