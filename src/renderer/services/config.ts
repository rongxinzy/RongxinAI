import {
  type ApiFormat,
  type ProviderConfig,
  ProviderName,
  ProviderRegistry,
  resolveConfiguredProviderModels,
  normalizeProviderBaseUrl,
  resolveModelEndpoint,
  ModelCapabilityStatus,
} from '@shared/providers';
import {
  ManagedProviderAccessMode,
  OPEN_MANAGED_PROVIDER_ACCESS_POLICY,
  type ManagedProviderAccessPolicy,
} from '@shared/managedProviders';

import { AppConfig, CONFIG_KEYS, defaultConfig, isCustomProvider } from '../config';
import { localStore } from './store';

type ProviderModelConfig = NonNullable<ProviderConfig['models']>[number];

const getFixedProviderApiFormat = (providerKey: string): ApiFormat | null => {
  const def = ProviderRegistry.get(providerKey);
  if (def && !def.switchableBaseUrls) {
    return def.defaultApiFormat;
  }
  return null;
};

const normalizeProviderApiFormat = (
  providerKey: string,
  apiFormat: unknown,
): 'anthropic' | 'openai' | 'gemini' => {
  const fixed = getFixedProviderApiFormat(providerKey);
  if (fixed) {
    return fixed;
  }
  if (apiFormat === 'openai') {
    return 'openai';
  }
  return 'anthropic';
};

const normalizeProviderModels = (
  providerKey: string,
  models: ProviderConfig['models'],
  apiFormat: ApiFormat,
  codingPlanEnabled?: boolean,
): ProviderConfig['models'] =>
  models?.map(model => {
    const endpoint = resolveModelEndpoint(providerKey, model.id, {
      apiFormat,
      codingPlanEnabled,
      modelConfig: model,
    });
    const catalogModel = ProviderRegistry.getModel(providerKey, model.id);
    const catalogCapacity = catalogModel
      ? {
          ...(!model.contextWindow &&
          !model.contextTokens &&
          typeof catalogModel.contextWindow === 'number' &&
          catalogModel.contextWindow > 0
            ? { contextWindow: catalogModel.contextWindow }
            : {}),
          ...(!model.maxTokens &&
          typeof catalogModel.maxTokens === 'number' &&
          catalogModel.maxTokens > 0
            ? { maxTokens: catalogModel.maxTokens }
            : {}),
        }
      : {};
    return {
      ...model,
      ...catalogCapacity,
      supportsImage: endpoint.capabilities.imageInput === ModelCapabilityStatus.Supported,
      capabilities: endpoint.capabilities,
    };
  });

const normalizeProvidersConfig = (
  providers: AppConfig['providers'],
  managedProviderExclusive = false,
): AppConfig['providers'] => {
  if (!providers) {
    return providers;
  }

  return Object.fromEntries(
    Object.entries(providers).map(([providerKey, providerConfig]) => [
      providerKey,
      {
        ...providerConfig,
        // Managed access never requires a user API key or an enable toggle. An exclusive
        // managed provider replaces the managed free model, which must stay disabled and
        // unseeded so host model resolution cannot fall back to it.
        ...(providerKey === ProviderName.Zhiyuan ? { enabled: !managedProviderExclusive } : {}),
        baseUrl: normalizeProviderBaseUrl(providerKey, providerConfig.baseUrl),
        apiFormat: normalizeProviderApiFormat(providerKey, providerConfig.apiFormat),
        models: normalizeProviderModels(
          providerKey,
          providerKey === ProviderName.Zhiyuan &&
            !providerConfig.models?.length &&
            !managedProviderExclusive
            ? defaultConfig.providers![ProviderName.Zhiyuan].models
            : providerConfig.models,
          normalizeProviderApiFormat(providerKey, providerConfig.apiFormat),
          providerConfig.codingPlanEnabled,
        ),
      },
    ]),
  ) as AppConfig['providers'];
};

/**
 * Migrate legacy single `custom` provider to `custom_0`.
 */
const migrateCustomProviders = (config: AppConfig): AppConfig => {
  const providers = config.providers;
  if (!providers) return config;

  // Migrate legacy `custom` key (without underscore) to `custom_0`
  if ('custom' in providers && !isCustomProvider('custom')) {
    const legacyCustom = providers['custom'];
    if (legacyCustom) {
      const updatedProviders = { ...providers } as Record<string, unknown>;
      updatedProviders['custom_0'] = { ...legacyCustom };
      delete updatedProviders['custom'];
      return {
        ...config,
        providers: updatedProviders as AppConfig['providers'],
      };
    }
  }

  return config;
};

