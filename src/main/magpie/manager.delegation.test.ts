import fs from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';
import { setup } from './manager.testHarness';

describe('Magpie manager operation delegation', () => {
  it('shares one catalog promise and rejects it when the owned process stops', async () => {
    const { manager, root, fetcher } = await setup();
    const originalFetch = fetcher.getMockImplementation()!;
    let release!: () => void;
    const pending = new Promise<void>(resolve => {
      release = resolve;
    });
    fetcher.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/v1/models')) await pending;
      return originalFetch(url, init);
    });
    try {
      await manager.start();
      const first = manager.models();
      const second = manager.models();
      expect(second).toBe(first);
      const rejected = expect(first).rejects.toThrow();
      const stopping = manager.shutdown();
      release();
      await rejected;
      await stopping;
      expect(manager.status().state).toBe('stopped');
      await expect(manager.models()).resolves.toEqual([]);
      expect(fetcher.mock.calls.filter(([url]) => url.endsWith('/v1/models'))).toHaveLength(1);
    } finally {
      release();
      await manager.shutdown();
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('keeps provider mutations routed through the public lifecycle and projection methods', async () => {
    const { manager, root } = await setup();
    try {
      await manager.start();
      const ensureRunning = vi.spyOn(manager, 'ensureRunning');
      const providers = vi.spyOn(manager, 'providers').mockResolvedValue([]);
      const clearRecentErrors = vi.spyOn(manager, 'clearRecentErrors');
      await expect(manager.setProviderEnabled('custom-openai', false)).resolves.toEqual([]);
      expect(ensureRunning).toHaveBeenCalledTimes(1);
      expect(providers).toHaveBeenCalledTimes(1);
      expect(clearRecentErrors).toHaveBeenCalledWith({
        providerIds: ['custom-openai'],
        providerNames: ['My OpenAI'],
      });
    } finally {
      await manager.shutdown();
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('shares provider diagnostics with status and clears hydration on shutdown', async () => {
    const { manager, root } = await setup();
    try {
      await manager.start();
      await manager.providers();
      manager.recordError('Provider failed', 'custom-openai');
      const diagnostics = await manager.diagnostics();
      expect(manager.status().diagnostics).toEqual({
        activeProviderCount: diagnostics.activeProviderCount,
        recentErrors: diagnostics.recentErrors,
      });
      await manager.clearDiagnostics();
      expect(manager.status().diagnostics?.recentErrors).toEqual([]);
      await manager.shutdown();
      expect(manager.status().diagnostics?.activeProviderCount).toBe(0);
    } finally {
      await manager.shutdown();
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('keeps agent operations routed through the public agent projection', async () => {
    const { manager, root } = await setup(undefined, undefined, undefined, { agents: [] });
    try {
      await manager.start();
      const agents = vi.spyOn(manager, 'agents').mockResolvedValue({ agents: [], pending: false });
      await expect(manager.disconnectAllAgents()).resolves.toEqual({ agents: [], pending: false });
      expect(agents).toHaveBeenCalledTimes(1);
    } finally {
      await manager.shutdown();
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
