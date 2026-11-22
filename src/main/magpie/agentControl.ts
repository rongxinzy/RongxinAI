import { isMagpieManagedAgentId } from '../../shared/magpie/constants';
import type {
  MagpieAgentConnectPreview,
  MagpieAgentFileChange,
  MagpieAgents,
} from '../../shared/magpie/types';
import { neutralizeUpstreamBrand } from './managementErrors';

function assertManagedMagpieAgentId(agentId: string): void {
  if (typeof agentId !== 'string' || !isMagpieManagedAgentId(agentId)) {
    throw new Error('Unsupported external agent');
  }
}

type MagpieManagementClient = {
  managementJson(route: string, init?: RequestInit): Promise<Record<string, unknown>>;
};

/** Structural fields returned by the upstream CLI version probe. */
type MagpieAgentCliVersions = Record<string, { version?: unknown; app?: unknown }>;

export function parseMagpieCliVersions(value: unknown): MagpieAgentCliVersions {
  return (value && typeof value === 'object' ? value : {}) as MagpieAgentCliVersions;
}

export async function magpieAgentPreview(
  client: MagpieManagementClient,
  agentId: string,
): Promise<MagpieAgentConnectPreview> {
  assertManagedMagpieAgentId(agentId);
  const encoded = encodeURIComponent(agentId);
  const body = await client.managementJson(`/api/agents/preview/${encoded}`);
  return {
    changes: Array.isArray(body.changes) ? (body.changes as MagpieAgentFileChange[]) : [],
    ...(typeof body.error === 'string' ? { error: neutralizeUpstreamBrand(body.error) } : {}),
    ...(typeof body.revision === 'string' ? { revision: body.revision } : {}),
  };
}

export function magpieAgentConnect(
  client: MagpieManagementClient,
  agentId: string,
): Promise<Record<string, unknown>> {
  assertManagedMagpieAgentId(agentId);
  const encoded = encodeURIComponent(agentId);
  return client.managementJson(`/api/agents/connect/${encoded}`, { method: 'POST' });
}

export function magpieAgentDisconnect(
  client: MagpieManagementClient,
  agentId: string,
): Promise<Record<string, unknown>> {
  assertManagedMagpieAgentId(agentId);
  const encoded = encodeURIComponent(agentId);
  return client.managementJson(`/api/agents/disconnect/${encoded}`, { method: 'POST' });
}

async function magpieAgentReapply(client: MagpieManagementClient, agentId: string): Promise<void> {
  assertManagedMagpieAgentId(agentId);
  const encoded = encodeURIComponent(agentId);
  await client.managementJson(`/api/agents/reapply/${encoded}`, { method: 'POST' });
}

export async function magpieReapplyConnectedAgents(
  client: MagpieManagementClient,
  agents: MagpieAgents,
  signal: AbortSignal,
): Promise<Map<string, string>> {
  const errors = new Map<string, string>();
  for (const agent of agents.agents) {
    signal.throwIfAborted();
    if (!agent.wired) continue;
    if (!isMagpieManagedAgentId(agent.id)) continue;
    try {
      await magpieAgentReapply(client, agent.id);
    } catch (error) {
      signal.throwIfAborted();
      const message = error instanceof Error ? error.message : String(error);
      errors.set(agent.id, message);
      console.warn(`[Magpie] reapply failed for ${agent.id}:`, error);
    }
  }
  return errors;
}
