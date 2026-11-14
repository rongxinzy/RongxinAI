import { describe, expect, it, vi } from 'vitest';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { ZhiyuanModelPoolHeader } from '../src/shared/modelPool/constants';
import { createPiEnterpriseProviderExtension } from '../src/main/enterpriseExtension/piEnterpriseProviderExtension';
import {
  ZhiyuanManagedProviderBridge,
  type ManagedEnterpriseModelRuntimeConfig,
} from '../src/main/enterpriseExtension/managedProviderBridge';
import { PiExtensionEventType } from '../src/main/libs/agentEngine/piExtensionTypes';

describe('Adversarial Enterprise Hooks & Proxy Retirement (M3)', () => {
  describe('Dimension 1: Complete Proxy Retirement', () => {
    it('verifies piOpenAICompatProxy files are completely deleted from disk', () => {
      const proxyPath = resolve(__dirname, '../src/main/libs/agentEngine/piOpenAICompatProxy.ts');
      const testPath = resolve(
        __dirname,
        '../src/main/libs/agentEngine/piOpenAICompatProxy.test.ts',
      );
      expect(existsSync(proxyPath)).toBe(false);
      expect(existsSync(testPath)).toBe(false);
    });

    it('verifies bridge does not create real listening sockets or loopback servers', async () => {
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
      const providers = bridge.hostProviders();
      expect(providers.length).toBe(1);
      // Supplying dummy virtual loopback 127.0.0.1:0/v1
      expect(providers[0].baseUrl).toBe('http://127.0.0.1:0/v1');

      // The real upstream URL must be preserved in runtime config, not the dummy port 0
      const runtimeConfig = bridge.getEnterpriseModelConfig('m1');
      expect(runtimeConfig?.baseUrl).toBe('https://upstream.enterprise.com/v1');
      expect(runtimeConfig?.apiKey).toBe('test-token');

      dispose();
    });
  });

  describe('Dimension 2: Lifecycle Hook Edge Cases & Immutability', () => {
    function setupExtension(options?: {
      isManaged?: boolean;
      token?: string;
      api?: string;
      headers?: Record<string, string>;
    }) {
      const handlers: Record<string, (event: any, ctx?: any) => Promise<any> | any> = {};
      const mockExtensionApi = {
        on: vi.fn((event: string, handler: any) => {
          handlers[event] = handler;
        }),
      };

      let cachedToken = options?.token ?? 'secret-token-100';
      let tokenInvalidated = false;

      const mockBridge = {
        isManagedProvider: vi.fn((provider: string) =>
          options?.isManaged !== undefined
            ? options.isManaged
            : provider.startsWith('zhiyuan-host-enterprise-'),
        ),
        getEnterpriseModelConfig: vi.fn((modelId: string) =>
          modelId === 'ent-model'
            ? ({
                modelId: 'ent-model',
                providerKey: 'zhiyuan-host-enterprise-1',
                baseUrl: 'https://api.enterprise.com/v1',
                api: (options?.api ?? 'openai-completions') as any,
                apiKey: cachedToken,
              } as ManagedEnterpriseModelRuntimeConfig)
            : null,
        ),
        getToken: vi.fn(async () => {
          if (tokenInvalidated) {
            cachedToken = 'refreshed-token-200';
            tokenInvalidated = false;
          }
          return cachedToken;
        }),
        invalidateToken: vi.fn(() => {
          tokenInvalidated = true;
        }),
      } as unknown as ZhiyuanManagedProviderBridge;

      const extensionFactory = createPiEnterpriseProviderExtension(mockBridge);
      extensionFactory(mockExtensionApi as any);

      const ctx = {
        model: {
          id: 'ent-model',
          provider: 'zhiyuan-host-enterprise-1',
          api: options?.api ?? 'openai-completions',
          headers: options?.headers ?? {
            [ZhiyuanModelPoolHeader.ConversationId]: 'conv-test-999',
            [ZhiyuanModelPoolHeader.Workload]: 'workload-batch',
          },
        },
      };

      return { handlers, mockBridge, mockExtensionApi, ctx };
    }

    it('proactively refreshes missing or invalidated token on before_provider_headers', async () => {
      const { handlers, mockBridge, ctx } = setupExtension();
      mockBridge.invalidateToken();

      const event = {
        type: 'before_provider_headers' as const,
        headers: {} as Record<string, string | null>,
      };

      await handlers[PiExtensionEventType.BeforeProviderHeaders](event, ctx);
      expect(mockBridge.getToken).toHaveBeenCalledTimes(1);
      expect(event.headers['authorization']).toBe('Bearer refreshed-token-200');
    });

    it('does not crash when payload is null, undefined, primitive, or non-object in before_provider_request', () => {
      const { handlers, ctx } = setupExtension();
      const fn = handlers[PiExtensionEventType.BeforeProviderRequest];

      expect(() => fn({ type: 'before_provider_request', payload: null }, ctx)).not.toThrow();
      expect(() => fn({ type: 'before_provider_request', payload: undefined }, ctx)).not.toThrow();
      expect(() =>
        fn({ type: 'before_provider_request', payload: 'string-payload' }, ctx),
      ).not.toThrow();
      expect(() => fn({ type: 'before_provider_request', payload: 12345 }, ctx)).not.toThrow();
      expect(() => fn({ type: 'before_provider_request', payload: true }, ctx)).not.toThrow();
    });

    it('does not crash when payload.messages is not an array or contains primitives / nulls', () => {
      const { handlers, ctx } = setupExtension();
      const fn = handlers[PiExtensionEventType.BeforeProviderRequest];

      expect(() =>
        fn({ type: 'before_provider_request', payload: { messages: 'not-array' } }, ctx),
      ).not.toThrow();
      expect(() =>
        fn({ type: 'before_provider_request', payload: { messages: null } }, ctx),
      ).not.toThrow();
      expect(() =>
        fn(
          {
            type: 'before_provider_request',
            payload: { messages: [null, undefined, 42, 'string', { role: 'user', content: 'hi' }] },
          },
          ctx,
        ),
      ).not.toThrow();
    });

    it('TRANSFORMATION IMMUTABILITY: transforms role: "developer" to "system" WITHOUT mutating input message or payload', () => {
      const { handlers, ctx } = setupExtension();
      const fn = handlers[PiExtensionEventType.BeforeProviderRequest];

      const originalMessage = { role: 'developer', content: 'Act as developer agent' };
      const originalPayload = {
        model: 'ent-model',
        messages: [originalMessage, { role: 'user', content: 'Hello' }],
      };

      const result = fn({ type: 'before_provider_request', payload: originalPayload }, ctx);

      // Returned payload should have role: 'system'
      expect(result.messages[0].role).toBe('system');

      // CRITICAL CHECK: The original message object MUST NOT be mutated!
      expect(originalMessage.role).toBe('developer');
    });

    it('FROZEN OBJECT RESILIENCE: transforms role: "developer" to "system" when input payload or message is Object.freeze()', () => {
      const { handlers, ctx } = setupExtension();
      const fn = handlers[PiExtensionEventType.BeforeProviderRequest];

      const frozenMessage = Object.freeze({ role: 'developer', content: 'System prompt' });
      const frozenPayload = Object.freeze({
        model: 'ent-model',
        messages: Object.freeze([frozenMessage]),
      });

      let result: any;
      expect(() => {
        result = fn({ type: 'before_provider_request', payload: frozenPayload }, ctx);
      }).not.toThrow();

      expect(result.messages[0].role).toBe('system');
      expect(frozenMessage.role).toBe('developer');
    });

    it('invalidates token on 401 and 403 in after_provider_response', () => {
      const { handlers, mockBridge, ctx } = setupExtension();
      const fn = handlers[PiExtensionEventType.AfterProviderResponse];

      fn({ type: 'after_provider_response', status: 401, headers: {} }, ctx);
      expect(mockBridge.invalidateToken).toHaveBeenCalledTimes(1);

      fn({ type: 'after_provider_response', status: 403, headers: {} }, ctx);
      expect(mockBridge.invalidateToken).toHaveBeenCalledTimes(2);

      fn({ type: 'after_provider_response', status: 200, headers: {} }, ctx);
      fn({ type: 'after_provider_response', status: 429, headers: {} }, ctx);
      fn({ type: 'after_provider_response', status: 500, headers: {} }, ctx);
      expect(mockBridge.invalidateToken).toHaveBeenCalledTimes(2);
    });
  });

  describe('Dimension 3: Multi-turn Concurrent Requests & Token Coalescing', () => {
    it('coalesces 50 concurrent getToken calls into exactly 1 refresh call during cache miss/invalidation', async () => {
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

      await bridge.refresh();
      const initialCount = snapshotCallCount;
      expect(initialCount).toBeGreaterThanOrEqual(1);

      // Invalidate token
      bridge.invalidateToken();

      // Launch 50 concurrent requests simultaneously
      const results = await Promise.all(Array.from({ length: 50 }, () => bridge.getToken()));

      // All 50 requests must receive the exact same refreshed token
      for (const token of results) {
        expect(token).toBe(`token-v${initialCount + 1}`);
      }

      // Snapshot must only have been invoked ONCE for all 50 concurrent calls
      expect(snapshotCallCount).toBe(initialCount + 1);

      dispose();
    });

    it('recovers cleanly when token refresh fails without permanently poisoning promise', async () => {
      let shouldFail = true;
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

      // Initial refresh fails
      await bridge.refresh();
      const initialCount = snapshotCount;
      expect(initialCount).toBeGreaterThanOrEqual(1);

      // getToken should reject with the error
      await expect(bridge.getToken()).rejects.toThrow('Upstream enterprise auth service 503');

      // Next attempt after service recovery should NOT return old rejected promise, but succeed
      shouldFail = false;
      const token = await bridge.getToken();
      expect(token).toBe('recovered-token-xyz');
      expect(snapshotCount).toBeGreaterThan(initialCount);

      dispose();
    });
  });
});
