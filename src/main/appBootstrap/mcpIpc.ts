/** MCP server IPC: CRUD, OAuth authorization, import/export and bridge refresh. */
import fs from 'fs';
import path from 'path';

import { app, dialog, ipcMain, shell } from 'electron';

import { rt } from './runtimeState';
import { getMcpStore, getStore } from './runtimeServices';
import {
  ensureBuiltInMcpDefaultsDisabled,
  refreshMcpBridge,
  refreshMcpOAuthHeaders,
} from './mcpBootstrap';
import {
  verifyFeishuConnector,
  FEISHU_MCP_REGISTRY_ID,
  getMcpIntegrationRuntime,
  getLocalFeishuCliCommand,
} from './feishuConnector';
import { MCP_OAUTH_STORE_PREFIX, McpOAuthManager } from '../libs/mcpOAuthManager';
import { exportMcpConfig, importMcpConfig } from '../libs/mcpConfigCodec';
import {
  validateMcpServerConfig,
  validateStoredMcpServerConfig,
} from '../libs/mcpCommandValidation';
import { probeMcpConnection } from '../libs/mcpConnectionProbe';
import { loadBundledMcpMarketplace } from '../mcpMarketplace';
import {
  hasVerifiedAgentTools,
  OfficialIntegrationId,
  OfficialIntegrationManifests,
} from '../libs/mcpIntegrationManifest';
import { IntegrationOperation } from '../libs/mcpIntegrationRuntime';
import { McpCredentialVault } from '../libs/mcpCredentialVault';
import type { McpServerFormData } from '../mcpStore';
import { McpIpc } from '../../shared/ipc/channels';

