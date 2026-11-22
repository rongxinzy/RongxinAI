import type { MagpieManagerOptions } from './managerOptions';
import { syncMagpieLanAccessKey } from './lanAccess';
import type { MagpieSignInState } from './oauthPolicy';
import { formatMagpieManagementError } from './managementErrors';
import { mergeMagpiePreferences, projectMagpiePreferences } from './preferences';
import type { MagpiePreferences, MagpiePreferencesPatch } from '../../shared/magpie/preferences';
import { parseMagpieCatalog, readBoundedCatalog } from './catalogReader';
import { isRetiredHostModel, isRetiredHostProviderId } from './hostProviders';

import type { MagpieStatus, MagpieModel } from '../../shared/magpie/types';

interface ManagementContext {
  options: Pick<MagpieManagerOptions, 'lanAccess' | 'parseCatalog'>;
  recordError(message: string): void;
  status(): MagpieStatus;
  ensureRunning(): Promise<MagpieStatus>;
  webRequest(route: string, init?: RequestInit, timeoutMs?: number): Promise<Response>;
  state(): MagpieStatus;
  abort(): AbortController | undefined;
  request(url: string, init?: RequestInit, timeoutMs?: number): Promise<Response>;
}

interface ManagementWrites {
  owner: AbortSignal;
  preferences?: Promise<MagpiePreferences>;
  lanKey?: Promise<void>;
}

/** Settings access and coalesced catalog reads for the owned process. */
export class MagpieManagerManagement {
  private catalogRead?: { owner: AbortSignal; pending: Promise<MagpieModel[]> };
  private writes?: ManagementWrites;
  constructor(private readonly context: ManagementContext) {}

  models(): Promise<MagpieModel[]> {
    const state = this.context.state();
    const owner = this.context.abort()?.signal;
    if (state.state !== 'running' || !state.gatewayUrl || !owner || owner.aborted)
      return Promise.resolve([]);
    if (this.catalogRead?.owner === owner) return this.catalogRead.pending;
    const pending = this.readModels(state.gatewayUrl, owner).finally(() => {
      if (this.catalogRead?.pending === pending) this.catalogRead = undefined;
    });
    this.catalogRead = { owner, pending };
    return pending;
  }
  private async readModels(gateway: string, owner: AbortSignal): Promise<MagpieModel[]> {
    const signal = AbortSignal.any([owner, AbortSignal.timeout(15_000)]);
    const response = await this.context.request(`${gateway}/v1/models`, { signal });
    if (!response.ok) throw new Error('Unable to load local models');
    const bytes = await readBoundedCatalog(response, signal);
    const models = await (this.context.options.parseCatalog ?? parseMagpieCatalog)(bytes, signal);
    signal.throwIfAborted();
    if (this.context.state().state !== 'running' || this.context.state().gatewayUrl !== gateway)
      throw new Error('Model service changed while reading its catalog');
    return models.filter(
      model =>
        !isRetiredHostProviderId(model.owned_by) &&
        !isRetiredHostModel(model.id) &&
        !isRetiredHostModel(model.canonical_id),
    );
  }
  private runningOwner(): AbortSignal | undefined {
    return this.context.state().state === 'running' ? this.context.abort()?.signal : undefined;
  }
  private writesFor(owner: AbortSignal): ManagementWrites {
    owner.throwIfAborted();
    if (this.writes?.owner !== owner) this.writes = { owner };
    return this.writes;
  }
  async preferences(): Promise<MagpiePreferences> {
    const signal = this.runningOwner();
    if (!signal) throw new Error('Model service is unavailable');
    return projectMagpiePreferences(await this.managementJson('/api/settings', { signal }));
  }
  async updatePreferences(patch: MagpiePreferencesPatch): Promise<MagpiePreferences> {
    const owner = this.runningOwner();
    if (!owner) throw new Error('Model service is unavailable');
    const writes = this.writesFor(owner);
    const pending = (writes.preferences ?? Promise.resolve())
      .catch((): void => {})
      .then(() => this.savePreferences(owner, patch));
    writes.preferences = pending;
    return pending;
  }
  private async savePreferences(signal: AbortSignal, patch: MagpiePreferencesPatch) {
    const raw = await this.managementJson('/api/settings', { signal });
    const {
      bareModelIDs: on,
      disabledModels: models,
      ...merged
    } = mergeMagpiePreferences(raw, patch);
    const save = (route: string, body: Record<string, unknown>) =>
      this.managementJson(route, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal,
      });
    let saved = raw;
    if (Object.keys(patch).some(key => key !== 'bareModelIDs' && key !== 'disabledModels')) {
      saved = await save('/api/settings', merged);
    }
    if (patch.bareModelIDs !== undefined) {
      saved = await save('/api/settings/bare-ids', { on });
    }
    if (patch.disabledModels !== undefined) {
      saved = await save('/api/settings/disabled-models', { models });
    }
    return projectMagpiePreferences(saved);
  }
  /** Main-only read of a flow created by the official management page. */
  async signInStatus(id: string): Promise<MagpieSignInState> {
    if (!/^[A-Za-z0-9_-]{1,80}$/.test(id) || !this.context.status().subscriptionAccountsEnabled)
      throw new Error('Subscription sign-in is unavailable');
    await this.context.ensureRunning();
    const signal = this.runningOwner();
    if (!signal) throw new Error('Model service is unavailable');
    const result = await this.managementJson(`/api/signin/${encodeURIComponent(id)}`, { signal });
    if (
      result.id !== id ||
      typeof result.agent !== 'string' ||
      typeof result.url !== 'string' ||
      typeof result.state !== 'string' ||
      result.url.length > 8192
    )
      throw new Error('Invalid subscription sign-in state');
    return { id, agent: result.agent, url: result.url, state: result.state };
  }
  async managementJson(
    route: string,
    init: RequestInit = {},
    timeoutMs?: number,
  ): Promise<Record<string, unknown>> {
    init.signal?.throwIfAborted();
    const response = await this.context.webRequest(route, init, timeoutMs);
    const text = await response.text();
    init.signal?.throwIfAborted();
    if (!response.ok)
      throw new Error(formatMagpieManagementError(response.status, response.statusText, text));
    if (text.length > 1024 * 1024) throw new Error('Management response exceeds size limit');
    return JSON.parse(text);
  }
  /** Best-effort key import after the gateway is up; failures surface in diagnostics. */
  async syncLanAccessKeyAfterStart(owner: AbortSignal): Promise<void> {
    try {
      await this.syncLanAccessKey(owner);
    } catch (error) {
      if (owner.aborted) return;
      console.warn('[Magpie] failed to import the LAN access key:', error);
      this.context.recordError('LAN access key import failed');
    }
  }

  /** Re-imports the (already rotated) LAN token as the `zhiyuan-lan` gateway key. */
  async onLanAccessTokenRegenerated(): Promise<void> {
    const owner = this.runningOwner();
    if (owner) await this.syncLanAccessKey(owner);
  }
  private syncLanAccessKey(owner: AbortSignal): Promise<void> {
    const writes = this.writesFor(owner);
    const pending = (writes.lanKey ?? Promise.resolve())
      .catch((): void => {})
      .then(() => {
        owner.throwIfAborted();
        const lanToken = this.context.options.lanAccess?.read().lanToken;
        if (!lanToken) return;
        return syncMagpieLanAccessKey(
          {
            managementJson: (route, init) => this.managementJson(route, { ...init, signal: owner }),
          },
          lanToken,
        );
      });
    writes.lanKey = pending;
    return pending;
  }
}
