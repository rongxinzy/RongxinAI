import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { projectMagpieCatalog } from './catalog';
import { MagpieManager } from './manager';
import { isolatedMagpieEnvironment, prepareMagpieHome } from './environment';
import { MAGPIE_LAN_KEY_NAME } from './lanAccess';
import { verifyMagpieBinary, MAGPIE_COMMIT, MAGPIE_VERSION } from './integrity';
async function temporary() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'magpie-host-test-'));
}
describe('Magpie isolation and integrity', () => {
  it('keeps real CLI home while isolating service settings and dropping credential environment', () => {
    const env = isolatedMagpieEnvironment('/private', 1234, 'test', {
      HOME: '/real',
      USERPROFILE: '/real',
      OPENAI_API_KEY: 'secret',
      MAGPIE_ADDR: '0.0.0.0:9999',
      PATH: '/bin',
    });
    expect(env.HOME).toBe('/real');
    expect(env.XDG_CONFIG_HOME).toBe('/private/config');
    expect(env.OPENAI_API_KEY).toBeUndefined();
    expect(env.MAGPIE_ADDR).toBe('127.0.0.1:1234');
    expect(env.MAGPIE_NO_ACCOUNTS).toBe('1');
    expect(env.DO_NOT_TRACK).toBe('1');
    expect(
      isolatedMagpieEnvironment('/private', 1234, 'test', { HOME: '/real' }, true)
        .MAGPIE_NO_ACCOUNTS,
    ).toBe('0');
  });
  it('binds the gateway on 0.0.0.0 only when LAN access is enabled', () => {
    const base = { HOME: '/real' };
    expect(isolatedMagpieEnvironment('/private', 1234, 'test', base, false, true).MAGPIE_ADDR).toBe(
      '0.0.0.0:1234',
    );
    expect(isolatedMagpieEnvironment('/private', 1234, 'test', base, true, true).MAGPIE_ADDR).toBe(
      '0.0.0.0:1234',
    );
    expect(
      isolatedMagpieEnvironment('/private', 1234, 'test', base, false, false).MAGPIE_ADDR,
    ).toBe('127.0.0.1:1234');
  });
  it('forces private no-account, no-telemetry and no-update settings without touching home', async () => {
    const root = await temporary();
    try {
      await prepareMagpieHome(root);
      const value = JSON.parse(
        await fs.readFile(path.join(root, 'config/magpie/settings.json'), 'utf8'),
      );
      expect(value).toMatchObject({
        noAccountDiscovery: true,
        noWSLAgents: true,
        noAutoUpdate: true,
        noStats: true,
        noUsageStats: true,
        lan: false,
        gatewayMode: 'off',
      });
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
  it('requires pinned platform manifest and verified binary bytes', async () => {
    const root = await temporary();
    const dir = path.join(root, `${process.platform}-${process.arch}`);
    await fs.mkdir(dir);
    const binary = process.platform === 'win32' ? 'magpie.exe' : 'magpie';
    const manifest = {
      schemaVersion: 1,
      platform: process.platform,
      arch: process.arch,
      binary,
      source: { commit: MAGPIE_COMMIT },
      version: MAGPIE_VERSION,
      sha256: 'a'.repeat(64),
    };
    try {
      await fs.writeFile(path.join(dir, 'manifest.json'), JSON.stringify(manifest));
      await expect(
        verifyMagpieBinary(root, new AbortController().signal, async () => 'b'.repeat(64)),
      ).rejects.toThrow('integrity');
      expect(
        await verifyMagpieBinary(root, new AbortController().signal, async () => 'a'.repeat(64)),
      ).toBe(path.join(dir, binary));
      await fs.writeFile(
        path.join(dir, 'manifest.json'),
        JSON.stringify({ ...manifest, source: { commit: 'moving-main' } }),
      );
      await expect(
        verifyMagpieBinary(root, new AbortController().signal, async () => 'a'.repeat(64)),
      ).rejects.toThrow('manifest');
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
describe('Magpie owned lifecycle', () => {
  async function setup(
    serviceEnabled?: { read(): boolean; write(enabled: boolean): void },
    gatewayPort?: { read(): number | undefined; write(port: number): void },
    lanAccess?: { read(): { enabled: boolean; lanToken: string | null } },
  ) {
    const root = await temporary();
    let port = 21000;
    const child = Object.assign(new EventEmitter(), {
      exitCode: null as number | null,
      signalCode: null as string | null,
      kill: vi.fn(function () {
        child.exitCode = 0;
        queueMicrotask(() => child.emit('exit', 0));
        return true;
      }),
    });
    const spawn = vi.fn(() => child);
    const callerKeys: Array<{ id: string; name: string; secret?: string }> = [];
    const fetcher = vi.fn(async (url: string, _init?: RequestInit) => {
      if (url.endsWith('/api/hello'))
        return Response.json({ name: 'magpie', version: MAGPIE_VERSION });
      if (url.endsWith('/api/caller-keys'))
        return Response.json({
          keys: callerKeys.map(({ secret: _secret, ...rest }) => rest),
        });
      if (url.endsWith('/api/caller-keys/copy-key')) {
        const body = JSON.parse(String(_init?.body ?? '{}')) as { key?: string };
        const key = callerKeys.find(entry => entry.id === body.key);
        return Response.json({ keys: [], secret: key?.secret ?? '' });
      }
      if (url.endsWith('/api/caller-keys/add-key')) {
        const body = JSON.parse(String(_init?.body ?? '{}')) as {
          name?: string;
          secret?: string;
        };
        callerKeys.push({
          id: `lan-${callerKeys.length + 1}`,
          name: body.name,
          secret: body.secret,
        });
        return Response.json({ keys: [] });
      }
      if (url.endsWith('/api/caller-keys/remove-key')) {
        const body = JSON.parse(String(_init?.body ?? '{}')) as { key?: string };
        const index = callerKeys.findIndex(entry => entry.id === body.key);
        if (index >= 0) callerKeys.splice(index, 1);
        return Response.json({ keys: [] });
      }
      if (url.endsWith('/api/state'))
        return Response.json({
          settings: { secret: 'never-project' },
          agents: [
            {
              id: 'codex',
              name: 'Codex',
              wired: true,
              fields: [
                {
                  key: 'model',
                  label: 'Model',
                  value: 'm1',
                  options: [{ value: 'm2', label: 'Model two', token: 'secret' }],
                },
                { key: 'apiKey', label: 'Key', value: 'secret' },
              ],
            },
          ],
        });
      if (url.endsWith('/api/agents/cli'))
        return Response.json({
          agents: { codex: { version: '1', path: '/secret/path' } },
          pending: false,
        });
      if (url.endsWith('/v1/models'))
        return Response.json({ data: [{ id: 'm1', owned_by: 'test', key: 'secret' }] });
      if (url.endsWith('/api/providers'))
        return Response.json({
          providers: [
            {
              id: 'zhiyuan-host-enterprise',
              name: 'Enterprise Host',
              chat: 'http://127.0.0.1:8000',
              key: 'magpie-local',
              models: ['ent-1'],
              off: false,
            },
            {
              id: 'custom-openai',
              name: 'My OpenAI',
              chat: 'https://api.openai.com/v1',
              key: { set: true, masked: 'sk-…6789' },
              models: [
                { id: 'gpt-4o', on: true },
                { id: 'gpt-4o-mini', on: false },
              ],
              off: false,
            },
          ],
        });
      if (url.endsWith('/api/provider/key')) {
        const body = JSON.parse(String(_init?.body ?? '{}')) as { id?: string };
        if (body.id === 'custom-openai') return Response.json({ key: 'sk-secret123456789' });
        return Response.json({ key: '' });
      }
      if (url.includes('api.openai.com') && url.endsWith('/models')) {
        const headers = _init?.headers as Record<string, string> | undefined;
        if (headers?.Authorization === 'Bearer sk-secret123456789') {
          return Response.json({ data: [{ id: 'gpt-4o' }] });
        }
        return new Response('Unauthorized', { status: 401 });
      }
      if (
        url.endsWith('/api/provider/save') ||
        url.endsWith('/api/provider/on') ||
        url.endsWith('/api/provider/off')
      )
        return Response.json({ ok: true });
      if (url.includes('/api/agents/reapply/')) return Response.json({ ok: true });
      return Response.json({});
    });
    const manager = new MagpieManager({
      serviceEnabled,
      ...(lanAccess ? { lanAccess } : {}),
      parseCatalog: async bytes =>
        projectMagpieCatalog(JSON.parse(new TextDecoder().decode(bytes))),
      resourcesRoot: root,
      privateHome: root,
      environment: { HOME: root, USERPROFILE: root },
      verify: async () => '/fake/magpie',
      spawn: spawn as never,
      fetch: fetcher as never,
      port: async () => ++port,
      ...(gatewayPort ? { gatewayPort } : {}),
    });
    return { root, child, spawn, fetcher, manager, callerKeys };
  }
  it('stays stopped until explicitly enabled, starts once, projects only public fields, stops owned process', async () => {
    const { root, manager, spawn, fetcher, child } = await setup();
    try {
      expect(manager.status().state).toBe('stopped');
      expect(spawn).not.toHaveBeenCalled();
      expect(await manager.agents()).toEqual({ agents: [], pending: false });
      const [first, second] = await Promise.all([manager.start(), manager.start()]);
      expect(first.state).toBe('running');
      expect(second).toEqual(first);
      expect(spawn).toHaveBeenCalledTimes(1);
      expect(
        fetcher.mock.calls.some(
          ([url, init]) => url.endsWith('/api/state') && init?.method === 'POST',
        ),
      ).toBe(false);
      expect(JSON.stringify(await manager.agents())).not.toContain('secret');
      expect(await manager.models()).toMatchObject([{ id: 'm1', owned_by: 'test' }]);
      await manager.setModel({ agentId: 'codex', field: 'model', value: 'm2' });
      await expect(
        manager.setModel({ agentId: 'codex', field: 'model', value: 'gateway-id-not-valid-here' }),
      ).rejects.toThrow('Unknown agent model selection');
      const request = fetcher.mock.calls.find(([url]) => url.endsWith('/api/set'));
      expect(request?.[1]?.body).toBe(
        JSON.stringify({ Agent: 'codex', Field: 'model', Value: 'm2' }),
      );
      await expect(
        manager.setModel({ agentId: 'codex', field: 'apiKey', value: 'x' }),
      ).rejects.toThrow('Invalid');
      expect(await manager.stop()).toMatchObject({ state: 'stopped' });
      expect(child.kill).toHaveBeenCalled();
      expect(() => manager.managementConnection()).toThrow('unavailable');
    } finally {
      await manager.stop();
      await fs.rm(root, { recursive: true, force: true });
    }
  });
  it('cancels startup and never exposes credentials in status or errors', async () => {
    const root = await temporary();
    const spawn = vi.fn();
    const manager = new MagpieManager({
      parseCatalog: async bytes =>
        projectMagpieCatalog(JSON.parse(new TextDecoder().decode(bytes))),
      privateHome: root,
      resourcesRoot: root,
      spawn: spawn as never,
      verify: async (_root, signal) => {
        await new Promise(resolve => setTimeout(resolve, 10));
        signal.throwIfAborted();
        return '/fake';
      },
    });
    try {
      const start = manager.start();
      const stop = manager.stop();
      expect((await start).state).toBe('stopped');
      expect((await stop).state).toBe('stopped');
      expect(spawn).not.toHaveBeenCalled();
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
  it('persists explicit enable across shutdown, lazily starts once after restart, and honors explicit disable', async () => {
    let enabled = false;
    const preference = {
      read: () => enabled,
      write: (value: boolean) => {
        enabled = value;
      },
    };
    const first = await setup(preference);
    let second: Awaited<ReturnType<typeof setup>> | undefined;
    try {
      expect(first.manager.status().enabled).toBe(false);
      await expect(first.manager.ensureRunning()).rejects.toThrow('Enable');
      expect(first.spawn).not.toHaveBeenCalled();
      await first.manager.start();
      expect(enabled).toBe(true);
      await first.manager.shutdown();
      expect(enabled).toBe(true);
      second = await setup(preference);
      expect(second.manager.status()).toMatchObject({ enabled: true, state: 'stopped' });
      expect(await second.manager.models()).toEqual([]);
      expect(second.spawn).not.toHaveBeenCalled();
      await Promise.all([second.manager.ensureRunning(), second.manager.ensureRunning()]);
      expect(second.spawn).toHaveBeenCalledTimes(1);
      await second.manager.stop();
      expect(enabled).toBe(false);
      await expect(second.manager.ensureRunning()).rejects.toThrow('Enable');
      expect(second.spawn).toHaveBeenCalledTimes(1);
    } finally {
      await first.manager.shutdown();
      if (second) {
        await second.manager.shutdown();
        await fs.rm(second.root, { recursive: true, force: true });
      }
      await fs.rm(first.root, { recursive: true, force: true });
    }
  });
  it('shares one failed lazy startup and retains enablement without a fallback', async () => {
    const verify = vi.fn(async () => {
      throw new Error('fixture bad manifest');
    });
    const manager = new MagpieManager({
      resourcesRoot: '/unused',
      privateHome: '/unused',
      serviceEnabled: { read: () => true, write: () => {} },
      verify,
    });
    const results = await Promise.allSettled([manager.ensureRunning(), manager.ensureRunning()]);
    expect(results.every(result => result.status === 'rejected')).toBe(true);
    expect(verify).toHaveBeenCalledTimes(1);
    expect(manager.status()).toMatchObject({ state: 'failed', enabled: true });
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

  it('reapplies wired managed agents after startup and persists the gateway port', async () => {
    let gatewayPort = 0;
    const store = {
      read: () => gatewayPort || undefined,
      write: (port: number) => {
        gatewayPort = port;
      },
    };
    const { manager, root, fetcher } = await setup(undefined, store);
    try {
      const started = Date.now();
      await manager.start();
      expect(Date.now() - started).toBeLessThan(5_000);
      expect(gatewayPort).toBeGreaterThan(0);
      await new Promise(resolve => setTimeout(resolve, 50));
      expect(
        fetcher.mock.calls.some(
          ([url, init]) => url.includes('/api/agents/reapply/codex') && init?.method === 'POST',
        ),
      ).toBe(true);
    } finally {
      await manager.shutdown();
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('does not call ensureRunning for disconnectAll when the service is stopped', async () => {
    const { manager, root } = await setup();
    try {
      const ensureRunning = vi.spyOn(manager, 'ensureRunning');
      await expect(manager.disconnectAllAgents()).resolves.toEqual({ agents: [], pending: false });
      expect(ensureRunning).not.toHaveBeenCalled();
    } finally {
      await manager.shutdown();
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('disconnectAll is a no-op when no managed agents are wired', async () => {
    const { manager, root, fetcher } = await setup();
    try {
      await manager.start();
      const prior = fetcher.getMockImplementation();
      fetcher.mockImplementation(async (url: string, init?: RequestInit) => {
        if (url.includes('/api/agents/disconnect/')) {
          throw new Error('unexpected disconnect call');
        }
        if (url.endsWith('/api/state')) {
          return Response.json({
            settings: {},
            agents: [
              {
                id: 'codex',
                name: 'Codex',
                wired: false,
                fields: [{ key: 'model', label: 'Model', value: 'm1', options: [] }],
              },
            ],
          });
        }
        return prior!(url, init);
      });
      fetcher.mockClear();
      await manager.disconnectAllAgents();
      expect(fetcher.mock.calls.some(([url]) => url.includes('/api/agents/disconnect/'))).toBe(
        false,
      );
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

  it('starts with LAN access even when the service is disabled, binds 0.0.0.0 and imports the LAN key', async () => {
    let lanToken: string | null = 'sk-lan-token';
    const lanAccess = { read: () => ({ enabled: true, lanToken }) };
    const { manager, root, spawn, callerKeys } = await setup(undefined, undefined, lanAccess);
    try {
      expect(manager.status().enabled).toBe(false);
      const status = await manager.onLanAccessChanged();
      expect(status.state).toBe('running');
      expect(spawn).toHaveBeenCalledTimes(1);
      expect(manager.status().enabled).toBe(false); // preference untouched
      const env = spawn.mock.calls[0][2].env as NodeJS.ProcessEnv;
      expect(env.MAGPIE_ADDR).toMatch(/^0\.0\.0\.0:\d+$/);
      await vi.waitFor(() =>
        expect(callerKeys).toEqual([
          { id: 'lan-1', name: MAGPIE_LAN_KEY_NAME, secret: 'sk-lan-token' },
        ]),
      );
    } finally {
      await manager.shutdown();
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('keeps the service preference off after a LAN-only run stops', async () => {
    let enabled = false;
    const preference = {
      read: () => enabled,
      write: (value: boolean) => {
        enabled = value;
      },
    };
    let lanEnabled = true;
    const lanAccess = { read: () => ({ enabled: lanEnabled, lanToken: 'sk-lan-token' }) };
    const { manager, root } = await setup(preference, undefined, lanAccess);
    try {
      await manager.onLanAccessChanged();
      expect(enabled).toBe(false);
      lanEnabled = false;
      // LAN was the only reason to run: stopping returns to stopped, not failed.
      expect((await manager.onLanAccessChanged()).state).toBe('stopped');
      expect(enabled).toBe(false);
      expect(await manager.ensureRunning().catch((): null => null)).toBeNull();
    } finally {
      await manager.shutdown();
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('restarts the owned process when the LAN toggle flips', async () => {
    let lanEnabled = false;
    const lanAccess = { read: () => ({ enabled: lanEnabled, lanToken: 'sk-lan-token' }) };
    const { manager, root, spawn } = await setup(
      { read: () => true, write: () => {} },
      undefined,
      lanAccess,
    );
    try {
      await manager.start();
      expect((spawn.mock.calls[0][2].env as NodeJS.ProcessEnv).MAGPIE_ADDR).toMatch(
        /^127\.0\.0\.1:/,
      );
      lanEnabled = true;
      expect((await manager.onLanAccessChanged()).state).toBe('running');
      expect(spawn).toHaveBeenCalledTimes(2);
      expect((spawn.mock.calls[1][2].env as NodeJS.ProcessEnv).MAGPIE_ADDR).toMatch(/^0\.0\.0\.0:/);
      lanEnabled = false;
      expect((await manager.onLanAccessChanged()).state).toBe('running');
      expect(spawn).toHaveBeenCalledTimes(3);
      expect((spawn.mock.calls[2][2].env as NodeJS.ProcessEnv).MAGPIE_ADDR).toMatch(
        /^127\.0\.0\.1:/,
      );
    } finally {
      await manager.shutdown();
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('replaces the imported key after the LAN token is regenerated', async () => {
    let lanToken: string | null = 'sk-lan-first';
    const lanAccess = { read: () => ({ enabled: true, lanToken }) };
    const { manager, root, callerKeys } = await setup(undefined, undefined, lanAccess);
    try {
      await manager.onLanAccessChanged();
      await vi.waitFor(() => expect(callerKeys).toHaveLength(1));
      lanToken = 'sk-lan-second';
      await manager.onLanAccessTokenRegenerated();
      expect(callerKeys).toEqual([
        { id: 'lan-2', name: MAGPIE_LAN_KEY_NAME, secret: 'sk-lan-second' },
      ]);
    } finally {
      await manager.shutdown();
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
