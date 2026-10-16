import http from 'http';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ModelCapabilityStatus,
  ProviderModelPiApi,
  type ResolvedModelEndpoint,
} from '../../../shared/providers';
import type { ApiConfigResolution } from './piApiConfig';

const intranetMocks = vi.hoisted(() => ({
  probe: vi.fn(async () => false),
  apiKey: vi.fn(() => 'intranet-api-key'),
  communityToken: vi.fn(async () => 'community-token'),
  intranetBaseUrl: 'http://127.0.0.1:9',
}));

vi.mock('../zhiyuanIntranet', () => ({
  probeZhiyuanIntranet: intranetMocks.probe,
  zhiyuanIntranetApiKey: intranetMocks.apiKey,
}));

vi.mock('../../communityAuthSession', () => ({
  getModelPoolAccessToken: intranetMocks.communityToken,
}));

vi.mock('../../../shared/modelPool/constants', async () => {
  const actual = await vi.importActual<typeof import('../../../shared/modelPool/constants')>(
    '../../../shared/modelPool/constants',
  );
  return {
    ...actual,
    ZhiyuanModelPool: {
      ...actual.ZhiyuanModelPool,
      // Late-bind so tests can point the intranet route at a local upstream.
      get IntranetBaseUrl() {
        return intranetMocks.intranetBaseUrl;
      },
    },
  };
});

import {
  PI_MANAGED_PROXY_API_KEY,
  resolvePiCustomModelBaseUrl,
  shouldUsePiOpenAICompatProxy,
} from './piManagedModelProxy';
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
  beforeEach(() => {
    intranetMocks.probe.mockReset();
    intranetMocks.probe.mockResolvedValue(false);
    intranetMocks.apiKey.mockClear();
    intranetMocks.communityToken.mockReset();
    intranetMocks.communityToken.mockResolvedValue('community-token');
    intranetMocks.intranetBaseUrl = 'http://127.0.0.1:9';
  });

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

  it('routes the zhiyuan provider through the intranet gateway when reachable', async () => {
    const captured: { url?: string; authorization?: string; body: string } = { body: '' };
    const gateway = http.createServer((request, response) => {
      captured.url = request.url;
      captured.authorization = request.headers.authorization;
      const chunks: Buffer[] = [];
      request.on('data', chunk => chunks.push(chunk));
      request.on('end', () => {
        captured.body = Buffer.concat(chunks).toString('utf8');
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(
          JSON.stringify({
            choices: [
              { index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' },
            ],
          }),
        );
      });
    });
    const gatewayBaseUrl = await listen(gateway);
    intranetMocks.intranetBaseUrl = gatewayBaseUrl;
    intranetMocks.probe.mockResolvedValue(true);

    try {
      const resolution = resolutionFor({
        providerName: 'zhiyuan',
        apiType: 'openai',
        baseURL: 'https://pool.example.test/v1',
        model: 'zhiyuan-free',
      });
      const loopback = await resolvePiCustomModelBaseUrl(
        resolution,
        ProviderModelPiApi.OpenAICompletions,
        { isManagedProvider: () => false },
      );

      expect(loopback).toContain('/__pi_openai_compat/zhiyuan/v1');

      const response = await postChatCompletion(loopback);
      expect(response.ok).toBe(true);
      expect(captured.url).toBe('/v1/chat/completions');
      expect(captured.authorization).toBe('Bearer intranet-api-key');
      expect(JSON.parse(captured.body)).toMatchObject({ model: 'GLM-5.3-Flash' });
      expect(intranetMocks.communityToken).not.toHaveBeenCalled();
    } finally {
      await close(gateway);
    }
  });

  it('keeps the community pool route with the logical model id when the intranet is unavailable', async () => {
    const captured: { url?: string; authorization?: string; body: string } = { body: '' };
    const pool = http.createServer((request, response) => {
      captured.url = request.url;
      captured.authorization = request.headers.authorization;
      const chunks: Buffer[] = [];
      request.on('data', chunk => chunks.push(chunk));
      request.on('end', () => {
        captured.body = Buffer.concat(chunks).toString('utf8');
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(
          JSON.stringify({
            choices: [
              { index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' },
            ],
          }),
        );
      });
    });
    const poolBaseUrl = await listen(pool);

    try {
      const resolution = resolutionFor({
        providerName: 'zhiyuan',
        apiType: 'openai',
        baseURL: `${poolBaseUrl}/v1`,
        model: 'zhiyuan-free',
      });
      const loopback = await resolvePiCustomModelBaseUrl(
        resolution,
        ProviderModelPiApi.OpenAICompletions,
        { isManagedProvider: () => false },
      );

      const response = await postChatCompletion(loopback);
      expect(response.ok).toBe(true);
      expect(captured.url).toBe('/v1/chat/completions');
      expect(captured.authorization).toBe('Bearer community-token');
      expect(JSON.parse(captured.body)).toMatchObject({ model: 'zhiyuan-free' });
      expect(intranetMocks.communityToken).toHaveBeenCalledTimes(1);
    } finally {
      await close(pool);
    }
  });

  it('releases the community refresher when switching to the intranet route', async () => {
    intranetMocks.probe.mockResolvedValue(false);
    const poolResolution = resolutionFor({
      providerName: 'zhiyuan',
      apiType: 'openai',
      baseURL: 'https://pool.example.test/v1',
      model: 'zhiyuan-free',
    });
    await resolvePiCustomModelBaseUrl(poolResolution, ProviderModelPiApi.OpenAICompletions, {
      isManagedProvider: () => false,
    });
    expect(intranetMocks.communityToken).toHaveBeenCalledTimes(1);

    const gateway = http.createServer((_request, response) => {
      response.writeHead(401, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: { message: 'invalid key' } }));
    });
    const gatewayBaseUrl = await listen(gateway);
    intranetMocks.intranetBaseUrl = gatewayBaseUrl;
    intranetMocks.probe.mockResolvedValue(true);

    try {
      const intranetResolution = resolutionFor({
        providerName: 'zhiyuan',
        apiType: 'openai',
        baseURL: 'https://pool.example.test/v1',
        model: 'zhiyuan-free',
      });
      const loopback = await resolvePiCustomModelBaseUrl(
        intranetResolution,
        ProviderModelPiApi.OpenAICompletions,
        { isManagedProvider: () => false },
      );

      const response = await postChatCompletion(loopback);
      expect(response.status).toBe(401);
      // Without releasing the refresher, the proxy would refresh the community
      // token here and retry the intranet gateway with the wrong credential.
      expect(intranetMocks.communityToken).toHaveBeenCalledTimes(1);
    } finally {
      await close(gateway);
    }
  });
});

async function postChatCompletion(loopbackBaseUrl: string): Promise<Response> {
  return fetch(`${loopbackBaseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${PI_MANAGED_PROXY_API_KEY}`,
    },
    body: JSON.stringify({
      model: 'zhiyuan-free',
      stream: false,
      messages: [{ role: 'user', content: 'hello' }],
    }),
  });
}

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
