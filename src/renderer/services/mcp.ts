import { McpCategory, McpConnectionTestResult, McpMarketplaceCategoryInfo, McpMarketplaceServer,McpRegistryEntry, McpServerConfig, McpServerFormData } from '../types/mcp';

export function normalizeMcpErrorMessage(message: string): string {
  const trimmed = message.trim();
  if (!trimmed) {
    return 'Failed to start MCP server';
  }

  const lower = trimmed.toLowerCase();
  const hasHtmlResponse = lower.includes('<!doctype html') || lower.includes('<html');

  if (hasHtmlResponse && lower.includes('streamable http')) {
    return 'The target URL is not a valid Streamable HTTP MCP endpoint.';
  }

  if (hasHtmlResponse && lower.includes('sse')) {
    return 'The target URL is not a valid SSE MCP endpoint.';
  }

  if (hasHtmlResponse || lower.includes('error posting to endpoint')) {
    return 'The target URL is not a valid MCP endpoint.';
  }

  if (lower.includes('connection closed')) {
    return 'The MCP server closed the connection unexpectedly.';
  }

  return trimmed;
}

/**
 * Convert remote marketplace server data to McpRegistryEntry format.
 */
function convertMarketplaceToRegistry(
  servers: McpMarketplaceServer[],
): McpRegistryEntry[] {
  return servers.map((s) => ({
    id: s.id,
    name: s.name,
    descriptionKey: '',
    description_zh: s.description_zh,
    description_en: s.description_en,
    category: s.category as McpCategory,
    categoryKey: '',
    transportType: s.transportType as McpRegistryEntry['transportType'],
    command: s.command,
    defaultArgs: s.defaultArgs,
    requiredEnvKeys: s.requiredEnvKeys,
    optionalEnvKeys: s.optionalEnvKeys,
  }));
}

class McpService {
  private servers: McpServerConfig[] = [];
  private initialized = false;

  async init(): Promise<void> {
    if (this.initialized) return;
    await this.loadServers();
    this.initialized = true;
  }

  async loadServers(): Promise<McpServerConfig[]> {
    try {
      const result = await window.electron.mcp.list();
      if (result.success && result.servers) {
        this.servers = result.servers;
      } else {
        this.servers = [];
      }
      return this.servers;
    } catch (error) {
      console.error('Failed to load MCP servers:', error);
      this.servers = [];
      return this.servers;
    }
  }

  async createServer(data: McpServerFormData): Promise<{ success: boolean; servers?: McpServerConfig[]; error?: string }> {
    try {
      const result = await window.electron.mcp.create(data);
      if (result.success && result.servers) {
        this.servers = result.servers;
      }
      return result;
    } catch (error) {
      const rawMessage = error instanceof Error ? error.message : 'Failed to create MCP server';
      const message = normalizeMcpErrorMessage(rawMessage);
      console.error('Failed to create MCP server:', error);
      return { success: false, error: message };
    }
  }

  async updateServer(id: string, data: Partial<McpServerFormData>): Promise<{ success: boolean; servers?: McpServerConfig[]; error?: string }> {
    try {
      const result = await window.electron.mcp.update(id, data);
      if (result.success && result.servers) {
        this.servers = result.servers;
      }
      return result;
    } catch (error) {
      const rawMessage = error instanceof Error ? error.message : 'Failed to update MCP server';
      const message = normalizeMcpErrorMessage(rawMessage);
      console.error('Failed to update MCP server:', error);
      return { success: false, error: message };
    }
  }

  async deleteServer(id: string): Promise<{ success: boolean; servers?: McpServerConfig[]; error?: string }> {
    try {
      const result = await window.electron.mcp.delete(id);
      if (result.success && result.servers) {
        this.servers = result.servers;
      }
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to delete MCP server';
      console.error('Failed to delete MCP server:', error);
      return { success: false, error: message };
    }
  }

  async setServerEnabled(id: string, enabled: boolean): Promise<McpServerConfig[]> {
    try {
      const result = await window.electron.mcp.setEnabled({ id, enabled });
      if (result.success && result.servers) {
        this.servers = result.servers;
        return this.servers;
      }
      throw new Error(normalizeMcpErrorMessage(result.error || 'Failed to update MCP server'));
    } catch (error) {
      console.error('Failed to update MCP server:', error);
      throw error;
    }
  }

  getServers(): McpServerConfig[] {
    return this.servers;
  }

  getEnabledServers(): McpServerConfig[] {
    return this.servers.filter(s => s.enabled);
  }

  getServerById(id: string): McpServerConfig | undefined {
    return this.servers.find(s => s.id === id);
  }

  async testConnection(data: McpServerFormData): Promise<McpConnectionTestResult> {
    try {
      return await window.electron.mcp.testConnection(data);
    } catch (error) {
      const rawMessage = error instanceof Error ? error.message : 'Failed to test MCP connection';
      const message = normalizeMcpErrorMessage(rawMessage);
      console.error('Failed to test MCP connection:', error);
      return { success: false, error: message };
    }
  }

  async fetchMarketplace(): Promise<{
    registry: McpRegistryEntry[];
    categories: McpMarketplaceCategoryInfo[];
  } | null> {
    try {
      const result = await window.electron.mcp.fetchMarketplace();
      if (result.success && result.data) {
        const registry = convertMarketplaceToRegistry(result.data.servers);
        return { registry, categories: result.data.categories };
      }
      return null;
    } catch (error) {
      console.error('Failed to fetch MCP marketplace:', error);
      return null;
    }
  }

  /**
   * Refresh the MCP Bridge: restarts MCP servers, re-discovers tools,
   * syncs openclaw.json, and restarts the gateway.
   * Returns the number of tools discovered.
   */
  async refreshBridge(): Promise<{ success: boolean; tools: number; error?: string }> {
    try {
      return await window.electron.mcp.refreshBridge();
    } catch (error) {
      const rawMessage = error instanceof Error ? error.message : 'Failed to refresh MCP bridge';
      const message = normalizeMcpErrorMessage(rawMessage);
      console.error('Failed to refresh MCP bridge:', error);
      return { success: false, tools: 0, error: message };
    }
  }

  onBridgeSyncStart(callback: () => void): () => void {
    return window.electron.mcp.onBridgeSyncStart(callback);
  }

  onBridgeSyncDone(callback: (data: { tools: number; error?: string }) => void): () => void {
    return window.electron.mcp.onBridgeSyncDone(callback);
  }
}

export const mcpService = new McpService();
