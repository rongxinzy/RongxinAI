import { expect, test } from 'vitest';

import { McpServerManager } from './mcpServerManager';

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
