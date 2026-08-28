import {
  ManagedProviderAccessMode,
  OPEN_MANAGED_PROVIDER_ACCESS_POLICY,
  type ManagedProviderAccessPolicy,
  type ManagedProviderCatalogModel,
  type ManagedProviderSnapshot,
} from '../../shared/managedProviders';
import {
  isProviderEnabled,
  normalizeProviderModelPiRuntimeConfig,
  type ProviderConfig,
  ProviderName,
} from '../../shared/providers';
import {
  ZHIYUAN_MANAGED_PROVIDER_CAPABILITY_API_VERSION,
  type ZhiyuanManagedProviderHostCapability,
  type ZhiyuanManagedProviderSource,
} from './contract';
import {
  registerPiOpenAICompatTokenRefresher,
  type PiOpenAICompatTokenRefresher,
} from '../libs/agentEngine/piOpenAICompatProxy';
import { EnterpriseExtensionStoreKey, LegacyManagedProviderKey } from './constants';

const MANAGED_PROVIDER_KEY_PATTERN = /^custom_[a-z0-9](?:[a-z0-9_-]{0,62}[a-z0-9])?$/;
const MAX_MODELS = 256;
const MAX_TEXT_LENGTH = 16_384;

interface ConfigStore {
  get<T>(key: string): T | undefined;
  set(key: string, value: unknown): void;
  delete(key: string): void;
}

interface StoredAppConfig {
  readonly model?: {
    readonly defaultModel?: string;
    readonly defaultModelProvider?: string;
    readonly [key: string]: unknown;
  };
  readonly providers?: Record<string, ProviderConfig>;
  readonly [key: string]: unknown;
}

interface StoredManagedProviderProjection {
  readonly providerKey: string;
  readonly previousDefaultModel?: string;
  readonly previousDefaultModelProvider?: string;
}

type PiOpenAICompatTokenRefresherRegistrar = (
  providerId: string,
  refresher: PiOpenAICompatTokenRefresher,
) => () => void;

export class ZhiyuanManagedProviderBridge implements ZhiyuanManagedProviderHostCapability {
  readonly apiVersion = ZHIYUAN_MANAGED_PROVIDER_CAPABILITY_API_VERSION;
  readonly #registerTokenRefresher: PiOpenAICompatTokenRefresherRegistrar;
  readonly #listeners = new Set<() => void>();
  #source: ZhiyuanManagedProviderSource | null = null;
  #disposeSourceListener: (() => void) | null = null;
  #disposeTokenRefresher: (() => void) | null = null;
  #store: ConfigStore | null = null;
  #snapshot: ManagedProviderSnapshot | null = null;
  #refreshPromise: Promise<void> | null = null;
  #refreshAgain = false;

  constructor(
    registerTokenRefresher: PiOpenAICompatTokenRefresherRegistrar = registerPiOpenAICompatTokenRefresher,
  ) {
    this.#registerTokenRefresher = registerTokenRefresher;
  }

  registerSource(source: ZhiyuanManagedProviderSource): () => void {
    if (this.#source) throw new Error('A Zhiyuan managed provider source is already registered.');
    validateSource(source);
    this.#source = source;
    this.#disposeSourceListener = source.onDidChange?.(() => void this.refresh()) ?? null;
    this.#disposeTokenRefresher = this.#registerTokenRefresher(source.providerKey, async () => {
      try {
        const snapshot = await this.#syncSnapshot(source);
        this.#emitChanged();
        return snapshot.config.apiKey;
      } catch (error) {
        if (source === this.#source) this.#clearSnapshot();
        throw error;
      }
    });
    void this.refresh();
    let registered = true;
    return () => {
      if (!registered) return;
      registered = false;
      this.#disposeSourceListener?.();
      this.#disposeSourceListener = null;
      this.#disposeTokenRefresher?.();
      this.#disposeTokenRefresher = null;
      this.#source = null;
      this.#clearSnapshot();
    };
  }

  attachStore(store: ConfigStore): void {
    this.#store = store;
    if (!this.#source) this.#clearOrphanedProjection();
    void this.refresh();
  }

  accessPolicy(): ManagedProviderAccessPolicy {
    const source = this.#source;
    if (!source?.exclusive) return OPEN_MANAGED_PROVIDER_ACCESS_POLICY;
    return Object.freeze({
      mode: ManagedProviderAccessMode.Exclusive,
      providerKeys: Object.freeze([source.providerKey]),
    });
  }

  catalog(): readonly ManagedProviderCatalogModel[] {
    const snapshot = this.#snapshot;
    if (!snapshot) return Object.freeze([]);
    const providerDisplayName = snapshot.config.displayName?.trim() || 'Zhiyuan';
    return Object.freeze(
      (snapshot.config.models ?? []).map((model, index) =>
        Object.freeze({
          id: model.id,
          displayName: model.name,
          providerKey: snapshot.providerKey,
          providerDisplayName,
          ...(model.capabilities ? { capabilities: model.capabilities } : {}),
          ...(model.contextWindow || model.contextTokens
            ? { contextWindow: model.contextWindow ?? model.contextTokens }
            : {}),
          isDefault: index === 0,
        }),
      ),
    );
  }

  onDidChange(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  refresh(): Promise<void> {
    if (this.#refreshPromise) {
      this.#refreshAgain = true;
      return this.#refreshPromise;
    }
    this.#refreshPromise = this.#runRefresh().finally(() => {
      this.#refreshPromise = null;
      if (this.#refreshAgain) {
        this.#refreshAgain = false;
        void this.refresh();
      }
    });
    return this.#refreshPromise;
  }

