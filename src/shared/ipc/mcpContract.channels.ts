/**
 * Channel map for the MCP IPC contract, importable by the sandboxed preload.
 * Kept in a separate zod-free module because the preload bundle must not
 * require zod; the type argument locks the map to the contract's channels.
 */
import type { IpcContractChannels } from './contract';
import type { mcpContract } from './mcpContract';
import { McpIpc } from './channels';

export const mcpContractChannels: IpcContractChannels<typeof mcpContract> = {
  list: McpIpc.List,
  create: McpIpc.Create,
  update: McpIpc.Update,
  delete: McpIpc.Delete,
  setEnabled: McpIpc.SetEnabled,
  testConnection: McpIpc.TestConnection,
  fetchMarketplace: McpIpc.FetchMarketplace,
  refreshBridge: McpIpc.RefreshBridge,
  authorize: McpIpc.Authorize,
  cancelAuthorize: McpIpc.CancelAuthorize,
  getFeishuCliStatus: McpIpc.GetFeishuCliStatus,
  prepareFeishuCli: McpIpc.PrepareFeishuCli,
  loadIcon: McpIpc.LoadIcon,
  exportConfig: McpIpc.ExportConfig,
  importConfig: McpIpc.ImportConfig,
  importConfigContent: McpIpc.ImportConfigContent,
} as const;
