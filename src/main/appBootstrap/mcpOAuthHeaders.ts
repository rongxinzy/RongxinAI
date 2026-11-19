import { McpOAuthManager } from '../libs/mcpOAuthManager';
import type { McpServerRecord } from '../mcpStore';
import { getMcpStore, getStore } from './runtimeServices';

const pendingRefreshes = new Map<string, Promise<string | null>>();

export async function refreshMcpOAuthRecord(server: McpServerRecord): Promise<McpServerRecord> {
  if (!server.registryId || !server.url || server.credentialsError) return server;
  const { registryId, url } = server;

  try {
    const key = JSON.stringify([registryId, url]);
    let refresh = pendingRefreshes.get(key);
    if (!refresh) {
      refresh = new McpOAuthManager(getStore()).refreshAccessToken(registryId, url);
      pendingRefreshes.set(key, refresh);
      const clear = () => pendingRefreshes.delete(key);
      void refresh.then(clear, clear);
    }
    const accessToken = await refresh;
    if (!accessToken) return server;

    const store = getMcpStore();
    const current = store.getServer(server.id);
    if (current?.registryId !== registryId || current.url !== url || current.credentialsError) {
      return server;
    }
    const authorization = `Bearer ${accessToken}`;
    if (current.headers?.Authorization === server.headers?.Authorization) {
      if (current.headers?.Authorization !== authorization) {
        store.updateServer(server.id, {
          headers: { ...current.headers, Authorization: authorization },
        });
      }
      return { ...server, headers: { ...server.headers, Authorization: authorization } };
    }

    // An overlapping refresh or configuration edit already updated the stored header.
    return { ...server, headers: current.headers };
  } catch (error) {
    console.warn(
      `[McpAuth] failed to refresh OAuth token for ${registryId}; using the stored token:`,
      error,
    );
    return server;
  }
}

export const refreshMcpOAuthHeaders = (servers: McpServerRecord[]): Promise<McpServerRecord[]> =>
  Promise.all(servers.map(refreshMcpOAuthRecord));