  async #runRefresh(): Promise<void> {
    const source = this.#source;
    if (!source || !this.#store) return;
    try {
      await this.#syncSnapshot(source);
    } catch {
      this.#clearSnapshot();
      return;
    }
    this.#emitChanged();
  }

  async #syncSnapshot(source: ZhiyuanManagedProviderSource): Promise<ManagedProviderSnapshot> {
    if (!this.#store || source !== this.#source) {
      throw new Error('Zhiyuan managed provider source is unavailable.');
    }
    const snapshot = normalizeSnapshot(
      source.providerKey,
      source.exclusive,
      await source.snapshot(),
    );
    if (source !== this.#source) {
      throw new Error('Zhiyuan managed provider source changed during refresh.');
    }
    this.#snapshot = snapshot;
    this.#writeSnapshot(snapshot);
    return snapshot;
  }

  #writeSnapshot(snapshot: ManagedProviderSnapshot): void {
    const store = this.#store;
    if (!store) return;
    const current = store.get<StoredAppConfig>(EnterpriseExtensionStoreKey.AppConfig) ?? {};
    const firstModel = snapshot.config.models?.[0];
    const currentModel = current.model ?? {};
    const projection = store.get<StoredManagedProviderProjection>(
      EnterpriseExtensionStoreKey.ManagedProviderProjection,
    );
    if (projection?.providerKey !== snapshot.providerKey) {
      store.set(EnterpriseExtensionStoreKey.ManagedProviderProjection, {
        providerKey: snapshot.providerKey,
        ...(snapshot.exclusive
          ? {
              previousDefaultModel: currentModel.defaultModel,
              previousDefaultModelProvider: currentModel.defaultModelProvider,
            }
          : {}),
      } satisfies StoredManagedProviderProjection);
    }
    store.set(EnterpriseExtensionStoreKey.AppConfig, {
      ...current,
      providers: { ...current.providers, [snapshot.providerKey]: snapshot.config },
      ...(snapshot.exclusive && firstModel
        ? {
            model: {
              ...currentModel,
              defaultModel: firstModel.id,
              defaultModelProvider: snapshot.providerKey,
            },
          }
        : {}),
    });
  }

  #clearSnapshot(): void {
    const projection = this.#store?.get<StoredManagedProviderProjection>(
      EnterpriseExtensionStoreKey.ManagedProviderProjection,
    );
    const providerKey =
      this.#snapshot?.providerKey ?? this.#source?.providerKey ?? projection?.providerKey;
    this.#snapshot = null;
    this.#removeStoredProjection(providerKey, projection);
    this.#emitChanged();
  }

  #clearOrphanedProjection(): void {
    const store = this.#store;
    if (!store) return;
    const projection = store.get<StoredManagedProviderProjection>(
      EnterpriseExtensionStoreKey.ManagedProviderProjection,
    );
    if (projection) {
      this.#removeStoredProjection(projection.providerKey, projection);
      return;
    }

    const current = store.get<StoredAppConfig>(EnterpriseExtensionStoreKey.AppConfig);
    if (current?.providers?.[LegacyManagedProviderKey.Enterprise]) {
      this.#removeStoredProjection(LegacyManagedProviderKey.Enterprise);
    }
  }

  #removeStoredProjection(
    providerKey: string | undefined,
    projection?: StoredManagedProviderProjection,
  ): void {
    const store = this.#store;
    if (!store || !providerKey) return;
    const current = store.get<StoredAppConfig>(EnterpriseExtensionStoreKey.AppConfig);
    if (!current) return;
    const providers = { ...current.providers };
    delete providers[providerKey];
    const model =
      current.model?.defaultModelProvider === providerKey
        ? restoreDefaultModel(current.model, providers, projection)
        : current.model;
    store.set(EnterpriseExtensionStoreKey.AppConfig, { ...current, providers, model });
    store.delete(EnterpriseExtensionStoreKey.ManagedProviderProjection);
  }

  #emitChanged(): void {
    for (const listener of this.#listeners) {
      try {
        listener();
      } catch {
        // A renderer notification must not break managed-provider synchronization.
      }
    }
  }
}

