import { createHash, randomBytes } from 'node:crypto';
import {
  ManagedProviderAccessMode,
  OPEN_MANAGED_PROVIDER_ACCESS_POLICY,
  type ManagedProviderAccessPolicy,
  type ManagedProviderCatalogModel,
  type ManagedProviderSnapshot,
} from '../../shared/managedProviders';
import {
  ApiFormat,
  normalizeProviderModelPiRuntimeConfig,
  type ProviderConfig,
} from '../../shared/providers';
import {
  ZHIYUAN_MANAGED_PROVIDER_CAPABILITY_API_VERSION,
  type ZhiyuanManagedProviderHostCapability,
  type ZhiyuanManagedProviderSource,
} from './contract';
import type { MagpieHostProvider } from '../magpie/hostProviders';

const MANAGED_PROVIDER_KEY_PATTERN = /^custom_[a-z0-9](?:[a-z0-9_-]{0,62}[a-z0-9])?$/;
const MAX_MODELS = 256;
const MAX_TEXT_LENGTH = 16_384;

export interface ManagedEnterpriseModelRuntimeConfig {
  modelId: string;
  providerKey: string;
  baseUrl: string;
  api: 'openai-completions' | 'anthropic-messages';
  apiKey: string;
}

/** Enterprise credentials stay in the extension bridge, never in app config or the gateway catalog. */
export class ZhiyuanManagedProviderBridge implements ZhiyuanManagedProviderHostCapability {
  readonly apiVersion = ZHIYUAN_MANAGED_PROVIDER_CAPABILITY_API_VERSION;
  readonly #listeners = new Set<() => void>();
  #source: ZhiyuanManagedProviderSource | null = null;
  #disposeSourceListener: (() => void) | null = null;
  #epoch = 0;
  #definitions: MagpieHostProvider[] = [];
  #enterpriseModels = new Map<string, ManagedEnterpriseModelRuntimeConfig>();
  #localKey = '';
  #currentApiKey = '';
  #tokenInvalidated = false;
  #refreshPromise: Promise<void> | null = null;
  #refreshAgain = false;
  #tokenRefreshPromise: Promise<string> | null = null;

  registerSource(source: ZhiyuanManagedProviderSource): () => void {
    if (this.#source) throw new Error('A Zhiyuan managed provider source is already registered.');
    validateSource(source);
    this.#source = source;
    this.#localKey = randomBytes(32).toString('hex');
    this.#disposeSourceListener =
      source.onDidChange?.(() => {
        this.#clearSnapshot();
        void this.refresh();
      }) ?? null;
    void this.refresh();
    let registered = true;
    return () => {
      if (!registered) return;
      registered = false;
      this.#disposeSourceListener?.();
      this.#disposeSourceListener = null;
      this.#source = null;
      this.#clearSnapshot();
      this.#localKey = '';
    };
  }

  accessPolicy(): ManagedProviderAccessPolicy {
    if (!this.#source?.exclusive) return OPEN_MANAGED_PROVIDER_ACCESS_POLICY;
    return Object.freeze({
      mode: ManagedProviderAccessMode.Exclusive,
      providerKeys: Object.freeze(this.#definitions.map(def => def.id)),
    });
  }

  isManagedProvider(name: string): boolean {
    return name.startsWith('zhiyuan-host-enterprise-');
  }

  hostProviders(): readonly MagpieHostProvider[] {
    return this.#definitions;
  }

  allowedModel(modelRef: string): boolean {
    if (!this.#source?.exclusive) return true;
    return this.#definitions.some(def =>
      def.models.some(model => `${def.id}/${model.id}` === modelRef),
    );
  }

  catalog(): readonly ManagedProviderCatalogModel[] {
    return this.#definitions.flatMap(def =>
      def.models.map((model, index) => ({
        id: model.id,
        displayName: model.name ?? model.id,
        providerKey: def.id,
        providerDisplayName: def.name,
        contextWindow: model.contextWindow,
        isDefault: index === 0,
      })),
    );
  }

  getEnterpriseModelConfig(modelRef: string): ManagedEnterpriseModelRuntimeConfig | null {
    if (!modelRef) return null;
    const direct = this.#enterpriseModels.get(modelRef);
    if (direct) return direct;
    // Check by stripping host provider prefix if passed like 'zhiyuan-host-enterprise-.../model-id'
    const slashIndex = modelRef.indexOf('/');
    if (slashIndex >= 0) {
      const modelId = modelRef.slice(slashIndex + 1);
      const matched = this.#enterpriseModels.get(modelId);
      if (matched) return matched;
    }
    return null;
  }

  async getToken(_providerId?: string): Promise<string> {
    if (this.#tokenInvalidated || !this.#currentApiKey) {
      if (this.#tokenRefreshPromise) {
        return this.#tokenRefreshPromise;
      }
      this.#tokenRefreshPromise = (async () => {
        const source = this.#source;
        if (!source) throw new Error('No managed provider source is registered.');
        try {
          const snapshot = await this.#syncSnapshot(source);
          this.#tokenInvalidated = false;
          this.#currentApiKey = snapshot.config.apiKey;
          this.#emitChanged();
          return this.#currentApiKey;
        } catch (error) {
          if (source === this.#source) this.#clearSnapshot();
          throw error;
        } finally {
          this.#tokenRefreshPromise = null;
        }
      })();
      return this.#tokenRefreshPromise;
    }
    return this.#currentApiKey;
  }

  invalidateToken(_providerId?: string): void {
    this.#tokenInvalidated = true;
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
    this.#refreshPromise = (async () => {
      const source = this.#source;
      if (!source) return;
      try {
        await this.#syncSnapshot(source);
      } catch {
        if (source === this.#source) this.#clearSnapshot();
        return;
      }
      this.#emitChanged();
    })().finally(() => {
      this.#refreshPromise = null;
      if (this.#refreshAgain) {
        this.#refreshAgain = false;
        void this.refresh();
      }
    });
    return this.#refreshPromise;
  }

