import type { MagpieManagerOptions } from './managerOptions';
import { MagpieManagerProviders } from './managerProviders';
import { MagpieManagerAgents } from './managerAgents';
import { MagpieManagerManagement } from './managerManagement';
import type { MagpieSignInState } from './oauthPolicy';

import { type MagpieHostProvider } from './hostProviders';
import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import type {
  MagpieStatus,
  MagpieModel,
  MagpieAgents,
  MagpieModelSelection,
  MagpieProviderSummary,
  MagpieSaveProviderInput,
  MagpieTestProviderResult,
  MagpieDiagnosticSummary,
} from '../../shared/magpie/types';

import { isolatedMagpieEnvironment, prepareMagpieHome } from './environment';

import { resolveMagpieGatewayPort } from './gatewayPort';
import { MAGPIE_VERSION, verifyMagpieBinary } from './integrity';
import type { MagpieAgentConnectPreview } from '../../shared/magpie/types';

import type { MagpiePreferences, MagpiePreferencesPatch } from '../../shared/magpie/preferences';

import type { MagpieRoutingGateway } from './magpieRoutingGateway';
import { MagpieRoutingUsageService } from './routingUsageService';
import { delay, freePort } from './magpieManagerUtils';

export type { MagpieManagerOptions } from './managerOptions';