// Model IDs that have been removed from specific providers.
// These will be filtered out from saved configs during migration.
const REMOVED_PROVIDER_MODELS: Record<string, string[]> = {
  deepseek: ['deepseek-chat'],
  openai: ['gpt-5.2-2025-12-11'],
};

// Models to inject into existing saved configs (for existing users).
// These models will be added on every startup if missing from the stored config.
// Note: users cannot permanently remove these models — they will be re-injected
// on next launch. Once all users have upgraded, entries here should be removed
// so the models follow normal user-editable behavior (same as other models).
// position: 'start' inserts at the beginning, 'end' appends at the end.
const ADDED_PROVIDER_MODELS: Record<
  string,
  {
    models: Array<{
      id: string;
      name: string;
      supportsImage?: boolean;
      contextWindow?: number;
      maxTokens?: number;
    }>;
    position: 'start' | 'end';
  }
> = {
  deepseek: {
    models: [
      {
        id: 'deepseek-v4-flash',
        name: 'DeepSeek V4 Flash',
        supportsImage: false,
        contextWindow: 1_000_000,
        maxTokens: 384_000,
      },
      {
        id: 'deepseek-v4-pro',
        name: 'DeepSeek V4 Pro',
        supportsImage: false,
        contextWindow: 1_000_000,
        maxTokens: 384_000,
      },
    ],
    position: 'start',
  },
  moonshot: {
    models: [
      {
        id: 'kimi-k3',
        name: 'Kimi K3',
        supportsImage: true,
        contextWindow: 1_000_000,
        maxTokens: 131_072,
      },
      {
        id: 'kimi-k2.6',
        name: 'Kimi K2.6',
        supportsImage: true,
        contextWindow: 256_000,
      },
    ],
    position: 'start',
  },
  qwen: {
    models: [
      {
        id: 'qwen3.7-max',
        name: 'Qwen3.7 Max',
        supportsImage: false,
        contextWindow: 1_000_000,
        maxTokens: 65_536,
      },
      {
        id: 'qwen3.7-plus',
        name: 'Qwen3.7 Plus',
        supportsImage: true,
        contextWindow: 1_000_000,
        maxTokens: 64_000,
      },
    ],
    position: 'start',
  },
  zhipu: {
    models: [
      {
        id: 'glm-5.2',
        name: 'GLM 5.2',
        supportsImage: false,
        contextWindow: 1_000_000,
        maxTokens: 131_072,
      },
    ],
    position: 'start',
  },
  minimax: {
    models: [
      {
        id: 'MiniMax-M3',
        name: 'MiniMax M3',
        supportsImage: false,
        contextWindow: 1_000_000,
        maxTokens: 128_000,
      },
      {
        id: 'MiniMax-M2.7',
        name: 'MiniMax M2.7',
        supportsImage: false,
        contextWindow: 204_800,
        maxTokens: 131_072,
      },
    ],
    position: 'start',
  },
  stepfun: {
    models: [
      {
        id: 'step-3.7-flash',
        name: 'Step 3.7 Flash',
        supportsImage: false,
        contextWindow: 256_000,
        maxTokens: 256_000,
      },
    ],
    position: 'start',
  },
  xiaomi: {
    models: [
      {
        id: 'mimo-v2.5-pro-ultraspeed',
        name: 'MiMo V2.5 Pro Ultraspeed',
        supportsImage: false,
        contextWindow: 1_048_576,
        maxTokens: 131_072,
      },
    ],
    position: 'start',
  },
  openai: {
    models: [
      { id: 'gpt-5.4', name: 'GPT-5.4', supportsImage: true },
      { id: 'gpt-5.2', name: 'GPT-5.2', supportsImage: true },
      { id: 'gpt-5.3-codex', name: 'GPT-5.3 Codex', supportsImage: true },
    ],
    position: 'start',
  },
};

const PROVIDER_MODEL_CATALOG_MIGRATION_VERSION = 1;
const MODEL_POOL_PROVIDER_MIGRATION_VERSION = 1;

