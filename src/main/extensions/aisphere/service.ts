import { createHash, randomBytes } from 'node:crypto';
import {
  AISphere,
  AISphereError,
  AISphereStatus,
  type AISphereSnapshot,
} from '../../../shared/aisphere';
import {
  ManagedProviderAccessMode,
  type ManagedProviderCatalogModel,
} from '../../../shared/managedProviders';
import { ModelCapabilityStatus } from '../../../shared/providers';
import type { MagpieHostProvider } from '../../magpie/hostProviders';
import { MAGPIE_DEFAULT_MODEL_ID_KEY } from '../../magpie/modelService';
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
interface Gateway {
  baseUrl: string;
  close: () => Promise<void>;
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
  private gateway?: Gateway;
  private openingGateway?: Promise<Gateway>;
  private startGateway?: () => Promise<Gateway>;
  private readonly listeners = new Set<() => void>();
  private gatewayToken = randomBytes(32).toString('hex');
  get token(): string {
    return this.gatewayToken;
  }
  busy: () => boolean = () => false;

  constructor(private readonly fetcher: PlatformFetch = platformFetch) {}

  async initialize(store: Store, startGateway: () => Promise<Gateway>): Promise<void> {
    this.store = store;
    this.startGateway = startGateway;
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

  private async ensureGateway(): Promise<void> {
    const start = this.startGateway;
    if (!start) throw new Error(AISphereError.Unavailable);
    if (this.gateway) return;
    const opening = (this.openingGateway ??= start());
    try {
      const gateway = await opening;
      if (this.openingGateway !== opening) throw new Error(AISphereError.Unavailable);
      this.gateway = gateway;
    } finally {
      if (this.openingGateway === opening) this.openingGateway = undefined;
    }
  }

  private async closeGateway(): Promise<void> {
    const { gateway, openingGateway } = this;
    this.gateway = undefined;
    this.openingGateway = undefined;
    const opened = gateway ?? (await openingGateway?.catch((): undefined => undefined));
    await opened?.close();
  }

  async shutdown(): Promise<void> {
    this.startGateway = undefined;
    await this.closeGateway();
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
    const providerId = this.providerId;
    return {
      mode: ManagedProviderAccessMode.Exclusive,
      providerKeys: providerId ? [providerId] : [],
    };
  }

  private get providerId(): string | null {
    if (!this.address) return null;
    const origin = createHash('sha256').update(this.address).digest('hex').slice(0, 24);
    return `${AISphere.HostProviderPrefix}${origin}`;
  }

  allowedModel(modelRef: string, owner: string | undefined): boolean {
    return (
      this.ready &&
      owner?.startsWith(AISphere.HostProviderPrefix) &&
      owner === this.providerId &&
      this.models.some(model => modelRef === `${owner}/${model.id}`)
    );
  }

  defaultModelRef(): string {
    const providerId = this.providerId;
    if (!this.ready || !providerId || !this.models.length) return '';
    const selection = this.store?.get<string>(MAGPIE_DEFAULT_MODEL_ID_KEY)?.trim() ?? '';
    return this.allowedModel(selection, providerId)
      ? selection
      : `${providerId}/${this.models[0].id}`;
  }

  catalog(): ManagedProviderCatalogModel[] {
    const providerId = this.providerId;
    if (!this.ready || !providerId) return [];
    const defaultModel = this.defaultModelRef();
    return this.models.map(model => ({
      ...publicModel(model),
      id: `${providerId}/${model.id}`,
      displayName: model.name,
      providerKey: providerId,
      providerDisplayName: 'AISphere',
      isDefault: defaultModel === `${providerId}/${model.id}`,
    }));
  }

  hostProvider(): MagpieHostProvider | null {
    const providerId = this.providerId;
    if (!this.ready || !providerId || !this.gateway || !this.models.length) return null;
    return {
      id: providerId,
      name: 'AISphere',
      api: 'openai-completions',
      baseUrl: `${this.gateway.baseUrl}/v1`,
      apiKey: this.token,
      models: this.models.map(model => ({
        id: model.id,
        name: model.name,
        contextWindow: model.contextWindow,
        maxTokens: model.maxTokens,
        input:
          model.capabilities.imageInput === ModelCapabilityStatus.Supported
            ? ['text', 'image']
            : ['text'],
      })),
    };
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
      return parsePlatformModels(await this.json(address + AISphere.ModelsPath));
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
    const address = normalizePlatformAddress(input);
    if (this.changing || this.active || this.busy()) throw new Error(AISphereError.Busy);
    this.changing = true;
    try {
      await this.pending?.catch((): void => {});
      const models = await this.discover(address);
      if (this.active || this.busy()) throw new Error(AISphereError.Busy);
      if (!this.startGateway) throw new Error(AISphereError.Unavailable);
      const switching = address !== this.address;
      if (models.length) await this.ensureGateway();
      this.store?.set(AISphere.StoreKey, address);
      if (switching) this.gatewayToken = randomBytes(32).toString('hex');
      this.address = address;
      this.models = models;
      this.ready = true;
      this.checkedAt = Date.now();
      if (switching) this.store?.set(MAGPIE_DEFAULT_MODEL_ID_KEY, this.defaultModelRef());
      this.notify();
      return this.snapshot();
    } finally {
      this.changing = false;
    }
  }

  async disconnect(): Promise<AISphereSnapshot> {
    if (this.changing || this.active || this.busy()) throw new Error(AISphereError.Busy);
    this.changing = true;
    try {
      await this.pending?.catch((): void => {});
      if (this.active || this.busy()) throw new Error(AISphereError.Busy);
      this.store?.set(AISphere.StoreKey, '');
      const selection = this.store?.get<string>(MAGPIE_DEFAULT_MODEL_ID_KEY);
      if (selection?.startsWith(AISphere.HostProviderPrefix))
        this.store?.set(MAGPIE_DEFAULT_MODEL_ID_KEY, '');
      this.gatewayToken = randomBytes(32).toString('hex');
      this.address = '';
      this.models = [];
      this.ready = false;
      this.checkedAt = 0;
      await this.closeGateway();
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
        const models = await this.discover(this.address);
        if (models.length) await this.ensureGateway();
        this.models = models;
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
