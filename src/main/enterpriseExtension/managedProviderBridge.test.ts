import http from 'node:http';
import { afterEach, describe, expect, test } from 'vitest';
import { once } from 'node:events';
import type { ProviderConfig } from '../../shared/providers';
import { ZhiyuanManagedProviderBridge } from './managedProviderBridge';
import { stopPiOpenAICompatProxyForTests } from '../libs/agentEngine/piOpenAICompatProxy';
const servers: http.Server[] = [];
afterEach(async () => {
  await stopPiOpenAICompatProxyForTests();
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
const config = (
  baseUrl = 'http://127.0.0.1:19999/v1',
  apiKey = 'fixture-enterprise-token',
): ProviderConfig => ({
  enabled: true,
  apiKey,
  baseUrl,
  displayName: 'Enterprise',
  models: [{ id: 'test-model', name: 'Test model', contextWindow: 8192 }],
});
async function server(handler: http.RequestListener): Promise<string> {
  const s = http.createServer(handler);
  servers.push(s);
  s.listen(0, '127.0.0.1');
  await once(s, 'listening');
  return `http://127.0.0.1:${(s.address() as import('node:net').AddressInfo).port}/v1`;
}
describe('enterprise provider loopback bridge', () => {
  test('keeps upstream token out of host definitions and exposes a precise exclusive model policy', async () => {
    const bridge = new ZhiyuanManagedProviderBridge();
    const dispose = bridge.registerSource({
      providerKey: 'custom_enterprise',
      exclusive: true,
      snapshot: async () => config(),
    });
    await bridge.refresh();
    const [provider] = bridge.hostProviders();
    expect(provider.id).toMatch(/^zhiyuan-host-enterprise-/);
    expect(provider.baseUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+\//);
    expect(provider.apiKey).not.toBe('fixture-enterprise-token');
    expect(JSON.stringify(bridge.catalog())).not.toContain('token');
    expect(JSON.stringify(bridge.hostProviders())).not.toContain('fixture-enterprise-token');
    expect(bridge.allowedModel(`${provider.id}/test-model`)).toBe(true);
    expect(bridge.allowedModel('ordinary/model')).toBe(false);
    expect(bridge.allowedModel('group/enterprise-alias')).toBe(false);
    dispose();
    expect(bridge.hostProviders()).toEqual([]);
  });
  test('forwards through the existing proxy and refreshes expired tokens without persisting them', async () => {
    const observed: string[] = [];
    const baseUrl = await server((req, res) => {
      observed.push(req.headers.authorization ?? '');
      if (req.headers.authorization === 'Bearer token-old') {
        res.writeHead(401);
        res.end('{}');
        return;
      }
      res.setHeader('content-type', 'application/json');
      res.end(
        JSON.stringify({
          id: 'fixture',
          choices: [{ message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
        }),
      );
    });
    let calls = 0;
    const bridge = new ZhiyuanManagedProviderBridge();
    const dispose = bridge.registerSource({
      providerKey: 'custom_enterprise',
      exclusive: true,
      snapshot: async () => config(baseUrl, ++calls <= 2 ? 'token-old' : 'token-new'),
    });
    await bridge.refresh();
    const [p] = bridge.hostProviders();
    const response = await fetch(`${p.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { authorization: `Bearer ${p.apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'test-model', messages: [], stream: false }),
    });
    expect(response.status).toBe(200);
    expect(observed).toEqual(['Bearer token-old', 'Bearer token-new']);
    dispose();
  });
  test('revocation immediately removes proxy capability and denies all exclusive models', async () => {
    let notify = () => {};
    let signedIn = true;
    const bridge = new ZhiyuanManagedProviderBridge();
    const dispose = bridge.registerSource({
      providerKey: 'custom_enterprise',
      exclusive: true,
      snapshot: async () => {
        if (!signedIn) throw new Error('signed out');
        return config();
      },
      onDidChange: listener => {
        notify = listener;
        return () => {};
      },
    });
    await bridge.refresh();
    const [p] = bridge.hostProviders();
    signedIn = false;
    notify();
    expect(bridge.hostProviders()).toEqual([]);
    expect(bridge.allowedModel(`${p.id}/test-model`)).toBe(false);
    const response = await fetch(`${p.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { authorization: `Bearer ${p.apiKey}` },
      body: '{}',
    });
    expect(response.status).toBe(404);
    await bridge.refresh();
    dispose();
  });
  test('rejects stale snapshot completion after source disposal', async () => {
    let finish!: (value: ProviderConfig) => void;
    const bridge = new ZhiyuanManagedProviderBridge();
    const dispose = bridge.registerSource({
      providerKey: 'custom_enterprise',
      exclusive: true,
      snapshot: () =>
        new Promise(resolve => {
          finish = resolve;
        }),
    });
    const pending = bridge.refresh();
    dispose();
    finish(config());
    await pending;
    expect(bridge.hostProviders()).toEqual([]);
  });
  test('keeps Anthropic routing and replaces only the local capability with the in-memory token', async () => {
    let observed: Record<string, unknown> = {};
    const base = await server((req, res) => {
      observed = {
        url: req.url,
        key: req.headers['x-api-key'],
        version: req.headers['anthropic-version'],
      };
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ type: 'message', content: [{ type: 'text', text: 'ok' }] }));
    });
    const bridge = new ZhiyuanManagedProviderBridge();
    const dispose = bridge.registerSource({
      providerKey: 'custom_enterprise',
      exclusive: true,
      snapshot: async () => ({ ...config(base.replace(/\/v1$/, '')), apiFormat: 'anthropic' }),
    });
    await bridge.refresh();
    const [p] = bridge.hostProviders();
    const response = await fetch(`${p.baseUrl}/v1/messages`, {
      method: 'POST',
      headers: {
        'x-api-key': p.apiKey!,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ model: 'test-model', messages: [], max_tokens: 32 }),
    });
    expect(response.status).toBe(200);
    expect(observed).toEqual({
      url: '/v1/messages',
      key: 'fixture-enterprise-token',
      version: '2023-06-01',
    });
    dispose();
  });
});
