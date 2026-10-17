/**
 * Constants and pure helpers shared by the McpManager modules.
 *
 * Extracted verbatim from McpManager.tsx (issue #1069); behavior must stay
 * identical to the inline originals.
 */
import gitlabIcon from '../../../assets/mcp-icons/gitlab.webp';
import tavilyIcon from '../../../assets/mcp-icons/tavily.webp';
import type { McpRegistryEntry, McpServerConfig } from '../../../types/mcp';
import { McpTab, MCP_PAGE_SIZE, type McpTab as McpTabType } from '../constants';

export const TRANSPORT_BADGE_CLASS_NAME = 'bg-muted text-muted-foreground';

export const MCP_ICON_BY_ID: Record<string, string> = {
  tavily: tavilyIcon,
  gitlab: gitlabIcon,
};

export const FEISHU_MCP_REGISTRY_ID = 'feishu';
export const GITHUB_MCP_REGISTRY_ID = 'github';
export const BAIDU_NETDISK_MCP_REGISTRY_ID = 'baidu-netdisk';
export const OFFICIAL_MCP_CONNECT_TIMEOUT_MS = 60_000;
export const OFFICIAL_MCP_DIALOG_CLOSE_DELAY_MS = 2_500;

export const getStdioCommandSummary = (command?: string, args?: string[]): string => {
  if (!command) return '';
  if (!args || args.length === 0) return command;
  return `${command} ${args[args.length - 1]}`;
};

export const getTransportSummary = (server: McpServerConfig): string => {
  if (server.transportType === 'stdio') {
    const parts = [server.command || ''];
    if (server.args && server.args.length > 0) {
      parts.push(server.args[0]);
      if (server.args.length > 1) parts.push('...');
    }
    return parts.join(' ');
  }
  return server.url || '';
};

/** Per-registry icon sizing quirk: supabase fills the tile, feishu/jinshuju shrink. */
export const getRegistryIconImageClassName = (registryId?: string): string | undefined => {
  if (registryId === 'supabase') return 'size-full';
  if (registryId === 'feishu' || registryId === 'jinshuju') return 'size-11';
  return undefined;
};

interface McpPaginationInput {
  activeTab: McpTabType;
  filteredInstalled: McpServerConfig[];
  filteredMarketplace: McpRegistryEntry[];
  filteredCustom: McpServerConfig[];
  currentPage: number;
}

interface McpPaginationResult {
  totalPages: number;
  paginatedInstalled: McpServerConfig[];
  paginatedMarketplace: McpRegistryEntry[];
  paginatedCustom: McpServerConfig[];
}

/**
 * Page math for the three manager tabs. The custom tab reserves the first
 * grid cell of page 1 for the import/export/create toolbar row, so it shows
 * one fewer server there and starts page 2+ one slot earlier.
 */
export function computeMcpPagination({
  activeTab,
  filteredInstalled,
  filteredMarketplace,
  filteredCustom,
  currentPage,
}: McpPaginationInput): McpPaginationResult {
  const customPageItemCount = filteredCustom.length > 0 ? filteredCustom.length + 1 : 0;
  const activeItemCount =
    activeTab === McpTab.Installed
      ? filteredInstalled.length
      : activeTab === McpTab.Marketplace
        ? filteredMarketplace.length
        : customPageItemCount;
  const totalPages = Math.max(1, Math.ceil(activeItemCount / MCP_PAGE_SIZE));
  const pageStart = (currentPage - 1) * MCP_PAGE_SIZE;
  const paginatedInstalled = filteredInstalled.slice(pageStart, pageStart + MCP_PAGE_SIZE);
  const paginatedMarketplace = filteredMarketplace.slice(pageStart, pageStart + MCP_PAGE_SIZE);
  const customPageStart = currentPage === 1 ? 0 : pageStart - 1;
  const paginatedCustom = filteredCustom.slice(
    customPageStart,
    customPageStart + (currentPage === 1 ? MCP_PAGE_SIZE - 1 : MCP_PAGE_SIZE),
  );
  return { totalPages, paginatedInstalled, paginatedMarketplace, paginatedCustom };
}
