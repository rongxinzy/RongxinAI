import fs from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';
import { setup } from './manager.testHarness';

describe('Magpie manager operation delegation', () => {
  it('does not send the second preference write to a replacement process on the same port', async () => {
    const ports = [21001, 21002, 21001, 21002];
    const { manager, root, fetcher, child } = await setup(undefined, undefined, undefined, {
      managerOptions: { port: async () => ports.shift()! },
    });
    const saved = Promise.withResolvers<Response>();
    const started = Promise.withResolvers<AbortSignal | null | undefined>();
    const originalFetch = fetcher.getMockImplementation()!;
    const writes: string[] = [];
    fetcher.mockImplementation(async (url, init) => {
      if (init?.method === 'POST' && new URL(url).pathname.startsWith('/api/settings')) {
        writes.push(new URL(url).pathname);
        if (url.endsWith('/api/settings')) {
          started.resolve(init.signal);
          return saved.promise;
        }
      }
      return originalFetch(url, init);
    });
    try {
      const first = await manager.start();
      const stale = Promise.allSettled([
        manager.updatePreferences({ vision: 'cloud/old', bareModelIDs: true }),
      ]);
      const signal = await started.promise;
      await manager.stop();
      child.exitCode = null;
      expect((await manager.start()).gatewayUrl).toBe(first.gatewayUrl);
      await manager.updatePreferences({ bareModelIDs: false });
      saved.resolve(Response.json({ vision: 'cloud/old' }));
      expect((await stale)[0].status).toBe('rejected');
      expect(signal?.aborted).toBe(true);
      expect(writes).toEqual(['/api/settings', '/api/settings/bare-ids']);
    } finally {
      saved.resolve(Response.json({}));
      await manager.shutdown();
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('updates bare model IDs through the native setting endpoint alone or in a mixed patch', async () => {
    const { manager, root, fetcher } = await setup();
    const originalFetch = fetcher.getMockImplementation()!;
    const settings = { vision: '', searcher: '', bareModelIDs: false };
    fetcher.mockImplementation(async (url, init) => {
      if (url.endsWith('/api/settings/bare-ids')) {
        settings.bareModelIDs = JSON.parse(String(init?.body)).on;
        return Response.json(settings);
      }
      if (url.endsWith('/api/settings')) {
        if (init?.method === 'POST') Object.assign(settings, JSON.parse(String(init.body)));
        return Response.json(settings);
      }
      return originalFetch(url, init);
    });
    try {
      await manager.start();
      const settingsWrites = () =>
        fetcher.mock.calls.flatMap(([url, init]) =>
          init?.method === 'POST' && new URL(url).pathname.startsWith('/api/settings')
            ? [[new URL(url).pathname, JSON.parse(String(init.body))]]
            : [],
        );
      await expect(manager.updatePreferences({ bareModelIDs: true })).resolves.toMatchObject({
        bareModelIDs: true,
      });
      expect(settingsWrites()).toEqual([['/api/settings/bare-ids', { on: true }]]);
      await expect(
        manager.updatePreferences({ bareModelIDs: false, vision: 'cloud/vision' }),
      ).resolves.toMatchObject({ bareModelIDs: false, vision: 'cloud/vision' });
      expect(settingsWrites()).toEqual([
        ['/api/settings/bare-ids', { on: true }],
        ['/api/settings', { vision: 'cloud/vision', searcher: '' }],
        ['/api/settings/bare-ids', { on: false }],
      ]);
      await Promise.all([
        manager.updatePreferences({ searcher: 'cloud/search' }),
        manager.updatePreferences({ vision: 'cloud/other-vision' }),
      ]);
      await expect(manager.preferences()).resolves.toMatchObject({
        vision: 'cloud/other-vision',
        searcher: 'cloud/search',
      });
    } finally {
      await manager.shutdown();
      await fs.rm(root, { recursive: true, force: true });
    }
  });

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

  it('reads wiring state once when no agents need to be disconnected', async () => {
    const { manager, root, fetcher } = await setup(undefined, undefined, undefined, { agents: [] });
    try {
      await manager.start();
      await vi.waitFor(() => {
        expect(fetcher.mock.calls.some(([url]) => url.endsWith('/api/state'))).toBe(true);
      });
      fetcher.mockClear();
      await expect(manager.disconnectAllAgents()).resolves.toEqual({ agents: [], pending: false });
      expect(fetcher.mock.calls.map(([url]) => new URL(url).pathname)).toEqual([
        '/api/state',
        '/api/agents/cli',
      ]);
      fetcher.mockClear();
      await manager.disconnectAllAgents(new AbortController().signal);
      expect(fetcher.mock.calls.map(([url]) => new URL(url).pathname)).toEqual(['/api/state']);
    } finally {
      await manager.shutdown();
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
