import type { KnownApi } from '@earendil-works/pi-ai';

import { ApiFormat, ProviderModelPiApi, ProviderName } from '../../../shared/providers';
import type { ApiConfigResolution } from '../claudeSettings';

export const PiModelApi = {
  ...ProviderModelPiApi,
  GoogleGenerativeAI: 'google-generative-ai',
} as const satisfies Record<string, KnownApi>;
export type PiModelApi = (typeof PiModelApi)[keyof typeof PiModelApi];

/** Select the same provider protocol used by the configured endpoint and connection test. */
export function resolvePiCustomModelApi(resolution: ApiConfigResolution): PiModelApi {
  const configuredApi = resolution.providerMetadata?.piRuntime?.api;
  if (configuredApi) return configuredApi;

  const protocol = resolution.endpoint?.protocol ?? resolution.config?.apiType;
  if (protocol === ApiFormat.Gemini) return PiModelApi.GoogleGenerativeAI;
  if (protocol === ApiFormat.Anthropic) return PiModelApi.AnthropicMessages;
  if (resolution.providerMetadata?.providerName === ProviderName.OpenAI) {
    return PiModelApi.OpenAIResponses;
  }
  return PiModelApi.OpenAICompletions;
}