  async #syncSnapshot(source: ZhiyuanManagedProviderSource): Promise<ManagedProviderSnapshot> {
    const epoch = this.#epoch;
    const snapshot = normalizeSnapshot(
      source.providerKey,
      source.exclusive,
      await source.snapshot(),
    );
    if (source !== this.#source || epoch !== this.#epoch)
      throw new Error('Managed provider source changed during refresh.');
    const next: MagpieHostProvider[] = [];
    const modelsMap = new Map<string, ManagedEnterpriseModelRuntimeConfig>();
    for (const model of snapshot.config.models ?? []) {
      const baseUrl = model.baseUrl ?? snapshot.config.baseUrl;
      const api =
        model.piRuntime?.api ??
        (snapshot.config.apiFormat === ApiFormat.Anthropic
          ? 'anthropic-messages'
          : 'openai-completions');
      if (api !== 'openai-completions' && api !== 'anthropic-messages')
        throw new Error('Enterprise proxy protocol is not supported.');
      const hash = createHash('sha256')
        .update(`${source.providerKey}\n${api}\n${baseUrl}\n${model.id}`)
        .digest('hex')
        .slice(0, 20);
      const hostProviderId = `zhiyuan-host-enterprise-${hash}`;
      const runtimeConfig: ManagedEnterpriseModelRuntimeConfig = {
        modelId: model.id,
        providerKey: hostProviderId,
        baseUrl,
        api,
        apiKey: snapshot.config.apiKey,
      };
      modelsMap.set(model.id, runtimeConfig);
      modelsMap.set(`${hostProviderId}/${model.id}`, runtimeConfig);
      // Supplying virtual loopback URL http://127.0.0.1:0/v1 satisfies Magpie validation without binding ports
      next.push({
        id: hostProviderId,
        name: snapshot.config.displayName ?? 'Enterprise',
        api,
        baseUrl: 'http://127.0.0.1:0/v1',
        apiKey: this.#localKey,
        models: [
          {
            id: model.id,
            name: model.name,
            contextWindow: model.contextWindow ?? model.contextTokens,
            maxTokens: model.maxTokens,
            input: model.supportsImage ? ['text', 'image'] : ['text'],
          },
        ],
      });
    }
    this.#enterpriseModels = modelsMap;
    this.#currentApiKey = snapshot.config.apiKey;
    this.#tokenInvalidated = false;
    this.#definitions = next;
    return snapshot;
  }

  #clearSnapshot(): void {
    this.#epoch++;
    this.#enterpriseModels.clear();
    this.#currentApiKey = '';
    this.#tokenInvalidated = false;
    this.#definitions = [];
    this.#emitChanged();
  }

  #emitChanged(): void {
    for (const listener of this.#listeners)
      try {
        listener();
      } catch {
        /* notification cannot interrupt revocation */
      }
  }
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
    apiFormat: normalizeApiFormat(value.apiFormat),
    displayName: normalizeText(value.displayName ?? 'Zhiyuan', 128),
    models: models.map(model => ({
      id: normalizeText(model.id, 256),
      name: normalizeText(model.name, 128),
      ...(model.baseUrl !== undefined ? { baseUrl: normalizeHttpUrl(model.baseUrl) } : {}),
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

function normalizeApiFormat(value: unknown): ApiFormat {
  if (value === undefined) return ApiFormat.OpenAI;
  if (value === ApiFormat.OpenAI || value === ApiFormat.Anthropic) return value;
  throw new Error('Managed provider API format is invalid.');
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
