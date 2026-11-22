import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { expect, test, vi } from 'vitest';

import { McpServerManager } from './mcpServerManager';
import * as coworkUtil from './coworkUtil';

vi.mock('electron', async importOriginal => {
  const electron = await importOriginal<typeof import('electron')>();
  return { ...electron, app: { ...electron.app, getAppPath: () => '/unused' } };
});

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

test('quit while resolving the stdio environment prevents MCP transport startup', async () => {
  const manager = new McpServerManager();
  const environment = Promise.withResolvers<Record<string, string>>();
  const resolving = Promise.withResolvers<void>();
  const enhancedEnv = vi.spyOn(coworkUtil, 'getEnhancedEnv').mockImplementationOnce(() => {
    resolving.resolve();
    return environment.promise;
  });
  const spawn = vi.spyOn(StdioClientTransport.prototype, 'start');
  const shutdown = new AbortController();
  try {
    const discovering = manager.reconcileServers(
      [
        {
          ...createRecord(),
          transportType: 'stdio',
          command: process.execPath,
          args: ['-e', 'process.exit(0)'],
        },
      ],
      shutdown.signal,
    );
    await Promise.race([
      resolving.promise,
      discovering.then(() => {
        throw new Error('Discovery finished before resolving the stdio environment');
      }),
    ]);
    shutdown.abort(new Error('quitting'));
    environment.resolve({});

    await expect(discovering).rejects.toThrow('quitting');
    expect(spawn).not.toHaveBeenCalled();
  } finally {
    environment.resolve({});
    await manager.stopServers();
    enhancedEnv.mockRestore();
    spawn.mockRestore();
  }
});

test('quit closes a transport that is still discovering tools', async () => {
  const manager = new McpServerManager();
  const tools = Promise.withResolvers<{ tools: [] }>();
  const requesting = Promise.withResolvers<void>();
  const connect = vi.spyOn(Client.prototype, 'connect').mockResolvedValue();
  const listTools = vi.spyOn(Client.prototype, 'listTools').mockImplementationOnce(() => {
    requesting.resolve();
    return tools.promise;
  });
  const close = vi.spyOn(StreamableHTTPClientTransport.prototype, 'close').mockResolvedValue();
  const shutdown = new AbortController();
  const discovering = manager.reconcileServers([createRecord()], shutdown.signal);
  const outcome = discovering.catch((error: unknown) => error);
  try {
    await requesting.promise;
    shutdown.abort(new Error('quitting'));

    await expect.poll(() => close.mock.calls.length).toBe(1);
    expect(await outcome).toEqual(new Error('quitting'));
    expect(manager.toolManifest).toEqual([]);
  } finally {
    tools.resolve({ tools: [] });
    await outcome;
    await manager.stopServers();
    connect.mockRestore();
    listTools.mockRestore();
    close.mockRestore();
  }
});
