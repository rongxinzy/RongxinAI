import { afterEach, expect, test, vi } from 'vitest';

import { McpServerManager } from '../libs/mcpServerManager';
import type { McpServerRecord } from '../mcpStore';
import { diagnoseCodingMcp } from './codingMcpDiagnostics';
import { refreshMcpOAuthHeaders } from './mcpOAuthHeaders';

vi.mock('./mcpOAuthHeaders', () => ({
  refreshMcpOAuthHeaders: vi.fn(async (records: McpServerRecord[]) => records),
}));

const server = (name: string, enabled = true): McpServerRecord => ({
  id: name,
  name,
  description: '',
  enabled,
  transportType: 'http',
  url: 'https://example.test/mcp',
  isBuiltIn: false,
  createdAt: 1,
  updatedAt: 1,
});

afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

test('probes only the requested MCP server and closes its connection', async () => {
  const selected = server('selected');
  const reconcile = vi
    .spyOn(McpServerManager.prototype, 'reconcileServers')
    .mockResolvedValue([{ server: 'selected', name: 'lookup', description: '', inputSchema: {} }]);
  vi.spyOn(McpServerManager.prototype, 'serverStatuses', 'get').mockReturnValue([
    { name: 'selected', connected: true, toolCount: 1 },
  ]);
  const stop = vi.spyOn(McpServerManager.prototype, 'stopServers').mockResolvedValue();

  await expect(diagnoseCodingMcp([server('unrelated'), selected], 'selected')).resolves.toEqual({
    gatewayAvailable: true,
    target: 'selected',
    servers: [{ name: 'selected', enabled: true, connected: true, toolCount: 1 }],
    tools: [{ server: 'selected', name: 'lookup' }],
  });
  expect(refreshMcpOAuthHeaders).toHaveBeenCalledExactlyOnceWith([selected]);
  expect(reconcile).toHaveBeenCalledExactlyOnceWith([selected]);
  expect(stop).toHaveBeenCalledOnce();
});

test('reports disabled or unknown MCP servers without connecting to unrelated servers', async () => {
  const reconcile = vi.spyOn(McpServerManager.prototype, 'reconcileServers').mockResolvedValue([]);
  const configured = [server('enabled'), server('disabled', false)];

  await expect(diagnoseCodingMcp(configured, 'disabled')).resolves.toMatchObject({
    servers: [{ name: 'disabled', enabled: false, connected: false, toolCount: 0 }],
  });
  await expect(diagnoseCodingMcp(configured, 'unknown')).resolves.toMatchObject({
    target: 'unknown',
    servers: [],
  });
  expect(refreshMcpOAuthHeaders).not.toHaveBeenCalled();
  expect(reconcile).not.toHaveBeenCalled();
});

test('closes diagnostics connections when discovery fails', async () => {
  vi.spyOn(McpServerManager.prototype, 'reconcileServers').mockRejectedValue(
    new Error('discovery failed'),
  );
  const stop = vi.spyOn(McpServerManager.prototype, 'stopServers').mockResolvedValue();

  await expect(diagnoseCodingMcp([server('selected')])).rejects.toThrow('discovery failed');
  expect(stop).toHaveBeenCalledOnce();
});
