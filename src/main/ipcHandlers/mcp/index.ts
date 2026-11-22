/** MCP server IPC: CRUD, OAuth authorization and import/export. */
import fs from 'fs';
import path from 'path';

import { app, dialog } from 'electron';
import type { z } from 'zod';

import {
  ensureBuiltInMcpDefaultsDisabled,
  refreshMcpBridge,
} from '../../appBootstrap/mcpBootstrap';
import {
  FEISHU_MCP_REGISTRY_ID,
  getMcpIntegrationRuntime,
  getLocalFeishuCliCommand,
} from '../../appBootstrap/feishuConnector';
import { MCP_OAUTH_STORE_PREFIX, McpOAuthManager } from '../../libs/mcpOAuthManager';
import { t } from '../../i18n';
import { exportMcpConfig, importMcpConfig } from '../../libs/mcpConfigCodec';
import {
  validateMcpServerConfig,
  validateStoredMcpServerConfig,
} from '../../libs/mcpCommandValidation';
import { probeMcpConnection } from '../../libs/mcpConnectionProbe';
import { readMcpMarketplaceAsync } from '../../workbenchTask/artifactWorkerPool';
import {
  hasVerifiedAgentTools,
  OfficialIntegrationId,
  OfficialIntegrationManifests,
} from '../../libs/mcpIntegrationManifest';
import { IntegrationOperation } from '../../libs/mcpIntegrationRuntime';
import { McpCredentialVault } from '../../libs/mcpCredentialVault';
import type { McpStore } from '../../mcpStore';
import type { SqliteStore } from '../../sqliteStore';
import { handleIpcContract } from '../../ipc/handleIpcContract';
import { mcpContract } from '../../../shared/ipc/mcpContract';
import type { McpServerFormData } from '../../mcpStore';

export interface McpIpcDeps {
  getMcpStore: () => McpStore;
  getStore: () => SqliteStore;
  onConfigurationChanged: () => void;
}

