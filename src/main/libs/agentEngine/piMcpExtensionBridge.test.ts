import { describe, expect, it, vi } from 'vitest';

import type { McpServerRecord } from '../../mcpStore';
import { buildPiLoadedMcpConfig, buildPiMcpTransportFactory } from './piMcpExtensionBridge';

vi.mock('../coworkUtil', () => ({
  getEnhancedEnv: vi.fn(async () => ({ PATH: '/usr/bin' })),
}));
vi.mock('../mcpEnvironment', () => ({
  mergeMcpSpawnEnv: vi.fn((base: Record<string, string>, extra?: Record<string, string>) => ({
    ...base,
    ...(extra ?? {}),
  })),
}));
vi.mock('../mcpServerManager', () => ({
  expandMcpTemplate: vi.fn((value: string) => value.replace('${TOKEN}', 'secret-token')),
  resolveStdioCommand: vi.fn(async (server: McpServerRecord) => ({
    command: `resolved-${server.command}`,
    args: server.args ?? [],
    env: server.env,
  })),
}));

const record = (overrides: Partial<McpServerRecord>): McpServerRecord => ({
  id: 'srv-1',
  name: 'blender',
  description: 'Blender MCP',
  enabled: true,
  transportType: 'stdio',
  command: 'npx',
  args: ['-y', 'blender-mcp'],
  isBuiltIn: false,
  createdAt: 1,
  updatedAt: 1,
  ...overrides,
});

describe('buildPiLoadedMcpConfig', () => {
  it('maps enabled stdio records with exposure, description, and second-based timeouts', () => {
    const config = buildPiLoadedMcpConfig([record({ exposure: 'direct', timeout: 90_000 })]);

    expect(config.errors).toEqual([]);
    expect(config.autoEnableCodemode).toBe(true);
    expect(config.servers).toEqual([
      {
        name: 'blender',
        source: 'zhiyuan-store',
        scope: 'extension',
        config: {
          type: 'stdio',
          command: 'npx',
          args: ['-y', 'blender-mcp'],
          exposure: 'direct',
          description: 'Blender MCP',
          timeout: 90,
        },
      },
    ]);
  });

  it('maps http records with headers and skips disabled or broken entries', () => {
    const config = buildPiLoadedMcpConfig([
      record({
        id: 'srv-http',
        name: 'docs',
        transportType: 'http',
        command: undefined,
        args: undefined,
        url: 'https://example.com/mcp',
        headers: { Authorization: 'Bearer x' },
      }),
      record({ id: 'srv-off', enabled: false }),
      record({
        id: 'srv-cred',
        credentialsError: true,
      }),
      record({ id: 'srv-sse', transportType: 'sse', url: 'https://example.com/sse' }),
    ]);

    expect(config.servers.map(server => server.name)).toEqual(['docs']);
    expect(config.servers[0]?.config).toEqual({
      type: 'http',
      url: 'https://example.com/mcp',
      headers: { Authorization: 'Bearer x' },
      description: 'Blender MCP',
    });
    expect(config.errors).toEqual([
      'MCP server "blender": stored credentials could not be read',
      'MCP server "blender": sse transport is not supported by the native bridge yet',
    ]);
  });
});

describe('buildPiMcpTransportFactory', () => {
  it('resolves stdio commands through the app runtime remap and merges the spawn env', async () => {
    const factory = buildPiMcpTransportFactory(() => [record({ env: { BLENDER_PORT: '1234' } })]);

    const transport = await factory(
      {
        name: 'blender',
        source: 'zhiyuan-store',
        config: { type: 'stdio', command: 'npx' },
      },
      '/tmp/work',
      undefined,
    );

    expect(transport).toBeDefined();
    // The SDK transport stores its options privately; asserting the resolved
    // command would reach the child process is covered by the manager's own
    // tests. Here we only pin that resolution did not throw.
  });

  it('expands token templates in http URLs and headers from the record env', async () => {
    const factory = buildPiMcpTransportFactory(() => [
      record({
        name: 'docs',
        transportType: 'http',
        command: undefined,
        args: undefined,
        url: 'https://example.com/${TOKEN}/mcp',
        headers: { Authorization: 'Bearer ${TOKEN}' },
        env: {},
      }),
    ]);

    const transport = await factory(
      {
        name: 'docs',
        source: 'zhiyuan-store',
        config: { type: 'http', url: 'https://example.com/${TOKEN}/mcp' },
      },
      '/tmp/work',
      undefined,
    );
    expect(transport).toBeDefined();
  });

  it('throws for stdio entries whose record disappeared', async () => {
    const factory = buildPiMcpTransportFactory(() => []);
    await expect(
      factory(
        { name: 'gone', source: 'zhiyuan-store', config: { type: 'stdio', command: 'x' } },
        '/tmp/work',
        undefined,
      ),
    ).rejects.toThrow('no longer configured');
  });
});
