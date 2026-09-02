import { beforeEach, expect, test, vi } from 'vitest';

const {
  connectMock,
  listToolsMock,
  closeClientMock,
  closeTransportMock,
  resolveStdioCommandMock,
  getEnhancedEnvMock,
  stdioParametersMock,
} = vi.hoisted(() => ({
  connectMock: vi.fn<(args: unknown) => Promise<void>>(),
  listToolsMock: vi.fn<() => Promise<{ tools: unknown[] }>>(),
  closeClientMock: vi.fn<() => Promise<void>>(),
  closeTransportMock: vi.fn<() => Promise<void>>(),
  resolveStdioCommandMock:
    vi.fn<
      () => Promise<{ command: string; args: string[]; env: Record<string, string> | undefined }>
    >(),
  getEnhancedEnvMock: vi.fn<() => Promise<Record<string, string>>>(),
  stdioParametersMock: vi.fn(),
}));

vi.mock('@modelcontextprotocol/sdk/client/index.js', () => ({
  Client: class MockClient {
    async connect(transport: unknown) {
      return connectMock(transport);
    }

    async listTools() {
      return listToolsMock();
    }

    async close() {
      return closeClientMock();
    }
  },
}));

vi.mock('@modelcontextprotocol/sdk/client/stdio.js', () => ({
  StdioClientTransport: class MockStdioClientTransport {
    stderr = {
      on: vi.fn(),
    };

    constructor(parameters: unknown) {
      stdioParametersMock(parameters);
    }

    async close() {
      return closeTransportMock();
    }
  },
}));

vi.mock('@modelcontextprotocol/sdk/client/sse.js', () => ({
  SSEClientTransport: class MockSSEClientTransport {
    url: URL;

    options: unknown;

    constructor(url: URL, options?: unknown) {
      this.url = url;
      this.options = options;
    }

    async close() {
      return closeTransportMock();
    }
  },
}));

vi.mock('@modelcontextprotocol/sdk/client/streamableHttp.js', () => ({
  StreamableHTTPClientTransport: class MockStreamableHTTPClientTransport {
    url: URL;

    options: unknown;

    constructor(url: URL, options?: unknown) {
      this.url = url;
      this.options = options;
    }

    async close() {
      return closeTransportMock();
    }
  },
}));

vi.mock('./mcpServerManager', () => ({
  resolveStdioCommand: resolveStdioCommandMock,
  expandMcpTemplate: (value: string, env?: Record<string, string>) =>
    value.replace(
      /\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g,
      (_match, key: string) => env?.[key] ?? `\${${key}}`,
    ),
  unresolvedMcpTemplateKeys: () => [],
}));

vi.mock('./coworkUtil', () => ({
  getEnhancedEnv: getEnhancedEnvMock,
}));

import { probeMcpConnection } from './mcpConnectionProbe';

beforeEach(() => {
  vi.clearAllMocks();
  resolveStdioCommandMock.mockResolvedValue({
    command: 'node',
    args: ['server.js'],
    env: undefined,
  });
  getEnhancedEnvMock.mockResolvedValue({});
  connectMock.mockResolvedValue(undefined);
  listToolsMock.mockResolvedValue({ tools: [] });
  closeClientMock.mockResolvedValue(undefined);
  closeTransportMock.mockResolvedValue(undefined);
});

test('probeMcpConnection rejects a non-MCP HTTP endpoint', async () => {
  connectMock.mockRejectedValueOnce(new Error('Unexpected content-type text/html'));

  const result = await probeMcpConnection({
    name: 'Example',
    description: '',
    transportType: 'http',
    url: 'http://example.com',
  });

  expect(result.success).toBe(false);
  expect(result.error).toContain('Unexpected content-type text/html');
});

test('probeMcpConnection passes headers to SSE transports', async () => {
  await probeMcpConnection({
    name: 'Remote SSE',
    description: '',
    transportType: 'sse',
    url: 'http://localhost:3000/sse',
    headers: {
      Authorization: 'Bearer token',
    },
  });

  expect(connectMock).toHaveBeenCalledTimes(1);
  const transport = connectMock.mock.calls[0]?.[0] as {
    url?: URL;
    options?: { requestInit?: RequestInit };
  };
  expect(transport.url?.toString()).toBe('http://localhost:3000/sse');
  expect(transport.options).toEqual({
    requestInit: {
      headers: {
        Authorization: 'Bearer token',
      },
    },
  });
});

test('probeMcpConnection pipes stdio stderr for connection diagnostics', async () => {
  await probeMcpConnection({
    name: 'Local MCP',
    description: '',
    transportType: 'stdio',
    command: 'node',
    args: ['server.js'],
  });

  expect(stdioParametersMock).toHaveBeenCalledWith(
    expect.objectContaining({
      command: 'node',
      args: ['server.js'],
      stderr: 'pipe',
    }),
  );
});
