import type { McpServerManager, McpToolManifestEntry } from '../mcpServerManager';
import { PiMcpTool } from './piMcpCapabilityPrompt';

interface PiToolResult {
  content: Array<{ type: string; text?: string }>;
  details: { isError?: boolean };
}

type PiCustomTool = Record<string, unknown>;

/**
 * The only MCP-to-Pi bridge for user-configured MCP servers. Connection,
 * credentials, installation and OAuth remain owned by the Electron main process.
 */
export class McpPiAdapter {
  constructor(private readonly serverManager: McpServerManager) {}

  buildGatewayTool(): PiCustomTool | null {
    if (
      this.serverManager.toolManifest.length === 0 &&
      this.serverManager.serverStatuses.length === 0
    ) {
      return null;
    }

    return {
      name: PiMcpTool.Name,
      label: PiMcpTool.Label,
      description:
        'MCP gateway — call MCP tools, search, or describe. ' +
        'Use {tool, args} to invoke. Use {search} to find tools by name/description. ' +
        'Use {describe} for parameter schemas. Use {server} to list tools on a server. ' +
        'Use {} for status overview.',
      promptSnippet: 'MCP gateway — call MCP tools (use search to discover, tool+args to invoke)',
      parameters: {
        type: 'object',
        properties: {
          tool: { type: 'string', description: 'Tool name to call (e.g. "read_file")' },
          args: {
            type: 'string',
            description: 'Arguments as JSON string (e.g. {"path":"/tmp/x"})',
          },
          server: {
            type: 'string',
            description: 'Filter to a specific server, or disambiguate tool calls',
          },
          search: {
            type: 'string',
            description: 'Search tools by name or description (substring match)',
          },
          describe: {
            type: 'string',
            description: 'Tool name to describe — returns parameter schema',
          },
        },
        additionalProperties: false,
      },
      execute: async (
        _toolCallId: string,
        params: Record<string, unknown>,
      ): Promise<PiToolResult> => {
        try {
          const manifest = this.serverManager.toolManifest;
          const tool = typeof params.tool === 'string' ? params.tool : undefined;
          const argsText = typeof params.args === 'string' ? params.args : undefined;
          const server = typeof params.server === 'string' ? params.server : undefined;
          const search = typeof params.search === 'string' ? params.search : undefined;
          const describe = typeof params.describe === 'string' ? params.describe : undefined;
          if (tool) return this.callTool(manifest, tool, argsText, server);
          if (search) return this.searchTools(manifest, search);
          if (describe) return this.describeTool(manifest, describe);
          if (server) return this.listServerTools(manifest, server);
          return this.status();
        } catch (error) {
          return this.textResult(
            `MCP error: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      },
    };
  }

  private async callTool(
    manifest: McpToolManifestEntry[],
    tool: string,
    argsText: string | undefined,
    requestedServer: string | undefined,
  ): Promise<PiToolResult> {
    let args: Record<string, unknown> = {};
    if (argsText) {
      try {
        const parsed: unknown = JSON.parse(argsText);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          return this.textResult('args must be a JSON object, e.g. {"key":"value"}');
        }
        args = parsed as Record<string, unknown>;
      } catch {
        return this.textResult(`Invalid args JSON: ${argsText}`);
      }
    }
    let server = requestedServer;
    if (!server) {
      const candidates = manifest.filter(entry => entry.name === tool);
      if (candidates.length === 0)
        return this.textResult(
          `Tool "${tool}" not found. Use mcp({ search: "..." }) to discover tools.`,
        );
      if (candidates.length > 1)
        return this.textResult(
          `Tool "${tool}" exists on multiple servers: ${candidates.map(candidate => candidate.server).join(', ')}. Use {server} to disambiguate.`,
        );
      server = candidates[0].server;
    }
    const result = await this.serverManager.callTool(server, tool, args);
    return { content: result.content, details: { isError: result.isError } };
  }

  private searchTools(manifest: McpToolManifestEntry[], search: string): PiToolResult {
    const query = search.toLowerCase();
    const matches = manifest.filter(
      tool =>
        tool.name.toLowerCase().includes(query) || tool.description.toLowerCase().includes(query),
    );
    if (matches.length === 0) return this.textResult(`No tools matching "${search}".`);
    const visibleMatches = matches.slice(0, 30);
    const suffix =
      matches.length > visibleMatches.length
        ? `\n... and ${matches.length - visibleMatches.length} more`
        : '';
    return this.textResult(
      visibleMatches.map(tool => `[${tool.server}] ${tool.name}: ${tool.description}`).join('\n') +
        suffix,
    );
  }

  private describeTool(manifest: McpToolManifestEntry[], name: string): PiToolResult {
    const tool = manifest.find(entry => entry.name === name);
    if (!tool) return this.textResult(`Tool "${name}" not found.`);
    return this.textResult(
      `[${tool.server}] ${tool.name}\n${tool.description}\nParameters: ${JSON.stringify(tool.inputSchema, null, 2)}`,
    );
  }

  private listServerTools(manifest: McpToolManifestEntry[], server: string): PiToolResult {
    const tools = manifest.filter(tool => tool.server === server);
    if (tools.length === 0) return this.textResult(`Server "${server}" not found or has no tools.`);
    return this.textResult(
      `${server} (${tools.length} tools):\n${tools.map(tool => `  ${tool.name}: ${tool.description}`).join('\n')}`,
    );
  }

  private status(): PiToolResult {
    const manifest = this.serverManager.toolManifest;
    const statuses = this.serverManager.serverStatuses;
    const connectedCount = statuses.filter(status => status.connected).length;
    const summary = `MCP — ${statuses.length} configured server(s), ${connectedCount} connected, ${manifest.length} tool(s)`;
    if (statuses.length === 0) return this.textResult(summary);
    return this.textResult(
      [
        summary,
        ...statuses.map(
          status =>
            `  ${status.name}: ${status.connected ? 'connected' : 'unavailable'}, ${status.toolCount} tool(s)${status.error ? ` — ${status.error}` : ''}`,
        ),
      ].join('\n'),
    );
  }

  private textResult(text: string): PiToolResult {
    return { content: [{ type: 'text', text }], details: {} };
  }
}
