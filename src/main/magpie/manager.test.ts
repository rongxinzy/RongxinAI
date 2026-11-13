import { describe, it, expect, vi } from 'vitest';

import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import { PassThrough } from 'node:stream';

import { projectMagpieCatalog } from './catalog';
import { MagpieManager } from './manager';

import { MAGPIE_LAN_KEY_NAME } from './lanAccess';

import { setup, temporary } from './manager.testHarness';
describe('Magpie owned lifecycle', () => {
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

  it('logs sanitized startup stderr and exit phase when launch fails while keeping status error sanitized', async () => {
    const root = await temporary();
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const manager = new MagpieManager({
      privateHome: root,
      resourcesRoot: root,
      serviceEnabled: { read: () => true, write: () => {} },
      verify: async () => '/fake/magpie.exe',
      spawn: (() => {
        const stderr = new PassThrough();
        const child = Object.assign(new EventEmitter(), {
          exitCode: null as number | null,
          signalCode: null as string | null,
          stderr,
          kill: vi.fn(() => true),
        });
        queueMicrotask(() => {
          stderr.write('listen tcp 127.0.0.1:18425: bind failed bearer secret123');
          stderr.end();
          child.exitCode = 1;
          child.emit('exit', 1, null);
        });
        return child;
      }) as never,
    });
    try {
      await expect(manager.ensureRunning()).rejects.toThrow(
        'Unable to start the verified local model service',
      );
      expect(manager.status()).toMatchObject({
        state: 'failed',
        error: 'Unable to start the verified local model service',
      });
      const launchWarn = warnSpy.mock.calls.find(([msg]) =>
        String(msg).includes('[Magpie] Launch failed:'),
      );
      expect(launchWarn?.[1]).toMatchObject({
        phase: 'probe',
        exitCode: 1,
        stderr: expect.stringContaining('listen tcp 127.0.0.1:18425: bind failed'),
      });
      expect(JSON.stringify(launchWarn?.[1])).not.toContain('secret123');
    } finally {
      warnSpy.mockRestore();
      await manager.shutdown();
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('recoverIfNeeded skips restart when healthy and restarts when gateway probe fails', async () => {
    const { manager, root, spawn, fetcher } = await setup({ read: () => true, write: () => {} });
    try {
      await manager.start();
      expect(spawn).toHaveBeenCalledTimes(1);

      const healthy = await manager.recoverIfNeeded();
      expect(healthy.state).toBe('running');
      expect(spawn).toHaveBeenCalledTimes(1);

      const originalFetch = fetcher.getMockImplementation()!;
      let failNextHello = true;
      fetcher.mockImplementation(async (url: string, init?: RequestInit) => {
        if (url.endsWith('/api/hello') && failNextHello) {
          failNextHello = false;
          throw new Error('connect ECONNREFUSED 127.0.0.1:18425');
        }
        return originalFetch(url, init);
      });

      const recovered = await manager.recoverIfNeeded();
      expect(recovered.state).toBe('running');
      expect(spawn).toHaveBeenCalledTimes(2);
    } finally {
      await manager.shutdown();
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
