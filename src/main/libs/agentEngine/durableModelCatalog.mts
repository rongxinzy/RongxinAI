import {
  createModels,
  createProvider,
  type Api,
  type Context,
  type Model,
  type MutableModels,
  type Provider,
  type ProviderRequestOptions,
} from '@earendil-works/pi-ai';
import { anthropicMessagesApi } from '@earendil-works/pi-ai/api/anthropic-messages.lazy';
import { openAICompletionsApi } from '@earendil-works/pi-ai/api/openai-completions.lazy';
import { openAIResponsesApi } from '@earendil-works/pi-ai/api/openai-responses.lazy';
import { zhiyuanManagedProviderBridge } from '../../enterpriseExtension/managedProviderBridge.js';

/** Provider ownership shared by the Durable harness and bounded background completions. */
export class DurableModelCatalog {
  readonly models: MutableModels = createModels({ identity: { attribution: null } });
  private readonly keys = new Map<string, string>();

  static async create(): Promise<DurableModelCatalog> {
    return new DurableModelCatalog();
  }

  registerProvider(id: string, config: Record<string, unknown>): void {
    const configuredModels = config.models;
    if (!Array.isArray(configuredModels) || !configuredModels.length)
      throw new Error(`Provider ${id} has no models.`);
    // A provider refresh must retain model identities still referenced by owned
    // conversations or compactions in the same Harness.
    const registered = new Map(this.models.getModels(id).map(model => [model.id, model]));
    for (const model of configuredModels as Model<Api>[]) registered.set(model.id, model);
    const modelList = [...registered.values()];
    const api = config.api;
    if (!['anthropic-messages', 'openai-responses', 'openai-completions'].includes(String(api)))
      throw new Error(`Unsupported provider protocol: ${String(api)}`);
    const provider = createProvider({
      id,
      name: typeof config.name === 'string' ? config.name : id,
      baseUrl: typeof config.baseUrl === 'string' ? config.baseUrl : undefined,
      models: modelList,
      auth: {
        apiKey: {
          name: id,
          resolve: async () => ({
            auth: {
              apiKey: zhiyuanManagedProviderBridge.isManagedProvider(id)
                ? await zhiyuanManagedProviderBridge.getToken()
                : this.keys.get(id),
            },
          }),
        },
      },
      api: {
        'anthropic-messages': anthropicMessagesApi(),
        'openai-responses': openAIResponsesApi(),
        'openai-completions': openAICompletionsApi(),
      },
    });
    this.models.setProvider(this.withEnterprisePolicy(provider));
  }

  async setRuntimeApiKey(provider: string, key: string): Promise<void> {
    this.keys.set(provider, key);
  }

  getModel(provider: string, modelId: string): Model<Api> | undefined {
    return this.models.getModel(provider, modelId);
  }

  completeSimple(model: unknown, context: Context) {
    return this.models.completeSimple(model as Model<Api>, context);
  }

  private withEnterprisePolicy(provider: Provider): Provider {
    if (!zhiyuanManagedProviderBridge.isManagedProvider(provider.id)) return provider;
    const optionsFor = <T extends ProviderRequestOptions>(api: Api, options?: T): T =>
      ({
        ...options,
        // SDKs reject HTTP errors before invoking onResponse. Observe the native
        // request transport so invalid credentials are refreshed on the NEXT attempt.
        fetch: async (
          input: Parameters<typeof globalThis.fetch>[0],
          init?: Parameters<typeof globalThis.fetch>[1],
        ) => {
          const token = await zhiyuanManagedProviderBridge.getToken();
          const headers = new Headers(
            init?.headers ?? (input instanceof Request ? input.headers : undefined),
          );
          if (api === 'anthropic-messages') {
            headers.set('x-api-key', token);
            headers.delete('authorization');
          } else {
            headers.set('authorization', `Bearer ${token}`);
            if (headers.has('x-api-key')) headers.set('x-api-key', token);
          }
          const response = await (options?.fetch ?? globalThis.fetch)(input, { ...init, headers });
          if (response.status === 401 || response.status === 403)
            zhiyuanManagedProviderBridge.invalidateToken();
          return response;
        },
        onPayload: async (payload, model) => {
          const transformed = await options?.onPayload?.(payload, model);
          const original = transformed === undefined ? payload : transformed;
          if (model.api === 'anthropic-messages' || !original || typeof original !== 'object')
            return original;
          const body = original as Record<string, unknown>;
          if (!Array.isArray(body.messages)) return original;
          return {
            ...body,
            messages: body.messages.map(message =>
              message && typeof message === 'object' && message.role === 'developer'
                ? { ...message, role: 'system' }
                : message,
            ),
          };
        },
      }) as T;
    return {
      ...provider,
      stream: (model, context, options) =>
        provider.stream(model, context, optionsFor(model.api, options)),
      streamSimple: (model, context, options) =>
        provider.streamSimple(model, context, optionsFor(model.api, options)),
    };
  }
}
