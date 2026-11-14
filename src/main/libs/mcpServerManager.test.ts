import { expect, test, vi } from 'vitest';

import { McpServerManager } from './mcpServerManager';
import { createServer } from 'node:http';
import { buildDurableMcpTools } from './agentEngine/durableMcpTools';

const createRecord = (updatedAt = 1) => ({
  id: 'server-1',
  name: 'Stable MCP',
  description: 'A stable server',
  enabled: true,
  transportType: 'http' as const,
  url: 'https://example.com/mcp',
  isBuiltIn: false,
  createdAt: 1,
  updatedAt,
});

test('real MCP tool discovery preserves annotations through the Durable registration', async () => {
  const server = createServer(async (request, response) => {
    if (request.method !== 'POST') {
      response.writeHead(204).end();
      return;
    }
    let text = '';
    for await (const chunk of request) text += chunk.toString();
    const message = JSON.parse(text);
    if (message.id === undefined) {
      response.writeHead(204).end();
      return;
    }
    response.writeHead(200, { 'content-type': 'application/json' });
    const result =
      message.method === 'initialize'
        ? {
            protocolVersion: '2025-06-18',
            capabilities: { tools: {} },
            serverInfo: { name: 'fixture', version: '1' },
          }
        : {
            tools: [
              {
                name: 'peek',
                description: 'Read an item.',
                inputSchema: { type: 'object', properties: {} },
                annotations: { readOnlyHint: true, idempotentHint: true },
              },
            ],
          };
    response.end(JSON.stringify({ jsonrpc: '2.0', id: message.id, result }));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing fixture port');
  const manager = new McpServerManager();
  try {
    const tools = await manager.startServers([
      { ...createRecord(), url: `http://127.0.0.1:${address.port}/mcp` },
    ]);
    expect(tools).toHaveLength(1);
    expect(tools[0].annotations).toEqual({ readOnlyHint: true, idempotentHint: true });
    const native = buildDurableMcpTools(manager);
    expect(native.annotations.get('mcp__Stable MCP__peek')).toEqual({
      readOnlyHint: true,
      idempotentHint: true,
    });
    expect(native.tools).toHaveLength(1);
  } finally {
    await manager.stopServers();
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close(error => (error ? reject(error) : resolve())),
    );
  }
});

const getManagerInternals = (manager: McpServerManager) =>
  manager as unknown as {
    servers: Map<
      string,
      {
        record: ReturnType<typeof createRecord>;
        client: { close: () => Promise<void> };
        tools: Array<{
          server: string;
          name: string;
          description: string;
          inputSchema: Record<string, unknown>;
        }>;
        recentStderr: string[];
      }
    >;
    _serverStatuses: Array<{ name: string; connected: boolean; toolCount: number; error?: string }>;
    startSingleServer: ReturnType<typeof vi.fn>;
  };

test('retains diagnostics for configured servers that fail before tool discovery', async () => {
  const manager = new McpServerManager();

  const tools = await manager.startServers([
    {
      name: 'Broken MCP',
      transportType: 'http',
      url: 'not-a-valid-url',
    },
  ] as never);

  expect(tools).toEqual([]);
  expect(manager.serverStatuses).toEqual([
    {
      name: 'Broken MCP',
      connected: false,
      toolCount: 0,
      error: expect.stringContaining('Invalid URL'),
    },
  ]);

  await manager.stopServers();
  expect(manager.serverStatuses).toEqual([]);
});

test('preserves an unchanged MCP connection during reconciliation', async () => {
  const manager = new McpServerManager();
  const internals = getManagerInternals(manager);
  const record = createRecord();
  const close = vi.fn(async () => {});
  internals.servers.set(record.name, {
    record,
    client: { close },
    tools: [
      {
        server: record.name,
        name: 'list_items',
        description: 'List items',
        inputSchema: { type: 'object' },
      },
    ],
    recentStderr: [],
  });
  internals._serverStatuses = [{ name: record.name, connected: true, toolCount: 1 }];
  internals.startSingleServer = vi.fn();

  const tools = await manager.reconcileServers([record] as never);

  expect(close).not.toHaveBeenCalled();
  expect(internals.startSingleServer).not.toHaveBeenCalled();
  expect(tools.map(tool => tool.name)).toEqual(['list_items']);
});

test('restarts only the MCP connection whose configuration changed', async () => {
  const manager = new McpServerManager();
  const internals = getManagerInternals(manager);
  const activeRecord = createRecord();
  const close = vi.fn(async () => {});
  internals.servers.set(activeRecord.name, {
    record: activeRecord,
    client: { close },
    tools: [],
    recentStderr: [],
  });
  internals._serverStatuses = [{ name: activeRecord.name, connected: true, toolCount: 0 }];
  internals.startSingleServer = vi.fn(async record => ({
    record,
    client: { close: vi.fn(async () => {}) },
    transport: {},
    tools: [],
    recentStderr: [],
  }));

  await manager.reconcileServers([createRecord(2)] as never);

  expect(close).toHaveBeenCalledOnce();
  expect(internals.startSingleServer).toHaveBeenCalledOnce();
});
