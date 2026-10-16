/**
 * MCP bootstrap: built-in default suppression, OAuth header refresh, server
 * startup/reconcile and Pi tool-manifest synchronization.
 */
import { BrowserWindow } from 'electron';

import { rt } from './runtimeState';
import { getMcpStore, getStore } from './runtimeServices';
import { bumpCodingCommandCatalog } from './codingRoomRuntime';
import { FEISHU_MCP_REGISTRY_ID } from './feishuConnector';
import { McpOAuthManager } from '../libs/mcpOAuthManager';
import { McpServerManager, type McpToolManifestEntry } from '../libs/mcpServerManager';
import {
  hasVerifiedAgentTools,
  OfficialIntegrationId,
  OfficialIntegrationManifests,
} from '../libs/mcpIntegrationManifest';

const MCP_BUILT_IN_DEFAULTS_DISABLED_KEY = 'mcp_builtin_defaults_disabled_v1';

export const ensureBuiltInMcpDefaultsDisabled = (): void => {
  const store = getStore();
  const defaultsAlreadyDisabled = store.get<boolean>(MCP_BUILT_IN_DEFAULTS_DISABLED_KEY) === true;

  for (const server of getMcpStore().listServers()) {
    const isUnverifiedOfficialConnector =
      server.registryId === FEISHU_MCP_REGISTRY_ID &&
      !hasVerifiedAgentTools(OfficialIntegrationManifests[OfficialIntegrationId.Feishu]);
    if (
      (isUnverifiedOfficialConnector || (!defaultsAlreadyDisabled && server.isBuiltIn)) &&
      server.enabled
    ) {
      getMcpStore().setEnabled(server.id, false);
    }
  }
  if (defaultsAlreadyDisabled) return;
  store.set(MCP_BUILT_IN_DEFAULTS_DISABLED_KEY, true);
};

export const refreshMcpOAuthHeaders = async <
  T extends { id: string; registryId?: string; url?: string; headers?: Record<string, string> },
>(
  servers: T[],
): Promise<T[]> => {
  const oauthManager = new McpOAuthManager(getStore());
  return Promise.all(
    servers.map(async server => {
      if (!server.registryId || !server.url) return server;
      try {
        const accessToken = await oauthManager.refreshAccessToken(server.registryId, server.url);
        if (!accessToken) return server;
        const headers = { ...server.headers, Authorization: `Bearer ${accessToken}` };
        getMcpStore().updateServer(server.id, { headers });
        return { ...server, headers };
      } catch (error) {
        console.warn(
          `[McpAuth] failed to refresh OAuth token for ${server.registryId}; using the stored token:`,
          error,
        );
        return server;
      }
    }),
  );
};

/**
 * Initialize MCP servers and discover tools.
 *
 * Safe to call from any Pi initialization context.
 * deduplicates concurrent calls via a promise lock and skips if the
 * McpServerManager is already running.
 *
 * Returns the tool manifest (may be empty if no MCP servers are configured).
 */
export const initMcpServers = async (): Promise<McpToolManifestEntry[]> => {
  if (rt.mcpInitPromise) return rt.mcpInitPromise;
  const generation = rt.mcpLifecycleGeneration;

  rt.mcpInitPromise = (async (): Promise<McpToolManifestEntry[]> => {
    try {
      ensureBuiltInMcpDefaultsDisabled();
      const enabledServers = await refreshMcpOAuthHeaders(getMcpStore().getEnabledServers());
      if (enabledServers.length === 0) {
        console.log('[McpInit] No MCP servers configured, skipping');
        return [];
      }

      if (!rt.mcpServerManager) {
        rt.mcpServerManager = new McpServerManager();
      }

      // If already running (e.g. initMcpServers called before startMcpBridge),
      // reuse the existing connections instead of restarting.
      if (rt.mcpServerManager.isRunning) {
        const count = rt.mcpServerManager.toolManifest.length;
        console.log(`[McpInit] MCP already running, reusing ${count} tools`);
        return rt.mcpServerManager.toolManifest;
      }

      console.log(`[McpInit] Starting ${enabledServers.length} MCP servers...`);
      const tools = await rt.mcpServerManager.startServers(enabledServers);
      if (generation !== rt.mcpLifecycleGeneration) {
        await rt.mcpServerManager.stopServers();
        return [];
      }
      console.log(`[McpInit] MCP servers started: ${tools.length} tools discovered`);
      syncPiMcpToolManifest();
      bumpCodingCommandCatalog();
      return tools;
    } catch (err) {
      console.error('[McpInit] Failed to start MCP servers:', err);
      return [];
    }
  })().finally(() => {
    rt.mcpInitPromise = null;
  });

  return rt.mcpInitPromise;
};

