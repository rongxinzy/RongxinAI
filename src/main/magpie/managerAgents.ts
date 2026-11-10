import type { MagpieStatus, MagpieAgents, MagpieModelSelection } from '../../shared/magpie/types';
import {
  magpieAgentConnect,
  magpieAgentDisconnect,
  magpieAgentPreview,
  magpieDisconnectAllManaged,
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
} from './externalAgentHostConfig';
import { resyncOpenCodeUserConfig, sweepManagedAgentsAfterStart } from './reapplyStartup';
import { isMagpieManagedAgentId } from '../../shared/magpie/constants';

import { MAGPIE_AGENT_MODEL_FIELDS } from './magpieManagerUtils';

import type { MagpieManagerOptions } from './managerOptions';

interface AgentContext {
  state(): MagpieStatus;
  ensureRunning(): Promise<MagpieStatus>;
  managementJson(
    route: string,
    init?: RequestInit,
    timeoutMs?: number,
  ): Promise<Record<string, unknown>>;
  agents(readTimeoutMs?: number): Promise<MagpieAgents>;
  options: Pick<MagpieManagerOptions, 'privateHome' | 'environment'>;
}

/** Managed CLI projection, wiring and host-configuration reconciliation. */
export class MagpieManagerAgents {
  private reapplyErrors = new Map<string, string>();
  constructor(private readonly context: AgentContext) {}

  async agents(readTimeoutMs?: number): Promise<MagpieAgents> {
    if (this.context.state().state !== 'running') return { agents: [], pending: false };
    const state = await this.context.managementJson('/api/state', {}, readTimeoutMs);
    const cli = await this.context.managementJson('/api/agents/cli', {}, readTimeoutMs);
    const records = parseMagpieCliVersions(cli.agents);
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
              ...(this.reapplyErrors.has(a.id)
                ? { reapplyError: this.reapplyErrors.get(a.id) }
                : {}),
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
  private agentClient(): {
    managementJson(route: string, init?: RequestInit): Promise<Record<string, unknown>>;
    agents(): Promise<MagpieAgents>;
  } {
    return {
      managementJson: (route, init) => this.context.managementJson(route, init),
      agents: () => this.context.agents(),
    };
  }

  private userHome(): string {
    return resolveUserHome(this.context.options.environment);
  }

  async reapplyManagedAgentsAfterStart(): Promise<void> {
    const outcome = await sweepManagedAgentsAfterStart({
      isRunning: () => this.context.state().state === 'running',
      readAgents: timeoutMs => this.context.agents(timeoutMs),
      reapply: current => magpieReapplyConnectedAgents(this.agentClient(), current),
    });
    if (!outcome) return;
    this.reapplyErrors = outcome.errors;
    await resyncOpenCodeUserConfig({
      snapshot: outcome.snapshot,
      errors: outcome.errors,
      privateHome: this.context.options.privateHome,
      home: this.userHome(),
      gatewayUrl:
        this.context.state().state === 'running' ? this.context.state().gatewayUrl : undefined,
    });
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

  private wiredManagedAgentIds(agents: MagpieAgents): string[] {
    const ids = new Set<string>();
    for (const agent of agents.agents) {
      if (!agent.wired || !isMagpieManagedAgentId(agent.id)) continue;
      ids.add(canonicalHostAgentId(agent.id));
    }
    return [...ids];
  }

  async previewAgent(agentId: string): Promise<MagpieAgentConnectPreview> {
    await this.context.ensureRunning();
    return magpieAgentPreview(this.agentClient(), agentId);
  }

  async connectAgent(agentId: string): Promise<MagpieAgents> {
    await this.context.ensureRunning();
    await clearLegacyHostAgentStorage(this.context.options.privateHome);
    await magpieAgentConnect(this.agentClient(), agentId);
    await this.finalizeHostConnect(agentId);
    return this.context.agents();
  }

  async disconnectAgent(agentId: string): Promise<MagpieAgents> {
    if (this.context.state().state !== 'running') return { agents: [], pending: false };
    const before = await this.context.agents();
    const wasWired = before.agents.some(agent => agent.id === agentId && agent.wired);
    const agents = await magpieAgentDisconnect(this.agentClient(), agentId);
    if (wasWired) await this.finalizeHostDisconnect(agentId);
    this.reapplyErrors.delete(agentId);
    return agents;
  }

  async disconnectAllAgents(): Promise<MagpieAgents> {
    if (this.context.state().state !== 'running') return { agents: [], pending: false };
    const before = await this.context.agents();
    const wired = this.wiredManagedAgentIds(before);
    if (wired.length === 0) return before;
    const next = await magpieDisconnectAllManaged(this.agentClient());
    for (const id of wired) {
      await this.finalizeHostDisconnect(id).catch(error => {
        console.warn(`[Magpie] host disconnect cleanup failed for ${id}:`, error);
      });
    }
    this.reapplyErrors.clear();
    return next;
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
    const agents = await this.context.agents();
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
    await this.context.managementJson('/api/set', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        Agent: selection.agentId,
        Field: selection.field,
        Value: selection.value,
      }),
    });
    return this.context.agents();
  }
}
