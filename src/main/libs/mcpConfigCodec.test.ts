import { expect, test } from 'vitest';

import { exportMcpConfig, importMcpConfig } from './mcpConfigCodec';

test('exports portable MCP config without credentials', () => {
  const document = exportMcpConfig([
    {
      id: 'server-1',
      name: 'Secure server',
      description: 'Example server',
      enabled: true,
      transportType: 'http',
      url: 'https://example.com/mcp',
      headers: { Authorization: 'Bearer secret-token' },
      isBuiltIn: false,
      createdAt: 1,
      updatedAt: 1,
    },
  ]);

  expect(JSON.stringify(document)).not.toContain('secret-token');
  expect(document).toEqual({
    mcpServers: {
      'Secure server': {
        description: 'Example server',
        url: 'https://example.com/mcp',
        transport: 'http',
      },
    },
  });
});

test('imports standard stdio and remote MCP configuration', () => {
  const servers = importMcpConfig({
    mcpServers: {
      filesystem: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem'] },
      remote: { url: 'https://example.com/mcp', transport: 'sse' },
    },
  });

  expect(servers).toEqual([
    {
      name: 'filesystem',
      description: '',
      transportType: 'stdio',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-filesystem'],
    },
    {
      name: 'remote',
      description: '',
      transportType: 'sse',
      url: 'https://example.com/mcp',
    },
  ]);
});

test('rejects malformed MCP configuration', () => {
  expect(() => importMcpConfig({ mcpServers: { invalid: {} } })).toThrow('command or url');
});