/**
 * Pi sessions capture their custom-tool topology at creation time. Keep an
 * already-created Pi runtime synchronized after both startup discovery and
 * later connector refreshes without instantiating Pi just for MCP bootstrap.
 */
const syncPiMcpToolManifest = (): void => {
  if (!rt.piRuntimeAdapter || !rt.mcpServerManager) return;
  if (!rt.piRuntimeAdapter.hasMcpServerManager()) {
    rt.piRuntimeAdapter.setMcpServerManager(rt.mcpServerManager);
    return;
  }
  rt.piRuntimeAdapter.refreshMcpTools();
};

/**
 * Refresh in-process MCP servers after configuration changes.
 * Returns a summary for the renderer to display.
 */
const broadcastMcpBridgeSync = (channel: string, data?: Record<string, unknown>): void => {
  const windows = BrowserWindow.getAllWindows();
  windows.forEach(win => {
    if (win.isDestroyed()) return;
    try {
      win.webContents.send(channel, data ?? {});
    } catch (error) {
      console.error(`[McpBridge] Failed to broadcast ${channel}:`, error);
    }
  });
};

export const refreshMcpBridge = (): Promise<{ tools: number; error?: string }> => {
  if (rt.mcpBridgeRefreshPromise) {
    // A server setting changed while the current pass was reading the enabled
    // list. Schedule one more pass after it completes so the bridge converges
    // on the latest persisted configuration.
    rt.mcpBridgeRefreshPending = true;
    return rt.mcpBridgeRefreshPromise;
  }
  rt.mcpBridgeRefreshPromise = (async () => {
    try {
      const generation = ++rt.mcpLifecycleGeneration;
      console.log('[McpBridge] refreshing after config change...');
      broadcastMcpBridgeSync('mcp:bridge:syncStart');

      ensureBuiltInMcpDefaultsDisabled();
      const enabledServers = await refreshMcpOAuthHeaders(getMcpStore().getEnabledServers());
      if (!rt.mcpServerManager) {
        rt.mcpServerManager = new McpServerManager();
      }
      // Reconcile preserves healthy, unchanged connections. A change to one
      // integration must not interrupt every other configured MCP server.
      const tools = await rt.mcpServerManager.reconcileServers(enabledServers);
      if (generation !== rt.mcpLifecycleGeneration) {
        return { tools: 0, error: 'MCP configuration changed during refresh' };
      }
      const toolCount = tools.length;
      console.log(`[McpBridge] refresh: ${toolCount} tools discovered`);
      bumpCodingCommandCatalog();

      // Pi's custom tool topology is captured when a session is created.
      // Mark live sessions stale after discovery so their next user turn is
      // rebuilt with the freshly discovered MCP proxy instead of relying on
      // whichever servers happened to be ready during app startup.
      syncPiMcpToolManifest();
      console.log(`[McpBridge] refresh complete: ${toolCount} tools discovered`);
      return { tools: toolCount };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error('[McpBridge] refresh error:', msg);
      return { tools: 0, error: msg };
    }
  })()
    .then(result => {
      broadcastMcpBridgeSync('mcp:bridge:syncDone', { tools: result.tools, error: result.error });
      return result;
    })
    .catch(err => {
      const error = err instanceof Error ? err.message : String(err);
      broadcastMcpBridgeSync('mcp:bridge:syncDone', { tools: 0, error });
      return { tools: 0, error };
    })
    .finally(() => {
      rt.mcpBridgeRefreshPromise = null;
      if (rt.mcpBridgeRefreshPending) {
        rt.mcpBridgeRefreshPending = false;
        void refreshMcpBridge();
      }
    });
  return rt.mcpBridgeRefreshPromise;
};