export const registerMcpIpc = (deps: McpIpcDeps): (() => Promise<void>) => {
  const refresh = () => refreshMcpBridge(deps.onConfigurationChanged);
  const marketplaceAbort = new AbortController();
  let marketplace: ReturnType<typeof readMcpMarketplaceAsync> | undefined;
  const getMarketplace = () => {
    marketplaceAbort.signal.throwIfAborted();
    if (marketplace) return marketplace;
    const roots = [
      ...new Set(
        [process.resourcesPath, app.getAppPath(), process.cwd()]
          .filter(Boolean)
          .map(root => path.join(root, 'MCPs')),
      ),
    ];
    return (marketplace = readMcpMarketplaceAsync(roots, marketplaceAbort.signal).catch(error => {
      marketplace = undefined;
      throw error;
    }));
  };
  const activeAuthorizations = new Map<
    string | symbol,
    { registryId?: string; cancellation: AbortController; settled: Promise<void> }
  >();
  const isAuthorizing = (registryId?: string): boolean =>
    Boolean(
      registryId &&
      [...activeAuthorizations.values()].some(active => active.registryId === registryId),
    );
  const cancel = (controller: AbortController) => {
    controller.abort(new Error('MCP authorization was cancelled'));
  };
  let closing = false;
  handleIpcContract(mcpContract, {
    list: () => {
      try {
        ensureBuiltInMcpDefaultsDisabled();
        const servers = deps.getMcpStore().listServers();
        return { success: true, servers };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to list MCP servers',
        };
      }
    },

    create: async (_event, data) => {
      try {
        const validationError = await validateMcpServerConfig(data as McpServerFormData);
        if (validationError) {
          return { success: false, error: validationError };
        }
        if (isAuthorizing(data.registryId))
          return { success: false, error: t('mcpIntegrationOperationBusy') };

        deps.getMcpStore().createServer(data as McpServerFormData);
        const servers = deps.getMcpStore().listServers();
        // Trigger async MCP bridge refresh (don't await — let UI show DB result immediately)
        refresh().catch(err => console.error('[McpBridge] background refresh error:', err));
        return { success: true, servers };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to create MCP server',
        };
      }
    },

    update: async (_event, id, data) => {
      try {
        const existing = deps.getMcpStore().getServer(id);
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
        if (isAuthorizing(existing.registryId) || isAuthorizing(data.registryId)) {
          return { success: false, error: t('mcpIntegrationOperationBusy') };
        }

        deps.getMcpStore().updateServer(id, data as Partial<McpServerFormData>);
        const servers = deps.getMcpStore().listServers();
        refresh().catch(err => console.error('[McpBridge] background refresh error:', err));
        return { success: true, servers };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to update MCP server',
        };
      }
    },

    testConnection: async (_event, data) => {
      try {
        const validationError = await validateMcpServerConfig(data as McpServerFormData);
        if (validationError) {
          return { success: false, error: validationError };
        }
        return await probeMcpConnection(data as McpServerFormData);
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to test MCP connection',
        };
      }
    },

    delete: async (_event, id) => {
      try {
        const store = deps.getMcpStore();
        const existing = store.getServer(id);
        if (!existing) {
          return { success: false, error: 'MCP server not found' };
        }
        const { registryId } = existing;
        if (isAuthorizing(registryId))
          return { success: false, error: t('mcpIntegrationOperationBusy') };
        const ownsRegistry = registryId && store.getRegistryOwner(registryId)?.id === id;
        if (ownsRegistry && registryId === FEISHU_MCP_REGISTRY_ID) {
          const uninstallStatus = await getMcpIntegrationRuntime().run(
            OfficialIntegrationId.Feishu,
            IntegrationOperation.Uninstall,
          );
          if (uninstallStatus.error) {
            return { success: false, error: uninstallStatus.error };
          }
        }
        store.deleteServer(id);
        const vault = new McpCredentialVault(deps.getStore());
        if (id !== registryId) vault.deleteValue(`${MCP_OAUTH_STORE_PREFIX}${id}`);
        if (ownsRegistry) vault.deleteValue(`${MCP_OAUTH_STORE_PREFIX}${registryId}`);
        const servers = store.listServers();
        const refreshResult = await refresh();
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
    },

    setEnabled: async (_event, options) => {
      try {
        if (options.enabled) {
          const existing = deps.getMcpStore().getServer(options.id);
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
          }
        }

        deps.getMcpStore().setEnabled(options.id, options.enabled);
        const servers = deps.getMcpStore().listServers();
        refresh().catch(err => console.error('[McpBridge] background refresh error:', err));
        return { success: true, servers };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to update MCP server',
        };
      }
    },

    fetchMarketplace: async () => {
      try {
        // The bundled registry is permissive (`Record<string, unknown>` rows);
        // the renderer projects known fields off each server object.
        const { catalog } = await getMarketplace();
        const data = catalog as z.infer<typeof mcpContract.fetchMarketplace.result>['data'];
        return { success: true, data };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to load bundled MCP marketplace',
        };
      }
    },

    loadIcon: async (_event, iconPath) => {
      try {
        const { icons } = await getMarketplace();
        const icon = icons.get(iconPath);
        if (!icon) return { success: false, error: 'MCP icon is not registered' };
        return 'data' in icon
          ? { success: true, data: icon.data }
          : { success: false, error: icon.error };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to load MCP icon',
        };
      }
    },

    exportConfig: async () => {
      try {
        const result = await dialog.showSaveDialog({
          title: 'Export MCP configuration',
          defaultPath: 'mcp.json',
          filters: [{ name: 'JSON', extensions: ['json'] }],
        });
        if (result.canceled || !result.filePath) return { success: true, cancelled: true };
        const document = exportMcpConfig(deps.getMcpStore().listServers());
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
    },

    importConfig: async () => {
      try {
        const result = await dialog.showOpenDialog({
          title: 'Import MCP configuration',
          properties: ['openFile'],
          filters: [{ name: 'JSON', extensions: ['json'] }],
        });
        if (result.canceled || result.filePaths.length === 0)
          return { success: true, cancelled: true };
        const input = JSON.parse(
          await fs.promises.readFile(result.filePaths[0], 'utf8'),
        ) as unknown;
        const servers = importMcpConfig(input);
        const existingNames = new Set(
          deps
            .getMcpStore()
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
        for (const server of servers) deps.getMcpStore().createServer(server);
        const refreshed = await refresh();
        return {
          success: !refreshed.error,
          servers: deps.getMcpStore().listServers(),
          error: refreshed.error,
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to import MCP configuration',
        };
      }
    },

    importConfigContent: async (_event, jsonContent) => {
      try {
        const input = JSON.parse(jsonContent) as unknown;
        const servers = importMcpConfig(input);
        const existingNames = new Set(
          deps
            .getMcpStore()
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
        for (const server of servers) deps.getMcpStore().createServer(server);
        const refreshed = await refresh();
        return {
          success: !refreshed.error,
          servers: deps.getMcpStore().listServers(),
          error: refreshed.error,
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to import MCP configuration',
        };
      }
    },

    cancelAuthorize: (_event, requestId) => {
      const active = activeAuthorizations.get(requestId);
      if (active) cancel(active.cancellation);
      return { success: true };
    },

    getFeishuCliStatus: () => ({
      success: true,
      installed: Boolean(getLocalFeishuCliCommand()),
    }),

    prepareFeishuCli: async () => {
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
    },

    authorize: async (_event, rawData) => {
      const { authorizationRequestId, ...data } = rawData;
      if (closing) return { success: false, error: t('mcpAuthorizationShuttingDown') };
      const key = authorizationRequestId || Symbol();
      if (activeAuthorizations.has(key) || isAuthorizing(data.registryId)) {
        return { success: false, error: t('mcpIntegrationOperationBusy') };
      }
      const cancellation = new AbortController();
      const settled = Promise.withResolvers<void>();
      activeAuthorizations.set(key, {
        registryId: data.registryId,
        cancellation,
        settled: settled.promise,
      });
      try {
        if (data.registryId === FEISHU_MCP_REGISTRY_ID) {
          const status = await getMcpIntegrationRuntime().run(
            OfficialIntegrationId.Feishu,
            IntegrationOperation.Authenticate,
            cancellation.signal,
          );
          cancellation.signal.throwIfAborted();
          if (status.error) throw new Error(status.error);
          const existingFeishu = deps.getMcpStore().getRegistryOwner(FEISHU_MCP_REGISTRY_ID);
          if (!existingFeishu) {
            deps.getMcpStore().createServer({
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
          const servers = deps.getMcpStore().listServers();
          const refreshResult = await refresh();
          if (refreshResult.error) {
            console.error('[McpBridge] Feishu refresh error:', refreshResult.error);
          }
          return { success: true, servers, refreshError: refreshResult.error };
        }
        const validationError = await validateMcpServerConfig(data as McpServerFormData);
        cancellation.signal.throwIfAborted();
        if (validationError) return { success: false, error: validationError };
        if (!data.registryId || !data.url)
          return { success: false, error: 'Official MCP configuration is incomplete' };

        const store = deps.getMcpStore();
        const existing = store.getRegistryOwner(data.registryId);
        if (existing && (existing.transportType === 'stdio' || existing.url !== data.url)) {
          return { success: false, error: t('mcpAuthorizationEndpointMismatch') };
        }
        if (!existing && store.listServers().some(server => server.name === data.name)) {
          return { success: false, error: t('mcpServerNameExists') };
        }
        const accessToken = await new McpOAuthManager(deps.getStore()).authorize(
          data.registryId,
          data.url,
          cancellation.signal,
        );
        cancellation.signal.throwIfAborted();
        if (!accessToken)
          return { success: false, error: 'OAuth authorization did not return an access token' };

        const current = store.getRegistryOwner(data.registryId);
        if (current?.id !== existing?.id) {
          return { success: false, error: t('mcpIntegrationOperationBusy') };
        }
        if (current && (current.transportType === 'stdio' || current.url !== data.url)) {
          return { success: false, error: t('mcpAuthorizationEndpointMismatch') };
        }
        const headers = Object.fromEntries(
          Object.entries((current ? current.headers : data.headers) ?? {}).filter(
            ([name]) => name.toLowerCase() !== 'authorization',
          ),
        );
        headers.Authorization = `Bearer ${accessToken}`;
        if (current) store.updateServer(current.id, { headers });
        else store.createServer({ ...data, isBuiltIn: true, headers });
        const servers = store.listServers();
        refresh().catch(err => console.error('[McpBridge] background refresh error:', err));
        return { success: true, servers };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to authorize MCP server',
        };
      } finally {
        activeAuthorizations.delete(key);
        settled.resolve();
      }
    },
  });
  return async () => {
    closing = true;
    marketplaceAbort.abort();
    const pending = [...activeAuthorizations.values()];
    for (const active of pending) cancel(active.cancellation);
    await Promise.all(pending.map(active => active.settled));
  };
};
