import { createHash } from 'node:crypto';

import { PiCatalogProviderIdByApiKeyPrefix } from './piProviderIds';

const PI_MODEL_CATALOG_REFRESH_INTERVAL_MS = 4 * 60 * 60 * 1000;
const PI_MODEL_CATALOG_REFRESH_TIMEOUT_MS = 15_000;

interface PiCatalogCredential {
  providerId: string;
  apiKey: string;
}

interface PiCatalogRefreshResult {
  aborted?: boolean;
  errors?: ReadonlyMap<string, unknown>;
}

interface PiCatalogRuntime {
  setRuntimeApiKey(providerId: string, apiKey: string): Promise<void>;
  refresh(options: { allowNetwork: boolean; signal: AbortSignal }): Promise<PiCatalogRefreshResult>;
}

export interface PiModelCatalogRefreshCoordinatorOptions {
  resolveApiKeys: () => Record<string, string>;
  createRuntime?: () => Promise<PiCatalogRuntime>;
  refreshIntervalMs?: number;
  refreshTimeoutMs?: number;
}

function resolveCatalogCredentials(apiKeys: Record<string, string>): PiCatalogCredential[] {
  return Object.entries(PiCatalogProviderIdByApiKeyPrefix).flatMap(([apiKeyPrefix, providerId]) => {
    const apiKey = apiKeys[apiKeyPrefix]?.trim();
    return apiKey ? [{ providerId, apiKey }] : [];
  });
}

function credentialSignature(credentials: PiCatalogCredential[]): string {
  const hash = createHash('sha256');
  for (const { providerId, apiKey } of credentials) {
    hash.update(providerId);
    hash.update('\u0000');
    hash.update(apiKey);
    hash.update('\u0001');
  }
  return hash.digest('hex');
}

async function createOfflinePiCatalogRuntime(): Promise<PiCatalogRuntime> {
  const { ModelRuntime } = await import('@earendil-works/pi-coding-agent');
  return ModelRuntime.create({ allowModelNetwork: false });
}

export class PiModelCatalogRefreshCoordinator {
  private readonly resolveApiKeys: () => Record<string, string>;
  private readonly createRuntime: () => Promise<PiCatalogRuntime>;
  private readonly refreshIntervalMs: number;
  private readonly refreshTimeoutMs: number;
  private interval: NodeJS.Timeout | null = null;
  private activeController: AbortController | null = null;
  private inFlight: Promise<void> | null = null;
  private activeSignature: string | null = null;
  private lastAttemptedSignature: string | null = null;
  private pendingRefresh = false;
  private stopped = true;

  constructor(options: PiModelCatalogRefreshCoordinatorOptions) {
    this.resolveApiKeys = options.resolveApiKeys;
    this.createRuntime = options.createRuntime ?? createOfflinePiCatalogRuntime;
    this.refreshIntervalMs = options.refreshIntervalMs ?? PI_MODEL_CATALOG_REFRESH_INTERVAL_MS;
    this.refreshTimeoutMs = options.refreshTimeoutMs ?? PI_MODEL_CATALOG_REFRESH_TIMEOUT_MS;
  }

  start(): void {
    if (this.interval) return;
    this.stopped = false;
    void this.requestRefresh(true);
    this.interval = setInterval(() => void this.requestRefresh(true), this.refreshIntervalMs);
    this.interval.unref?.();
  }

  notifyConfigurationChanged(): void {
    void this.requestRefresh(false);
  }

  async requestRefresh(force: boolean): Promise<void> {
    if (this.stopped) return;

    let credentials: PiCatalogCredential[];
    try {
      credentials = resolveCatalogCredentials(this.resolveApiKeys());
    } catch (error) {
      console.warn('[PiModelCatalog] could not read provider credentials:', error);
      return;
    }
    const signature = credentialSignature(credentials);
    if (this.inFlight) {
      if (signature !== this.activeSignature) this.pendingRefresh = true;
      return this.inFlight;
    }
    if (!force && signature === this.lastAttemptedSignature) return;

    this.activeSignature = signature;
    this.lastAttemptedSignature = signature;
    const refresh = this.runRefresh(credentials)
      .catch(error => {
        if (!this.stopped) {
          console.warn('[PiModelCatalog] background refresh failed:', error);
        }
      })
      .finally(() => {
        if (this.inFlight !== refresh) return;
        this.inFlight = null;
        this.activeSignature = null;
        if (!this.stopped && this.pendingRefresh) {
          this.pendingRefresh = false;
          void this.requestRefresh(true);
        }
      });
    this.inFlight = refresh;
    return refresh;
  }

  async stop(): Promise<void> {
    this.stopped = true;
    this.pendingRefresh = false;
    if (this.interval) clearInterval(this.interval);
    this.interval = null;
    this.activeController?.abort();
    await this.inFlight;
  }

  private async runRefresh(credentials: PiCatalogCredential[]): Promise<void> {
    if (credentials.length === 0 || this.stopped) return;

    const runtime = await this.createRuntime();
    for (const { providerId, apiKey } of credentials) {
      if (this.stopped) return;
      await runtime.setRuntimeApiKey(providerId, apiKey);
    }
    if (this.stopped) return;

    const controller = new AbortController();
    this.activeController = controller;
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, this.refreshTimeoutMs);
    timeout.unref?.();

    try {
      const result = await runtime.refresh({ allowNetwork: true, signal: controller.signal });
      if (timedOut) {
        console.warn('[PiModelCatalog] background refresh timed out; keeping the existing cache');
        return;
      }
      if (this.stopped || result.aborted) return;
      if (result.errors?.size) {
        console.warn(
          `[PiModelCatalog] background refresh kept the existing cache after ${result.errors.size} provider error(s)`,
        );
        return;
      }
      console.debug(
        `[PiModelCatalog] refreshed ${credentials.length} configured provider catalog(s)`,
      );
    } finally {
      clearTimeout(timeout);
      if (this.activeController === controller) this.activeController = null;
    }
  }
}
