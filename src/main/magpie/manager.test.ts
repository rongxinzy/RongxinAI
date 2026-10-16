import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { projectMagpieCatalog } from './catalog';
import { MagpieManager } from './manager';
import { isolatedMagpieEnvironment, prepareMagpieHome } from './environment';
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
  async function setup(serviceEnabled?: { read(): boolean; write(enabled: boolean): void }) {
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
    const fetcher = vi.fn(async (url: string, _init?: RequestInit) => {
      if (url.endsWith('/api/hello'))
        return Response.json({ name: 'magpie', version: MAGPIE_VERSION });
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
      return Response.json({});
    });
    const manager = new MagpieManager({
      serviceEnabled,
      parseCatalog: async bytes =>
        projectMagpieCatalog(JSON.parse(new TextDecoder().decode(bytes))),
      resourcesRoot: root,
      privateHome: root,
      environment: { HOME: root, USERPROFILE: root },
      verify: async () => '/fake/magpie',
      spawn: spawn as never,
      fetch: fetcher as never,
      port: async () => ++port,
    });
    return { root, child, spawn, fetcher, manager };
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
      expect(fetcher.mock.calls.some(([url]) => url.endsWith('/api/state'))).toBe(false);
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
});
