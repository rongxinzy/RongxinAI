import { describe, expect, it, vi } from 'vitest';
import { ZhiyuanModelPoolHeader } from '../../shared/modelPool/constants';
import { createPiEnterpriseProviderExtension } from './piEnterpriseProviderExtension';
import type { ZhiyuanManagedProviderBridge } from './managedProviderBridge';
import { PiExtensionEventType } from '../libs/agentEngine/piExtensionTypes';

describe('createPiEnterpriseProviderExtension', () => {
  function setup(options?: {
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

    let cachedToken = options?.token ?? 'enterprise-secret-token-123';
    let tokenInvalidated = false;

    const mockBridge = {
      isManagedProvider: vi.fn((provider: string) =>
        options?.isManaged !== undefined
          ? options.isManaged
          : provider.startsWith('zhiyuan-host-enterprise-'),
      ),
      getEnterpriseModelConfig: vi.fn((modelId: string) =>
        modelId === 'ent-model'
          ? {
              modelId: 'ent-model',
              providerKey: 'zhiyuan-host-enterprise-1',
              baseUrl: 'https://api.enterprise.com/v1',
              api: (options?.api ?? 'openai-completions') as any,
              apiKey: cachedToken,
            }
          : null,
      ),
      getToken: vi.fn(async () => {
        if (tokenInvalidated) {
          cachedToken = 'refreshed-enterprise-token-456';
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

  describe('before_provider_headers', () => {
    it('injects Bearer token and model pool headers for OpenAI completions', async () => {
      const { handlers, ctx } = setup();
      const event = {
        type: 'before_provider_headers' as const,
        headers: {} as Record<string, string | null>,
      };

      await handlers[PiExtensionEventType.BeforeProviderHeaders](event, ctx);

      expect(event.headers['authorization']).toBe('Bearer enterprise-secret-token-123');
      expect(event.headers['Authorization']).toBeUndefined();
      expect(event.headers[ZhiyuanModelPoolHeader.ConversationId]).toBe('conv-test-999');
      expect(event.headers[ZhiyuanModelPoolHeader.Workload]).toBe('workload-batch');
    });

    it('standardizes on lowercase authorization and deletes pre-existing uppercase Authorization', async () => {
      const { handlers, ctx } = setup();
      const event = {
        type: 'before_provider_headers' as const,
        headers: {
          Authorization: 'Bearer stale-token',
        } as Record<string, string | null>,
      };

      await handlers[PiExtensionEventType.BeforeProviderHeaders](event, ctx);

      expect(event.headers['authorization']).toBe('Bearer enterprise-secret-token-123');
      expect(event.headers['Authorization']).toBeUndefined();
    });

    it('injects x-api-key for Anthropic models', async () => {
      const { handlers, ctx } = setup({ api: 'anthropic-messages' });
      const event = {
        type: 'before_provider_headers' as const,
        headers: {} as Record<string, string | null>,
      };

      await handlers[PiExtensionEventType.BeforeProviderHeaders](event, ctx);

      expect(event.headers['x-api-key']).toBe('enterprise-secret-token-123');
      expect(event.headers['authorization']).toBeUndefined();
    });

    it('proactively calls bridge.getToken() to refresh token', async () => {
      const { handlers, mockBridge, ctx } = setup();
      const event = {
        type: 'before_provider_headers' as const,
        headers: {} as Record<string, string | null>,
      };

      await handlers[PiExtensionEventType.BeforeProviderHeaders](event, ctx);
      expect(mockBridge.getToken).toHaveBeenCalledTimes(1);
    });

    it('skips header injection for non-managed models', async () => {
      const { handlers } = setup();
      const event = {
        type: 'before_provider_headers' as const,
        headers: {} as Record<string, string | null>,
      };
      const nonManagedCtx = {
        model: {
          id: 'public-model',
          provider: 'openai',
          api: 'openai-completions',
        },
      };

      await handlers[PiExtensionEventType.BeforeProviderHeaders](event, nonManagedCtx);

      expect(event.headers['authorization']).toBeUndefined();
      expect(event.headers['Authorization']).toBeUndefined();
    });
  });

  describe('before_provider_request', () => {
    it('non-destructively remaps role: developer to role: system for OpenAI completions', () => {
      const { handlers, ctx } = setup({ api: 'openai-completions' });
      const devMessage = { role: 'developer', content: 'Act as coding assistant' };
      const payload = {
        model: 'ent-model',
        messages: [
          devMessage,
          { role: 'user', content: 'Write hello world' },
          { role: 'assistant', content: 'console.log("hello world")' },
        ],
      };
      const event = {
        type: 'before_provider_request' as const,
        payload,
      };

      const result = handlers[PiExtensionEventType.BeforeProviderRequest](event, ctx) as any;

      expect(result.messages[0].role).toBe('system');
      expect(result.messages[1].role).toBe('user');
      expect(result.messages[2].role).toBe('assistant');
      // Original message and payload must NOT be mutated
      expect(devMessage.role).toBe('developer');
      expect(payload.messages[0].role).toBe('developer');
    });

    it('handles frozen payload and messages without throwing', () => {
      const { handlers, ctx } = setup({ api: 'openai-completions' });
      const frozenMsg = Object.freeze({ role: 'developer', content: 'Strict rules' });
      const frozenPayload = Object.freeze({
        model: 'ent-model',
        messages: Object.freeze([frozenMsg]),
      });

      const result = handlers[PiExtensionEventType.BeforeProviderRequest](
        { type: 'before_provider_request', payload: frozenPayload },
        ctx,
      ) as any;

      expect(result.messages[0].role).toBe('system');
      expect(frozenMsg.role).toBe('developer');
    });

    it('leaves developer roles untouched for non-enterprise models (e.g. OpenAI o1/o3-mini)', () => {
      const { handlers } = setup();
      const nonEnterpriseCtx = {
        model: {
          id: 'o1',
          provider: 'openai',
          api: 'openai-completions',
        },
      };
      const payload = {
        model: 'o1',
        messages: [{ role: 'developer', content: 'Formatting instructions for reasoning' }],
      };
      const event = {
        type: 'before_provider_request' as const,
        payload,
      };

      const result = handlers[PiExtensionEventType.BeforeProviderRequest](
        event,
        nonEnterpriseCtx,
      ) as any;

      expect(result.messages[0].role).toBe('developer');
    });

    it('leaves developer roles untouched for Anthropic endpoints', () => {
      const { handlers, ctx } = setup({ api: 'anthropic-messages' });
      const payload = {
        model: 'ent-model',
        messages: [
          { role: 'developer', content: 'Preamble' },
          { role: 'user', content: 'Hi' },
        ],
      };
      const event = {
        type: 'before_provider_request' as const,
        payload,
      };

      const result = handlers[PiExtensionEventType.BeforeProviderRequest](event, ctx) as any;

      expect(result.messages[0].role).toBe('developer');
    });
  });

  describe('after_provider_response', () => {
    it('calls bridge.invalidateToken() on 401 Unauthorized', () => {
      const { handlers, mockBridge, ctx } = setup();
      const event = {
        type: 'after_provider_response' as const,
        status: 401,
        headers: {},
      };

      handlers[PiExtensionEventType.AfterProviderResponse](event, ctx);

      expect(mockBridge.invalidateToken).toHaveBeenCalledTimes(1);
    });

    it('calls bridge.invalidateToken() on 403 Forbidden', () => {
      const { handlers, mockBridge, ctx } = setup();
      const event = {
        type: 'after_provider_response' as const,
        status: 403,
        headers: {},
      };

      handlers[PiExtensionEventType.AfterProviderResponse](event, ctx);

      expect(mockBridge.invalidateToken).toHaveBeenCalledTimes(1);
    });

    it('does not invalidate token on 401 or 403 when model is not an enterprise model or ctx is missing', () => {
      const { handlers, mockBridge } = setup();
      const nonEnterpriseCtx = {
        model: {
          id: 'gpt-4o',
          provider: 'openai',
          api: 'openai-completions',
        },
      };

      handlers[PiExtensionEventType.AfterProviderResponse](
        { type: 'after_provider_response', status: 401, headers: {} },
        nonEnterpriseCtx,
      );
      handlers[PiExtensionEventType.AfterProviderResponse](
        { type: 'after_provider_response', status: 403, headers: {} },
        undefined,
      );

      expect(mockBridge.invalidateToken).not.toHaveBeenCalled();
    });

    it('does not invalidate token on 200, 429, or 500 status codes', () => {
      const { handlers, mockBridge, ctx } = setup();

      for (const status of [200, 429, 500, 503]) {
        handlers[PiExtensionEventType.AfterProviderResponse](
          { type: 'after_provider_response', status, headers: {} },
          ctx,
        );
      }

      expect(mockBridge.invalidateToken).not.toHaveBeenCalled();
    });
  });
});
