import { describe, it, expect } from 'vitest';

import fs from 'node:fs/promises';

import { setup } from './manager.testHarness';
describe('Magpie provider lifecycle', () => {
  it('resets provider hydration after host sync so diagnostics refetches providers', async () => {
    const { manager, root, fetcher } = await setup();
    let providersListFetches = 0;
    const originalFetch = fetcher.getMockImplementation();
    fetcher.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/api/providers')) providersListFetches++;
      return originalFetch ? await originalFetch(url, init) : Response.json({});
    });
    try {
      await manager.start();
      await manager.providers();
      const afterHydrate = providersListFetches;
      await manager.diagnostics();
      expect(providersListFetches).toBe(afterHydrate);

      await manager.syncHostProviders([
        {
          id: 'zhiyuan-host-loopback',
          name: 'Loopback host',
          api: 'openai-completions',
          baseUrl: 'http://127.0.0.1:11434/v1',
          models: [{ id: 'local-model' }],
        },
      ]);
      const afterHostSync = providersListFetches;
      await manager.diagnostics();
      expect(providersListFetches).toBe(afterHostSync + 1);
    } finally {
      await manager.shutdown();
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('keeps the provider list when a stored-key probe fails for one row', async () => {
    const { manager, root, fetcher } = await setup();
    const originalFetch = fetcher.getMockImplementation();
    fetcher.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/api/providers')) {
        return Response.json({
          providers: [
            {
              id: 'legacy-none',
              name: 'Legacy',
              chat: 'https://api.example/v1',
              key: { set: true, masked: '••••' },
              models: ['m1'],
              off: false,
            },
            {
              id: 'custom-openai',
              name: 'My OpenAI',
              chat: 'https://api.openai.com/v1',
              key: { set: true, masked: 'sk-…6789' },
              models: [{ id: 'gpt-4o', on: true }],
              off: false,
            },
          ],
        });
      }
      if (url.endsWith('/api/provider/key')) {
        return new Response('error', { status: 500 });
      }
      return originalFetch ? await originalFetch(url, init) : Response.json({});
    });
    try {
      await manager.start();
      const list = await manager.providers();
      expect(list).toHaveLength(2);
      expect(list.find(p => p.id === 'custom-openai')).toMatchObject({ hasKey: true });
      expect(list.find(p => p.id === 'legacy-none')).toMatchObject({
        hasKey: true,
        keyMasked: '••••',
      });
    } finally {
      await manager.shutdown();
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('lists providers with key masking and host managed flag (A2)', async () => {
    const { manager, root } = await setup();
    try {
      await manager.start();
      const list = await manager.providers();
      expect(list).toHaveLength(2);

      const host = list.find(p => p.id === 'zhiyuan-host-enterprise');
      expect(host).toMatchObject({
        isHostManaged: true,
        keyMasked: 'system-managed',
        hasKey: false,
      });

      const custom = list.find(p => p.id === 'custom-openai');
      expect(custom).toMatchObject({
        isHostManaged: false,
        name: 'My OpenAI',
        api: 'openai-completions',
        baseUrl: 'https://api.openai.com/v1',
        hasKey: true,
        keyMasked: 'sk-…6789',
        models: ['gpt-4o'],
      });
      // Ensure the raw secret key is never projected
      expect((custom as Record<string, unknown>).key).toBeUndefined();
    } finally {
      await manager.shutdown();
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('strictly protects host-managed providers against save, toggle, or delete (A1)', async () => {
    const { manager, root } = await setup();
    try {
      await manager.start();
      await expect(
        manager.saveProvider({
          id: 'zhiyuan-host-fake',
          name: 'Hacked',
          api: 'openai-completions',
          baseUrl: 'https://evil.test',
          models: ['m1'],
        }),
      ).rejects.toThrow('Host-managed');

      await expect(manager.setProviderEnabled('zhiyuan-host-enterprise', true)).rejects.toThrow(
        'Host-managed',
      );
      await expect(manager.deleteProvider('zhiyuan-host-enterprise')).rejects.toThrow(
        'Host-managed',
      );
    } finally {
      await manager.shutdown();
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('testProvider loads the stored key from provider/key when the key field is blank', async () => {
    const { manager, root } = await setup();
    try {
      await manager.start();
      const result = await manager.testProvider({
        id: 'custom-openai',
        name: 'My OpenAI',
        api: 'openai-completions',
        baseUrl: 'https://api.openai.com/v1',
        models: ['gpt-4o'],
      });
      expect(result.ok).toBe(true);
      expect(result.modelCount).toBe(1);
      expect(result.discoveredModels).toEqual(['m1']);
    } finally {
      await manager.shutdown();
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('testProvider flags requiresKey when testing without valid key gets 401', async () => {
    const { manager, root } = await setup();
    try {
      await manager.start();
      const result = await manager.testProvider({
        name: 'OpenAI Without Key',
        api: 'openai-completions',
        baseUrl: 'https://api.openai.com',
        models: ['gpt-4o'],
      });
      expect(result.ok).toBe(false);
      expect(result.requiresKey).toBe(true);
    } finally {
      await manager.shutdown();
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('saves provider, retains existing key when omitted (A2), and updates state', async () => {
    const { manager, root, fetcher } = await setup();
    try {
      await manager.start();
      // Omit key when updating existing provider 'custom-openai'
      await manager.saveProvider({
        id: 'custom-openai',
        name: 'My OpenAI Renamed',
        api: 'openai-completions',
        baseUrl: 'https://api.openai.com/v1',
        models: ['gpt-4o', 'gpt-4o-mini'],
      });

      const saveCall = fetcher.mock.calls.find(([url]) => url.endsWith('/api/provider/save'));
      expect(saveCall).toBeDefined();
      const body = JSON.parse(saveCall![1]?.body as string);
      expect(body.id).toBe('custom-openai');
      expect(body.name).toBe('My OpenAI Renamed');
      // Upstream keeps the stored key when the editor leaves the field blank
      expect(body.key).toBe('');
    } finally {
      await manager.shutdown();
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('runs diagnostics and measures gateway latency', async () => {
    const { manager, root } = await setup();
    try {
      await manager.start();
      manager.recordError('Rate limit exceeded', 'custom-openai');
      const diag = await manager.diagnostics();
      expect(diag.activeProviderCount).toBe(2);
      expect(diag.recentErrors).toHaveLength(1);
      expect(diag.recentErrors![0].message).toBe('Rate limit exceeded');
      expect(diag.latencyMs).toBeGreaterThanOrEqual(0);
    } finally {
      await manager.shutdown();
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
