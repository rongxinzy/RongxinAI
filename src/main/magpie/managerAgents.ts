import { setTimeout as delay } from 'node:timers/promises';
import type { MagpieStatus, MagpieAgents, MagpieModelSelection } from '../../shared/magpie/types';
import {
  magpieAgentConnect,
  magpieAgentDisconnect,
  magpieAgentPreview,
  magpieReapplyConnectedAgents,
  parseMagpieCliVersions,
} from './agentControl';

import type { MagpieAgentConnectPreview } from '../../shared/magpie/types';

import {
  clearLegacyHostAgentStorage,
  mergeOpenCodeConfigToUser,
  revertOpenCodeConfigFromUser,
  resolveUserHome,
  stripCodexMagpieProviderBlock,
  canonicalHostAgentId,
  syncOpenCodeConfigToUser,
} from './externalAgentHostConfig';
import { MAGPIE_EXTERNAL_AGENT_CATALOG } from '../../shared/magpie/constants';

import { MAGPIE_AGENT_MODEL_FIELDS } from './magpieManagerUtils';

import type { MagpieManagerOptions } from './managerOptions';

// The upstream CLI version probe can wait three seconds before returning pending results.
const CLI_VERSION_READ_TIMEOUT_MS = 4_000;
const STARTUP_AGENT_READ_TIMEOUT_MS = 20_000;
const STARTUP_AGENT_READ_ATTEMPTS = 3;
const STARTUP_AGENT_READ_RETRY_MS = 1_000;

function agentRows(state: Record<string, unknown>): Record<string, unknown>[] {
  return (Array.isArray(state.agents) ? state.agents : []).slice(0, 200);
}

interface AgentContext {
  state(): MagpieStatus;
  ensureRunning(): Promise<MagpieStatus>;
  managementJson(
    route: string,
    init?: RequestInit,
    timeoutMs?: number,
  ): Promise<Record<string, unknown>>;
  options: Pick<MagpieManagerOptions, 'privateHome' | 'environment'>;
}

/** Managed CLI projection, wiring and host-configuration reconciliation. */
export class MagpieManagerAgents {
  private reapplyErrors = new Map<string, string>();
  private startupReapply?: { controller: AbortController; task: Promise<void> };
  constructor(private readonly context: AgentContext) {}

  async agents(): Promise<MagpieAgents> {
    if (this.context.state().state !== 'running') return { agents: [], pending: false };
    const state = await this.context.managementJson('/api/state');
    return this.projectAgents(state, await this.readCliVersions());
  }

  private readCliVersions() {
    return this.context.managementJson('/api/agents/cli', {}, CLI_VERSION_READ_TIMEOUT_MS);
  }

