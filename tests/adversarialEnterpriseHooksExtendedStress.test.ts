import { describe, expect, it, vi } from 'vitest';
import { ZhiyuanModelPoolHeader } from '../src/shared/modelPool/constants';
import { createPiEnterpriseProviderExtension } from '../src/main/enterpriseExtension/piEnterpriseProviderExtension';
import type {
  ZhiyuanManagedProviderBridge,
  ManagedEnterpriseModelRuntimeConfig,
} from '../src/main/enterpriseExtension/managedProviderBridge';
import { PiExtensionEventType } from '../src/main/libs/agentEngine/piExtensionTypes';

function setupHarness(options?: {
  isManaged?: boolean;
  token?: string;
  api?: string;
  headers?: Record<string, string>;
  modelId?: string;
  provider?: string;
}) {
  const handlers: Record<string, (event: any, ctx?: any) => Promise<any> | any> = {};
  const mockExtensionApi = {
    on: vi.fn((event: string, handler: any) => {
      handlers[event] = handler;
    }),
  };

  let cachedToken = options?.token ?? 'active-token-001';
  let tokenInvalidated = false;

  const mockBridge = {
    isManagedProvider: vi.fn((provider: string) =>
      options?.isManaged !== undefined
        ? options.isManaged
        : provider.startsWith('zhiyuan-host-enterprise-'),
    ),
    getEnterpriseModelConfig: vi.fn((modelId: string) =>
      modelId === (options?.modelId ?? 'ent-model')
        ? ({
            modelId: options?.modelId ?? 'ent-model',
            providerKey: options?.provider ?? 'zhiyuan-host-enterprise-1',
            baseUrl: 'https://api.enterprise.com/v1',
            api: (options?.api ?? 'openai-completions') as any,
            apiKey: cachedToken,
          } as ManagedEnterpriseModelRuntimeConfig)
        : null,
    ),
    getToken: vi.fn(async () => {
      if (tokenInvalidated) {
        cachedToken = 'refreshed-token-002';
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
      id: options?.modelId ?? 'ent-model',
      provider: options?.provider ?? 'zhiyuan-host-enterprise-1',
      api: options?.api ?? 'openai-completions',
      headers: options?.headers ?? {
        [ZhiyuanModelPoolHeader.ConversationId]: 'conv-test-999',
        [ZhiyuanModelPoolHeader.Workload]: 'workload-batch',
      },
    },
  };

  return { handlers, mockBridge, mockExtensionApi, ctx };
}

describe('Adversarial Enterprise Hooks Extended Stress Harness', () => {
  describe('Dimension 1: Deep Freeze & Immutability Stress', () => {
    it('handles deeply frozen payload, arrays, and nested message objects without throwing', () => {
      const { handlers, ctx } = setupHarness();
      const fn = handlers[PiExtensionEventType.BeforeProviderRequest];

      const deepFrozenDevMsg = Object.freeze({
        role: 'developer',
        content: Object.freeze([{ type: 'text', text: 'strictly frozen text' }]),
        metadata: Object.freeze({ strict: true }),
      });
      const deepFrozenUserMsg = Object.freeze({
        role: 'user',
        content: Object.freeze([{ type: 'text', text: 'user input' }]),
      });
      const deepFrozenPayload = Object.freeze({
        model: 'ent-model',
        temperature: 0.7,
        messages: Object.freeze([deepFrozenDevMsg, deepFrozenUserMsg]),
      });

      let result: any;
      expect(() => {
        result = fn({ type: 'before_provider_request', payload: deepFrozenPayload }, ctx);
      }).not.toThrow();

      // Original objects remain frozen and untouched
      expect(Object.isFrozen(deepFrozenPayload)).toBe(true);
      expect(Object.isFrozen(deepFrozenDevMsg)).toBe(true);
      expect(deepFrozenDevMsg.role).toBe('developer');

      // Transformed result has role: 'system' for developer message
      expect(result.messages[0].role).toBe('system');
      expect(result.messages[0].metadata).toBe(deepFrozenDevMsg.metadata);
      expect(result.messages[0].content).toBe(deepFrozenDevMsg.content);

      // Non-developer message is reference-identical
      expect(result.messages[1]).toBe(deepFrozenUserMsg);
    });

    it('handles getter-backed and sealed message objects', () => {
      const { handlers, ctx } = setupHarness();
      const fn = handlers[PiExtensionEventType.BeforeProviderRequest];

      const sealedDevMsg = Object.seal({
        role: 'developer',
        get content() {
          return 'getter-content';
        },
      });

      const payload = {
        model: 'ent-model',
        messages: [sealedDevMsg],
      };

      let result: any;
      expect(() => {
        result = fn({ type: 'before_provider_request', payload }, ctx);
      }).not.toThrow();

      expect(result.messages[0].role).toBe('system');
      expect(result.messages[0].content).toBe('getter-content');
      expect(sealedDevMsg.role).toBe('developer');
    });
  });

  describe('Dimension 2: Reference Identity Preservation for Non-Developer Messages', () => {
    it('preserves exact object references (===) for all non-developer messages across 100 interleaved messages', () => {
      const { handlers, ctx } = setupHarness();
      const fn = handlers[PiExtensionEventType.BeforeProviderRequest];

      const messages: any[] = [];
      const roles = ['user', 'assistant', 'system', 'tool', 'developer'];
      for (let i = 0; i < 100; i++) {
        const role = roles[i % roles.length];
        messages.push({
          id: `msg-${i}`,
          role,
          content: `Content for ${role} #${i}`,
          extra: { index: i },
        });
      }

      const payload = {
        model: 'ent-model',
        messages,
      };

      const result = fn({ type: 'before_provider_request', payload }, ctx);

      expect(result.messages).toHaveLength(100);

      for (let i = 0; i < 100; i++) {
        const original = messages[i];
        const transformed = result.messages[i];

        if (original.role === 'developer') {
          expect(transformed.role).toBe('system');
          expect(transformed.content).toBe(original.content);
          expect(transformed.id).toBe(original.id);
          expect(transformed.extra).toBe(original.extra);
          expect(transformed).not.toBe(original); // Cloned
          expect(original.role).toBe('developer'); // Original not mutated
        } else {
          // MUST BE EXACT SAME REFERENCE
          expect(transformed).toBe(original);
        }
      }
    });

    it('returns exact same payload reference when no developer messages exist (zero unnecessary allocation)', () => {
      const { handlers, ctx } = setupHarness();
      const fn = handlers[PiExtensionEventType.BeforeProviderRequest];

      const payload = {
        model: 'ent-model',
        messages: [
          { role: 'system', content: 'system prompt' },
          { role: 'user', content: 'user question' },
          { role: 'assistant', content: 'assistant answer' },
        ],
      };

      const result = fn({ type: 'before_provider_request', payload }, ctx);

      // Must return identical payload instance
      expect(result).toBe(payload);
      expect(result.messages).toBe(payload.messages);
    });
  });

  describe('Dimension 3: Strict Enterprise Model Scoping', () => {
    it('does NOT transform role: developer for non-enterprise models (e.g. OpenAI o1/o3-mini)', () => {
      const { handlers } = setupHarness();
      const fn = handlers[PiExtensionEventType.BeforeProviderRequest];

      const o1Ctx = {
        model: {
          id: 'o1-preview',
          provider: 'openai',
          api: 'openai-completions',
        },
      };

      const devMessage = { role: 'developer', content: 'Instructions for reasoning' };
      const payload = {
        model: 'o1-preview',
        messages: [devMessage, { role: 'user', content: 'Solve this puzzle' }],
      };

      const result = fn({ type: 'before_provider_request', payload }, o1Ctx);

      // Must return exact same payload reference untouched
      expect(result).toBe(payload);
      expect(result.messages[0].role).toBe('developer');
      expect(devMessage.role).toBe('developer');
    });

    it('does NOT inject headers for non-enterprise models in before_provider_headers', async () => {
      const { handlers, mockBridge } = setupHarness();
      const fn = handlers[PiExtensionEventType.BeforeProviderHeaders];

      const nonEnterpriseCtx = {
        model: {
          id: 'claude-3-5-sonnet-20241022',
          provider: 'anthropic',
          api: 'anthropic-messages',
          headers: {
            'x-custom-test': 'should-not-be-injected',
          },
        },
      };

      const event = {
        type: 'before_provider_headers' as const,
        headers: {} as Record<string, string | null>,
      };

      await fn(event, nonEnterpriseCtx);

      expect(mockBridge.getToken).not.toHaveBeenCalled();
      expect(event.headers).toEqual({});
    });

    it('does NOT invalidate token for non-enterprise models in after_provider_response', () => {
      const { handlers, mockBridge } = setupHarness();
      const fn = handlers[PiExtensionEventType.AfterProviderResponse];

      const nonEnterpriseCtx = {
        model: {
          id: 'gpt-4o',
          provider: 'openai',
          api: 'openai-completions',
        },
      };

      fn({ type: 'after_provider_response', status: 401, headers: {} }, nonEnterpriseCtx);
      fn({ type: 'after_provider_response', status: 403, headers: {} }, nonEnterpriseCtx);

      expect(mockBridge.invalidateToken).not.toHaveBeenCalled();
    });

    it('gracefully handles missing, null, undefined, or empty context objects across all hooks', async () => {
      const { handlers, mockBridge } = setupHarness();

      const nullCtxs = [
        undefined,
        null,
        {},
        { model: undefined },
        { model: { id: 'unknown-model', provider: 'other-provider' } },
      ];

      for (const ctx of nullCtxs) {
        // 1. BeforeProviderHeaders
        const headerEvent = {
          type: 'before_provider_headers' as const,
          headers: {} as Record<string, string | null>,
        };
        await expect(
          handlers[PiExtensionEventType.BeforeProviderHeaders](headerEvent, ctx),
        ).resolves.not.toThrow();
        expect(mockBridge.getToken).not.toHaveBeenCalled();

        // 2. BeforeProviderRequest
        const payload = { messages: [{ role: 'developer', content: 'test' }] };
        const reqResult = handlers[PiExtensionEventType.BeforeProviderRequest](
          { type: 'before_provider_request', payload },
          ctx,
        );
        expect(reqResult).toBe(payload);
        expect(payload.messages[0].role).toBe('developer');

        // 3. AfterProviderResponse
        expect(() => {
          handlers[PiExtensionEventType.AfterProviderResponse](
            { type: 'after_provider_response', status: 401, headers: {} },
            ctx,
          );
        }).not.toThrow();
        expect(mockBridge.invalidateToken).not.toHaveBeenCalled();
      }
    });

    it('identifies enterprise models by provider === "enterprise"', async () => {
      const { handlers, mockBridge } = setupHarness({
        isManaged: false, // bridge says false for isManagedProvider
        modelId: 'some-other-id', // bridge config returns null
      });

      const enterpriseCtx = {
        model: {
          id: 'unregistered-id',
          provider: 'enterprise', // matches provider === 'enterprise'
          api: 'openai-completions',
        },
      };

      const event = {
        type: 'before_provider_headers' as const,
        headers: {} as Record<string, string | null>,
      };

      await handlers[PiExtensionEventType.BeforeProviderHeaders](event, enterpriseCtx);
      expect(mockBridge.getToken).toHaveBeenCalled();
      expect(event.headers['authorization']).toBe('Bearer active-token-001');
    });
  });

  describe('Dimension 4: Header Hygiene & Case Normalization', () => {
    it('cleans pre-existing uppercase Authorization and produces single lowercase authorization header', async () => {
      const { handlers, ctx } = setupHarness();
      const fn = handlers[PiExtensionEventType.BeforeProviderHeaders];

      const event = {
        type: 'before_provider_headers' as const,
        headers: {
          Authorization: 'Bearer stale-upper-token',
          'content-type': 'application/json',
        } as Record<string, string | null>,
      };

      await fn(event, ctx);

      // Check key presence
      expect(event.headers['authorization']).toBe('Bearer active-token-001');
      expect(event.headers['Authorization']).toBeUndefined();
      expect('Authorization' in event.headers).toBe(false);

      // Verify no other casing exists in Object.keys
      const authKeys = Object.keys(event.headers).filter(k => k.toLowerCase() === 'authorization');
      expect(authKeys).toEqual(['authorization']);
    });

    it('injects x-api-key without authorization header for Anthropic enterprise models', async () => {
      const { handlers, ctx } = setupHarness({ api: 'anthropic-messages' });
      const fn = handlers[PiExtensionEventType.BeforeProviderHeaders];

      const event = {
        type: 'before_provider_headers' as const,
        headers: {
          'user-agent': 'zhiyuan-client',
        } as Record<string, string | null>,
      };

      await fn(event, ctx);

      expect(event.headers['x-api-key']).toBe('active-token-001');
      expect(event.headers['authorization']).toBeUndefined();
      expect(event.headers['Authorization']).toBeUndefined();
    });

    it('updates existing x-api-key if present on OpenAI-compatible enterprise models', async () => {
      const { handlers, ctx } = setupHarness({ api: 'openai-completions' });
      const fn = handlers[PiExtensionEventType.BeforeProviderHeaders];

      const event = {
        type: 'before_provider_headers' as const,
        headers: {
          'x-api-key': 'old-key',
        } as Record<string, string | null>,
      };

      await fn(event, ctx);

      expect(event.headers['authorization']).toBe('Bearer active-token-001');
      expect(event.headers['x-api-key']).toBe('active-token-001');
    });
  });

  describe('Dimension 5: Exotic & Malformed Request Bodies', () => {
    it('handles legacy prompt payloads, non-array messages, and corrupted message entries', () => {
      const { handlers, ctx } = setupHarness();
      const fn = handlers[PiExtensionEventType.BeforeProviderRequest];

      const cases = [
        { payload: { prompt: 'Translate hello to French' } },
        { payload: { messages: 42 } },
        { payload: { messages: 'invalid-string' } },
        { payload: { messages: {} } },
        { payload: { messages: [null, undefined, 123, 'plain-text', {}] } },
        {
          payload: {
            messages: [
              null,
              { role: 'developer', content: 'system 1' },
              undefined,
              { role: 'user', content: 'hello' },
              { role: 'developer', content: 'system 2' },
            ],
          },
        },
      ];

      for (const testCase of cases) {
        let result: any;
        expect(() => {
          result = fn({ type: 'before_provider_request', payload: testCase.payload }, ctx);
        }).not.toThrow();

        if (Array.isArray((testCase.payload as any).messages)) {
          const msgs = (testCase.payload as any).messages;
          if (msgs.some((m: any) => m?.role === 'developer')) {
            expect(result.messages[1].role).toBe('system');
            expect(result.messages[3].role).toBe('user');
            expect(result.messages[4].role).toBe('system');
          }
        }
      }
    });
  });
});
