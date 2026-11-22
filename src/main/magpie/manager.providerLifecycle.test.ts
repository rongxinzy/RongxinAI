import { describe, it, expect, vi } from 'vitest';

import fs from 'node:fs/promises';

import { installJobRunnerFixture, setup } from './manager.testHarness';
import { RETIRED_OLLAMA_HOST_PROVIDER_ID, RETIRED_STRATA_HOST_PROVIDER_ID } from './hostProviders';
import { MagpieModelService } from './modelService';

describe('Magpie provider lifecycle', () => {
  it.each(['save', 'enable', 'delete'] as const)(
    'discards a user provider %s when its read belongs to a stopped process',
    async action => {
      const ports = [21001, 21002, 21001, 21002];
      const { manager, root, fetcher, child } = await setup(undefined, undefined, undefined, {
        managerOptions: { port: async () => ports.shift()! },
      });
      const oldList = Promise.withResolvers<Response>();
      const admitted = Promise.withResolvers<RequestInit | undefined>();
      const writes: string[] = [];
      let holdList = false;
      const originalFetch = fetcher.getMockImplementation()!;
      fetcher.mockImplementation(async (url, init) => {
        if (url.endsWith('/api/providers') && holdList) {
          admitted.resolve(init);
          return oldList.promise;
        }
        if (/\/api\/provider\/(save|on|off|delete)$/.test(url)) writes.push(url);
        return originalFetch(url, init);
      });
      try {
        const first = await manager.start();
        holdList = true;
        const id = 'provider-local';
        const edits = {
          save: () =>
            manager.saveProvider({
              id,
              name: 'Local provider',
              api: 'openai-completions',
              baseUrl: 'http://127.0.0.1:8080/v1',
            }),
          enable: () => manager.setProviderEnabled(id, true),
          delete: () => manager.deleteProvider(id),
        };
        const edit = edits[action]();
        const result = Promise.allSettled([edit]);
        const request = await admitted.promise;
        await manager.stop();
        child.exitCode = null;
        holdList = false;
        expect((await manager.start()).gatewayUrl).toBe(first.gatewayUrl);
        oldList.resolve(Response.json({ providers: [] }));
        expect((await result)[0].status).toBe('rejected');
        expect(request?.signal?.aborted).toBe(true);
        expect(writes).toEqual([]);
      } finally {
        oldList.resolve(Response.json({ providers: [] }));
        await manager.shutdown();
        await fs.rm(root, { recursive: true, force: true });
      }
    },
  );

  it('does not replay queued host writes into a new process on the same gateway port', async () => {
    const ports = [21001, 21002, 21001, 21002];
    const { manager, root, fetcher, child } = await setup(undefined, undefined, undefined, {
      managerOptions: { port: async () => ports.shift()! },
    });
    const oldSave = Promise.withResolvers<Response>();
    const admitted = Promise.withResolvers<RequestInit | undefined>();
    const writes: string[] = [];
    let restarted = false;
    const originalFetch = fetcher.getMockImplementation()!;
    const definition = (name: string) => ({
      id: `zhiyuan-host-${name}`,
      name,
      api: 'openai-completions' as const,
      baseUrl: 'http://127.0.0.1:11434/v1',
      models: [{ id: name }],
    });
    fetcher.mockImplementation(async (url, init) => {
      if (url.endsWith('/api/providers')) {
        return Response.json({
          providers: restarted ? [] : [{ id: 'zhiyuan-host-old', off: true }],
        });
      }
      if (/\/api\/provider\/(save|on|off)$/.test(url)) {
        const route = new URL(url).pathname;
        const { id } = JSON.parse(String(init?.body));
        writes.push(`${route}:${id}`);
        if (route.endsWith('/save') && id === 'zhiyuan-host-old') {
          admitted.resolve(init);
          return oldSave.promise;
        }
        return Response.json({});
      }
      return originalFetch(url, init);
    });
    try {
      await expect(manager.syncHostProviders([definition('stopped')])).rejects.toThrow(
        'Model service is unavailable',
      );
      const first = await manager.start();
      const old = manager.syncHostProviders([definition('old')]);
      const queued = manager.syncHostProviders([definition('queued')]);
      const stale = Promise.allSettled([old, queued]);
      const request = await admitted.promise;
      await manager.stop();
      expect(request?.signal?.aborted).toBe(true);
      child.exitCode = null;
      restarted = true;
      expect((await manager.start()).gatewayUrl).toBe(first.gatewayUrl);
      const fresh = manager.syncHostProviders([definition('fresh')]);
      await vi.waitFor(() => expect(writes).toContain('/api/provider/save:zhiyuan-host-fresh'));
      await fresh;
      oldSave.resolve(Response.json({}));
      expect((await stale).map(result => result.status)).toEqual(['rejected', 'rejected']);
      expect(writes).toEqual([
        '/api/provider/save:zhiyuan-host-old',
        '/api/provider/save:zhiyuan-host-fresh',
      ]);
    } finally {
      oldSave.resolve(Response.json({}));
      await manager.shutdown();
      await fs.rm(root, { recursive: true, force: true });
    }
  });
  it.each([
    { id: RETIRED_STRATA_HOST_PROVIDER_ID, platform: 'win32' },
    { id: RETIRED_OLLAMA_HOST_PROVIDER_ID, platform: 'darwin' },
    { id: RETIRED_OLLAMA_HOST_PROVIDER_ID, platform: 'linux' },
    { id: RETIRED_OLLAMA_HOST_PROVIDER_ID, platform: 'win32' },
  ] as const)('retires $id before exposing the gateway on $platform', async ({ id, platform }) => {
    const { manager, root, fetcher } = await setup(undefined, undefined, undefined, {
      managerOptions: { platform },
    });
    if (platform === 'win32') await installJobRunnerFixture(root);
    const modelId = `${id}/old-model`;
    const endpoint = 'http://127.0.0.1:11434/v1';
    const offRequested = Promise.withResolvers<unknown>();
    const allowDisable = Promise.withResolvers<void>();
    const originalFetch = fetcher.getMockImplementation();
    fetcher.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/api/providers')) {
        return Response.json({
          providers: [
            { id, chat: endpoint, off: false },
            { id: 'custom-openai', chat: endpoint, off: false },
          ],
        });
      }
      if (url.endsWith('/v1/models')) {
        return Response.json({
          data: [
            { id: modelId, display_name: 'Retired model' },
            { id: 'custom-openai/current-model' },
            { id: 'old-model', owned_by: id },
            { id: 'old-alias', display_name: 'Retired model' },
          ],
        });
      }
      if (url.endsWith('/api/provider/off')) {
        offRequested.resolve(JSON.parse(String(init?.body)));
        await allowDisable.promise;
        return Response.json({ ok: true });
      }
      return originalFetch ? await originalFetch(url, init) : Response.json({});
    });
    const startup = manager.start();
    try {
      await expect(Promise.race([offRequested.promise, startup])).resolves.toEqual({ id });
      expect(manager.status()).toMatchObject({ state: 'starting' });
      allowDisable.resolve();
      expect((await startup).state).toBe('running');
      expect((await manager.providers()).map(provider => provider.id)).toEqual(['custom-openai']);
      expect((await manager.models()).map(model => model.id)).toEqual([
        'custom-openai/current-model',
      ]);
      expect(fetcher.mock.calls.filter(([url]) => url.endsWith('/api/provider/off'))).toHaveLength(
        1,
      );
    } finally {
      allowDisable.resolve();
      await startup;
      await manager.shutdown();
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('keeps the gateway unavailable when a retired provider cannot be disabled', async () => {
    const { manager, root, fetcher } = await setup();
    const originalFetch = fetcher.getMockImplementation()!;
    fetcher.mockImplementation(async (url, init) => {
      if (url.endsWith('/api/providers')) {
        return Response.json({ providers: [{ id: RETIRED_OLLAMA_HOST_PROVIDER_ID, off: false }] });
      }
      if (url.endsWith('/api/provider/off')) return new Response(null, { status: 500 });
      return originalFetch(url, init);
    });
    try {
      expect(await manager.start()).toMatchObject({ state: 'failed' });
      expect(manager.status().gatewayUrl).toBeUndefined();
      expect(await manager.models()).toEqual([]);
    } finally {
      await manager.shutdown();
      await fs.rm(root, { recursive: true, force: true });
    }
  });

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

  it('resolves model routes without probing stored keys and tolerates probe failures in the editor', async () => {
    const { manager, root, fetcher } = await setup();
    const originalFetch = fetcher.getMockImplementation();
    let keyReads = 0;
    fetcher.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/v1/models')) {
        return Response.json({ data: [{ id: 'legacy-none/m1', owned_by: 'legacy-none' }] });
      }
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
        keyReads++;
        return new Response('error', { status: 500 });
      }
      return originalFetch ? await originalFetch(url, init) : Response.json({});
    });
    try {
      await manager.start();
      const models = new MagpieModelService(manager, {
        readDefaultModelId: () => 'legacy-none/m1',
        writeDefaultModelId: () => {},
      });
      expect((await models.resolve()).provider).toMatchObject({
        id: 'legacy-none',
        api: 'openai-completions',
        baseUrl: 'https://api.example/v1',
      });
      expect(keyReads).toBe(0);

      const list = await manager.providers();
      expect(keyReads).toBe(1);
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
