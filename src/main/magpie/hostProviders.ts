/** Main-only contract. Never expose this (or upstream credentials) in renderer IPC. */
export interface MagpieHostProvider {
  id: string;
  name: string;
  api: 'openai-completions' | 'openai-responses' | 'anthropic-messages';
  baseUrl: string;
  /** Only a local capability for a host-owned loopback bridge, never an upstream access token. */
  apiKey?: string;
  models: {
    id: string;
    name?: string;
    contextWindow?: number;
    maxTokens?: number;
    input?: ('text' | 'image')[];
    reasoningLevels?: string[];
  }[];
}
export const HOST_PROVIDER_PREFIX = 'zhiyuan-host-';
export function assertHostProviderId(id: string): void {
  if (!/^zhiyuan-host-[a-z0-9][a-z0-9-]{0,80}$/.test(id))
    throw new Error('Invalid host model provider id');
}
export function hostProviderPayload(provider: MagpieHostProvider): Record<string, unknown> {
  assertHostProviderId(provider.id);
  const url = new URL(provider.baseUrl);
  if (
    url.protocol !== 'http:' ||
    !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) ||
    !url.port ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error('Host model providers must use an explicit loopback endpoint');
  if (!provider.name?.trim() || provider.name.length > 200 || provider.models.length > 2000)
    throw new Error('Invalid host model provider');
  const ids = new Set<string>();
  const contexts: Record<string, number> = {};
  const outputs: Record<string, number> = {};
  const modelPrefs: Record<string, unknown> = {};
  for (const model of provider.models) {
    if (!model.id || model.id.length > 500 || /[\u0000-\u001f]/.test(model.id) || ids.has(model.id))
      throw new Error('Invalid host model id');
    ids.add(model.id);
    for (const value of [model.contextWindow, model.maxTokens]) {
      if (
        value !== undefined &&
        (!Number.isSafeInteger(value) || value <= 0 || value > 100_000_000)
      )
        throw new Error('Invalid host model limit');
    }
    if (model.contextWindow) contexts[model.id] = model.contextWindow;
    if (model.maxTokens) outputs[model.id] = model.maxTokens;
    modelPrefs[model.id] = {
      ...(model.name ? { name: model.name } : {}),
      ...(model.input ? { images: model.input.includes('image') } : {}),
      ...(model.reasoningLevels ? { efforts: model.reasoningLevels } : {}),
    };
  }
  const field = {
    'openai-completions': 'chat',
    'openai-responses': 'responses',
    'anthropic-messages': 'anthropic',
  }[provider.api];
  if (!field) throw new Error('Unsupported host model protocol');
  return {
    id: provider.id,
    from: provider.id,
    name: provider.name,
    chat: '',
    responses: '',
    anthropic: '',
    [field]: provider.baseUrl,
    key: provider.apiKey || 'magpie-local',
    models: [...ids],
    noModels: ids.size === 0,
    contexts,
    outputs,
    modelPrefs,
    proxy: 'direct',
    unredacted: true,
    off: false,
  };
}
