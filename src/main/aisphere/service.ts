import { randomBytes } from 'node:crypto';
import {
  AISphere,
  AISphereError,
  AISphereStatus,
  type AISphereSnapshot,
} from '../../shared/aisphere';
import { ManagedProviderAccessMode } from '../../shared/managedProviders';
import type { ProviderConfig } from '../../shared/providers';
import {
  normalizePlatformAddress,
  parsePlatformModels,
  publicModel,
  type PlatformModel,
} from './catalog';
import { platformFetch, type PlatformFetch } from './transport';

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
  private recoveryTimer?: ReturnType<typeof setTimeout>;
  private recoveryDelay = 5000;
  private disposed = false;
  private readonly listeners = new Set<() => void>();
  private gatewayToken = randomBytes(32).toString('hex');
  get token(): string {
    return this.gatewayToken;
  }
  busy: () => boolean = () => false;

  constructor(private readonly fetcher: PlatformFetch = platformFetch) {}

  async initialize(store: Store, gateway: string): Promise<void> {
    this.disposed = false;
    this.store = store;
    this.gateway = gateway;
    const stored = store.get<string>(AISphere.StoreKey);
    if (stored) {
      try {
        this.address = normalizePlatformAddress(stored);
      } catch {
        /* Invalid binding stays closed. */
      }
    }
    await this.refresh().catch((): void => {});
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

  private stopRecovery(): void {
    clearTimeout(this.recoveryTimer);
    this.recoveryTimer = undefined;
  }

  private scheduleRecovery(): void {
    if (this.disposed || this.ready || !this.address || this.recoveryTimer) return;
    this.recoveryTimer = setTimeout(() => {
      this.recoveryTimer = undefined;
      // Discovery stays serialized with manual refresh and platform replacement.
      void this.refresh().catch(() => this.scheduleRecovery());
    }, this.recoveryDelay);
    this.recoveryTimer.unref?.();
    this.recoveryDelay = Math.min(this.recoveryDelay * 2, 60000);
  }

  dispose(): void {
    this.disposed = true;
    this.stopRecovery();
  }

  private async json(url: string): Promise<unknown> {
    const response = await this.fetcher(url, {
      redirect: 'error',
      signal: AbortSignal.timeout(10000),
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

  /** Platforms often advertise http model URLs that nginx immediately upgrades to https. */
  private alignModelUrls(address: string, models: PlatformModel[]): PlatformModel[] {
    const platform = new URL(address);
    if (platform.protocol !== 'https:') return models;
    return models.map(model => {
      const url = new URL(model.url);
      if (url.protocol !== 'http:' || url.hostname !== platform.hostname) return model;
      url.protocol = 'https:';
      return { ...model, url: url.href };
    });
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
      return this.alignModelUrls(
        address,
        parsePlatformModels(await this.json(address + AISphere.ModelsPath)),
      );
    } catch (error) {
      if (
        error instanceof Error &&
        Object.values(AISphereError).some(code => code === error.message)
      )
        throw error;
      throw new Error(AISphereError.Unavailable);
    }
  }

  async connect(input: unknown): Promise<AISphereSnapshot> {
    const address = normalizePlatformAddress(input);
    // 2026/09/17 lixiang  仅「换地址」受运行中任务拦截；同地址重新获取模型允许
    const switching = address !== this.address;
    if (this.changing || (switching && (this.active > 0 || this.busy()))) {
      throw new Error(AISphereError.Busy);
    }
    this.changing = true;
    try {
      await this.pending?.catch((): void => {});
      const models = await this.discover(address);
      if (switching && (this.active > 0 || this.busy())) throw new Error(AISphereError.Busy);
      this.store?.set(AISphere.StoreKey, address);
      if (switching) this.gatewayToken = randomBytes(32).toString('hex');
      this.address = address;
      this.models = models;
      this.ready = true;
      this.stopRecovery();
      this.recoveryDelay = 5000;
      this.checkedAt = Date.now();
      // A new binding must not retain an old platform's default selection.
      const current = this.store?.get<Config>(AISphere.AppConfigKey) ?? {};
      this.store?.set(
        AISphere.AppConfigKey,
        this.project({
          ...current,
          model: {
            ...current.model,
            defaultModel: switching
              ? (models[0]?.id ?? '')
              : (current.model?.defaultModel ?? models[0]?.id ?? ''),
            defaultModelProvider: AISphere.Provider,
          },
        }),
      );
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
        this.stopRecovery();
        this.recoveryDelay = 5000;
        this.checkedAt = Date.now();
      } catch (error) {
        this.ready = false;
        throw error;
      } finally {
        this.notify();
      }
    })().finally(() => {
      this.pending = undefined;
      this.scheduleRecovery();
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
    if (!this.ready) throw new Error(AISphereError.Unavailable);
    if (
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
