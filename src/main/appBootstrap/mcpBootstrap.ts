/**
 * MCP configuration publication and diagnostics shutdown.
 */
import { BrowserWindow } from 'electron';
import { McpIpc } from '../../shared/ipc/channels';

import { getMcpStore, getStore } from './runtimeServices';
import { FEISHU_MCP_REGISTRY_ID } from './feishuConnector';
import { shutdownMcpDiagnostics } from './codingMcpDiagnostics';
import {
  hasVerifiedAgentTools,
  OfficialIntegrationId,
  OfficialIntegrationManifests,
} from '../libs/mcpIntegrationManifest';

const MCP_BUILT_IN_DEFAULTS_DISABLED_KEY = 'mcp_builtin_defaults_disabled_v1';
const MCP_BRIDGE_SHUTDOWN_MESSAGE = 'MCP bridge is shutting down';
const bridgeShutdown = new AbortController();
type McpRefreshResult = { tools: number; error?: string };

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

const broadcastMcpBridgeSync = (
  channel: typeof McpIpc.BridgeSyncStart | typeof McpIpc.BridgeSyncDone,
  data?: McpRefreshResult,
): void => {
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

function publishMcpConfiguration(onConfigurationChanged: () => void): void {
  bridgeShutdown.signal.throwIfAborted();
  ensureBuiltInMcpDefaultsDisabled();
  onConfigurationChanged();
}

function completeMcpRefresh(result: McpRefreshResult): McpRefreshResult {
  broadcastMcpBridgeSync(McpIpc.BridgeSyncDone, result);
  return result;
}

function handleMcpRefreshError(error: unknown): McpRefreshResult {
  const message = error instanceof Error ? error.message : String(error);
  if (!bridgeShutdown.signal.aborted) console.error('[McpBridge] Refresh failed:', error);
  return completeMcpRefresh({ tools: 0, error: message });
}

export async function refreshMcpBridge(
  onConfigurationChanged: () => void,
): Promise<McpRefreshResult> {
  if (bridgeShutdown.signal.aborted) return { tools: 0, error: MCP_BRIDGE_SHUTDOWN_MESSAGE };

  broadcastMcpBridgeSync(McpIpc.BridgeSyncStart);
  try {
    publishMcpConfiguration(onConfigurationChanged);
    return completeMcpRefresh({ tools: 0 });
  } catch (error) {
    return handleMcpRefreshError(error);
  }
}

export async function shutdownMcpBridge(): Promise<void> {
  bridgeShutdown.abort(new Error(MCP_BRIDGE_SHUTDOWN_MESSAGE));
  await shutdownMcpDiagnostics();
}
