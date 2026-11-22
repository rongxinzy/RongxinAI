import { beforeEach, expect, test, vi } from 'vitest';

import type { McpServerRecord } from '../mcpStore';
import { refreshMcpOAuthHeaders } from './mcpOAuthHeaders';

vi.mock('./runtimeServices', () => ({
  getStore: () => ({ get: () => true }),
  getMcpStore: vi.fn(() => ({
    listServers: () => [],
    getEnabledServers: () => [{ name: 'fixture', enabled: true }],
  })),
}));
vi.mock('./mcpOAuthHeaders', () => ({
  refreshMcpOAuthHeaders: vi.fn(async (records: McpServerRecord[]) => records),
}));

const onConfigurationChanged = vi.fn();
const loadBootstrap = () => import('./mcpBootstrap');
const loadManager = () => import('../libs/mcpServerManager');

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
});

test('publishes saved configuration to Pi without connecting to MCP servers', async () => {
  const bootstrap = await loadBootstrap();
  const { McpServerManager } = await loadManager();
  const reconcile = vi.spyOn(McpServerManager.prototype, 'reconcileServers');
  try {
    await expect(bootstrap.refreshMcpBridge(onConfigurationChanged)).resolves.toEqual({ tools: 0 });
    expect(onConfigurationChanged).toHaveBeenCalledOnce();
    expect(reconcile).not.toHaveBeenCalled();
    expect(refreshMcpOAuthHeaders).not.toHaveBeenCalled();
  } finally {
    reconcile.mockRestore();
  }
});

test('quit joins Coding Room diagnostics and their transport cleanup', async () => {
  const bootstrap = await loadBootstrap();
  const { diagnoseCodingMcp } = await import('./codingMcpDiagnostics');
  const { McpServerManager } = await loadManager();
  const entered = Promise.withResolvers<AbortSignal>();
  const cleanup = Promise.withResolvers<void>();
  const stop = vi.spyOn(McpServerManager.prototype, 'stopServers').mockReturnValue(cleanup.promise);
  const reconcile = vi
    .spyOn(McpServerManager.prototype, 'reconcileServers')
    .mockImplementation(async (_records, signal) => {
      entered.resolve(signal!);
      return new Promise((_resolve, reject) => {
        signal?.addEventListener('abort', () => reject(signal.reason), { once: true });
      });
    });
  const records = [{ name: 'fixture', enabled: true }] as McpServerRecord[];
  try {
    const diagnostic = diagnoseCodingMcp(records, 'fixture');
    const outcome = expect(diagnostic).rejects.toThrow('shutting down');
    const signal = await entered.promise;
    const completed = vi.fn();
    const closing = bootstrap.shutdownMcpBridge().then(completed);
    expect(signal.aborted).toBe(true);
    await expect(diagnoseCodingMcp(records, 'fixture')).rejects.toThrow('shutting down');
    expect(reconcile).toHaveBeenCalledOnce();
    expect(stop).toHaveBeenCalledOnce();
    expect(completed).not.toHaveBeenCalled();
    cleanup.resolve();
    await outcome;
    await closing;
  } finally {
    cleanup.resolve();
    reconcile.mockRestore();
    stop.mockRestore();
  }
});
