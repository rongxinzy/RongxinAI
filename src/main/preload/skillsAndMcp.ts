import { ipcRenderer } from 'electron';

import { McpIpc, SkillsIpc } from '../../shared/ipc/channels';
import { MarketplaceIpcChannel } from '../../shared/marketplace/constants';
import type { MarketplaceSearchRequest } from '../../shared/marketplace/types';
import { onPush, onPushVoid } from './pushChannel';

// Skills, MCP servers, and the shared marketplace bridge.
export const skillsAndMcpApi = {
  skills: {
    list: () => ipcRenderer.invoke(SkillsIpc.List),
    setEnabled: (options: { id: string; enabled: boolean }) =>
      ipcRenderer.invoke(SkillsIpc.SetEnabled, options),
    setEnabledBatch: (options: { ids: string[]; enabled: boolean }) =>
      ipcRenderer.invoke(SkillsIpc.SetEnabledBatch, options),
    setPinned: (options: { id: string; pinned: boolean }) =>
      ipcRenderer.invoke(SkillsIpc.SetPinned, options),
    delete: (id: string) => ipcRenderer.invoke(SkillsIpc.Delete, id),
    download: (source: string, options?: { iconUrl?: string; displayName?: string }) =>
      ipcRenderer.invoke(SkillsIpc.Download, source, options),
    confirmInstall: (pendingId: string, action: string) =>
      ipcRenderer.invoke(SkillsIpc.ConfirmInstall, pendingId, action),
    getRoot: () => ipcRenderer.invoke(SkillsIpc.GetRoot),
    getContent: (skillId: string) => ipcRenderer.invoke(SkillsIpc.GetContent, skillId),
    autoRoutingPrompt: () => ipcRenderer.invoke(SkillsIpc.AutoRoutingPrompt),
    getConfig: (skillId: string) => ipcRenderer.invoke(SkillsIpc.GetConfig, skillId),
    setConfig: (skillId: string, config: Record<string, string>) =>
      ipcRenderer.invoke(SkillsIpc.SetConfig, skillId, config),
    testEmailConnectivity: (skillId: string, config: Record<string, string>) =>
      ipcRenderer.invoke(SkillsIpc.TestEmailConnectivity, skillId, config),
    fetchMarketplace: (options?: { pageNumber?: number; pageSize?: number }) =>
      ipcRenderer.invoke(SkillsIpc.FetchMarketplace, options),
    fetchMarketplaceContent: (skillId: string) =>
      ipcRenderer.invoke(SkillsIpc.FetchMarketplaceContent, skillId),
    onChanged: (callback: () => void) => onPushVoid(SkillsIpc.Changed, callback),
  },

  mcp: {
    list: () => ipcRenderer.invoke(McpIpc.List),
    create: (data: unknown) => ipcRenderer.invoke(McpIpc.Create, data),
    update: (id: string, data: unknown) => ipcRenderer.invoke(McpIpc.Update, id, data),
    delete: (id: string) => ipcRenderer.invoke(McpIpc.Delete, id),
    setEnabled: (options: { id: string; enabled: boolean }) =>
      ipcRenderer.invoke(McpIpc.SetEnabled, options),
    testConnection: (data: unknown) => ipcRenderer.invoke(McpIpc.TestConnection, data),
    fetchMarketplace: () => ipcRenderer.invoke(McpIpc.FetchMarketplace),
    refreshBridge: () => ipcRenderer.invoke(McpIpc.RefreshBridge),
    authorize: (data: unknown) => ipcRenderer.invoke(McpIpc.Authorize, data),
    cancelAuthorize: (requestId: string) => ipcRenderer.invoke(McpIpc.CancelAuthorize, requestId),
    getFeishuCliStatus: () => ipcRenderer.invoke(McpIpc.GetFeishuCliStatus),
    prepareFeishuCli: () => ipcRenderer.invoke(McpIpc.PrepareFeishuCli),
    loadIcon: (iconPath: string) => ipcRenderer.invoke(McpIpc.LoadIcon, iconPath),
    exportConfig: () => ipcRenderer.invoke(McpIpc.ExportConfig),
    importConfig: () => ipcRenderer.invoke(McpIpc.ImportConfig),
    onBridgeSyncStart: (callback: () => void) => onPushVoid(McpIpc.BridgeSyncStart, callback),
    onBridgeSyncDone: (callback: (data: { tools: number; error?: string }) => void) =>
      onPush(McpIpc.BridgeSyncDone, callback),
  },

  marketplace: {
    search: (request: MarketplaceSearchRequest) =>
      ipcRenderer.invoke(MarketplaceIpcChannel.Search, request),
    cancelSearch: (requestId: string) =>
      ipcRenderer.invoke(MarketplaceIpcChannel.CancelSearch, requestId),
  },
};
