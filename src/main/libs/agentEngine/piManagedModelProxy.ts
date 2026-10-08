import { randomUUID } from 'crypto';

import { ProviderModelPiApi, ProviderName } from '../../../shared/providers';
import { getModelPoolAccessToken } from '../../communityAuthSession';
import { zhiyuanManagedProviderBridge } from '../../enterpriseExtension/managedProviderBridge';
import type { ApiConfigResolution } from '../claudeSettings';
import type { PiModelApi } from './piModelApi';
import {
  registerPiOpenAICompatTokenRefresher,
  registerPiOpenAICompatUpstream,
} from './piOpenAICompatProxy';

const CUSTOM_PROVIDER_KEY_PREFIX = 'custom_';

/**
 * Per-process capability that authenticates the Pi runtime against the local
 * managed-model loopback proxy for the built-in Zhiyuan provider. Managed
 * custom providers authenticate with their own entitlement token instead.
 */
export const PI_MANAGED_PROXY_API_KEY = `sk-zhiyuan-${randomUUID()}`;

export interface PiManagedProviderLookup {
  isManagedProvider(providerName: string): boolean;
}

export function shouldUsePiOpenAICompatProxy(
  resolution: ApiConfigResolution,
  api: PiModelApi,
): boolean {
  const providerName = resolution.providerMetadata?.providerName ?? '';
  return (
    (providerName === ProviderName.Zhiyuan ||
      providerName.startsWith(CUSTOM_PROVIDER_KEY_PREFIX)) &&
    resolution.config?.apiType === 'openai' &&
    api === ProviderModelPiApi.OpenAICompletions
  );
}

/**
 * Managed enterprise Anthropic models must reach the gateway through the
 * loopback proxy: pi-ai only sends x-api-key for plain API keys, while the
 * gateway requires a Bearer token. Community-built custom Anthropic providers
 * keep their direct x-api-key behavior, so the proxy only engages for the
 * bridge-managed provider. The gate keys off the per-model resolved api, so
 * anthropic models in a mixed catalog whose provider-level apiFormat stays
 * openai are covered as well.
 */
function shouldUsePiManagedAnthropicProxy(
  resolution: ApiConfigResolution,
  api: PiModelApi,
  managedProviders: PiManagedProviderLookup,
): boolean {
  const providerName = resolution.providerMetadata?.providerName ?? '';
  return (
    providerName.startsWith(CUSTOM_PROVIDER_KEY_PREFIX) &&
    api === ProviderModelPiApi.AnthropicMessages &&
    managedProviders.isManagedProvider(providerName)
  );
}

export async function resolvePiCustomModelBaseUrl(
  resolution: ApiConfigResolution,
  api: PiModelApi,
  managedProviders: PiManagedProviderLookup = zhiyuanManagedProviderBridge,
): Promise<string> {
  const config = resolution.config;
  const providerMetadata = resolution.providerMetadata;
  if (!config || !providerMetadata) {
    return '';
  }

  if (providerMetadata.providerName === ProviderName.Zhiyuan) {
    const accessToken = await getModelPoolAccessToken();
    registerPiOpenAICompatTokenRefresher(providerMetadata.providerName, () =>
      getModelPoolAccessToken({ forceRefresh: true }),
    );
    return registerPiOpenAICompatUpstream(providerMetadata.providerName, {
      baseURL: config.baseURL,
      apiKey: accessToken,
      requiredIncomingApiKey: PI_MANAGED_PROXY_API_KEY,
    });
  }

  if (shouldUsePiManagedAnthropicProxy(resolution, api, managedProviders)) {
    // Anthropic managed models route per model (`<gateway-origin>/<modelId>`),
    // so each model registers its own upstream; the token refresher stays
    // registered under the bare provider key. The extension guarantees a
    // modelBaseUrl for managed anthropic models; the fallbacks only tolerate
    // malformed projections.
    const upstreamId = `${providerMetadata.providerName}#${
      resolution.endpoint?.modelId ?? config.model
    }`;
    return registerPiOpenAICompatUpstream(
      upstreamId,
      {
        baseURL:
          resolution.endpoint?.modelBaseUrl ?? resolution.endpoint?.baseUrl ?? config.baseURL,
        apiKey: config.apiKey,
      },
      { bareBaseUrl: true },
    );
  }

  if (!shouldUsePiOpenAICompatProxy(resolution, api)) {
    return config.baseURL;
  }

  return registerPiOpenAICompatUpstream(providerMetadata.providerName, {
    baseURL: config.baseURL,
    ...(providerMetadata.usesAnonymousAccess
      ? { forwardIncomingAuthorization: false }
      : { apiKey: config.apiKey }),
  });
}
