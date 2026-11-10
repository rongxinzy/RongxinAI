import { randomBytes } from 'node:crypto';
import {
  AISphere,
  AISphereError,
  AISphereStatus,
  type AISphereSnapshot,
} from '../../../shared/aisphere';
import { ManagedProviderAccessMode } from '../../../shared/managedProviders';
import type { ProviderConfig } from '../../../shared/providers';
import { isOwnedExternalUrl } from '../../shellIpc/ownedExternalUrls';
import {
  normalizePlatformAddress,
  parsePlatformModels,
  publicModel,
  type PlatformModel,
} from './catalog';
import { platformFetch, type PlatformFetch } from './transport';

interface RestrictedPlatform {
  inferenceOrigins: readonly string[];
}

interface Store {
  get<T>(key: string): T | undefined;
  set(key: string, value: unknown): void;
}
interface ModelSelection {
  defaultModel?: string;
  defaultModelProvider?: string;
}
interface Config {
  model?: ModelSelection;
  providers?: Record<string, unknown>;
  api?: unknown;
}

/** Owns real endpoints and credentials. Only a safe gateway projection leaves the main process. */
export class AISphereService {
  private store?: Store;
  private address = '';
  private models: PlatformModel[] = [];
  private ready = false;
  private checkedAt = 0;
  private pending?: Promise<void>;
  private changing = false;
  private active = 0;
  private gateway = '';
  private restrictedPlatform?: RestrictedPlatform;
  private readonly listeners = new Set<() => void>();
  private gatewayToken = randomBytes(32).toString('hex');
  get token(): string {
    return this.gatewayToken;
  }
  busy: () => boolean = () => false;

  constructor(private readonly fetcher: PlatformFetch = platformFetch) {}

  async initialize(
    store: Store,
    gateway: string,
    options?: { backgroundRefresh?: boolean; restrictedPlatform?: RestrictedPlatform },
  ): Promise<void> {
    this.store = store;
    this.gateway = gateway;
    this.restrictedPlatform = options?.restrictedPlatform;
    const stored = store.get<string>(AISphere.StoreKey);
    if (stored) {
      try {
        this.address = this.normalizeAddress(stored);
      } catch {
        /* Invalid binding stays closed. */
      }
    }
    const refresh = this.refresh().catch((): void => {});
    if (!options?.backgroundRefresh) await refresh;
  }

  modelGatewayOrigin(): string {
    return this.gateway;
  }

  requiresTrustedCertificate(): boolean {
    return Boolean(this.restrictedPlatform);
  }

  private normalizeAddress(input: unknown): string {
    const address = normalizePlatformAddress(input);
    if (this.restrictedPlatform && isOwnedExternalUrl(address)) {
      throw new Error(AISphereError.InvalidAddress);
    }
    return address;
  }

  defaultModel(): string | undefined {
    return this.store?.get<Config>(AISphere.AppConfigKey)?.model?.defaultModel;
  }

  setDefaultModel(model: string): void {
    this.selection(model, AISphere.Provider);
    const current = this.store?.get<Config>(AISphere.AppConfigKey) ?? {};
    this.store?.set(AISphere.AppConfigKey, {
      ...current,
      model: { ...current.model, defaultModel: model, defaultModelProvider: AISphere.Provider },
    });
  }

  snapshot(): AISphereSnapshot {
    return {
      address: this.address,
      status: !this.address
        ? AISphereStatus.Unconfigured
        : this.ready
          ? AISphereStatus.Ready
          : AISphereStatus.Unavailable,
      models: this.models.map(publicModel),
    };
  }

  policy() {
    return { mode: ManagedProviderAccessMode.Exclusive, providerKeys: [AISphere.Provider] };
  }

