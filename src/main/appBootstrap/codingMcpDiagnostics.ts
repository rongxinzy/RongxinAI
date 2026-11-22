import type { BuiltinCodingMcpSnapshot } from '../codingAgent/builtinCodingMcpReport';
import { McpServerManager } from '../libs/mcpServerManager';
import type { McpServerRecord } from '../mcpStore';
import { refreshMcpOAuthHeaders } from './mcpOAuthHeaders';

const shutdown = new AbortController();
const pending = new Set<Promise<BuiltinCodingMcpSnapshot>>();

export function diagnoseCodingMcp(
  records: readonly McpServerRecord[],
  target?: string,
): Promise<BuiltinCodingMcpSnapshot> {
  const probe = runDiagnostic(records, target).finally(() => pending.delete(probe));
  pending.add(probe);
  return probe;
}

export async function shutdownMcpDiagnostics(): Promise<void> {
  shutdown.abort(new Error('MCP diagnostics are shutting down'));
  await Promise.allSettled(pending);
}

async function runDiagnostic(
  records: readonly McpServerRecord[],
  target?: string,
): Promise<BuiltinCodingMcpSnapshot> {
  const { signal } = shutdown;
  signal.throwIfAborted();
  const selected = target ? records.filter(server => server.name === target) : records;
  const enabled = selected.filter(server => server.enabled);
  const snapshot: BuiltinCodingMcpSnapshot = {
    gatewayAvailable: true,
    target: target ?? null,
    servers: selected.map(({ name, enabled }) => ({
      name,
      enabled,
      connected: false,
      toolCount: 0,
    })),
    tools: [],
  };
  if (enabled.length === 0) return snapshot;

  const manager = new McpServerManager();
  try {
    const tools = await manager.reconcileServers(await refreshMcpOAuthHeaders(enabled), signal);
    signal.throwIfAborted();
    const statuses = new Map(manager.serverStatuses.map(status => [status.name, status]));
    snapshot.servers = snapshot.servers.map(server => ({
      ...server,
      ...statuses.get(server.name),
    }));
    snapshot.tools = tools.map(({ server, name }) => ({ server, name }));
    return snapshot;
  } finally {
    await manager.stopServers();
  }
}
