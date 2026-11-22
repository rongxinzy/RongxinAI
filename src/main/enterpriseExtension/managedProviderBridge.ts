import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
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
import { ENTERPRISE_HOST_PROVIDER_PREFIX, type MagpieHostProvider } from '../magpie/hostProviders';

const MANAGED_PROVIDER_KEY_PATTERN = /^custom_[a-z0-9](?:[a-z0-9_-]{0,62}[a-z0-9])?$/;
const MAX_MODELS = 256;
const MAX_TEXT_LENGTH = 16_384;

interface EnterpriseRoute {
  modelId: string;
  localKey: string;
  baseUrl: string;
  api: 'openai-completions' | 'anthropic-messages';
}

/** Enterprise credentials stay in the extension bridge, never in app config or the gateway catalog. */
export class ZhiyuanManagedProviderBridge implements ZhiyuanManagedProviderHostCapability {
  readonly apiVersion = ZHIYUAN_MANAGED_PROVIDER_CAPABILITY_API_VERSION;
  readonly #listeners = new Set<() => void>();
  #source: ZhiyuanManagedProviderSource | null = null;
  #disposeSourceListener: (() => void) | null = null;
  #epoch = 0;
  #definitions: Omit<MagpieHostProvider, 'baseUrl'>[] = [];
  #enterpriseModels = new Map<string, EnterpriseRoute>();
  #routeLifetimes = new Map<string, AbortController>();
  #localKey = '';
  #currentApiKey = '';
  #refreshPromise: Promise<void> | null = null;
  #refreshAgain = false;

  registerSource(source: ZhiyuanManagedProviderSource): () => void {
    if (this.#source) throw new Error('A Zhiyuan managed provider source is already registered.');
    validateSource(source);
    this.#source = source;
    this.#localKey = randomBytes(32).toString('hex');
    this.#disposeSourceListener =
      source.onDidChange?.(() => {
        this.#clearSnapshot(false);
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

  hostProviders(origin?: string): readonly MagpieHostProvider[] {
    if (!origin) return [];
    return this.#definitions.map(definition => ({
      ...definition,
      baseUrl: `${origin}/${definition.id}${definition.api === 'anthropic-messages' ? '' : '/v1'}`,
    }));
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

  async resolveTransport(providerId: string, credential: string) {
    const route = this.#enterpriseModels.get(providerId);
    if (!route || !matchesEnterpriseCapability(credential, route.localKey)) return null;
    const epoch = this.#epoch;
    if (this.#refreshPromise) await this.#refreshPromise;
    const current = this.#enterpriseModels.get(providerId);
    const signal = this.#routeLifetimes.get(providerId)?.signal;
    if (
      epoch !== this.#epoch ||
      !current ||
      !signal ||
      signal.aborted ||
      !this.#currentApiKey ||
      !matchesEnterpriseCapability(credential, current.localKey)
    ) {
      return null;
    }
    return {
      modelId: current.modelId,
      baseUrl: current.baseUrl,
      api: current.api,
      token: this.#currentApiKey,
      signal,
    };
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
      const epoch = this.#epoch;
      if (!source) return;
      try {
        await this.#syncSnapshot(source);
      } catch {
        if (source === this.#source && epoch === this.#epoch) this.#clearSnapshot();
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

  async #syncSnapshot(source: ZhiyuanManagedProviderSource): Promise<void> {
    const epoch = this.#epoch;
    const snapshot = normalizeSnapshot(
      source.providerKey,
      source.exclusive,
      await source.snapshot(),
    );
    if (source !== this.#source || epoch !== this.#epoch)
      throw new Error('Managed provider source changed during refresh.');
    const next: Omit<MagpieHostProvider, 'baseUrl'>[] = [];
    const modelsMap = new Map<string, EnterpriseRoute>();
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
      const hostProviderId = `${ENTERPRISE_HOST_PROVIDER_PREFIX}${hash}`;
      // Magpie deduplicates provider entries with the same host and key.
      const localKey = createHmac('sha256', this.#localKey).update(hostProviderId).digest('hex');
      modelsMap.set(hostProviderId, { modelId: model.id, localKey, baseUrl, api });
      next.push({
        id: hostProviderId,
        name: snapshot.config.displayName ?? 'Enterprise',
        api,
        apiKey: localKey,
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
    for (const [id, lifetime] of this.#routeLifetimes) {
      if (modelsMap.has(id)) continue;
      lifetime.abort();
      this.#routeLifetimes.delete(id);
    }
    for (const id of modelsMap.keys()) {
      if (!this.#routeLifetimes.has(id)) this.#routeLifetimes.set(id, new AbortController());
    }
    this.#enterpriseModels = modelsMap;
    this.#currentApiKey = snapshot.config.apiKey;
    this.#definitions = next;
  }

  #clearSnapshot(revokeActive = true): void {
    if (revokeActive) {
      for (const lifetime of this.#routeLifetimes.values()) lifetime.abort();
      this.#routeLifetimes.clear();
    }
    this.#epoch++;
    this.#enterpriseModels.clear();
    this.#currentApiKey = '';
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
  if (
    (url.protocol !== 'http:' && url.protocol !== 'https:') ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
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

export function matchesEnterpriseCapability(value: string, expected: string): boolean {
  return /^[0-9a-f]{64}$/.test(value) && timingSafeEqual(Buffer.from(value), Buffer.from(expected));
}

export const zhiyuanManagedProviderBridge = new ZhiyuanManagedProviderBridge();
