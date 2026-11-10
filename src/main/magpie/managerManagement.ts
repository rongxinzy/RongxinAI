import type { MagpieManagerOptions } from './managerOptions';
import { syncMagpieLanAccessKey } from './lanAccess';
import type { MagpieSignInState } from './oauthPolicy';
import { formatMagpieManagementError } from './managementErrors';
import { mergeMagpiePreferences, projectMagpiePreferences } from './preferences';
import type { MagpiePreferences, MagpiePreferencesPatch } from '../../shared/magpie/preferences';
import { parseMagpieCatalog, readBoundedCatalog } from './catalogReader';

import type { MagpieStatus, MagpieModel } from '../../shared/magpie/types';

interface ManagementContext {
  options: Pick<MagpieManagerOptions, 'lanAccess' | 'parseCatalog'>;
  recordError(message: string): void;
  status(): MagpieStatus;
  ensureRunning(): Promise<MagpieStatus>;
  webRequest(route: string, init?: RequestInit, timeoutMs?: number): Promise<Response>;
  managementJson(route: string, init?: RequestInit): Promise<Record<string, unknown>>;
  state(): MagpieStatus;
  abort(): AbortController | undefined;
  request(url: string, init?: RequestInit, timeoutMs?: number): Promise<Response>;
}

/** Settings access and coalesced catalog reads for the owned process. */
export class MagpieManagerManagement {
  private catalogRead?: Promise<MagpieModel[]>;
  constructor(private readonly context: ManagementContext) {}

  models(): Promise<MagpieModel[]> {
    if (this.catalogRead) return this.catalogRead;
    this.catalogRead = this.readModels().finally(() => {
      this.catalogRead = undefined;
    });
    return this.catalogRead;
  }
  private async readModels(): Promise<MagpieModel[]> {
    if (this.context.state().state !== 'running' || !this.context.state().gatewayUrl) return [];
    const gateway = this.context.state().gatewayUrl;
    const signal = AbortSignal.any([this.context.abort()!.signal, AbortSignal.timeout(15_000)]);
    const response = await this.context.request(`${gateway}/v1/models`, { signal });
    if (!response.ok) throw new Error('Unable to load local models');
    const bytes = await readBoundedCatalog(response, signal);
    const models = await (this.context.options.parseCatalog ?? parseMagpieCatalog)(bytes, signal);
    signal.throwIfAborted();
    if (this.context.state().state !== 'running' || this.context.state().gatewayUrl !== gateway)
      throw new Error('Model service changed while reading its catalog');
    return models;
  }
  preferences(): Promise<MagpiePreferences> {
    return this.context.managementJson('/api/settings').then(projectMagpiePreferences);
  }
  async updatePreferences(patch: MagpiePreferencesPatch): Promise<MagpiePreferences> {
    const raw = await this.context.managementJson('/api/settings');
    const merged = mergeMagpiePreferences(raw, patch);
    const saved = await this.context.managementJson('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(merged),
    });
    return projectMagpiePreferences(saved);
  }
  /** Main-only read of a flow created by the official management page. */
  async signInStatus(id: string): Promise<MagpieSignInState> {
    if (!/^[A-Za-z0-9_-]{1,80}$/.test(id) || !this.context.status().subscriptionAccountsEnabled)
      throw new Error('Subscription sign-in is unavailable');
    await this.context.ensureRunning();
    const result = await this.context.managementJson(`/api/signin/${encodeURIComponent(id)}`);
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
    const response = await this.context.webRequest(route, init, timeoutMs);
    const text = await response.text();
    if (!response.ok)
      throw new Error(formatMagpieManagementError(response.status, response.statusText, text));
    if (text.length > 1024 * 1024) throw new Error('Management response exceeds size limit');
    return JSON.parse(text);
  }
  /** Best-effort key import after the gateway is up; failures surface in diagnostics. */
  async syncLanAccessKeyAfterStart(): Promise<void> {
    const lanToken = this.context.options.lanAccess?.read().lanToken;
    if (!lanToken) return;
    try {
      await this.syncLanAccessKey(lanToken);
    } catch (error) {
      console.warn('[Magpie] failed to import the LAN access key:', error);
      this.context.recordError('LAN access key import failed');
    }
  }

  /** Re-imports the (already rotated) LAN token as the `zhiyuan-lan` gateway key. */
  async onLanAccessTokenRegenerated(): Promise<void> {
    if (this.context.state().state !== 'running') return;
    const lanToken = this.context.options.lanAccess?.read().lanToken;
    if (!lanToken) return;
    await this.syncLanAccessKey(lanToken);
  }
  private async syncLanAccessKey(lanToken: string): Promise<void> {
    await syncMagpieLanAccessKey(
      { managementJson: (route, init) => this.context.managementJson(route, init) },
      lanToken,
    );
  }
}