/** Owns exactly one verified, isolated upstream process. Never attaches to existing gateways. */
export class MagpieManager implements MagpieRoutingGateway {
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
  private lanAccessChange?: Promise<MagpieStatus>;
  private recovering?: Promise<MagpieStatus>;
  private readonly providerOperations: MagpieManagerProviders;
  private readonly agentOperations: MagpieManagerAgents;
  private readonly managementOperations: MagpieManagerManagement;
  readonly routingUsage: MagpieRoutingUsageService;
  constructor(private readonly options: MagpieManagerOptions) {
    this.providerOperations = new MagpieManagerProviders({
      state: () => this.state,
      ensureRunning: () => this.ensureRunning(),
      managementJson: (route, init, timeoutMs) => this.managementJson(route, init, timeoutMs),
      request: (url, init, timeoutMs) => this.request(url, init, timeoutMs),
      options,
      providers: () => this.providers(),
      clearRecentErrors: filter => this.clearRecentErrors(filter),
      diagnostics: () => this.diagnostics(),
    });
    this.agentOperations = new MagpieManagerAgents({
      state: () => this.state,
      ensureRunning: () => this.ensureRunning(),
      managementJson: (route, init, timeoutMs) => this.managementJson(route, init, timeoutMs),
      agents: timeoutMs => this.agents(timeoutMs),
      options,
    });
    this.managementOperations = new MagpieManagerManagement({
      state: () => this.state,
      abort: () => this.abort,
      options,
      recordError: message => this.recordError(message),
      status: () => this.status(),
      ensureRunning: () => this.ensureRunning(),
      webRequest: (route, init, timeoutMs) => this.webRequest(route, init, timeoutMs),
      managementJson: (route, init) => this.managementJson(route, init),
      request: (url, init, timeoutMs) => this.request(url, init, timeoutMs),
    });
    this.routingUsage = new MagpieRoutingUsageService(this);
  }
  status(): MagpieStatus {
    return {
      ...this.state,
      enabled: this.isServiceEnabled(),
      subscriptionAccountsEnabled: this.options.subscriptionAccounts?.read() === true,
      diagnostics: this.providerOperations.summary(),
    };
  }
  private isServiceEnabled(): boolean {
    return (
      !this.deniedAfterPersistenceFailure &&
      (this.options.serviceEnabled?.read() ?? this.memoryEnabled)
    );
  }
  private isLanAccessEnabled(): boolean {
    return this.options.lanAccess?.read().enabled === true;
  }
  /** The process may run for the model service or because LAN access needs it. */
  private shouldRun = (): boolean => this.isServiceEnabled() || this.isLanAccessEnabled();
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
      return this.stopping.then(() => (this.shouldRun() ? this.startOwned() : this.status()));
    if (this.pending) return this.pending;
    if (this.state.state === 'running') return Promise.resolve(this.status());
    this.abort = new AbortController();
    this.state = { state: 'starting', version: MAGPIE_VERSION };
    this.pending = this.launch(this.abort.signal).finally(() => {
      this.pending = undefined;
    });
    return this.pending;
  }
  private sanitizeDiagnosticText(text: string): string {
    const trimmed = text.trim();
    if (!trimmed) return '';
    const redacted = trimmed.replace(
      /(bearer\s+|sk-|magpie_web_[^=]*=)[A-Za-z0-9._-]+/gi,
      '$1[REDACTED]',
    );
    return redacted.length > 2048 ? redacted.slice(-2048) : redacted;
  }

  private async launch(signal: AbortSignal): Promise<MagpieStatus> {
    let phase: 'verify' | 'prepare-home' | 'resolve-port' | 'spawn' | 'probe' = 'verify';
    let stderrTail = '';
    let spawnError: unknown;
    let exitCode: number | null = null;
    let exitSignal: NodeJS.Signals | null = null;
    try {
      const binary = await (this.options.verify ?? verifyMagpieBinary)(
        this.options.resourcesRoot,
        signal,
      );
      phase = 'prepare-home';
      await prepareMagpieHome(
        this.options.privateHome,
        this.options.subscriptionAccounts?.read() === true,
      );
      phase = 'resolve-port';
      const port = this.options.port ?? freePort;
      const gatewayPort =
        this.options.gatewayPort !== undefined
          ? await resolveMagpieGatewayPort(this.options.gatewayPort)
          : await port();
      this.webPort = await port();
      while (this.webPort === gatewayPort) this.webPort = await port();
      this.webKey = randomBytes(32).toString('hex');
      const lanAccessEnabled = this.isLanAccessEnabled();
      signal.throwIfAborted();
      phase = 'spawn';
      const child = (this.options.spawn ?? spawn)(
        binary,
        ['web', '--addr', `127.0.0.1:${this.webPort}`, '--no-open'],
        {
          cwd: this.options.privateHome,
          shell: false,
          windowsHide: true,
          stdio: ['ignore', 'ignore', 'pipe'],
          env: isolatedMagpieEnvironment(
            this.options.privateHome,
            gatewayPort,
            this.webKey,
            this.options.environment,
            this.options.subscriptionAccounts?.read() === true,
            lanAccessEnabled,
          ),
        },
      );
      this.child = child;
      let exited = false;
      const appendStderr = (chunk: Buffer | string): void => {
        const text = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
        stderrTail = `${stderrTail}${text}`;
        if (stderrTail.length > 4096) stderrTail = stderrTail.slice(-4096);
      };
      if (child.stderr && typeof child.stderr.on === 'function') {
        child.stderr.on('data', appendStderr);
        child.stderr.on('error', () => {});
      }
      child.once('error', error => {
        exited = true;
        spawnError = error;
      });
      child.once('exit', (code, sig) => {
        exited = true;
        exitCode = code;
        exitSignal = sig;
        if (this.child === child) {
          this.child = undefined;
          this.providerOperations.clearHostSignatures();
          this.webKey = undefined;
          this.webPort = undefined;
          if (this.state.state === 'running') {
            const stderr = this.sanitizeDiagnosticText(stderrTail);
            console.warn('[Magpie] Owned model service exited unexpectedly:', {
              code,
              signal: sig,
              ...(stderr ? { stderr } : {}),
            });
            this.state = {
              state: 'failed',
              version: MAGPIE_VERSION,
              error: 'Local model service exited',
            };
          }
        }
      });
      phase = 'probe';
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
            void this.agentOperations.reapplyManagedAgentsAfterStart();
            if (lanAccessEnabled) void this.managementOperations.syncLanAccessKeyAfterStart();
            return this.status();
          }
        } catch {
          signal.throwIfAborted();
        }
        await delay(100);
      }
      throw new Error('Magpie startup timed out');
    } catch (error) {
      if (!signal.aborted) {
        const stderr = this.sanitizeDiagnosticText(stderrTail);
        console.warn('[Magpie] Launch failed:', {
          phase,
          error: error instanceof Error ? error.message : String(error),
          ...(exitCode !== null ? { exitCode } : {}),
          ...(exitSignal ? { exitSignal } : {}),
          ...(spawnError
            ? { spawnError: spawnError instanceof Error ? spawnError.message : String(spawnError) }
            : {}),
          ...(stderr ? { stderr } : {}),
        });
      }
      await this.terminate();
      this.state = {
        state: signal.aborted ? 'stopped' : 'failed',
        version: MAGPIE_VERSION,
        ...(signal.aborted ? {} : { error: 'Unable to start the verified local model service' }),
      };
      return this.status();
    }
  }
  private request(url: string, init: RequestInit = {}, timeoutMs?: number): Promise<Response> {
    const timeout = AbortSignal.timeout(timeoutMs ?? (init.method === 'POST' ? 15_000 : 2_000));
    return (this.options.fetch ?? fetch)(url, {
      ...init,
      redirect: 'error',
      signal: init.signal ? AbortSignal.any([init.signal, timeout]) : timeout,
    });
  }
  private webRequest(route: string, init: RequestInit = {}, timeoutMs?: number): Promise<Response> {
    if (!this.webPort || !this.webKey) throw new Error('Local model service is unavailable');
    return this.request(
      `http://127.0.0.1:${this.webPort}${route}`,
      {
        ...init,
        headers: { ...init.headers, Cookie: `magpie_web_${this.webPort}=${this.webKey}` },
      },
      timeoutMs,
    );
  }
  managementRequest(route: string, init: RequestInit = {}, timeoutMs?: number): Promise<Response> {
    return this.webRequest(route, init, timeoutMs);
  }
  preferences(): Promise<MagpiePreferences> {
    return this.managementOperations.preferences();
  }
  updatePreferences(patch: MagpiePreferencesPatch): Promise<MagpiePreferences> {
    return this.managementOperations.updatePreferences(patch);
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
    return this.managementOperations.models();
  }
  /** Only a previously explicit, persisted enable permits lazy startup or one recovery attempt. */
  async ensureRunning(): Promise<MagpieStatus> {
    if (!this.shouldRun()) throw new Error('Enable unified model management in settings first.');
    const status = await this.startOwned();
    if (status.state !== 'running' || !status.gatewayUrl || !this.shouldRun())
      throw new Error(
        status.error || 'The model service could not start. Retry in model settings.',
      );
    return status;
  }

  /** Probes a reportedly running gateway (e.g. after sleep/wake) and restarts it if dead. */
  async recoverIfNeeded(): Promise<MagpieStatus> {
    if (this.recovering) return this.recovering;
    const run = (async (): Promise<MagpieStatus> => {
      if (!this.shouldRun()) return this.status();
      if (this.state.state === 'starting') return (await this.pending) ?? this.status();
      if (this.state.state === 'running' && this.state.gatewayUrl) {
        try {
          const hello = await this.request(`${this.state.gatewayUrl}/api/hello`, {}, 1_500);
          const data = (await hello.json()) as { name?: string };
          if (hello.ok && data.name === 'magpie') return this.status();
        } catch {
          /* fall through to restart */
        }
        console.warn('[Magpie] Gateway health check failed; restarting owned model service.');
        await this.stopOwned();
        if (!this.shouldRun()) return this.status();
      }
      return await this.startOwned();
    })().finally(() => {
      this.recovering = undefined;
    });
    this.recovering = run;
    return run;
  }

  /**
   * Applies a local-inference LAN toggle change: MAGPIE_ADDR is read only at
   * process start, so the owned process restarts when the flag flips. The
   * service-enabled preference itself is never rewritten.
   */
  onLanAccessChanged(): Promise<MagpieStatus> {
    if (this.subscriptionChange)
      return Promise.reject(new Error('Subscription settings are already changing'));
    if (this.lanAccessChange) return this.lanAccessChange;
    if (this.state.state === 'starting') return this.pending ?? Promise.resolve(this.status());
    const run = (async (): Promise<MagpieStatus> => {
      const shouldRun = this.shouldRun();
      if (this.state.state === 'running' && !shouldRun) {
        // LAN was the only reason the process was running.
        return await this.shutdown();
      }
      if (this.state.state === 'running') {
        // The env flip needs a restart even when the token itself is unchanged;
        // launch re-imports the key once the new process is up.
        return await this.stopOwned().then(() => this.startOwned());
      }
      if (shouldRun) return await this.startOwned();
      return this.status();
    })().finally(() => {
      this.lanAccessChange = undefined;
    });
    this.lanAccessChange = run;
    return run;
  }

  /** Re-imports the (already rotated) LAN token as the `zhiyuan-lan` gateway key. */
  onLanAccessTokenRegenerated(): Promise<void> {
    return this.managementOperations.onLanAccessTokenRegenerated();
  }
  syncHostProviders(definitions: readonly MagpieHostProvider[]): Promise<void> {
    return this.providerOperations.syncHostProviders(definitions);
  }
  recordError(message: string, providerId?: string): void {
    this.providerOperations.recordError(message, providerId);
  }
  clearRecentErrors(filter?: { providerIds?: string[]; providerNames?: string[] }): void {
    this.providerOperations.clearRecentErrors(filter);
  }
  clearDiagnostics(): Promise<MagpieDiagnosticSummary> {
    return this.providerOperations.clearDiagnostics();
  }
  providers(): Promise<MagpieProviderSummary[]> {
    return this.providerOperations.providers();
  }
  saveProvider(input: MagpieSaveProviderInput): Promise<MagpieProviderSummary[]> {
    return this.providerOperations.saveProvider(input);
  }
  setProviderEnabled(id: string, enabled: boolean): Promise<MagpieProviderSummary[]> {
    return this.providerOperations.setProviderEnabled(id, enabled);
  }
  deleteProvider(id: string): Promise<MagpieProviderSummary[]> {
    return this.providerOperations.deleteProvider(id);
  }
  testProvider(input: MagpieSaveProviderInput): Promise<MagpieTestProviderResult> {
    return this.providerOperations.testProvider(input);
  }
  diagnostics(): Promise<MagpieDiagnosticSummary> {
    return this.providerOperations.diagnostics();
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
  signInStatus(id: string): Promise<MagpieSignInState> {
    return this.managementOperations.signInStatus(id);
  }
  agents(readTimeoutMs?: number): Promise<MagpieAgents> {
    return this.agentOperations.agents(readTimeoutMs);
  }
  previewAgent(agentId: string): Promise<MagpieAgentConnectPreview> {
    return this.agentOperations.previewAgent(agentId);
  }
  connectAgent(agentId: string): Promise<MagpieAgents> {
    return this.agentOperations.connectAgent(agentId);
  }
  disconnectAgent(agentId: string): Promise<MagpieAgents> {
    return this.agentOperations.disconnectAgent(agentId);
  }
  disconnectAllAgents(): Promise<MagpieAgents> {
    return this.agentOperations.disconnectAllAgents();
  }
  setModel(selection: MagpieModelSelection): Promise<MagpieAgents> {
    return this.agentOperations.setModel(selection);
  }
  private managementJson(
    route: string,
    init: RequestInit = {},
    timeoutMs?: number,
  ): Promise<Record<string, unknown>> {
    return this.managementOperations.managementJson(route, init, timeoutMs);
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
      this.providerOperations.resetHydration();
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
    this.providerOperations.clearHostSignatures();
  }
}
