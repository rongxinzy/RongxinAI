import type { MagpieManagerOptions } from './managerOptions';
import {
  HOST_PROVIDER_PREFIX,
  hostProviderPayload,
  type MagpieHostProvider,
} from './hostProviders';

import type {
  MagpieStatus,
  MagpieProviderSummary,
  MagpieSaveProviderInput,
  MagpieTestProviderResult,
  MagpieDiagnosticSummary,
} from '../../shared/magpie/types';

import { probeProviderEndpoint } from './providerTest';
import { RecentErrors } from './recentErrors';

import {
  enrichMagpieProviderSummariesWithStoredKeys,
  isUsableMagpieProviderKey,
  parseMagpieProviderKeyResponse,
} from './magpieProviderKey';
import {
  buildMagpieProviderSavePayload,
  normalizeProviderContexts,
  projectMagpieProviderSummaries,
  resolveMagpieProviderSaveKey,
  sanitizeProviderContexts,
} from './projectMagpieProviders';

interface ProviderContext {
  state(): MagpieStatus;
  ensureRunning(): Promise<MagpieStatus>;
  managementJson(
    route: string,
    init?: RequestInit,
    timeoutMs?: number,
  ): Promise<Record<string, unknown>>;
  request(url: string, init?: RequestInit, timeoutMs?: number): Promise<Response>;
  options: Pick<MagpieManagerOptions, 'fetch'>;
  providers(): Promise<MagpieProviderSummary[]>;
  clearRecentErrors(filter?: { providerIds?: string[]; providerNames?: string[] }): void;
  diagnostics(): Promise<MagpieDiagnosticSummary>;
}

/** Provider synchronization, editing and diagnostics for one owned manager. */
export class MagpieManagerProviders {
  private hostSync: Promise<void> = Promise.resolve();
  private hostSignatures = new Map<string, string>();
  private readonly recentErrors = new RecentErrors();
  private cachedActiveProviderCount = 0;
  private providersListHydrated = false;
  constructor(private readonly context: ProviderContext) {}

  summary(): Pick<MagpieDiagnosticSummary, 'activeProviderCount' | 'recentErrors'> {
    return {
      activeProviderCount: this.cachedActiveProviderCount,
      recentErrors: this.recentErrors.list(),
    };
  }

  clearHostSignatures(): void {
    this.hostSignatures.clear();
  }

  resetHydration(): void {
    this.providersListHydrated = false;
    this.cachedActiveProviderCount = 0;
  }

