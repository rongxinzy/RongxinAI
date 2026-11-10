import { describe, expect, it, vi } from 'vitest';

import type { McpServerManager } from '../mcpServerManager';
import { PiMcpTool } from './piMcpCapabilityPrompt';
import { McpPiAdapter } from './mcpPiAdapter';

interface GatewayTool {
  name: string;
  execute: (
    toolCallId: string,
    params: Record<string, unknown>,
  ) => Promise<{ content: Array<{ type: string; text?: string }>; details: { isError?: boolean } }>;
}

const createManager = (): McpServerManager =>
  ({
    toolManifest: [
      {
        server: 'files',
        name: 'read_file',
        description: 'Read a file from the workspace',
        inputSchema: { type: 'object', properties: { path: { type: 'string' } } },
      },
      {
        server: 'archive',
        name: 'read_file',
        description: 'Read a file from the archive',
        inputSchema: { type: 'object' },
      },
      {
        server: 'calendar',
        name: 'list_events',
        description: 'List calendar events',
        inputSchema: { type: 'object' },
      },
    ],
    serverStatuses: [
      { name: 'files', connected: true, toolCount: 1 },
      { name: 'archive', connected: false, toolCount: 0, error: 'Authentication required' },
    ],
    callTool: vi.fn(async () => ({ content: [{ type: 'text', text: 'ok' }], isError: false })),
  }) as unknown as McpServerManager;

const getGateway = (manager: McpServerManager): GatewayTool => {
  const tool = new McpPiAdapter(manager).buildGatewayTool();
  if (!tool) throw new Error('Expected MCP gateway tool');
  return tool as unknown as GatewayTool;
};

describe('McpPiAdapter', () => {
  it('does not register a gateway when there are no managed servers', () => {
    const manager = {
      toolManifest: [],
      serverStatuses: [],
    } as unknown as McpServerManager;

    expect(new McpPiAdapter(manager).buildGatewayTool()).toBeNull();
  });

  it('searches the discovered tool catalog', async () => {
    const tool = getGateway(createManager());

    expect(tool.name).toBe(PiMcpTool.Name);
    const result = await tool.execute('search', { search: 'calendar' });

    expect(result.content[0].text).toContain('[calendar] list_events');
  });

  it('requires a server when a tool name is ambiguous', async () => {
    const manager = createManager();
    const tool = getGateway(manager);

    const result = await tool.execute('ambiguous', { tool: 'read_file' });

    expect(result.content[0].text).toContain('exists on multiple servers: files, archive');
    expect(manager.callTool).not.toHaveBeenCalled();
  });

  it('validates JSON arguments before calling the server', async () => {
    const manager = createManager();
    const tool = getGateway(manager);

    const result = await tool.execute('invalid-json', {
      tool: 'list_events',
      args: '["not-an-object"]',
    });

    expect(result.content[0].text).toContain('args must be a JSON object');
    expect(manager.callTool).not.toHaveBeenCalled();
  });

  it('routes a uniquely named tool to its server', async () => {
    const manager = createManager();
    const tool = getGateway(manager);

    const result = await tool.execute('call', {
      tool: 'list_events',
      args: '{"limit":5}',
    });

    expect(manager.callTool).toHaveBeenCalledWith('calendar', 'list_events', { limit: 5 });
    expect(result.content[0].text).toBe('ok');
  });

  it('reports runtime connection state without requiring a discovered tool', async () => {
    const tool = getGateway(createManager());

    const result = await tool.execute('status', {});

    expect(result.content[0].text).toContain('files: connected, 1 tool(s)');
    expect(result.content[0].text).toContain('archive: unavailable, 0 tool(s)');
    expect(result.content[0].text).toContain('Authentication required');
  });

  it('truncates oversized tool output to MCP_MAX_OUTPUT_CHARS', async () => {
    const manager = createManager();
    const oversized = 'x'.repeat(70_000);
    vi.mocked(manager.callTool).mockResolvedValueOnce({
      content: [{ type: 'text', text: oversized }],
      isError: false,
    });
    const tool = getGateway(manager);

    const result = await tool.execute('call', { tool: 'list_events' });

    expect((result.details as { truncated?: boolean }).truncated).toBe(true);
    expect(result.content[0].text).toContain(
      '[MCP tool output truncated to 30,000 characters (total: 70,000 characters)]',
    );
  });

  it('safely truncates without leaving dangling high surrogates at boundary', async () => {
    const manager = createManager();
    // 29,999 'a's followed by '🚀' (2 code units) -> total 30,001 chars
    const boundarySurrogate = 'a'.repeat(29_999) + '🚀extra';
    vi.mocked(manager.callTool).mockResolvedValueOnce({
      content: [{ type: 'text', text: boundarySurrogate }],
      isError: false,
    });
    const tool = getGateway(manager);

    const result = await tool.execute('call', { tool: 'list_events' });
    expect((result.details as { truncated?: boolean }).truncated).toBe(true);
    // Boundary cut should drop the high surrogate, so prefix is 29,999 'a's
    expect(result.content[0].text.startsWith('a'.repeat(29_999))).toBe(true);
    expect(result.content[0].text).toContain(
      `[MCP tool output truncated to 30,000 characters (total: ${boundarySurrogate.length.toLocaleString()} characters)]`,
    );
  });
});
