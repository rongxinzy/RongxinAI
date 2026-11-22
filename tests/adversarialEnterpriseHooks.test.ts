import { describe, expect, it, vi } from 'vitest';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { ZhiyuanManagedProviderBridge } from '../src/main/enterpriseExtension/managedProviderBridge';

const origin = 'http://127.0.0.1:4321';

describe('Enterprise provider ownership', () => {
  describe('Proxy retirement', () => {
    it('verifies piOpenAICompatProxy files are completely deleted from disk', () => {
      const proxyPath = resolve(__dirname, '../src/main/libs/agentEngine/piOpenAICompatProxy.ts');
      const testPath = resolve(
        __dirname,
        '../src/main/libs/agentEngine/piOpenAICompatProxy.test.ts',
      );
      expect(existsSync(proxyPath)).toBe(false);
      expect(existsSync(testPath)).toBe(false);
    });

    it('does not publish an enterprise route until the host transport has an origin', async () => {
      const bridge = new ZhiyuanManagedProviderBridge();
      const dispose = bridge.registerSource({
        providerKey: 'custom_enterprise_stress',
        exclusive: true,
        snapshot: async () => ({
          enabled: true,
          apiKey: 'test-token',
          baseUrl: 'https://upstream.enterprise.com/v1',
          displayName: 'Enterprise Stress',
          models: [{ id: 'm1', name: 'Model 1', contextWindow: 4096 }],
        }),
      });

      await bridge.refresh();
      const providers = bridge.hostProviders(origin);
      expect(providers.length).toBe(1);
      expect(bridge.hostProviders()).toEqual([]);
      expect(providers[0].baseUrl).toBe(`${origin}/${providers[0].id}/v1`);

      expect(JSON.stringify(providers)).not.toContain('test-token');
      await expect(
        bridge.resolveTransport(providers[0].id, providers[0].apiKey!),
      ).resolves.toMatchObject({
        baseUrl: 'https://upstream.enterprise.com/v1',
        token: 'test-token',
      });

      dispose();
    });
  });

  describe('Source refresh', () => {
    it('shares an in-flight source refresh across 50 concurrent token reads', async () => {
      let snapshotCallCount = 0;
      const bridge = new ZhiyuanManagedProviderBridge();

      const dispose = bridge.registerSource({
        providerKey: 'custom_enterprise_concurrency',
        exclusive: true,
        snapshot: async () => {
          snapshotCallCount++;
          // Simulate network latency for token endpoint
          await new Promise(r => setTimeout(r, 20));
          return {
            enabled: true,
            apiKey: `token-v${snapshotCallCount}`,
            baseUrl: 'https://api.enterprise.com/v1',
            displayName: 'Concurrency Test',
            models: [{ id: 'model-c', name: 'Model Concurrency' }],
          };
        },
      });

      await vi.waitFor(() => expect(bridge.hostProviders(origin)).toHaveLength(1));
      const initialCount = snapshotCallCount;
      expect(initialCount).toBe(1);
      const [provider] = bridge.hostProviders(origin);
      const refresh = bridge.refresh();

      // Launch 50 concurrent requests simultaneously
      const results = await Promise.all(
        Array.from({ length: 50 }, () => bridge.resolveTransport(provider.id, provider.apiKey!)),
      );
      await refresh;

      // All 50 requests must receive the exact same refreshed token
      for (const token of results) {
        expect(token?.token).toBe(`token-v${initialCount + 1}`);
      }

      // Snapshot must only have been invoked ONCE for all 50 concurrent calls
      expect(snapshotCallCount).toBe(initialCount + 1);

      dispose();
    });

    it('withholds auth after a failed refresh and recovers when the source is available', async () => {
      let shouldFail = false;
      let snapshotCount = 0;
      const bridge = new ZhiyuanManagedProviderBridge();

      const dispose = bridge.registerSource({
        providerKey: 'custom_enterprise_failure',
        exclusive: true,
        snapshot: async () => {
          snapshotCount++;
          if (shouldFail) {
            throw new Error('Upstream enterprise auth service 503 Unavailable');
          }
          return {
            enabled: true,
            apiKey: 'recovered-token-xyz',
            baseUrl: 'https://api.enterprise.com/v1',
            displayName: 'Recovery Test',
            models: [{ id: 'model-r', name: 'Model Recovery' }],
          };
        },
      });

      await vi.waitFor(() => expect(bridge.hostProviders(origin)).toHaveLength(1));
      const initialCount = snapshotCount;
      const [provider] = bridge.hostProviders(origin);
      shouldFail = true;
      const refresh = bridge.refresh();
      await expect(bridge.resolveTransport(provider.id, provider.apiKey!)).resolves.toBeNull();
      await refresh;
      expect(bridge.hostProviders(origin)).toEqual([]);

      shouldFail = false;
      await bridge.refresh();
      await expect(bridge.resolveTransport(provider.id, provider.apiKey!)).resolves.toMatchObject({
        token: 'recovered-token-xyz',
      });
      expect(snapshotCount).toBeGreaterThan(initialCount);

      dispose();
    });
  });
});