  /** Main-only authoritative host binding snapshot; external Provider credentials never enter here. */
  syncHostProviders(definitions: readonly MagpieHostProvider[]): Promise<void> {
    const payloads = definitions.map(hostProviderPayload);
    const ids = new Set(payloads.map(p => String(p.id)));
    if (ids.size !== payloads.length)
      return Promise.reject(new Error('Duplicate host provider id'));
    const run = this.hostSync
      .catch((): void => undefined)
      .then(async () => {
        await this.context.ensureRunning();
        // Discover only reserved ids. Do not forward or log the management response.
        const state = await this.context.managementJson('/api/providers');
        const existing = new Set<string>(
          (Array.isArray(state.providers) ? state.providers : []).flatMap((p: unknown) =>
            p &&
            typeof p === 'object' &&
            'id' in p &&
            typeof p.id === 'string' &&
            p.id.startsWith(HOST_PROVIDER_PREFIX)
              ? [p.id]
              : [],
          ),
        );
        for (const id of existing) {
          if (!ids.has(id)) {
            await this.context.managementJson('/api/provider/off', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ id }),
            });
            this.hostSignatures.delete(id);
          }
        }
        for (const payload of payloads) {
          const id = String(payload.id);
          const signature = JSON.stringify(payload);
          // Authoritative binding changes are written through upstream's API, never its files.
          const actual = (Array.isArray(state.providers) ? state.providers : []).find(
            (entry: { id?: string }) => entry.id === id,
          );
          const sameTarget =
            actual &&
            actual.off !== true &&
            ['chat', 'responses', 'anthropic', 'name'].every(
              field => actual[field] === payload[field],
            ) &&
            !actual.fallback?.length &&
            !actual.headers &&
            !actual.extraBody &&
            JSON.stringify(actual.chosen ?? []) === JSON.stringify(payload.models) &&
            JSON.stringify(actual.contexts ?? {}) === JSON.stringify(payload.contexts) &&
            JSON.stringify(actual.outputs ?? {}) === JSON.stringify(payload.outputs);
          if (existing.has(id) && this.hostSignatures.get(id) === signature && sameTarget) continue;
          await this.context.managementJson('/api/provider/save', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              ...payload,
              headers: {},
              extraBody: {},
              fallback: [],
              new: !existing.has(id),
            }),
          });
          // Upstream preserves provider disabled state across provider/save; a host endpoint returning
          // after unload/logout must explicitly re-enable that same reserved provider.
          if (existing.has(id) && actual?.off === true) {
            await this.context.managementJson('/api/provider/on', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ id }),
            });
          }
          this.hostSignatures.set(id, signature);
        }
        this.providersListHydrated = false;
      });
    this.hostSync = run;
    return run;
  }

  recordError(message: string, providerId?: string): void {
    this.recentErrors.record(message, providerId);
  }

  clearRecentErrors(filter?: { providerIds?: string[]; providerNames?: string[] }): void {
    this.recentErrors.clear(filter);
  }

  async clearDiagnostics(): Promise<MagpieDiagnosticSummary> {
    this.context.clearRecentErrors();
    return this.context.diagnostics();
  }

  async providers(): Promise<MagpieProviderSummary[]> {
    if (this.context.state().state !== 'running') return [];
    try {
      const state = await this.context.managementJson('/api/providers');
      const rawList = Array.isArray(state.providers) ? state.providers : [];
      const list = projectMagpieProviderSummaries(state);
      await enrichMagpieProviderSummariesWithStoredKeys(list, rawList, id =>
        this.fetchStoredProviderKey(id),
      );
      this.cachedActiveProviderCount = list.filter(p => !p.off).length;
      this.providersListHydrated = true;
      return list;
    } catch {
      return [];
    }
  }

  private async fetchStoredProviderKey(providerId: string): Promise<string | undefined> {
    const body = await this.context.managementJson('/api/provider/key', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: providerId }),
    });
    return parseMagpieProviderKeyResponse(body);
  }

  async saveProvider(input: MagpieSaveProviderInput): Promise<MagpieProviderSummary[]> {
    if (!input || typeof input !== 'object') throw new Error('Invalid provider payload');
    const name = input.name?.trim();
    if (!name || name.length > 100)
      throw new Error('Provider name is required (max 100 characters)');
    const baseUrl = input.baseUrl?.trim();
    if (!baseUrl) throw new Error('Base URL is required');
    try {
      const parsedUrl = new URL(baseUrl);
      if (!['http:', 'https:'].includes(parsedUrl.protocol)) throw new Error();
    } catch {
      throw new Error('Base URL must be a valid http or https URL');
    }
    if (input.id && input.id.startsWith(HOST_PROVIDER_PREFIX)) {
      throw new Error('Host-managed providers cannot be modified via user settings');
    }
    // Fail before starting the service on a value upstream would reject.
    const contexts = normalizeProviderContexts(input.contexts);
    await this.context.ensureRunning();
    const state = await this.context.managementJson('/api/providers');
    const existingList = Array.isArray(state.providers) ? state.providers : [];
    const existing = input.id
      ? existingList.find((p: Record<string, unknown>) => p.id === input.id)
      : undefined;

    const id =
      input.id?.trim() ||
      `provider-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    if (id.startsWith(HOST_PROVIDER_PREFIX)) {
      throw new Error('Invalid provider id');
    }

    const targetField =
      input.api === 'anthropic-messages'
        ? 'anthropic'
        : input.api === 'openai-responses'
          ? 'responses'
          : 'chat';

    const payload = buildMagpieProviderSavePayload(
      { ...input, name, contexts },
      existing as Record<string, unknown> | undefined,
      id,
      targetField,
      baseUrl,
    );

    await this.context.managementJson('/api/provider/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const existingName =
      existing && 'name' in existing && typeof existing.name === 'string'
        ? existing.name
        : undefined;
    const existingTarget =
      existing && targetField in existing && typeof existing[targetField] === 'string'
        ? existing[targetField]
        : '';
    const previousContexts = sanitizeProviderContexts(existing?.contexts);
    const nextContexts = contexts ?? previousContexts;
    // A key-only save leaves the error that made the user open the dialog.
    const configChanged =
      !existing ||
      existingTarget !== baseUrl ||
      existingName !== name ||
      JSON.stringify(nextContexts ?? null) !== JSON.stringify(previousContexts ?? null);
    if (configChanged) {
      this.context.clearRecentErrors({
        providerIds: [id],
        providerNames: [name, ...(existingName ? [existingName] : [])],
      });
    }

    return this.context.providers();
  }

  async setProviderEnabled(id: string, enabled: boolean): Promise<MagpieProviderSummary[]> {
    if (typeof id !== 'string' || id.startsWith(HOST_PROVIDER_PREFIX)) {
      throw new Error('Host-managed providers cannot be toggled via user settings');
    }
    await this.context.ensureRunning();
    const name = await this.providerName(id);
    await this.context.managementJson(enabled ? '/api/provider/on' : '/api/provider/off', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    });
    this.context.clearRecentErrors({
      providerIds: [id],
      ...(name ? { providerNames: [name] } : {}),
    });
    return this.context.providers();
  }

  async deleteProvider(id: string): Promise<MagpieProviderSummary[]> {
    if (typeof id !== 'string' || id.startsWith(HOST_PROVIDER_PREFIX)) {
      throw new Error('Host-managed providers cannot be deleted via user settings');
    }
    await this.context.ensureRunning();
    // Best effort: a failed listing must not stop the delete it only names.
    const name = await this.providerName(id);
    try {
      await this.context.managementJson('/api/provider/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
    } catch {
      await this.context.managementJson('/api/provider/off', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
    }
    this.context.clearRecentErrors({
      providerIds: [id],
      ...(name ? { providerNames: [name] } : {}),
    });
    return this.context.providers();
  }

  private async providerName(id: string): Promise<string | undefined> {
    try {
      const state = await this.context.managementJson('/api/providers');
      const list = Array.isArray(state.providers) ? state.providers : [];
      const row = list.find((provider: Record<string, unknown>) => provider.id === id);
      return row && 'name' in row && typeof row.name === 'string' ? row.name : undefined;
    } catch {
      return undefined;
    }
  }

  async testProvider(input: MagpieSaveProviderInput): Promise<MagpieTestProviderResult> {
    if (!input.baseUrl) return { ok: false, error: 'Base URL is required' };
    let key = resolveMagpieProviderSaveKey(input.key);
    if (!isUsableMagpieProviderKey(key) && input.id) {
      const stored = await this.fetchStoredProviderKey(input.id);
      if (isUsableMagpieProviderKey(stored)) key = stored;
    }
    return probeProviderEndpoint(
      input.baseUrl,
      input.api,
      isUsableMagpieProviderKey(key) ? key : '',
      this.context.options.fetch ?? fetch,
    );
  }

  async diagnostics(): Promise<MagpieDiagnosticSummary> {
    let latencyMs: number | undefined;
    if (this.context.state().state === 'running' && this.context.state().gatewayUrl) {
      const start = Date.now();
      try {
        await this.context.request(`${this.context.state().gatewayUrl}/api/hello`, {
          signal: AbortSignal.timeout(3_000),
        });
        latencyMs = Date.now() - start;
      } catch {
        /* ignore ping error */
      }
    }
    let activeProviderCount = this.cachedActiveProviderCount;
    if (this.context.state().state === 'running' && !this.providersListHydrated) {
      try {
        const all = await this.context.providers();
        activeProviderCount = all.filter(p => !p.off).length;
      } catch {
        activeProviderCount = 0;
      }
    }
    return {
      latencyMs,
      activeProviderCount,
      recentErrors: this.recentErrors.list(),
    };
  }
}
