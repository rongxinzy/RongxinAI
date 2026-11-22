import { McpOAuthManager } from '../libs/mcpOAuthManager';
import type { McpServerRecord } from '../mcpStore';
import { getMcpStore, getStore } from './runtimeServices';

const pendingRefreshes = new Map<
  string,
  { token: Promise<string | null>; updates: Set<Promise<McpServerRecord>> }
>();
const shutdown = new AbortController();

export async function refreshMcpOAuthRecord(server: McpServerRecord): Promise<McpServerRecord> {
  const { signal } = shutdown;
  if (signal.aborted || !server.registryId || !server.url || server.credentialsError) return server;
  const { registryId, url } = server;
  const key = JSON.stringify([registryId, url]);

  try {
    if (getMcpStore().getRegistryOwner(registryId)?.id !== server.id) return server;
    const refresh = pendingRefreshes.get(key) ?? {
      token: new McpOAuthManager(getStore()).refreshAccessToken(registryId, url, signal),
      updates: new Set<Promise<McpServerRecord>>(),
    };
    pendingRefreshes.set(key, refresh);
    const update = refresh.token.then(token =>
      signal.aborted ? server : updateMcpOAuthHeader(server, token),
    );
    refresh.updates.add(update);
    return await update.finally(() => {
      refresh.updates.delete(update);
      if (refresh.updates.size === 0) pendingRefreshes.delete(key);
    });
  } catch {
    if (!signal.aborted)
      console.warn(`[McpAuth] failed to refresh OAuth token for MCP server ${server.id}.`);
    return server;
  }
}

function updateMcpOAuthHeader(
  server: McpServerRecord,
  accessToken: string | null,
): McpServerRecord {
  if (!accessToken) return server;

  const store = getMcpStore();
  const current = server.registryId ? store.getRegistryOwner(server.registryId) : null;
  if (
    !current ||
    current.id !== server.id ||
    current.url !== server.url ||
    current.credentialsError
  ) {
    return server;
  }
  const authorization = `Bearer ${accessToken}`;
  if (current.headers?.Authorization === server.headers?.Authorization) {
    if (current.headers?.Authorization !== authorization) {
      store.updateServer(server.id, {
        headers: { ...current.headers, Authorization: authorization },
      });
    }
    return { ...server, headers: { ...current.headers, Authorization: authorization } };
  }

  // An overlapping refresh or configuration edit already updated the stored header.
  return { ...server, headers: current.headers };
}

export const refreshMcpOAuthHeaders = (servers: McpServerRecord[]): Promise<McpServerRecord[]> =>
  Promise.all(servers.map(refreshMcpOAuthRecord));

export async function shutdownMcpOAuthRefreshes(): Promise<void> {
  shutdown.abort();
  await Promise.allSettled([...pendingRefreshes.values()].flatMap(refresh => [...refresh.updates]));
}