export const registerMcpIpc = (): void => {
  // MCP Server IPC handlers
  ipcMain.handle(McpIpc.List, () => {
    try {
      ensureBuiltInMcpDefaultsDisabled();
      const servers = getMcpStore().listServers();
      return { success: true, servers };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to list MCP servers',
      };
    }
  });

  ipcMain.handle(
    McpIpc.Create,
    async (
      _event,
      data: {
        name: string;
        description: string;
        transportType: string;
        command?: string;
        args?: string[];
        env?: Record<string, string>;
        url?: string;
        headers?: Record<string, string>;
        isBuiltIn?: boolean;
        registryId?: string;
        exposure?: 'codemode' | 'deferred' | 'direct' | 'hidden';
      },
    ) => {
      try {
        const validationError = await validateMcpServerConfig(data as McpServerFormData);
        if (validationError) {
          return { success: false, error: validationError };
        }

        getMcpStore().createServer(data as McpServerFormData);
        const servers = getMcpStore().listServers();
        // Trigger async MCP bridge refresh (don't await — let UI show DB result immediately)
        refreshMcpBridge().catch(err =>
          console.error('[McpBridge] background refresh error:', err),
        );
        return { success: true, servers };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to create MCP server',
        };
      }
    },
  );

  ipcMain.handle(
    McpIpc.Update,
    async (
      _event,
      id: string,
      data: {
        name?: string;
        description?: string;
        transportType?: string;
        command?: string;
        args?: string[];
        env?: Record<string, string>;
        url?: string;
        headers?: Record<string, string>;
        githubUrl?: string;
        registryId?: string;
        exposure?: 'codemode' | 'deferred' | 'direct' | 'hidden';
      },
    ) => {
      try {
        const existing = getMcpStore().getServer(id);
        if (!existing) {
          return { success: false, error: 'MCP server not found' };
        }

        const merged: McpServerFormData = {
          name: data.name ?? existing.name,
          description: data.description ?? existing.description,
          transportType: (data.transportType ??
            existing.transportType) as McpServerFormData['transportType'],
          command: data.command !== undefined ? data.command : existing.command,
          args: data.args !== undefined ? data.args : existing.args,
          env: data.env !== undefined ? data.env : existing.env,
          url: data.url !== undefined ? data.url : existing.url,
          headers: data.headers !== undefined ? data.headers : existing.headers,
          isBuiltIn: existing.isBuiltIn,
          githubUrl: data.githubUrl !== undefined ? data.githubUrl : existing.githubUrl,
          registryId: data.registryId !== undefined ? data.registryId : existing.registryId,
          exposure: data.exposure !== undefined ? data.exposure : existing.exposure,
        };

        const validationError = await validateMcpServerConfig(merged);
        if (validationError) {
          return { success: false, error: validationError };
        }

        getMcpStore().updateServer(id, data as Partial<McpServerFormData>);
        const servers = getMcpStore().listServers();
        refreshMcpBridge().catch(err =>
          console.error('[McpBridge] background refresh error:', err),
        );
        return { success: true, servers };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to update MCP server',
        };
      }
    },
  );

  ipcMain.handle(McpIpc.TestConnection, async (_event, data: McpServerFormData) => {
    try {
      const validationError = await validateMcpServerConfig(data);
      if (validationError) {
        return { success: false, error: validationError };
      }
      return await probeMcpConnection(data);
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to test MCP connection',
      };
    }
  });

  ipcMain.handle(McpIpc.Delete, async (_event, id: string) => {
    try {
      const existing = getMcpStore().getServer(id);
      if (!existing) {
        return { success: false, error: 'MCP server not found' };
      }
      if (existing.registryId === FEISHU_MCP_REGISTRY_ID) {
        const uninstallStatus = await getMcpIntegrationRuntime().run(
          OfficialIntegrationId.Feishu,
          IntegrationOperation.Uninstall,
        );
        if (uninstallStatus.error) {
          return { success: false, error: uninstallStatus.error };
        }
      }
      getMcpStore().deleteServer(id);
      // OAuth sessions are keyed by the registry id during authorization,
      // while the installed server row has its own random database id. Clear
      // both keys so uninstall actually unlinks this App's authorization.
      const oauthKeys = new Set([id, existing.registryId].filter(Boolean));
      for (const oauthKey of oauthKeys) {
        getStore().delete(`${MCP_OAUTH_STORE_PREFIX}${oauthKey}`);
        new McpCredentialVault(getStore()).deleteValue(`${MCP_OAUTH_STORE_PREFIX}${oauthKey}`);
      }
      const servers = getMcpStore().listServers();
      const refreshResult = await refreshMcpBridge();
      if (refreshResult.error) {
        console.error('[McpBridge] refresh after uninstall failed:', refreshResult.error);
      }
      return { success: true, servers, refreshError: refreshResult.error };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to delete MCP server',
      };
    }
  });

  ipcMain.handle(McpIpc.SetEnabled, async (_event, options: { id: string; enabled: boolean }) => {
    try {
      if (options.enabled) {
        const existing = getMcpStore().getServer(options.id);
        if (!existing) {
          return { success: false, error: 'MCP server not found' };
        }
        if (
          existing.registryId === FEISHU_MCP_REGISTRY_ID &&
          !hasVerifiedAgentTools(OfficialIntegrationManifests[OfficialIntegrationId.Feishu])
        ) {
          return {
            success: false,
            error:
              'Feishu is installed as an official connector, but no verified agent tools are available yet.',
          };
        }
        if (existing.registryId !== FEISHU_MCP_REGISTRY_ID) {
          const validationError = await validateStoredMcpServerConfig(existing);
          if (validationError) {
            return { success: false, error: validationError };
          }
          // Enabling must remain responsive. refreshMcpBridge() immediately
          // follows this write and performs the single authoritative OAuth
          // refresh plus MCP initialization. Doing it here as a synchronous
          // probe duplicated that network work and blocked the switch.
        }
      }

      getMcpStore().setEnabled(options.id, options.enabled);
      const servers = getMcpStore().listServers();
      refreshMcpBridge().catch(err => console.error('[McpBridge] background refresh error:', err));
      return { success: true, servers };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to update MCP server',
      };
    }
  });

  ipcMain.handle(McpIpc.FetchMarketplace, async () => {
    try {
      return {
        success: true,
        data: loadBundledMcpMarketplace(app.getAppPath(), process.resourcesPath),
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to load bundled MCP marketplace',
      };
    }
  });

  ipcMain.handle(McpIpc.LoadIcon, async (_event, iconPath: string) => {
    try {
      const marketplace = loadBundledMcpMarketplace(app.getAppPath(), process.resourcesPath);
      if (
        !marketplace.servers.some(server => (server as { iconPath?: string }).iconPath === iconPath)
      ) {
        return { success: false, error: 'MCP icon is not registered' };
      }
      const roots = [
        path.join(process.resourcesPath, 'MCPs'),
        path.join(app.getAppPath(), 'MCPs'),
        path.join(process.cwd(), 'MCPs'),
      ];
      for (const root of roots) {
        const filePath = path.resolve(root, iconPath);
        if (!filePath.startsWith(`${root}${path.sep}`) || !fs.existsSync(filePath)) continue;
        const extension = path.extname(filePath).toLowerCase();
        const mimeType =
          extension === '.png'
            ? 'image/png'
            : extension === '.jpg' || extension === '.jpeg'
              ? 'image/jpeg'
              : extension === '.svg'
                ? 'image/svg+xml'
                : null;
        if (!mimeType) return { success: false, error: 'Unsupported MCP icon format' };
        return {
          success: true,
          data: `data:${mimeType};base64,${fs.readFileSync(filePath).toString('base64')}`,
        };
      }
      return { success: false, error: 'MCP icon was not found' };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to load MCP icon',
      };
    }
  });

  ipcMain.handle(McpIpc.ExportConfig, async () => {
    try {
      const result = await dialog.showSaveDialog({
        title: 'Export MCP configuration',
        defaultPath: 'mcp.json',
        filters: [{ name: 'JSON', extensions: ['json'] }],
      });
      if (result.canceled || !result.filePath) return { success: true, cancelled: true };
      const document = exportMcpConfig(getMcpStore().listServers());
      await fs.promises.writeFile(
        result.filePath,
        `${JSON.stringify(document, null, 2)}\n`,
        'utf8',
      );
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to export MCP configuration',
      };
    }
  });

  ipcMain.handle(McpIpc.ImportConfig, async () => {
    try {
      const result = await dialog.showOpenDialog({
        title: 'Import MCP configuration',
        properties: ['openFile'],
        filters: [{ name: 'JSON', extensions: ['json'] }],
      });
      if (result.canceled || result.filePaths.length === 0)
        return { success: true, cancelled: true };
      const input = JSON.parse(await fs.promises.readFile(result.filePaths[0], 'utf8')) as unknown;
      const servers = importMcpConfig(input);
      const existingNames = new Set(
        getMcpStore()
          .listServers()
          .map(server => server.name),
      );
      for (const server of servers) {
        if (existingNames.has(server.name)) {
          return { success: false, error: `MCP server "${server.name}" already exists.` };
        }
        const validationError = await validateMcpServerConfig(server);
        if (validationError) return { success: false, error: validationError };
      }
      for (const server of servers) getMcpStore().createServer(server);
      const refreshed = await refreshMcpBridge();
      return {
        success: !refreshed.error,
        servers: getMcpStore().listServers(),
        error: refreshed.error,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to import MCP configuration',
      };
    }
  });

  ipcMain.handle(McpIpc.CancelAuthorize, (_event, requestId: string) => {
    rt.activeMcpAuthorizations.get(requestId)?.abort();
    return { success: true };
  });

  ipcMain.handle(McpIpc.GetFeishuCliStatus, () => ({
    success: true,
    installed: Boolean(getLocalFeishuCliCommand()),
  }));

  ipcMain.handle(McpIpc.PrepareFeishuCli, async () => {
    try {
      const status = await getMcpIntegrationRuntime().run(
        OfficialIntegrationId.Feishu,
        IntegrationOperation.Provision,
      );
      return status.error ? { success: false, error: status.error } : { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to install Feishu CLI',
      };
    }
  });

  ipcMain.handle(
    McpIpc.Authorize,
    async (_event, rawData: McpServerFormData & { authorizationRequestId?: string }) => {
      const { authorizationRequestId, ...data } = rawData;
      const cancellation = authorizationRequestId ? new AbortController() : null;
      if (authorizationRequestId && cancellation) {
        rt.activeMcpAuthorizations.set(authorizationRequestId, cancellation);
      }
      const ensureNotCancelled = () => {
        if (cancellation?.signal.aborted) throw new Error('MCP authorization was cancelled');
      };
      try {
        ensureNotCancelled();
        if (data.registryId === FEISHU_MCP_REGISTRY_ID) {
          const status = await getMcpIntegrationRuntime().run(
            OfficialIntegrationId.Feishu,
            IntegrationOperation.Authenticate,
            cancellation?.signal,
          );
          if (status.error) throw new Error(status.error);
          ensureNotCancelled();
          const existingFeishu = getMcpStore()
            .listServers()
            .find(server => server.registryId === FEISHU_MCP_REGISTRY_ID);
          if (!existingFeishu) {
            getMcpStore().createServer({
              name: data.name,
              description: data.description || 'Official Feishu CLI and Skills connector',
              transportType: 'stdio',
              // Presentation-only record. The CLI is intentionally not started
              // by McpServerManager until a verified MCP tool protocol exists.
              command: 'lark-cli',
              isBuiltIn: true,
              registryId: FEISHU_MCP_REGISTRY_ID,
            });
          }
          const servers = getMcpStore().listServers();
          const refreshResult = await refreshMcpBridge();
          if (refreshResult.error) {
            console.error('[McpBridge] Feishu refresh error:', refreshResult.error);
          }
          return { success: true, servers, refreshError: refreshResult.error };
        }
        const validationError = await validateMcpServerConfig(data);
        if (validationError) return { success: false, error: validationError };
        if (!data.registryId || !data.url)
          return { success: false, error: 'Official MCP configuration is incomplete' };

        const accessToken = await new McpOAuthManager(getStore()).authorize(
          data.registryId,
          data.url,
          cancellation?.signal,
        );
        ensureNotCancelled();
        if (!accessToken)
          return { success: false, error: 'OAuth authorization did not return an access token' };

        getMcpStore().createServer({
          ...data,
          isBuiltIn: true,
          headers: { ...data.headers, Authorization: `Bearer ${accessToken}` },
        });
        const servers = getMcpStore().listServers();
        refreshMcpBridge().catch(err =>
          console.error('[McpBridge] background refresh error:', err),
        );
        return { success: true, servers };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to authorize MCP server',
        };
      } finally {
        if (authorizationRequestId) rt.activeMcpAuthorizations.delete(authorizationRequestId);
      }
    },
  );

  // Explicit bridge refresh — renderer can await this for loading state
  ipcMain.handle(McpIpc.RefreshBridge, async () => {
    try {
      const result = await refreshMcpBridge();
      return { success: true, tools: result.tools, error: result.error };
    } catch (error) {
      return {
        success: false,
        tools: 0,
        error: error instanceof Error ? error.message : 'Failed to refresh MCP bridge',
      };
    }
  });
};
