import { describe, expect, test, vi } from 'vitest';
import type { ProviderConfig } from '../../shared/providers';
import { ZhiyuanManagedProviderBridge } from './managedProviderBridge';

const origin = 'http://127.0.0.1:4321';

const config = (
  baseUrl = 'https://api.enterprise.com/v1',
  apiKey = 'fixture-enterprise-token',
): ProviderConfig => ({
  enabled: true,
  apiKey,
  baseUrl,
  displayName: 'Enterprise',
  models: [{ id: 'test-model', name: 'Test model', contextWindow: 8192 }],
});

describe('enterprise provider bridge', () => {
  test('keeps upstream token out of host definitions and exposes a precise exclusive model policy', async () => {
    const bridge = new ZhiyuanManagedProviderBridge();
    const dispose = bridge.registerSource({
      providerKey: 'custom_enterprise',
      exclusive: true,
      snapshot: async () => config(),
    });
    await bridge.refresh();
    const [provider] = bridge.hostProviders(origin);
    expect(provider.id).toMatch(/^zhiyuan-host-enterprise-/);
    expect(bridge.hostProviders()).toEqual([]);
    expect(provider.baseUrl).toBe(`${origin}/${provider.id}/v1`);
    expect(provider.apiKey).not.toBe('fixture-enterprise-token');
    expect(JSON.stringify(bridge.catalog())).not.toContain('fixture-enterprise-token');
    expect(JSON.stringify(bridge.hostProviders(origin))).not.toContain('fixture-enterprise-token');
    expect(bridge.allowedModel(`${provider.id}/test-model`)).toBe(true);
    expect(bridge.allowedModel('ordinary/model')).toBe(false);
    expect(bridge.allowedModel('group/enterprise-alias')).toBe(false);

    const route = await bridge.resolveTransport(provider.id, provider.apiKey!);
    expect(route).toMatchObject({
      modelId: 'test-model',
      baseUrl: 'https://api.enterprise.com/v1',
      api: 'openai-completions',
    });
    expect(await bridge.resolveTransport('cloud', provider.apiKey!)).toBeNull();
    expect(await bridge.resolveTransport(provider.id, 'wrong-key')).toBeNull();

    dispose();
    expect(bridge.hostProviders(origin)).toEqual([]);
    expect(route?.signal.aborted).toBe(true);
    expect(await bridge.resolveTransport(provider.id, provider.apiKey!)).toBeNull();
  });

  test('reads the cached token and shares the next source refresh', async () => {
    let calls = 0;
    const bridge = new ZhiyuanManagedProviderBridge();
    const dispose = bridge.registerSource({
      providerKey: 'custom_enterprise',
      exclusive: true,
      snapshot: async () => config('https://api.enterprise.com/v1', `token-v${++calls}`),
    });
    await vi.waitFor(() => expect(bridge.hostProviders(origin)).toHaveLength(1));
    const initialCalls = calls;
    const [provider] = bridge.hostProviders(origin);

    const token1 = await bridge.resolveTransport(provider.id, provider.apiKey!);
    expect(token1?.token).toBe(`token-v${initialCalls}`);
    expect(calls).toBe(initialCalls);

    // Subsequent call returns cached token without calling snapshot again
    const token2 = await bridge.resolveTransport(provider.id, provider.apiKey!);
    expect(token2?.token).toBe(`token-v${initialCalls}`);
    expect(calls).toBe(initialCalls);

    const refresh = bridge.refresh();
    const [tokenA, tokenB] = await Promise.all([
      bridge.resolveTransport(provider.id, provider.apiKey!),
      bridge.resolveTransport(provider.id, provider.apiKey!),
    ]);
    await refresh;
    expect(tokenA?.token).toBe(`token-v${initialCalls + 1}`);
    expect(tokenB?.token).toBe(`token-v${initialCalls + 1}`);
    expect(calls).toBe(initialCalls + 1);

    dispose();
  });

  test('does not resolve a key for a mismatched or retired provider endpoint', async () => {
    const first = 'https://first.enterprise.test/v1';
    const second = 'https://second.enterprise.test/v1';
    let current = config(first, 'first-token');
    const bridge = new ZhiyuanManagedProviderBridge();
    const dispose = bridge.registerSource({
      providerKey: 'custom_enterprise',
      exclusive: true,
      snapshot: async () => current,
    });
    try {
      await bridge.refresh();
      const [previous] = bridge.hostProviders(origin);
      expect(await bridge.resolveTransport(previous.id, second)).toBeNull();
      const previousRoute = await bridge.resolveTransport(previous.id, previous.apiKey!);
      current = config(second, 'second-token');
      await bridge.refresh();
      expect(await bridge.resolveTransport(previous.id, previous.apiKey!)).toBeNull();
      expect(previousRoute?.signal.aborted).toBe(true);
      const [active] = bridge.hostProviders(origin);
      expect(await bridge.resolveTransport(active.id, active.apiKey!)).toMatchObject({
        token: 'second-token',
        baseUrl: second,
      });
    } finally {
      dispose();
    }
  });

  test('does not return a newly authorized endpoint key to a request waiting for refresh', async () => {
    const first = 'https://first.enterprise.test/v1';
    const second = 'https://second.enterprise.test/v1';
    const snapshot = Promise.withResolvers<ProviderConfig>();
    let refreshInFlight = false;
    const bridge = new ZhiyuanManagedProviderBridge();
    const dispose = bridge.registerSource({
      providerKey: 'custom_enterprise',
      exclusive: true,
      snapshot: async () => (refreshInFlight ? snapshot.promise : config(first, 'first-token')),
    });
    try {
      await vi.waitFor(() => expect(bridge.hostProviders(origin)).toHaveLength(1));
      const [previous] = bridge.hostProviders(origin);
      refreshInFlight = true;
      const refresh = bridge.refresh();
      const inFlight = bridge.resolveTransport(previous.id, previous.apiKey!);
      snapshot.resolve(config(second, 'second-token'));
      expect(await inFlight).toBeNull();
      await refresh;
      const [active] = bridge.hostProviders(origin);
      expect(await bridge.resolveTransport(active.id, active.apiKey!)).toMatchObject({
        token: 'second-token',
        baseUrl: second,
      });
    } finally {
      dispose();
    }
  });

  test('revocation immediately removes models and denies all exclusive models', async () => {
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
    const [p] = bridge.hostProviders(origin);
    expect(p).toBeDefined();

    const route = await bridge.resolveTransport(p.id, p.apiKey!);
    signedIn = false;
    notify();
    expect(bridge.hostProviders(origin)).toEqual([]);
    expect(bridge.allowedModel(`${p.id}/test-model`)).toBe(false);
    expect(await bridge.resolveTransport(p.id, p.apiKey!)).toBeNull();

    await bridge.refresh();
    expect(route?.signal.aborted).toBe(true);
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
    expect(bridge.hostProviders(origin)).toEqual([]);
  });

  test('configures Anthropic routing correctly in enterprise model config', async () => {
    const bridge = new ZhiyuanManagedProviderBridge();
    const dispose = bridge.registerSource({
      providerKey: 'custom_enterprise',
      exclusive: true,
      snapshot: async () => ({
        ...config('https://api.anthropic.enterprise.com'),
        apiFormat: 'anthropic',
      }),
    });
    await bridge.refresh();
    const [p] = bridge.hostProviders(origin);
    expect(p.api).toBe('anthropic-messages');

    const modelConfig = await bridge.resolveTransport(p.id, p.apiKey!);
    expect(modelConfig?.api).toBe('anthropic-messages');
    expect(modelConfig?.baseUrl).toBe('https://api.anthropic.enterprise.com');

    dispose();
  });
});
