import http from 'http';

import { afterEach, describe, expect, it } from 'vitest';

import {
  ModelCapabilityStatus,
  ProviderModelPiApi,
  type ResolvedModelEndpoint,
} from '../../../shared/providers';
import type { ApiConfigResolution } from '../claudeSettings';
import { resolvePiCustomModelBaseUrl, shouldUsePiOpenAICompatProxy } from './piManagedModelProxy';
import { stopPiOpenAICompatProxyForTests } from './piOpenAICompatProxy';

const MANAGED_PROVIDER = 'custom_enterprise';

const UNKNOWN_CAPABILITIES = {
  toolCalling: ModelCapabilityStatus.Unknown,
  imageInput: ModelCapabilityStatus.Unknown,
  videoInput: ModelCapabilityStatus.Unknown,
  audioInput: ModelCapabilityStatus.Unknown,
  documentInput: ModelCapabilityStatus.Unknown,
  reasoning: ModelCapabilityStatus.Unknown,
};

function endpoint(baseUrl: string, modelId: string, modelBaseUrl?: string): ResolvedModelEndpoint {
  return {
    providerId: MANAGED_PROVIDER,
    modelId,
    displayName: modelId,
    protocol: 'anthropic',
    baseUrl,
    ...(modelBaseUrl ? { modelBaseUrl } : {}),
    capabilities: { ...UNKNOWN_CAPABILITIES },
    runtime: { kind: 'cloud', status: 'unknown' },
  };
}

function resolutionFor(input: {
  providerName?: string;
  apiType?: 'openai' | 'anthropic';
  baseURL?: string;
  apiKey?: string;
  model?: string;
  endpoint?: ResolvedModelEndpoint;
}): ApiConfigResolution {
  return {
    config: {
      apiKey: input.apiKey ?? 'managed-jwt',
      baseURL: input.baseURL ?? 'https://gateway.example.test/v1',
      model: input.model ?? 'enterprise-chat',
      ...(input.apiType ? { apiType: input.apiType } : {}),
    },
    ...(input.endpoint ? { endpoint: input.endpoint } : {}),
    providerMetadata: {
      providerName: input.providerName ?? MANAGED_PROVIDER,
      codingPlanEnabled: false,
    },
  };
}

describe('piManagedModelProxy', () => {
  afterEach(async () => {
    await stopPiOpenAICompatProxyForTests();
  });

  it('routes managed OpenAI-compatible custom providers through the loopback proxy', async () => {
    const resolution = resolutionFor({ apiType: 'openai' });

    expect(shouldUsePiOpenAICompatProxy(resolution, ProviderModelPiApi.OpenAICompletions)).toBe(
      true,
    );
    const baseUrl = await resolvePiCustomModelBaseUrl(
      resolution,
      ProviderModelPiApi.OpenAICompletions,
      { isManagedProvider: () => true },
    );

    expect(baseUrl).toContain(`/__pi_openai_compat/${MANAGED_PROVIDER}/v1`);
    expect(baseUrl).not.toContain('%23');
  });

  it('registers a per-model upstream for managed anthropic models', async () => {
    let receivedUrl: string | undefined;
    let receivedAuthorization: string | undefined;
    const upstream = http.createServer((request, response) => {
      receivedUrl = request.url;
      receivedAuthorization = request.headers.authorization;
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ id: 'msg_1', type: 'message' }));
    });
    const upstreamBaseURL = await listen(upstream);

    try {
      const resolution = resolutionFor({
        apiType: 'anthropic',
        model: 'bench-anthropic',
        endpoint: endpoint(
          `${upstreamBaseURL}/v1`,
          'bench-anthropic',
          `${upstreamBaseURL}/bench-anthropic`,
        ),
      });

      const baseUrl = await resolvePiCustomModelBaseUrl(
        resolution,
        ProviderModelPiApi.AnthropicMessages,
        { isManagedProvider: () => true },
      );

      expect(baseUrl).toContain(encodeURIComponent(`${MANAGED_PROVIDER}#bench-anthropic`));
      expect(baseUrl.endsWith('/v1')).toBe(false);

      const response = await fetch(`${baseUrl}/v1/messages`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model: 'bench-anthropic', messages: [] }),
      });

      expect(response.ok).toBe(true);
      expect(receivedUrl).toBe('/bench-anthropic/v1/messages');
      expect(receivedAuthorization).toBe('Bearer managed-jwt');
    } finally {
      await close(upstream);
    }
  });

  it('keeps community custom anthropic providers on direct connections', async () => {
    const resolution = resolutionFor({
      providerName: 'custom_community',
      apiType: 'anthropic',
      baseURL: 'https://community.example.test/v1',
      model: 'bench-anthropic',
      endpoint: endpoint('https://community.example.test/bench-anthropic', 'bench-anthropic'),
    });

    const baseUrl = await resolvePiCustomModelBaseUrl(
      resolution,
      ProviderModelPiApi.AnthropicMessages,
      { isManagedProvider: () => false },
    );

    expect(baseUrl).toBe('https://community.example.test/v1');
  });

  it('proxies managed anthropic models even when the provider resolves as openai', async () => {
    const resolution = resolutionFor({
      apiType: 'openai',
      model: 'bench-anthropic',
      endpoint: endpoint(
        'https://gateway.example.test/v1',
        'bench-anthropic',
        'https://gateway.example.test/bench-anthropic',
      ),
    });

    const baseUrl = await resolvePiCustomModelBaseUrl(
      resolution,
      ProviderModelPiApi.AnthropicMessages,
      { isManagedProvider: () => true },
    );

    expect(baseUrl).toContain(encodeURIComponent(`${MANAGED_PROVIDER}#bench-anthropic`));
    expect(baseUrl.endsWith('/v1')).toBe(false);
  });
});

async function listen(server: http.Server): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('upstream did not receive a TCP port'));
        return;
      }
      resolve(`http://127.0.0.1:${address.port}`);
    });
  });
}

async function close(server: http.Server): Promise<void> {
  await new Promise<void>(resolve => server.close(() => resolve()));
}
