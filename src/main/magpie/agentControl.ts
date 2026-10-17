import {
  isMagpieManagedAgentId,
  MAGPIE_EXTERNAL_AGENT_CATALOG,
} from '../../shared/magpie/constants';
import type {
  MagpieAgentConnectPreview,
  MagpieAgentFileChange,
  MagpieAgents,
} from '../../shared/magpie/types';

function assertManagedMagpieAgentId(agentId: string): void {
  if (typeof agentId !== 'string' || !isMagpieManagedAgentId(agentId)) {
    throw new Error('Unsupported external agent');
  }
}

type MagpieManagementClient = {
  managementJson(route: string, init?: RequestInit): Promise<Record<string, unknown>>;
  agents(): Promise<MagpieAgents>;
};

export async function magpieAgentPreview(
  client: MagpieManagementClient,
  agentId: string,
): Promise<MagpieAgentConnectPreview> {
  assertManagedMagpieAgentId(agentId);
  const encoded = encodeURIComponent(agentId);
  const body = await client.managementJson(`/api/agents/preview/${encoded}`);
  return {
    changes: Array.isArray(body.changes) ? (body.changes as MagpieAgentFileChange[]) : [],
    ...(typeof body.error === 'string' ? { error: body.error } : {}),
    ...(typeof body.revision === 'string' ? { revision: body.revision } : {}),
  };
}

export async function magpieAgentConnect(
  client: MagpieManagementClient,
  agentId: string,
): Promise<MagpieAgents> {
  assertManagedMagpieAgentId(agentId);
  const encoded = encodeURIComponent(agentId);
  await client.managementJson(`/api/agents/connect/${encoded}`, { method: 'POST' });
  return client.agents();
}

export async function magpieAgentDisconnect(
  client: MagpieManagementClient,
  agentId: string,
): Promise<MagpieAgents> {
  assertManagedMagpieAgentId(agentId);
  const encoded = encodeURIComponent(agentId);
  await client.managementJson(`/api/agents/disconnect/${encoded}`, { method: 'POST' });
  return client.agents();
}

async function magpieAgentReapply(
  client: MagpieManagementClient,
  agentId: string,
): Promise<void> {
  assertManagedMagpieAgentId(agentId);
  const encoded = encodeURIComponent(agentId);
  await client.managementJson(`/api/agents/reapply/${encoded}`, { method: 'POST' });
}

export async function magpieReapplyConnectedAgents(
  client: MagpieManagementClient,
  agents: MagpieAgents,
): Promise<void> {
  for (const agent of agents.agents) {
    if (!agent.wired) continue;
    if (!isMagpieManagedAgentId(agent.id)) continue;
    await magpieAgentReapply(client, agent.id);
  }
}

export async function magpieDisconnectAllManaged(
  client: MagpieManagementClient,
): Promise<MagpieAgents> {
  let snapshot = await client.agents();
  for (const entry of MAGPIE_EXTERNAL_AGENT_CATALOG) {
    for (const upstreamId of entry.upstreamIds) {
      const agent = snapshot.agents.find(candidate => candidate.id === upstreamId);
      if (!agent?.wired) continue;
      snapshot = await magpieAgentDisconnect(client, upstreamId);
    }
  }
  return snapshot;
}
