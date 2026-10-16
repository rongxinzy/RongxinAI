import type { MagpieSignInState } from './oauthPolicy';
import { parseMagpieCatalog, readBoundedCatalog } from './catalogReader';
import {
  HOST_PROVIDER_PREFIX,
  hostProviderPayload,
  type MagpieHostProvider,
} from './hostProviders';
import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import net from 'node:net';
import type {
  MagpieStatus,
  MagpieModel,
  MagpieAgents,
  MagpieModelSelection,
} from '../../shared/magpie/types';
import { isolatedMagpieEnvironment, prepareMagpieHome } from './environment';
import { MAGPIE_VERSION, verifyMagpieBinary } from './integrity';
const MODEL_FIELDS = new Set(['model', 'large', 'small', 'executor', 'planner']);
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as net.AddressInfo).port;
      server.close(error => (error ? reject(error) : resolve(port)));
    });
  });
}
export interface MagpieManagerOptions {
  resourcesRoot: string;
  privateHome: string;
  /** Tests must supply temporary HOME and USERPROFILE; production retains the real CLI home. */
  environment?: NodeJS.ProcessEnv;
  verify?: typeof verifyMagpieBinary;
  spawn?: typeof spawn;
  fetch?: typeof fetch;
  port?: () => Promise<number>;
  startupTimeoutMs?: number;
  parseCatalog?: typeof parseMagpieCatalog;
  serviceEnabled?: { read(): boolean; write(enabled: boolean): void };
  subscriptionAccounts?: { read(): boolean; write(enabled: boolean): void | Promise<void> };
}
/** Owns exactly one verified, isolated upstream process. Never attaches to existing gateways. */
export class MagpieManager {
  private state: MagpieStatus = { state: 'stopped', version: MAGPIE_VERSION };
  private child?: ChildProcess;
  private pending?: Promise<MagpieStatus>;
  private stopping?: Promise<MagpieStatus>;
  private abort?: AbortController;
  private webPort?: number;
  private webKey?: string;
  private stopRevision = 0;
  private memoryEnabled = false;
  private deniedAfterPersistenceFailure = false;
  private subscriptionChange?: Promise<MagpieStatus>;
  private catalogRead?: Promise<MagpieModel[]>;
  private hostSync: Promise<void> = Promise.resolve();
  private hostSignatures = new Map<string, string>();
  constructor(private readonly options: MagpieManagerOptions) {}
  status(): MagpieStatus {
    return {
      ...this.state,
      enabled: this.isServiceEnabled(),
      subscriptionAccountsEnabled: this.options.subscriptionAccounts?.read() === true,
    };
  }
  private isServiceEnabled(): boolean {
    return (
      !this.deniedAfterPersistenceFailure &&
      (this.options.serviceEnabled?.read() ?? this.memoryEnabled)
    );
  }
  start(): Promise<MagpieStatus> {
    try {
      this.options.serviceEnabled?.write(true);
      this.memoryEnabled = true;
      this.deniedAfterPersistenceFailure = false;
    } catch (error) {
      return Promise.reject(error);
    }
    return this.startOwned();
  }
  private startOwned(): Promise<MagpieStatus> {
    if (this.stopping)
      return this.stopping.then(() =>
        this.isServiceEnabled() ? this.startOwned() : this.status(),
      );
    if (this.pending) return this.pending;
    if (this.state.state === 'running') return Promise.resolve(this.status());
    this.abort = new AbortController();
    this.state = { state: 'starting', version: MAGPIE_VERSION };
    this.pending = this.launch(this.abort.signal).finally(() => {
      this.pending = undefined;
    });
    return this.pending;
  }
  private async launch(signal: AbortSignal): Promise<MagpieStatus> {
    try {
      const binary = await (this.options.verify ?? verifyMagpieBinary)(
        this.options.resourcesRoot,
        signal,
      );
      await prepareMagpieHome(
        this.options.privateHome,
        this.options.subscriptionAccounts?.read() === true,
      );
      const port = this.options.port ?? freePort;
      const gatewayPort = await port();
      this.webPort = await port();
      while (this.webPort === gatewayPort) this.webPort = await port();
      this.webKey = randomBytes(32).toString('hex');
      signal.throwIfAborted();
      const child = (this.options.spawn ?? spawn)(
        binary,
        ['web', '--addr', `127.0.0.1:${this.webPort}`, '--no-open'],
        {
          cwd: this.options.privateHome,
          shell: false,
          windowsHide: true,
          stdio: 'ignore',
          env: isolatedMagpieEnvironment(
            this.options.privateHome,
            gatewayPort,
            this.webKey,
            this.options.environment,
            this.options.subscriptionAccounts?.read() === true,
          ),
        },
      );
      this.child = child;
      let exited = false;
      child.once('error', () => {
        exited = true;
      });
      child.once('exit', () => {
        exited = true;
        if (this.child === child) {
          this.child = undefined;
          this.hostSignatures.clear();
          this.webKey = undefined;
          this.webPort = undefined;
          if (this.state.state === 'running')
            this.state = {
              state: 'failed',
              version: MAGPIE_VERSION,
              error: 'Local model service exited',
            };
        }
      });
      const gatewayUrl = `http://127.0.0.1:${gatewayPort}`;
      const deadline = Date.now() + (this.options.startupTimeoutMs ?? 30_000);
      while (Date.now() < deadline) {
        signal.throwIfAborted();
        if (exited) throw new Error('Magpie process exited during startup');
        try {
          const hello = await this.request(`${gatewayUrl}/api/hello`, { signal });
          const data = (await hello.json()) as { name?: string; version?: string };
          const web = await this.webRequest('/', { signal });
          if (data.name === 'magpie' && data.version === MAGPIE_VERSION && web.ok && !exited) {
            this.state = { state: 'running', version: MAGPIE_VERSION, gatewayUrl };
            return this.status();
          }
        } catch {
          signal.throwIfAborted();
        }
        await delay(100);
      }
      throw new Error('Magpie startup timed out');
    } catch {
      await this.terminate();
      this.state = {
        state: signal.aborted ? 'stopped' : 'failed',
        version: MAGPIE_VERSION,
        ...(signal.aborted ? {} : { error: 'Unable to start the verified local model service' }),
      };
      return this.status();
    }
  }
  private request(url: string, init: RequestInit = {}): Promise<Response> {
    const timeout = AbortSignal.timeout(init.method === 'POST' ? 15_000 : 2_000);
    return (this.options.fetch ?? fetch)(url, {
      ...init,
      redirect: 'error',
      signal: init.signal ? AbortSignal.any([init.signal, timeout]) : timeout,
    });
  }
  private webRequest(route: string, init: RequestInit = {}): Promise<Response> {
    if (!this.webPort || !this.webKey) throw new Error('Local model service is unavailable');
    return this.request(`http://127.0.0.1:${this.webPort}${route}`, {
      ...init,
      headers: { ...init.headers, Cookie: `magpie_web_${this.webPort}=${this.webKey}` },
    });
  }
  /** Main-only descriptor: never send this key through renderer IPC or logs. */
  managementConnection(): { url: string; cookieName: string; key: string } {
    if (this.state.state !== 'running' || !this.webPort || !this.webKey)
      throw new Error('Local model service is unavailable');
    return {
      url: `http://127.0.0.1:${this.webPort}`,
      cookieName: `magpie_web_${this.webPort}`,
      key: this.webKey,
    };
  }
  models(): Promise<MagpieModel[]> {
    if (this.catalogRead) return this.catalogRead;
    this.catalogRead = this.readModels().finally(() => {
      this.catalogRead = undefined;
    });
    return this.catalogRead;
  }
  private async readModels(): Promise<MagpieModel[]> {
    if (this.state.state !== 'running' || !this.state.gatewayUrl) return [];
    const gateway = this.state.gatewayUrl;
    const signal = AbortSignal.any([this.abort!.signal, AbortSignal.timeout(15_000)]);
    const response = await this.request(`${gateway}/v1/models`, { signal });
    if (!response.ok) throw new Error('Unable to load local models');
    const bytes = await readBoundedCatalog(response, signal);
    const models = await (this.options.parseCatalog ?? parseMagpieCatalog)(bytes, signal);
    signal.throwIfAborted();
    if (this.state.state !== 'running' || this.state.gatewayUrl !== gateway)
      throw new Error('Model service changed while reading its catalog');
    return models;
  }
  /** Only a previously explicit, persisted enable permits lazy startup or one recovery attempt. */
  async ensureRunning(): Promise<MagpieStatus> {
    if (!this.isServiceEnabled())
      throw new Error('Enable unified model management in settings first.');
    const status = await this.startOwned();
    if (status.state !== 'running' || !status.gatewayUrl || !this.isServiceEnabled())
      throw new Error(
        status.error || 'The model service could not start. Retry in model settings.',
      );
    return status;
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
        await this.ensureRunning();
        // Discover only reserved ids. Do not forward or log the management response.
        const state = await this.managementJson('/api/providers');
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
            await this.managementJson('/api/provider/off', {
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
          await this.managementJson('/api/provider/save', {
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
            await this.managementJson('/api/provider/on', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ id }),
            });
          }
          this.hostSignatures.set(id, signature);
        }
      });
    this.hostSync = run;
    return run;
  }

  /** Called only by the host's explicitly confirmed subscription-account switch. */
  setSubscriptionAccounts(enabled: boolean): Promise<MagpieStatus> {
    if (typeof enabled !== 'boolean')
      return Promise.reject(new Error('Invalid subscription preference'));
    if (!this.options.subscriptionAccounts)
      return Promise.reject(new Error('Subscription preference storage is unavailable'));
    if (this.subscriptionChange)
      return Promise.reject(new Error('Subscription settings are already changing'));
    if (this.state.state !== 'running')
      return Promise.reject(new Error('Start the model service before changing subscriptions.'));
    if (this.options.subscriptionAccounts.read() === enabled) return Promise.resolve(this.status());
    const preference = this.options.subscriptionAccounts;
    const stopRevision = this.stopRevision;
    this.subscriptionChange = (async () => {
      // The environment remains deny-by-default until the explicit enable is persisted and
      // the owned process restarts. Turning off clears upstream account caches immediately.
      const privacy = await this.managementJson('/api/settings/account-discovery', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ off: !enabled }),
      });
      if ((privacy.noAccountDiscovery === true) !== !enabled)
        throw new Error('The subscription privacy setting was not applied.');
      try {
        await preference.write(enabled);
      } catch (error) {
        // Fail closed if persistence fails: do not leave newly permitted account access running.
        await this.shutdown();
        throw error;
      }
      await this.stopOwned();
      if (this.stopRevision !== stopRevision) return this.status();
      return this.startOwned();
    })().finally(() => {
      this.subscriptionChange = undefined;
    });
    return this.subscriptionChange;
  }
  /** Main-only read of a flow created by the official management page. */
  async signInStatus(id: string): Promise<MagpieSignInState> {
    if (!/^[A-Za-z0-9_-]{1,80}$/.test(id) || !this.status().subscriptionAccountsEnabled)
      throw new Error('Subscription sign-in is unavailable');
    await this.ensureRunning();
    const result = await this.managementJson(`/api/signin/${encodeURIComponent(id)}`);
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
  async agents(): Promise<MagpieAgents> {
    if (this.state.state !== 'running') return { agents: [], pending: false };
    const state = await this.managementJson('/api/state');
    const cli = await this.managementJson('/api/agents/cli');
    const records = cli.agents && typeof cli.agents === 'object' ? cli.agents : {};
    return {
      pending: cli.pending === true,
      agents: (Array.isArray(state.agents) ? state.agents : [])
        .slice(0, 200)
        .flatMap((a: Record<string, unknown>) => {
          if (typeof a.id !== 'string' || typeof a.name !== 'string') return [];
          const version = records[a.id] ?? {};
          return [
            {
              id: a.id,
              name: a.name,
              cliMissing: a.cliMissing === true,
              wired: a.wired === true,
              ...(typeof version.version === 'string' ? { version: version.version } : {}),
              ...(typeof version.app === 'string' ? { appVersion: version.app } : {}),
              models: (Array.isArray(a.fields) ? a.fields : [])
                .filter(
                  (f: Record<string, unknown>) =>
                    typeof f.key === 'string' &&
                    MODEL_FIELDS.has(f.key) &&
                    typeof f.value === 'string',
                )
                .map((f: Record<string, unknown>) => ({
                  key: String(f.key),
                  label: typeof f.label === 'string' ? f.label : String(f.key),
                  value: String(f.value),
                  options: (Array.isArray(f.options) ? f.options : [])
                    .slice(0, 2000)
                    .flatMap((option: Record<string, unknown>) =>
                      typeof option.value === 'string'
                        ? [
                            {
                              value: option.value,
                              ...(typeof option.label === 'string' ? { label: option.label } : {}),
                            },
                          ]
                        : [],
                    ),
                })),
            },
          ];
        }),
    };
  }
  async setModel(selection: MagpieModelSelection): Promise<MagpieAgents> {
    if (
      !selection ||
      typeof selection.agentId !== 'string' ||
      selection.agentId.length > 100 ||
      !MODEL_FIELDS.has(selection.field) ||
      typeof selection.value !== 'string' ||
      selection.value.length > 500
    )
      throw new Error('Invalid model selection');
    const agents = await this.agents();
    if (
      !agents.agents.some(
        a =>
          a.id === selection.agentId &&
          a.models.some(
            f =>
              f.key === selection.field &&
              (f.value === selection.value ||
                f.options.some(option => option.value === selection.value)),
          ),
      )
    )
      throw new Error('Unknown agent model selection');
    await this.managementJson('/api/set', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        Agent: selection.agentId,
        Field: selection.field,
        Value: selection.value,
      }),
    });
    return this.agents();
  }
  private async managementJson(
    route: string,
    init: RequestInit = {},
  ): Promise<Record<string, any>> {
    const response = await this.webRequest(route, init);
    if (!response.ok) throw new Error('Local CLI management request failed');
    const text = await response.text();
    if (text.length > 1024 * 1024) throw new Error('Management response exceeds size limit');
    return JSON.parse(text);
  }
  /** Explicit user disable. Application exit and internal restarts must use shutdown/stopOwned. */
  stop(): Promise<MagpieStatus> {
    this.memoryEnabled = false;
    try {
      this.options.serviceEnabled?.write(false);
    } catch (error) {
      this.deniedAfterPersistenceFailure = true;
      return this.shutdown().then(() => {
        throw error;
      });
    }
    return this.shutdown();
  }
  /** Stop the owned process without forgetting the user's permission for the next app start. */
  shutdown(): Promise<MagpieStatus> {
    this.stopRevision++;
    return this.stopOwned();
  }
  private stopOwned(): Promise<MagpieStatus> {
    if (this.stopping) return this.stopping;
    this.abort?.abort();
    this.state = { state: 'stopping', version: MAGPIE_VERSION };
    this.stopping = (async () => {
      await this.pending;
      if (this.child) {
        try {
          await this.webRequest('/api/window/quit', { method: 'POST' });
          // Upstream WebWindow exits after its response has flushed (200 ms).
          await delay(300);
        } catch {
          /* owned process termination below */
        }
        await this.terminate();
      }
      this.state = { state: 'stopped', version: MAGPIE_VERSION };
      return this.status();
    })()
      .catch(error => {
        this.state = {
          state: 'failed',
          version: MAGPIE_VERSION,
          error: 'Unable to stop the local model service. Restart the application before retrying.',
        };
        throw error;
      })
      .finally(() => {
        this.stopping = undefined;
      });
    return this.stopping;
  }
  private async terminate(): Promise<void> {
    const child = this.child;
    if (child && child.exitCode === null && child.signalCode === null) {
      child.kill('SIGTERM');
      await Promise.race([
        new Promise<void>(resolve => child.once('exit', () => resolve())),
        delay(1500),
      ]);
      if (child.exitCode === null && child.signalCode === null) {
        child.kill('SIGKILL');
        await Promise.race([
          new Promise<void>(resolve => child.once('exit', () => resolve())),
          delay(1500),
        ]);
        if (child.exitCode === null && child.signalCode === null)
          throw new Error('The owned model process has not stopped');
      }
    }
    this.child = undefined;
    this.webKey = undefined;
    this.webPort = undefined;
    this.hostSignatures.clear();
  }
}
