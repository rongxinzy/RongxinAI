import { once } from 'node:events';
import { createServer } from 'node:http';
import { expect, test } from 'vitest';
import { ApiFormat } from '../../shared/providers';
import { ZhiyuanManagedProviderBridge } from './managedProviderBridge';
import { startEnterpriseModelGateway } from './modelGateway';

test('streams native Anthropic responses and aborts an in-flight request when the source is removed', async () => {
  const received = Promise.withResolvers<{
    url: string | undefined;
    token: string | string[] | undefined;
    authorization: string | undefined;
    version: string | string[] | undefined;
    forwardProof: string | string[] | undefined;
    body: string;
  }>();
  const disconnected = Promise.withResolvers<void>();
  const upstream = createServer(async (request, response) => {
    response.once('close', () => disconnected.resolve());
    let body = '';
    for await (const chunk of request) body += chunk.toString();
    received.resolve({
      url: request.url,
      token: request.headers['x-api-key'],
      authorization: request.headers.authorization,
      version: request.headers['anthropic-version'],
      forwardProof: request.headers['x-zhiyuan-enterprise-forward'],
      body,
    });
    response.writeHead(200, { 'Content-Type': 'text/event-stream' });
    response.write('event: ping\ndata: {"type":"ping"}\n\n');
  });
  upstream.listen(0, '127.0.0.1');
  await once(upstream, 'listening');
  const { port } = upstream.address() as { port: number };
  const bridge = new ZhiyuanManagedProviderBridge();
  const dispose = bridge.registerSource({
    providerKey: 'custom_enterprise',
    exclusive: true,
    snapshot: async () => ({
      enabled: true,
      apiKey: 'fixture-anthropic-token',
      baseUrl: `http://127.0.0.1:${port}/per-model`,
      apiFormat: ApiFormat.Anthropic,
      models: [{ id: 'fixture', name: 'Fixture' }],
    }),
  });
  const gateway = await startEnterpriseModelGateway(bridge);
  try {
    await bridge.refresh();
    const [provider] = bridge.hostProviders(gateway.origin);
    const payload = JSON.stringify({
      model: 'fixture',
      max_tokens: 512,
      messages: [{ role: 'user', content: 'Hello' }],
      stream: true,
    });
    const response = await fetch(`${provider.baseUrl}/v1/messages`, {
      method: 'POST',
      headers: {
        'x-api-key': provider.apiKey!,
        'x-zhiyuan-enterprise-forward': gateway.key,
        'anthropic-version': '2023-06-01',
      },
      body: payload,
      signal: AbortSignal.timeout(5_000),
    });
    expect(response.status).toBe(200);
    const reader = response.body!.getReader();
    expect(new TextDecoder().decode((await reader.read()).value)).toContain('event: ping');
    expect(await received.promise).toEqual({
      url: '/per-model/v1/messages',
      token: 'fixture-anthropic-token',
      authorization: undefined,
      version: '2023-06-01',
      forwardProof: undefined,
      body: payload,
    });
    dispose();
    await expect(reader.read()).rejects.toThrow();
    await disconnected.promise;
  } finally {
    dispose();
    await gateway.close();
    upstream.closeAllConnections();
    await new Promise<void>(resolve => upstream.close(() => resolve()));
  }
});
