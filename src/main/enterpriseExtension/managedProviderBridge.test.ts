import { describe, expect, test, vi } from 'vitest';

import { ManagedProviderAccessMode } from '../../shared/managedProviders';
import type { ProviderConfig } from '../../shared/providers';
import type { ZhiyuanManagedProviderSource } from './contract';
import { ZhiyuanManagedProviderBridge } from './managedProviderBridge';

describe('Zhiyuan managed provider bridge', () => {
  test('projects a managed source into the existing custom provider configuration', async () => {
    const store = new MemoryStore({
      app_config: {
        model: { defaultModel: 'old-model', defaultModelProvider: 'deepseek' },
        providers: { deepseek: providerConfig({ displayName: 'DeepSeek' }) },
      },
    });
    let notifyChanged: (() => void) | null = null;
    const source: ZhiyuanManagedProviderSource = {
      providerKey: 'custom_enterprise',
      exclusive: true,
      snapshot: vi.fn(async () => providerConfig()),
      onDidChange: listener => {
        notifyChanged = listener;
        return vi.fn();
      },
    };
    const bridge = new ZhiyuanManagedProviderBridge();
    const changed = vi.fn();
    bridge.onDidChange(changed);
    const unregister = bridge.registerSource(source);

    bridge.attachStore(store);
    await bridge.refresh();

    expect(bridge.accessPolicy()).toEqual({
      mode: ManagedProviderAccessMode.Exclusive,
      providerKeys: ['custom_enterprise'],
    });
    expect(bridge.catalog()).toEqual([
      expect.objectContaining({
        id: 'enterprise-chat',
        providerKey: 'custom_enterprise',
        providerDisplayName: 'Zhiyuan',
        isDefault: true,
      }),
    ]);
    expect(store.get<any>('app_config')).toMatchObject({
      model: { defaultModel: 'enterprise-chat', defaultModelProvider: 'custom_enterprise' },
      providers: {
        deepseek: { displayName: 'DeepSeek' },
        custom_enterprise: {
          enabled: true,
          apiKey: 'model-token',
          baseUrl: 'http://127.0.0.1:8090/v1',
          apiFormat: 'openai',
        },
      },
    });

    notifyChanged?.();
    await bridge.refresh();
    expect(source.snapshot).toHaveBeenCalled();
    expect(changed).toHaveBeenCalled();

    unregister();
    expect(store.get<any>('app_config').providers.custom_enterprise).toBeUndefined();
    expect(store.get<any>('app_config').providers.deepseek).toBeDefined();
  });

  test('rejects non-custom keys and clears an unavailable managed snapshot', async () => {
    const store = new MemoryStore({ app_config: { providers: {} } });
    const bridge = new ZhiyuanManagedProviderBridge();
    expect(() =>
      bridge.registerSource({
        providerKey: 'external.zhiyuan',
        exclusive: true,
        snapshot: async () => providerConfig(),
      }),
    ).toThrow('custom provider namespace');

    bridge.registerSource({
      providerKey: 'custom_enterprise',
      exclusive: true,
      snapshot: async () => {
        throw new Error('control plane unavailable');
      },
    });
    bridge.attachStore(store);
    await bridge.refresh();

    expect(bridge.accessPolicy().mode).toBe(ManagedProviderAccessMode.Exclusive);
    expect(bridge.catalog()).toEqual([]);
    expect(store.get<any>('app_config').providers).toEqual({});
  });
});

function providerConfig(overrides: Partial<ProviderConfig> = {}): ProviderConfig {
  return {
    enabled: true,
    apiKey: 'model-token',
    baseUrl: 'http://127.0.0.1:8090/v1/',
    apiFormat: 'openai',
    displayName: 'Zhiyuan',
    models: [{ id: 'enterprise-chat', name: 'Enterprise Chat' }],
    ...overrides,
  };
}

class MemoryStore {
  readonly #values = new Map<string, unknown>();

  constructor(initial: Record<string, unknown>) {
    for (const [key, value] of Object.entries(initial)) this.#values.set(key, value);
  }

  get<T>(key: string): T | undefined {
    return this.#values.get(key) as T | undefined;
  }

  set(key: string, value: unknown): void {
    this.#values.set(key, value);
  }
}
