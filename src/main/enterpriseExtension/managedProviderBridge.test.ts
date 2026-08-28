import { describe, expect, test, vi } from 'vitest';

import { ManagedProviderAccessMode } from '../../shared/managedProviders';
import type { ProviderConfig } from '../../shared/providers';
import type { ZhiyuanManagedProviderSource } from './contract';
import { EnterpriseExtensionStoreKey, LegacyManagedProviderKey } from './constants';
import { ZhiyuanManagedProviderBridge } from './managedProviderBridge';

describe('Zhiyuan managed provider bridge', () => {
  test('projects a managed source into the existing custom provider configuration', async () => {
    const store = new MemoryStore({
      [EnterpriseExtensionStoreKey.AppConfig]: {
        model: { defaultModel: 'old-model', defaultModelProvider: 'deepseek' },
        providers: {
          deepseek: providerConfig({
            displayName: 'DeepSeek',
            models: [{ id: 'old-model', name: 'Old Model' }],
          }),
        },
      },
    });
    let notifyChanged: (() => void) | null = null;
    const source: ZhiyuanManagedProviderSource = {
      providerKey: LegacyManagedProviderKey.Enterprise,
      exclusive: true,
      snapshot: vi.fn(async () => providerConfig()),
      onDidChange: listener => {
        notifyChanged = listener;
        return vi.fn();
      },
    };
    let refreshToken: (() => Promise<string>) | null = null;
    const unregisterTokenRefresher = vi.fn();
    const registerTokenRefresher = vi.fn((_providerId, refresher) => {
      refreshToken = refresher;
      return unregisterTokenRefresher;
    });
    const bridge = new ZhiyuanManagedProviderBridge(registerTokenRefresher);
    const changed = vi.fn();
    bridge.onDidChange(changed);
    const unregister = bridge.registerSource(source);

    bridge.attachStore(store);
    await bridge.refresh();

    expect(bridge.accessPolicy()).toEqual({
      mode: ManagedProviderAccessMode.Exclusive,
      providerKeys: [LegacyManagedProviderKey.Enterprise],
    });
    expect(bridge.catalog()).toEqual([
      expect.objectContaining({
        id: 'enterprise-chat',
        providerKey: LegacyManagedProviderKey.Enterprise,
        providerDisplayName: 'Zhiyuan',
        isDefault: true,
      }),
    ]);
    expect(store.get<any>(EnterpriseExtensionStoreKey.AppConfig)).toMatchObject({
      model: {
        defaultModel: 'enterprise-chat',
        defaultModelProvider: LegacyManagedProviderKey.Enterprise,
      },
      providers: {
        deepseek: { displayName: 'DeepSeek' },
        [LegacyManagedProviderKey.Enterprise]: {
          enabled: true,
          apiKey: 'model-token',
          baseUrl: 'http://127.0.0.1:8090/v1',
          apiFormat: 'openai',
        },
      },
    });
    expect(registerTokenRefresher).toHaveBeenCalledWith(
      LegacyManagedProviderKey.Enterprise,
      expect.any(Function),
    );

    vi.mocked(source.snapshot).mockResolvedValue(providerConfig({ apiKey: 'refreshed-token' }));
    await expect(refreshToken?.()).resolves.toBe('refreshed-token');
    expect(
      store.get<any>(EnterpriseExtensionStoreKey.AppConfig).providers[
        LegacyManagedProviderKey.Enterprise
      ].apiKey,
    ).toBe('refreshed-token');

    notifyChanged?.();
    await bridge.refresh();
    expect(source.snapshot).toHaveBeenCalled();
    expect(changed).toHaveBeenCalled();

    unregister();
    expect(unregisterTokenRefresher).toHaveBeenCalledOnce();
    expect(
      store.get<any>(EnterpriseExtensionStoreKey.AppConfig).providers[
        LegacyManagedProviderKey.Enterprise
      ],
    ).toBeUndefined();
    expect(store.get<any>(EnterpriseExtensionStoreKey.AppConfig).providers.deepseek).toBeDefined();
    expect(store.get<any>(EnterpriseExtensionStoreKey.AppConfig).model).toMatchObject({
      defaultModel: 'old-model',
      defaultModelProvider: 'deepseek',
    });
    expect(store.get(EnterpriseExtensionStoreKey.ManagedProviderProjection)).toBeUndefined();
  });

  test('removes an orphaned legacy enterprise projection and selects a valid provider', () => {
    const store = new MemoryStore({
      [EnterpriseExtensionStoreKey.AppConfig]: {
        model: {
          defaultModel: 'exclusive-ui-e2e',
          defaultModelProvider: LegacyManagedProviderKey.Enterprise,
        },
        providers: {
          deepseek: providerConfig({
            displayName: 'DeepSeek',
            models: [{ id: 'deepseek-chat', name: 'DeepSeek Chat' }],
          }),
          [LegacyManagedProviderKey.Enterprise]: providerConfig({
            models: [{ id: 'exclusive-ui-e2e', name: 'Enterprise Authorized Model' }],
          }),
        },
      },
    });

    new ZhiyuanManagedProviderBridge().attachStore(store);

    expect(
      store.get<any>(EnterpriseExtensionStoreKey.AppConfig).providers[
        LegacyManagedProviderKey.Enterprise
      ],
    ).toBeUndefined();
    expect(store.get<any>(EnterpriseExtensionStoreKey.AppConfig).model).toMatchObject({
      defaultModel: 'deepseek-chat',
      defaultModelProvider: 'deepseek',
    });
  });

  test('restores a persisted selection when a managed source is absent after restart', () => {
    const store = new MemoryStore({
      [EnterpriseExtensionStoreKey.AppConfig]: {
        model: {
          defaultModel: 'enterprise-chat',
          defaultModelProvider: LegacyManagedProviderKey.Enterprise,
        },
        providers: {
          deepseek: providerConfig({
            displayName: 'DeepSeek',
            models: [{ id: 'deepseek-reasoner', name: 'DeepSeek Reasoner' }],
          }),
          [LegacyManagedProviderKey.Enterprise]: providerConfig(),
        },
      },
      [EnterpriseExtensionStoreKey.ManagedProviderProjection]: {
        providerKey: LegacyManagedProviderKey.Enterprise,
        previousDefaultModel: 'deepseek-reasoner',
        previousDefaultModelProvider: 'deepseek',
      },
    });

    new ZhiyuanManagedProviderBridge().attachStore(store);

    expect(store.get<any>(EnterpriseExtensionStoreKey.AppConfig).model).toMatchObject({
      defaultModel: 'deepseek-reasoner',
      defaultModelProvider: 'deepseek',
    });
    expect(store.get(EnterpriseExtensionStoreKey.ManagedProviderProjection)).toBeUndefined();
  });

  test('rejects non-custom keys and clears an unavailable managed snapshot', async () => {
    const store = new MemoryStore({
      [EnterpriseExtensionStoreKey.AppConfig]: { providers: {} },
    });
    const bridge = new ZhiyuanManagedProviderBridge();
    expect(() =>
      bridge.registerSource({
        providerKey: 'external.zhiyuan',
        exclusive: true,
        snapshot: async () => providerConfig(),
      }),
    ).toThrow('custom provider namespace');

    bridge.registerSource({
      providerKey: LegacyManagedProviderKey.Enterprise,
      exclusive: true,
      snapshot: async () => {
        throw new Error('control plane unavailable');
      },
    });
    bridge.attachStore(store);
    await bridge.refresh();

    expect(bridge.accessPolicy().mode).toBe(ManagedProviderAccessMode.Exclusive);
    expect(bridge.catalog()).toEqual([]);
    expect(store.get<any>(EnterpriseExtensionStoreKey.AppConfig).providers).toEqual({});
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

  delete(key: string): void {
    this.#values.delete(key);
  }
}