  onChanged(callback: () => void): () => void {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  private notify() {
    for (const callback of this.listeners) callback();
  }

  private async json(url: string): Promise<unknown> {
    const response = await this.fetcher(url, {
      redirect: 'error',
      signal: AbortSignal.timeout(10000),
      requireTrustedCertificate: this.requiresTrustedCertificate(),
    });
    if (!response.ok || !response.body) throw new Error(AISphereError.Unavailable);
    // Discovery responses are small and bounded; do not read unlimited server payloads.
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    try {
      while (true) {
        const next = await reader.read();
        if (next.done) break;
        bytes += next.value.byteLength;
        if (bytes > 256 * 1024) throw new Error(AISphereError.InvalidModels);
        chunks.push(next.value);
      }
      return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
    } finally {
      await reader.cancel().catch((): void => {});
    }
  }

  private async discover(address: string): Promise<PlatformModel[]> {
    try {
      const identity = await this.json(address + AISphere.VerifyPath);
      if (
        !identity ||
        typeof identity !== 'object' ||
        !('data' in identity) ||
        identity.data !== 'ok'
      ) {
        throw new Error(AISphereError.InvalidPlatform);
      }
      const models = parsePlatformModels(await this.json(address + AISphere.ModelsPath));
      if (this.restrictedPlatform) {
        const origins = new Set([address, ...this.restrictedPlatform.inferenceOrigins]);
        if (
          models.some(
            model => isOwnedExternalUrl(model.url) || !origins.has(new URL(model.url).origin),
          )
        ) {
          throw new Error(AISphereError.InvalidModels);
        }
      }
      return models;
    } catch (error) {
      if (
        error instanceof Error &&
        Object.values(AISphereError).some(code => code === error.message)
      ) {
        throw error;
      }
      throw new Error(AISphereError.Unavailable);
    }
  }

  async connect(input: unknown): Promise<AISphereSnapshot> {
    const address = this.normalizeAddress(input);
    if (this.changing || this.active || this.busy()) throw new Error(AISphereError.Busy);
    this.changing = true;
    try {
      await this.pending?.catch((): void => {});
      const models = await this.discover(address);
      if (this.active || this.busy()) throw new Error(AISphereError.Busy);
      const switching = address !== this.address;
      this.store?.set(AISphere.StoreKey, address);
      if (switching) this.gatewayToken = randomBytes(32).toString('hex');
      this.address = address;
      this.models = models;
      this.ready = true;
      this.checkedAt = Date.now();
      // A new binding must not retain an old platform's default selection.
      const current = this.store?.get<Config>(AISphere.AppConfigKey) ?? {};
      const next = {
        ...current,
        model: {
          ...current.model,
          defaultModel: switching
            ? (models[0]?.id ?? '')
            : (current.model?.defaultModel ?? models[0]?.id ?? ''),
          defaultModelProvider: AISphere.Provider,
        },
      };
      this.store?.set(AISphere.AppConfigKey, this.restrictedPlatform ? next : this.project(next));
      this.notify();
      return this.snapshot();
    } finally {
      this.changing = false;
    }
  }

  async refresh(): Promise<void> {
    if (this.changing) throw new Error(AISphereError.Busy);
    if (this.pending) return this.pending;
    if (!this.address) return;
    this.pending = (async () => {
      try {
        this.models = await this.discover(this.address);
        this.ready = true;
        this.checkedAt = Date.now();
      } catch (error) {
        this.ready = false;
        throw error;
      } finally {
        this.notify();
      }
    })().finally(() => {
      this.pending = undefined;
    });
    return this.pending;
  }

  provider(): ProviderConfig {
    return {
      enabled: true,
      userEnabled: true,
      displayName: 'AISphere',
      apiFormat: 'openai',
      baseUrl: this.gateway + '/v1',
      apiKey: this.token,
      models: this.ready ? this.models.map(publicModel) : [],
    };
  }

  project<T extends Config>(config: T): T {
    return {
      ...config,
      api: { key: this.token, baseUrl: this.gateway + '/v1', apiFormat: 'openai' },
      providers: { [AISphere.Provider]: this.provider() },
    };
  }

  selection(model?: string, provider?: string): { model: string; config: ProviderConfig } {
    if (
      !this.ready ||
      !model ||
      (provider && provider !== AISphere.Provider) ||
      !this.models.some(item => item.id === model)
    ) {
      throw new Error(AISphereError.MissingModel);
    }
    return { model, config: this.provider() };
  }

  assertGateway(url: string, method: string): void {
    if (!this.gateway || url !== this.gateway + AISphere.ChatPath || method !== 'POST') {
      throw new Error(AISphereError.RequestRejected);
    }
  }

  async acquire(model: string): Promise<{ model: PlatformModel; release: () => void }> {
    if (this.changing) throw new Error(AISphereError.Busy);
    this.active += 1;
    try {
      if (!this.ready || Date.now() - this.checkedAt > 30000) await this.refresh();
      const selected = this.models.find(item => item.id === model);
      if (!this.ready || !selected) throw new Error(AISphereError.MissingModel);
      return {
        model: selected,
        release: () => {
          this.active -= 1;
        },
      };
    } catch (error) {
      this.active -= 1;
      throw error;
    }
  }
}

export const aisphereService = new AISphereService();
