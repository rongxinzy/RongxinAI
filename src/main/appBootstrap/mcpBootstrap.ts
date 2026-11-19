/**
 * MCP configuration policy and settings-triggered bridge refresh.
 */
import { BrowserWindow } from 'electron';

import { agentRuntime } from './agentRuntimeState';
import { mcpRuntime } from './mcpRuntimeState';
import { getMcpStore, getStore } from './runtimeServices';
import { bumpCodingCommandCatalog } from './codingRoomRuntime';
import { FEISHU_MCP_REGISTRY_ID } from './feishuConnector';
import { refreshMcpOAuthHeaders } from './mcpOAuthHeaders';
import { McpServerManager } from '../libs/mcpServerManager';
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

const reconcileMcpBridge = (): Promise<{ tools: number; error?: string }> => {
  if (mcpRuntime.bridgeRefreshPromise) {
    // A server setting changed while the current pass was reading the enabled
    // list. Schedule one more pass after it completes so the bridge converges
    // on the latest persisted configuration.
    mcpRuntime.bridgeRefreshPending = true;
    return mcpRuntime.bridgeRefreshPromise;
  }
  mcpRuntime.bridgeRefreshPromise = (async () => {
    try {
      console.log('[McpBridge] refreshing after config change...');
      broadcastMcpBridgeSync('mcp:bridge:syncStart');

      const enabledServers = await refreshMcpOAuthHeaders(getMcpStore().getEnabledServers());
      if (!mcpRuntime.serverManager) {
        mcpRuntime.serverManager = new McpServerManager();
      }
      // Reconcile preserves healthy, unchanged connections. A change to one
      // integration must not interrupt every other configured MCP server.
      const tools = await mcpRuntime.serverManager.reconcileServers(enabledServers);
      const toolCount = tools.length;
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
      mcpRuntime.bridgeRefreshPromise = null;
      if (mcpRuntime.bridgeRefreshPending) {
        mcpRuntime.bridgeRefreshPending = false;
        void reconcileMcpBridge();
      }
    });
  return mcpRuntime.bridgeRefreshPromise;
};

export const refreshMcpBridge = (): Promise<{ tools: number; error?: string }> => {
  try {
    ensureBuiltInMcpDefaultsDisabled();
    // Existing sessions read the new configuration before their next turn.
    agentRuntime.piRuntimeAdapter?.markMcpConfigurationChanged();
    bumpCodingCommandCatalog();
    return reconcileMcpBridge();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[McpBridge] failed to refresh MCP configuration:', error);
    broadcastMcpBridgeSync('mcp:bridge:syncDone', { tools: 0, error: message });
    return Promise.resolve({ tools: 0, error: message });
  }
};
