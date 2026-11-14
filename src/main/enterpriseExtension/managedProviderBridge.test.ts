import { describe, expect, test } from 'vitest';
import type { ProviderConfig } from '../../shared/providers';
import { ZhiyuanManagedProviderBridge } from './managedProviderBridge';

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
    const [provider] = bridge.hostProviders();
    expect(provider.id).toMatch(/^zhiyuan-host-enterprise-/);
    // Supplying virtual loopback URL http://127.0.0.1:0/v1 satisfies Magpie validation without sockets
    expect(provider.baseUrl).toBe('http://127.0.0.1:0/v1');
    expect(provider.apiKey).not.toBe('fixture-enterprise-token');
    expect(JSON.stringify(bridge.catalog())).not.toContain('fixture-enterprise-token');
    expect(JSON.stringify(bridge.hostProviders())).not.toContain('fixture-enterprise-token');
    expect(bridge.allowedModel(`${provider.id}/test-model`)).toBe(true);
    expect(bridge.allowedModel('ordinary/model')).toBe(false);
    expect(bridge.allowedModel('group/enterprise-alias')).toBe(false);

    // Direct model runtime config retrieval
    const modelConfig = bridge.getEnterpriseModelConfig('test-model');
    expect(modelConfig).not.toBeNull();
    expect(modelConfig?.baseUrl).toBe('https://api.enterprise.com/v1');
    expect(modelConfig?.apiKey).toBe('fixture-enterprise-token');
    expect(modelConfig?.api).toBe('openai-completions');

    dispose();
    expect(bridge.hostProviders()).toEqual([]);
    expect(bridge.getEnterpriseModelConfig('test-model')).toBeNull();
  });

  test('refreshes and coalesces tokens without exposing credentials in host definitions', async () => {
    let calls = 0;
    const bridge = new ZhiyuanManagedProviderBridge();
    const dispose = bridge.registerSource({
      providerKey: 'custom_enterprise',
      exclusive: true,
      snapshot: async () => config('https://api.enterprise.com/v1', `token-v${++calls}`),
    });
    await bridge.refresh();
    const initialCalls = calls;

    const token1 = await bridge.getToken();
    expect(token1).toBe(`token-v${initialCalls}`);
    expect(calls).toBe(initialCalls);

    // Subsequent call returns cached token without calling snapshot again
    const token2 = await bridge.getToken();
    expect(token2).toBe(`token-v${initialCalls}`);
    expect(calls).toBe(initialCalls);

    // After invalidation (e.g. 401/403 response), next call fetches fresh token
    bridge.invalidateToken();
    // Simulate concurrent requests requesting fresh token
    const [tokenA, tokenB] = await Promise.all([bridge.getToken(), bridge.getToken()]);
    expect(tokenA).toBe(`token-v${initialCalls + 1}`);
    expect(tokenB).toBe(`token-v${initialCalls + 1}`);
    expect(calls).toBe(initialCalls + 1);

    dispose();
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
    const [p] = bridge.hostProviders();
    expect(p).toBeDefined();

    signedIn = false;
    notify();
    expect(bridge.hostProviders()).toEqual([]);
    expect(bridge.allowedModel(`${p.id}/test-model`)).toBe(false);
    expect(bridge.getEnterpriseModelConfig('test-model')).toBeNull();

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
    const [p] = bridge.hostProviders();
    expect(p.api).toBe('anthropic-messages');

    const modelConfig = bridge.getEnterpriseModelConfig('test-model');
    expect(modelConfig?.api).toBe('anthropic-messages');
    expect(modelConfig?.baseUrl).toBe('https://api.anthropic.enterprise.com');

    dispose();
  });
});
