import http from 'node:http';

import type { Model } from '@earendil-works/pi-ai';
import { completeSimple } from '@earendil-works/pi-ai/compat';
import { afterEach, expect, test, vi } from 'vitest';

import { CONFIG_KEYS } from '../../../renderer/config';
import { ApiFormat, type ProviderConfig } from '../../../shared/providers';
import { resolveRawApiConfigForModelRef, setStoreGetter } from '../claudeSettings';
import { resolvePiCustomModelApi, type PiModelApi } from './piModelApi';
import { resolvePiCustomModelBaseUrl } from './piManagedModelProxy';
import { stopPiOpenAICompatProxyForTests } from './piOpenAICompatProxy';

vi.mock('../../communityAuthSession', () => ({ getModelPoolAccessToken: vi.fn() }));
vi.mock('../zhiyuanIntranet', () => ({
  probeZhiyuanIntranet: vi.fn(),
  zhiyuanIntranetApiKey: vi.fn(),
}));

afterEach(async () => {
  setStoreGetter(() => null);
  vi.unstubAllGlobals();
  await stopPiOpenAICompatProxyForTests();
});

test('real SDK stream sends the selected custom model ID, not a case variant', async () => {
  const providerId = 'custom_1';
  const modelId = 'GLM-5.3-Flash';
  const received: Array<{ path: string | undefined; model: unknown; stream: unknown }> = [];
  const upstream = http.createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as {
      model: unknown;
      stream?: unknown;
    };
    received.push({ path: request.url, model: body.model, stream: body.stream });
    if (body.model !== modelId) {
      response.writeHead(503, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: { code: 'model_not_found' } }));
      return;
    }
    if (!body.stream) {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(
        JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'OK' } }] }),
      );
      return;
    }
    response.writeHead(200, { 'content-type': 'text/event-stream' });
    response.end(
      `data: ${JSON.stringify({
        id: 'chat-test',
        choices: [{ index: 0, delta: { role: 'assistant', content: 'OK' }, finish_reason: null }],
      })}\n\ndata: ${JSON.stringify({
        choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
      })}\n\ndata: [DONE]\n\n`,
    );
  });
  await new Promise<void>(resolve => upstream.listen(0, '127.0.0.1', resolve));
  const address = upstream.address();
  if (!address || typeof address === 'string') throw new Error('Expected a TCP listener');
  const provider: ProviderConfig = {
    enabled: true,
    apiKey: 'test-key',
    baseUrl: `http://127.0.0.1:${address.port}`,
    apiFormat: ApiFormat.OpenAI,
    models: [
      { id: 'GLM-5.3-FLASH', name: 'Wrong case' },
      { id: modelId, name: 'Selected model' },
    ],
  };
  try {
    setStoreGetter(
      () =>
        ({
          get: (key: string) =>
            key === CONFIG_KEYS.APP_CONFIG ? { providers: { [providerId]: provider } } : undefined,
        }) as never,
    );
    const resolution = resolveRawApiConfigForModelRef(`${providerId}/${modelId}`);
    const endpoint = resolution.endpoint!;
    const model: Model<PiModelApi> = {
      id: endpoint.modelId,
      name: endpoint.displayName,
      provider: providerId,
      api: resolvePiCustomModelApi(resolution),
      baseUrl: await resolvePiCustomModelBaseUrl(resolution, resolvePiCustomModelApi(resolution)),
      reasoning: false,
      input: ['text'],
      contextWindow: 32768,
      maxTokens: 64,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    };
    const reply = await completeSimple(
      model,
      { messages: [{ role: 'user', content: 'Hi', timestamp: 1 }] },
      { apiKey: provider.apiKey, maxTokens: 64 },
    );
    expect(reply.errorMessage).toBeUndefined();
    expect(reply.content).toContainEqual({ type: 'text', text: 'OK' });
    expect(received).toEqual([{ path: '/v1/chat/completions', model: modelId, stream: true }]);
  } finally {
    await stopPiOpenAICompatProxyForTests();
    await new Promise<void>((resolve, reject) =>
      upstream.close(error => (error ? reject(error) : resolve())),
    );
  }
});