export class ConfigService {
  private config: AppConfig = defaultConfig;
  private operationQueue: Promise<void> = Promise.resolve();
  private managedProviderPolicy: ManagedProviderAccessPolicy = OPEN_MANAGED_PROVIDER_ACCESS_POLICY;

  private isManagedProviderExclusive(): boolean {
    return this.managedProviderPolicy.mode === ManagedProviderAccessMode.Exclusive;
  }

  private async refreshManagedProviderPolicy(): Promise<void> {
    try {
      const policy = await window.electron?.managedProviders?.policy?.();
      if (policy) {
        this.managedProviderPolicy = policy;
      }
    } catch {
      // Keep the last known policy; a transient IPC failure must not re-seed managed access.
    }
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.operationQueue.then(operation);
    this.operationQueue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private async loadFromStorage() {
    await this.refreshManagedProviderPolicy();
    const managedProviderExclusive = this.isManagedProviderExclusive();
    const storedConfig = await localStore.getItem<AppConfig>(CONFIG_KEYS.APP_CONFIG);
    if (!storedConfig) {
      console.warn('[ConfigService] init: no stored config found, using defaults');
    }
    if (storedConfig) {
      const shouldMigrateProviderModels =
        (storedConfig.migrations?.providerModelCatalog ?? 0) <
        PROVIDER_MODEL_CATALOG_MIGRATION_VERSION;
      const shouldMigrateModelPoolProvider =
        (storedConfig.migrations?.modelPoolProvider ?? 0) < MODEL_POOL_PROVIDER_MIGRATION_VERSION;
      const mergedProviders = storedConfig.providers
        ? Object.fromEntries(
            Object.entries({
              ...(defaultConfig.providers ?? {}),
              ...storedConfig.providers,
            }).map(([providerKey, providerConfig]) => [
              providerKey,
              (() => {
                const mergedProvider = {
                  ...(((defaultConfig.providers as Record<string, unknown>)?.[
                    providerKey
                  ] as Record<string, unknown>) ?? {}),
                  ...providerConfig,
                };
                // Filter out removed models
                const removedIds = REMOVED_PROVIDER_MODELS[providerKey];
                if (removedIds && mergedProvider.models) {
                  mergedProvider.models = mergedProvider.models.filter(
                    (m: { id: string }) => !removedIds.includes(m.id),
                  );
                }
                // Inject added models (for existing users who already have saved config)
                const addedConfig = ADDED_PROVIDER_MODELS[providerKey];
                if (shouldMigrateProviderModels && addedConfig && mergedProvider.models) {
                  const addedModelsById = new Map(
                    addedConfig.models.map(model => [model.id, model]),
                  );
                  mergedProvider.models = mergedProvider.models.map(
                    (model: ProviderModelConfig) => {
                      const addedModel = addedModelsById.get(model.id);
                      if (!addedModel) return model;
                      return {
                        ...model,
                        contextWindow: model.contextWindow ?? addedModel.contextWindow,
                        maxTokens: model.maxTokens ?? addedModel.maxTokens,
                      };
                    },
                  );
                  const existingIds = new Set(
                    mergedProvider.models.map((m: { id: string }) => m.id),
                  );
                  const newModels = addedConfig.models.filter(m => !existingIds.has(m.id));
                  if (newModels.length > 0) {
                    mergedProvider.models =
                      addedConfig.position === 'start'
                        ? [...newModels, ...mergedProvider.models]
                        : [...mergedProvider.models, ...newModels];
                  }
                }
                mergedProvider.models = resolveConfiguredProviderModels(
                  providerKey,
                  mergedProvider as ProviderConfig,
                );
                return {
                  ...mergedProvider,
                  baseUrl: normalizeProviderBaseUrl(providerKey, mergedProvider.baseUrl),
                  apiFormat: normalizeProviderApiFormat(providerKey, mergedProvider.apiFormat),
                  models: normalizeProviderModels(
                    providerKey,
                    mergedProvider.models as ProviderConfig['models'],
                    normalizeProviderApiFormat(providerKey, mergedProvider.apiFormat),
                    mergedProvider.codingPlanEnabled,
                  ),
                };
              })(),
            ]),
          )
        : defaultConfig.providers;

      // Migrate model.defaultModel if it was removed
      const allRemovedIds = Object.values(REMOVED_PROVIDER_MODELS).flat();
      const migratedModel = { ...defaultConfig.model, ...storedConfig.model };
      if (allRemovedIds.includes(migratedModel.defaultModel)) {
        migratedModel.defaultModel = defaultConfig.model.defaultModel;
      }
      if (migratedModel.availableModels) {
        migratedModel.availableModels = migratedModel.availableModels.filter(
          (m: { id: string }) => !allRemovedIds.includes(m.id),
        );
      }

      this.config = migrateCustomProviders({
        ...defaultConfig,
        ...storedConfig,
        api: {
          ...defaultConfig.api,
          ...storedConfig.api,
        },
        model: migratedModel,
        app: {
          ...defaultConfig.app,
          ...storedConfig.app,
        },
        shortcuts: {
          ...defaultConfig.shortcuts!,
          ...(storedConfig.shortcuts ?? {}),
        } as AppConfig['shortcuts'],
        providers: normalizeProvidersConfig(
          mergedProviders as AppConfig['providers'],
          managedProviderExclusive,
        ),
        migrations: {
          ...defaultConfig.migrations,
          ...storedConfig.migrations,
          providerModelCatalog: PROVIDER_MODEL_CATALOG_MIGRATION_VERSION,
          modelPoolProvider: MODEL_POOL_PROVIDER_MIGRATION_VERSION,
        },
      });
      const shortcuts = this.config.shortcuts!;
      this.config.shortcuts = {
        ...shortcuts,
        newChat:
          shortcuts.newChat === 'Ctrl+N' ? defaultConfig.shortcuts!.newChat : shortcuts.newChat,
        search: shortcuts.search === 'Ctrl+F' ? defaultConfig.shortcuts!.search : shortcuts.search,
        settings:
          shortcuts.settings === 'Ctrl+,' ? defaultConfig.shortcuts!.settings : shortcuts.settings,
      };
      const storedZhiyuanProvider = storedConfig.providers?.[ProviderName.Zhiyuan];
      const shouldRepairManagedAccess =
        !managedProviderExclusive &&
        (storedZhiyuanProvider?.enabled !== true || !storedZhiyuanProvider?.models?.length);
      const shouldSuppressManagedAccess =
        managedProviderExclusive && storedZhiyuanProvider?.enabled === true;
      if (
        shouldMigrateProviderModels ||
        shouldMigrateModelPoolProvider ||
        shouldRepairManagedAccess ||
        shouldSuppressManagedAccess
      ) {
        await localStore.setItem(CONFIG_KEYS.APP_CONFIG, this.config);
      }
    } else {
      this.config = defaultConfig;
    }
  }

  async init() {
    try {
      await this.enqueue(() => this.loadFromStorage());
    } catch (error) {
      console.error('[ConfigService] init failed:', error);
    }
  }

  async reload(): Promise<AppConfig> {
    try {
      await this.enqueue(() => this.loadFromStorage());
    } catch (error) {
      console.error('[ConfigService] reload failed:', error);
    }
    return this.config;
  }

  getConfig(): AppConfig {
    return this.config;
  }

  async updateConfig(
    update: Partial<AppConfig> | ((current: AppConfig) => Partial<AppConfig> | undefined),
  ) {
    await this.enqueue(async () => {
      await this.refreshManagedProviderPolicy();
      // Read only after earlier operations finish so concurrent partial updates
      // cannot merge against the same stale snapshot and overwrite each other.
      const stored = await localStore.getItem<AppConfig>(CONFIG_KEYS.APP_CONFIG);
      const base = stored ?? this.config;
      const newConfig = typeof update === 'function' ? update(base) : update;
      if (!newConfig) return;
      const normalizedProviders = normalizeProvidersConfig(
        newConfig.providers as AppConfig['providers'] | undefined,
        this.isManagedProviderExclusive(),
      );

      this.config = {
        ...base,
        ...newConfig,
        ...(normalizedProviders ? { providers: normalizedProviders } : {}),
      };
      await localStore.setItem(CONFIG_KEYS.APP_CONFIG, this.config);
      window.dispatchEvent(new CustomEvent('config-updated'));
    });
  }

  getApiConfig() {
    return {
      apiKey: this.config.api.key,
      baseUrl: this.config.api.baseUrl,
    };
  }
}

export const configService = new ConfigService();