function restoreDefaultModel(
  currentModel: NonNullable<StoredAppConfig['model']>,
  providers: Record<string, ProviderConfig>,
  projection?: StoredManagedProviderProjection,
): StoredAppConfig['model'] {
  const previousProvider = projection?.previousDefaultModelProvider;
  const previousModel = projection?.previousDefaultModel;
  if (
    previousProvider &&
    previousModel &&
    providerContainsModel(previousProvider, previousModel, providers)
  ) {
    return {
      ...currentModel,
      defaultModel: previousModel,
      defaultModelProvider: previousProvider,
    };
  }

  const fallback = selectFallbackModel(providers);
  if (fallback) {
    return {
      ...currentModel,
      defaultModel: fallback.model,
      defaultModelProvider: fallback.provider,
    };
  }

  return { ...currentModel, defaultModel: '', defaultModelProvider: undefined };
}

function selectFallbackModel(
  providers: Record<string, ProviderConfig>,
): { provider: string; model: string } | null {
  const candidates = Object.entries(providers).filter(
    ([providerName, config]) => isProviderEnabled(providerName, config) && config.models?.[0]?.id,
  );
  const selected =
    candidates.find(([providerName]) => providerName === ProviderName.DeepSeek) ?? candidates[0];
  if (!selected?.[1].models?.[0]?.id) return null;
  return { provider: selected[0], model: selected[1].models[0].id };
}

function providerContainsModel(
  providerName: string,
  model: string,
  providers: Record<string, ProviderConfig>,
): boolean {
  const config = providers[providerName];
  return (
    isProviderEnabled(providerName, config) &&
    config.models?.some(candidate => candidate.id === model)
  );
}

function validateSource(source: ZhiyuanManagedProviderSource): void {
  if (!source || typeof source !== 'object' || typeof source.snapshot !== 'function') {
    throw new Error('Zhiyuan managed provider source is invalid.');
  }
  if (source.onDidChange !== undefined && typeof source.onDidChange !== 'function') {
    throw new Error('Zhiyuan managed provider change subscription is invalid.');
  }
  if (!MANAGED_PROVIDER_KEY_PATTERN.test(source.providerKey)) {
    throw new Error('Managed provider key must use the custom provider namespace.');
  }
}

function normalizeSnapshot(
  providerKeyValue: string,
  exclusive: boolean,
  configValue: ProviderConfig,
): ManagedProviderSnapshot {
  const providerKey = normalizeText(providerKeyValue, 72);
  const config = normalizeConfig(configValue);
  return Object.freeze({ providerKey, exclusive, config });
}

function normalizeConfig(value: ProviderConfig): ProviderConfig {
  if (!value || typeof value !== 'object') throw new Error('Managed provider config is invalid.');
  const models = value.models ?? [];
  if (!Array.isArray(models) || models.length > MAX_MODELS) {
    throw new Error('Managed provider model catalog is invalid.');
  }
  return Object.freeze({
    enabled: true,
    userEnabled: true,
    apiKey: normalizeText(value.apiKey, MAX_TEXT_LENGTH),
    baseUrl: normalizeHttpUrl(value.baseUrl),
    apiFormat: 'openai',
    displayName: normalizeText(value.displayName ?? 'Zhiyuan', 128),
    models: models.map(model => ({
      id: normalizeText(model.id, 256),
      name: normalizeText(model.name, 128),
      ...(model.supportsImage !== undefined ? { supportsImage: model.supportsImage === true } : {}),
      ...(model.capabilities ? { capabilities: Object.freeze({ ...model.capabilities }) } : {}),
      ...(model.contextWindow ? { contextWindow: model.contextWindow } : {}),
      ...(model.contextTokens ? { contextTokens: model.contextTokens } : {}),
      ...(model.maxTokens ? { maxTokens: model.maxTokens } : {}),
      ...(model.piRuntime
        ? { piRuntime: normalizeProviderModelPiRuntimeConfig(model.piRuntime) }
        : {}),
    })),
  });
}

function normalizeHttpUrl(value: unknown): string {
  const normalized = normalizeText(value, 2048).replace(/\/+$/, '');
  const url = new URL(normalized);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Managed provider base URL is invalid.');
  }
  return url.toString().replace(/\/+$/, '');
}

function normalizeText(value: unknown, maximumLength: number): string {
  if (typeof value !== 'string') throw new Error('Managed provider text value is invalid.');
  const normalized = value.trim();
  if (
    !normalized ||
    normalized.length > maximumLength ||
    /[\u0000-\u001f\u007f]/.test(normalized)
  ) {
    throw new Error('Managed provider text value is invalid.');
  }
  return normalized;
}

export const zhiyuanManagedProviderBridge = new ZhiyuanManagedProviderBridge();
