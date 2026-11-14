import { ZhiyuanModelPoolHeader } from '../../shared/modelPool/constants';
import type { ZhiyuanManagedProviderBridge } from './managedProviderBridge';
import {
  PiExtensionEventType,
  type AfterProviderResponseEvent,
  type BeforeProviderHeadersEvent,
  type BeforeProviderRequestEvent,
  type PiExtensionApi,
  type PiExtensionFactory,
} from '../libs/agentEngine/piExtensionTypes';

/**
 * Pi Native Lifecycle Extension for Enterprise Providers.
 *
 * Hooks into Pi's native request lifecycle (replacing legacy loopback HTTP proxy):
 * - before_provider_headers: Injects Bearer token / x-api-key, refreshes token via bridge,
 *   and injects ZhiyuanModelPoolHeader metadata.
 * - before_provider_request: Non-destructively maps payload.messages replacing role: 'developer' with 'system'
 *   for OpenAI-compatible enterprise endpoints.
 * - after_provider_response: Detects HTTP 401/403 on enterprise models and invalidates cached bridge token.
 */
export function createPiEnterpriseProviderExtension(
  bridge: ZhiyuanManagedProviderBridge,
): PiExtensionFactory {
  function isEnterpriseModel(ctx?: any): boolean {
    if (!ctx?.model) return false;
    return (
      bridge.isManagedProvider(ctx.model.provider) ||
      Boolean(bridge.getEnterpriseModelConfig(ctx.model.id)) ||
      ctx.model.provider === 'enterprise'
    );
  }

  return (extensionApi: PiExtensionApi) => {
    extensionApi.on(
      PiExtensionEventType.BeforeProviderHeaders,
      async (event: BeforeProviderHeadersEvent, ctx?: any) => {
        if (!isEnterpriseModel(ctx)) return;

        try {
          const token = await bridge.getToken();
          if (token) {
            if (ctx?.model?.api === 'anthropic-messages') {
              event.headers['x-api-key'] = token;
            } else {
              event.headers['authorization'] = `Bearer ${token}`;
              delete event.headers['Authorization'];
              if (typeof event.headers['x-api-key'] === 'string') {
                event.headers['x-api-key'] = token;
              }
            }
          }
        } catch (error) {
          console.error('[PiEnterpriseExtension] Failed to get authentication token:', error);
          throw error;
        }

        // Inject ZhiyuanModelPoolHeader values if present on ctx.model.headers
        if (ctx?.model?.headers) {
          for (const [key, value] of Object.entries(ctx.model.headers)) {
            if (typeof value === 'string' && event.headers[key] === undefined) {
              event.headers[key] = value;
            }
          }
        }
      },
    );

    extensionApi.on(
      PiExtensionEventType.BeforeProviderRequest,
      (event: BeforeProviderRequestEvent, ctx?: any) => {
        if (!isEnterpriseModel(ctx)) return event.payload;
        if (!event.payload || typeof event.payload !== 'object') return event.payload;
        const payload = event.payload as Record<string, unknown>;

        // Only remap developer roles for OpenAI completions (not Anthropic)
        const isAnthropic = ctx?.model?.api === 'anthropic-messages';
        if (!isAnthropic && Array.isArray(payload.messages)) {
          const hasDeveloper = payload.messages.some(
            message =>
              message && typeof message === 'object' && (message as any).role === 'developer',
          );
          if (hasDeveloper) {
            const remappedMessages = payload.messages.map(message => {
              if (message && typeof message === 'object' && (message as any).role === 'developer') {
                return { ...(message as Record<string, unknown>), role: 'system' };
              }
              return message;
            });
            return {
              ...payload,
              messages: remappedMessages,
            };
          }
        }
        return event.payload;
      },
    );

    extensionApi.on(
      PiExtensionEventType.AfterProviderResponse,
      (event: AfterProviderResponseEvent, ctx?: any) => {
        if (!isEnterpriseModel(ctx)) return;
        if (event.status === 401 || event.status === 403) {
          bridge.invalidateToken();
        }
      },
    );
  };
}
