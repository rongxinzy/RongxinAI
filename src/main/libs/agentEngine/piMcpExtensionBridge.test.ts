import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { McpServerRecord } from '../../mcpStore';
import { buildPiLoadedMcpConfig, buildPiMcpTransportFactory } from './piMcpExtensionBridge';

const sdkMocks = vi.hoisted(() => ({
  instances: [] as Array<{
    kind: 'stdio' | 'http' | 'sse';
    args: unknown[];
    start: ReturnType<typeof vi.fn>;
    send: ReturnType<typeof vi.fn>;
    close: ReturnType<typeof vi.fn>;
    onmessage?: (message: unknown) => void;
    onerror?: (error: Error) => void;
    onclose?: () => void;
    setProtocolVersion?: ReturnType<typeof vi.fn>;
  }>,
}));

vi.mock('@modelcontextprotocol/sdk/client/stdio.js', () => ({
  StdioClientTransport: class MockStdio {
    onmessage?: (message: unknown) => void;
    onerror?: (error: Error) => void;
    onclose?: () => void;
    start = vi.fn(async () => {});
    send = vi.fn(async () => {});
    close = vi.fn(async () => {});
    setProtocolVersion = vi.fn();
    constructor(...args: unknown[]) {
      sdkMocks.instances.push({
        kind: 'stdio',
        args,
        start: this.start,
        send: this.send,
        close: this.close,
        setProtocolVersion: this.setProtocolVersion,
        set onmessage(fn) {
          this._onmessage = fn;
        },
        get onmessage() {
          return this._onmessage;
        },
      } as never);
      sdkMocks.instances[sdkMocks.instances.length - 1] = this as never;
      (this as { kind?: string; args?: unknown[] }).kind = 'stdio';
      (this as { args?: unknown[] }).args = args;
    }
  },
}));

vi.mock('@modelcontextprotocol/sdk/client/streamableHttp.js', () => ({
  StreamableHTTPClientTransport: class MockHttp {
    kind = 'http' as const;
    args: unknown[];
    onmessage?: (message: unknown) => void;
    onerror?: (error: Error) => void;
    onclose?: () => void;
    start = vi.fn(async () => {});
    send = vi.fn(async () => {});
    close = vi.fn(async () => {});
    setProtocolVersion = vi.fn();
    constructor(...args: unknown[]) {
      this.args = args;
      sdkMocks.instances.push(this as never);
    }
  },
}));

vi.mock('@modelcontextprotocol/sdk/client/sse.js', () => ({
  SSEClientTransport: class MockSse {
    kind = 'sse' as const;
    args: unknown[];
    onmessage?: (message: unknown) => void;
    onerror?: (error: Error) => void;
    onclose?: () => void;
    start = vi.fn(async () => {});
    send = vi.fn(async () => {});
    close = vi.fn(async () => {});
    constructor(...args: unknown[]) {
      this.args = args;
      sdkMocks.instances.push(this as never);
    }
  },
}));

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

beforeEach(() => {
  sdkMocks.instances.length = 0;
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

  it('maps http and sse records and skips disabled or credential-broken entries', () => {
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
      record({
        id: 'srv-sse',
        name: 'legacy-sse',
        transportType: 'sse',
        command: undefined,
        args: undefined,
        url: 'https://example.com/sse',
      }),
    ]);

    expect(config.servers.map(server => server.name)).toEqual(['docs', 'legacy-sse']);
    expect(config.servers[0]?.config).toEqual({
      type: 'http',
      url: 'https://example.com/mcp',
      headers: { Authorization: 'Bearer x' },
      description: 'Blender MCP',
    });
    expect(config.servers[1]?.config).toEqual({
      type: 'http',
      url: 'https://example.com/sse',
      description: 'Blender MCP',
    });
    expect(config.errors).toEqual(['MCP server "blender": stored credentials could not be read']);
  });
});

describe('buildPiMcpTransportFactory', () => {
  it('returns a synchronous Pi McpTransport and resolves stdio env/command on start()', async () => {
    const factory = buildPiMcpTransportFactory(() => [record({ env: { BLENDER_PORT: '1234' } })]);

    const transport = factory(
      {
        name: 'blender',
        source: 'zhiyuan-store',
        config: { type: 'stdio', command: 'npx' },
      },
      '/tmp/work',
      undefined,
    );

    // Pi calls onMessage/onError/onClose synchronously before start().
    const messages: unknown[] = [];
    const unsubscribe = transport.onMessage(msg => messages.push(msg));
    expect(typeof unsubscribe).toBe('function');

    await transport.start();
    expect(sdkMocks.instances).toHaveLength(1);
    expect(sdkMocks.instances[0]?.kind).toBe('stdio');
    expect(sdkMocks.instances[0]?.args[0]).toMatchObject({
      command: 'resolved-npx',
      env: { PATH: '/usr/bin', BLENDER_PORT: '1234' },
    });

    sdkMocks.instances[0]?.onmessage?.({ jsonrpc: '2.0', id: 1, result: {} });
    expect(messages).toEqual([{ jsonrpc: '2.0', id: 1, result: {} }]);
    await transport.close();
    expect(sdkMocks.instances[0]?.close).toHaveBeenCalledOnce();
  });

  it('expands token templates in http and sse URLs and headers', async () => {
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
      record({
        id: 'srv-sse',
        name: 'legacy-sse',
        transportType: 'sse',
        command: undefined,
        args: undefined,
        url: 'https://example.com/${TOKEN}/sse',
        headers: { Authorization: 'Bearer ${TOKEN}' },
        env: {},
      }),
    ]);

    const httpTransport = factory(
      {
        name: 'docs',
        source: 'zhiyuan-store',
        config: {
          type: 'http',
          url: 'https://example.com/${TOKEN}/mcp',
          headers: { Authorization: 'Bearer ${TOKEN}' },
        },
      },
      '/tmp/work',
      undefined,
    );
    await httpTransport.start();
    expect(sdkMocks.instances[0]?.kind).toBe('http');
    expect((sdkMocks.instances[0]?.args[0] as URL | undefined)?.toString()).toBe(
      'https://example.com/secret-token/mcp',
    );
    expect(sdkMocks.instances[0]?.args[1]).toEqual({
      requestInit: { headers: { Authorization: 'Bearer secret-token' } },
    });

    const sseTransport = factory(
      {
        name: 'legacy-sse',
        source: 'zhiyuan-store',
        config: {
          type: 'http',
          url: 'https://example.com/${TOKEN}/sse',
          headers: { Authorization: 'Bearer ${TOKEN}' },
        },
      },
      '/tmp/work',
      undefined,
    );
    await sseTransport.start();
    expect(sdkMocks.instances[1]?.kind).toBe('sse');
    expect((sdkMocks.instances[1]?.args[0] as URL | undefined)?.toString()).toBe(
      'https://example.com/secret-token/sse',
    );
  });

  it('throws synchronously for stdio entries whose record disappeared', () => {
    const factory = buildPiMcpTransportFactory(() => []);
    expect(() =>
      factory(
        { name: 'gone', source: 'zhiyuan-store', config: { type: 'stdio', command: 'x' } },
        '/tmp/work',
        undefined,
      ),
    ).toThrow('no longer configured');
  });
});