  private projectAgents(
    state: Record<string, unknown>,
    cli: Record<string, unknown>,
  ): MagpieAgents {
    const records = parseMagpieCliVersions(cli.agents);
    return {
      pending: cli.pending === true,
      agents: agentRows(state).flatMap(a => {
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
            ...(this.reapplyErrors.has(a.id) ? { reapplyError: this.reapplyErrors.get(a.id) } : {}),
            models: (Array.isArray(a.fields) ? a.fields : [])
              .filter(
                (f: Record<string, unknown>) =>
                  typeof f.key === 'string' &&
                  MAGPIE_AGENT_MODEL_FIELDS.has(f.key) &&
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
  private agentClient(signal?: AbortSignal): {
    managementJson(route: string, init?: RequestInit): Promise<Record<string, unknown>>;
  } {
    return {
      managementJson: (route, init) => {
        signal?.throwIfAborted();
        return this.context.managementJson(route, signal ? { ...init, signal } : init);
      },
    };
  }

  private userHome(): string {
    return resolveUserHome(this.context.options.environment);
  }

  reapplyAfterStart(gatewayUrl: string, owner: AbortSignal): void {
    const controller = new AbortController();
    const signal = AbortSignal.any([owner, controller.signal]);
    const task = this.reapplyStartupAgents(gatewayUrl, signal)
      .catch(error => {
        if (!signal.aborted) console.warn('[Magpie] startup agent configuration failed:', error);
      })
      .finally(() => {
        this.startupReapply = undefined;
      });
    this.startupReapply = { controller, task };
  }

  stopStartupReapply(): Promise<void> | undefined {
    this.startupReapply?.controller.abort();
    return this.startupReapply?.task;
  }

  private async reapplyStartupAgents(gatewayUrl: string, signal: AbortSignal): Promise<void> {
    this.reapplyErrors.clear();
    let state: Record<string, unknown>;
    for (let attempt = 1; ; attempt++) {
      signal.throwIfAborted();
      try {
        // These requests can write CLI config upstream. Drain a dispatched request before changing it again.
        state = await this.context.managementJson('/api/state', {}, STARTUP_AGENT_READ_TIMEOUT_MS);
        break;
      } catch (error) {
        if (attempt === STARTUP_AGENT_READ_ATTEMPTS || signal.aborted) throw error;
        await delay(STARTUP_AGENT_READ_RETRY_MS, undefined, { signal });
      }
    }
    signal.throwIfAborted();
    const snapshot = this.projectAgents(state, {});
    const errors = await magpieReapplyConnectedAgents(this.agentClient(), snapshot, signal);
    signal.throwIfAborted();
    this.reapplyErrors = errors;
    if (
      snapshot.agents.some(agent => agent.wired && canonicalHostAgentId(agent.id) === 'opencode') &&
      !errors.has('opencode')
    ) {
      await syncOpenCodeConfigToUser(this.context.options.privateHome, this.userHome(), gatewayUrl);
    }
  }

  private async finalizeHostConnect(agentId: string): Promise<void> {
    if (canonicalHostAgentId(agentId) !== 'opencode') return;
    await mergeOpenCodeConfigToUser(this.context.options.privateHome, this.userHome());
  }

  private async finalizeHostDisconnect(agentId: string): Promise<void> {
    const canonical = canonicalHostAgentId(agentId);
    const home = this.userHome();
    if (canonical === 'opencode')
      await revertOpenCodeConfigFromUser(this.context.options.privateHome, home);
    if (canonical === 'codex') await stripCodexMagpieProviderBlock(home);
    await clearLegacyHostAgentStorage(this.context.options.privateHome);
  }

  async previewAgent(agentId: string): Promise<MagpieAgentConnectPreview> {
    await this.context.ensureRunning();
    return magpieAgentPreview(this.agentClient(), agentId);
  }

  async connectAgent(agentId: string): Promise<MagpieAgents> {
    await this.context.ensureRunning();
    await this.startupReapply?.task;
    if (this.context.state().state !== 'running') throw new Error('Model service is unavailable');
    await clearLegacyHostAgentStorage(this.context.options.privateHome);
    const state = await magpieAgentConnect(this.agentClient(), agentId);
    await this.finalizeHostConnect(agentId);
    return this.projectAgents(state, await this.readCliVersions());
  }

  async disconnectAgent(agentId: string): Promise<MagpieAgents> {
    await this.startupReapply?.task;
    if (this.context.state().state !== 'running') return { agents: [], pending: false };
    const before = await this.context.managementJson('/api/state');
    const wasWired = agentRows(before).some(agent => agent.id === agentId && agent.wired === true);
    const state = await magpieAgentDisconnect(this.agentClient(), agentId);
    if (wasWired) await this.finalizeHostDisconnect(agentId);
    this.reapplyErrors.delete(agentId);
    return this.projectAgents(state, await this.readCliVersions());
  }

  async disconnectAllAgents(signal?: AbortSignal): Promise<MagpieAgents> {
    await (signal ? this.stopStartupReapply() : this.startupReapply?.task);
    signal?.throwIfAborted();
    if (this.context.state().state !== 'running') return { agents: [], pending: false };
    const client = this.agentClient(signal);
    let state = await client.managementJson('/api/state');
    for (const entry of MAGPIE_EXTERNAL_AGENT_CATALOG) {
      for (const upstreamId of entry.upstreamIds) {
        if (!agentRows(state).some(agent => agent.id === upstreamId && agent.wired === true))
          continue;
        state = await magpieAgentDisconnect(client, upstreamId);
        await this.finalizeHostDisconnect(upstreamId).catch(error => {
          console.warn(`[Magpie] host disconnect cleanup failed for ${upstreamId}:`, error);
        });
        this.reapplyErrors.delete(upstreamId);
      }
    }
    // Quit only needs the wiring response, independent of the CLI version probe.
    return this.projectAgents(state, signal ? {} : await this.readCliVersions());
  }

  async setModel(selection: MagpieModelSelection): Promise<MagpieAgents> {
    if (
      !selection ||
      typeof selection.agentId !== 'string' ||
      selection.agentId.length > 100 ||
      !MAGPIE_AGENT_MODEL_FIELDS.has(selection.field) ||
      typeof selection.value !== 'string' ||
      selection.value.length > 500
    )
      throw new Error('Invalid model selection');
    await this.startupReapply?.task;
    const state =
      this.context.state().state === 'running'
        ? await this.context.managementJson('/api/state')
        : {};
    const agents = this.projectAgents(state, {});
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
    const updated = await this.context.managementJson('/api/set', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        Agent: selection.agentId,
        Field: selection.field,
        Value: selection.value,
      }),
    });
    return this.projectAgents(updated, await this.readCliVersions());
  }
}
