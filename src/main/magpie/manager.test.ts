import { describe, it, expect, vi } from 'vitest';

import { EventEmitter } from 'node:events';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { PassThrough } from 'node:stream';

import { projectMagpieCatalog } from './catalog';
import { MagpieManager } from './manager';

import { MAGPIE_LAN_KEY_NAME } from './lanAccess';

import { installJobRunnerFixture, setup, temporary } from './manager.testHarness';
describe('Magpie owned lifecycle', () => {
  it('limits the graceful quit request before falling back to the owned process', async () => {
    const { root, manager, fetcher, child } = await setup();
    const quitRequest = Promise.withResolvers<Response>();
    const quitStarted = Promise.withResolvers<void>();
    let stopping: ReturnType<typeof manager.shutdown> | undefined;
    try {
      expect((await manager.start()).state).toBe('running');
      const fetchNormally = fetcher.getMockImplementation()!;
      fetcher.mockImplementation((url, init) => {
        if (!url.endsWith('/api/window/quit')) return fetchNormally(url, init);
        quitStarted.resolve();
        return quitRequest.promise;
      });
      const deadline = vi.spyOn(AbortSignal, 'timeout');
      try {
        stopping = manager.shutdown();
        await quitStarted.promise;
        expect(deadline).toHaveBeenCalledWith(1_000);
      } finally {
        deadline.mockRestore();
        quitRequest.reject(new Error('Graceful quit unavailable'));
        await stopping;
      }
      expect(child.kill).toHaveBeenCalledWith('SIGTERM');
      expect(manager.status().state).toBe('stopped');
    } finally {
      await manager.shutdown();
      await fs.rm(root, { recursive: true, force: true });
    }
  });

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
      fetcher.mockClear();
      await expect(
        manager.setModel({ agentId: 'codex', field: 'model', value: 'm2' }),
      ).resolves.toMatchObject({
        agents: [{ id: 'codex', version: '1' }],
      });
      expect(fetcher.mock.calls.map(([url]) => new URL(url).pathname)).toEqual([
        '/api/state',
        '/api/set',
        '/api/agents/cli',
      ]);
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
  it('provides a private Work key only for the current owned gateway process', async () => {
    const ports = [21001, 21002, 21001, 21003];
    const { manager, root, spawn, child, callerKeys } = await setup(
      undefined,
      undefined,
      undefined,
      {
        managerOptions: { port: async () => ports.shift()! },
      },
    );
    const origin = 'http://127.0.0.1:21001';
    try {
      expect(manager.workKeyResolver(origin)).toBeUndefined();
      const status = await manager.start();
      expect(status.gatewayUrl).toBe(origin);
      expect(manager.workKeyResolver(`${origin}/`)).toBeUndefined();
      const firstResolver = manager.workKeyResolver(origin)!;
      const key = firstResolver()!;
      expect(key).toMatch(/^sk-zhiyuan-work-[A-Za-z0-9_-]{43}$/);
      const [, args, options] = spawn.mock.calls[0];
      expect(options.env?.MAGPIE_WORK_KEY_SHA256).toBe(
        createHash('sha256').update(key).digest('hex'),
      );
      expect(JSON.stringify([args, options.env, manager.status()])).not.toContain(key);
      expect(callerKeys).toEqual([]);
      expect(
        await fs.readFile(path.join(root, 'config/magpie/settings.json'), 'utf8'),
      ).not.toContain(key);

      const stopping = manager.stop();
      expect(firstResolver()).toBeUndefined();
      expect(manager.workKeyResolver(origin)).toBeUndefined();
      await stopping;
      child.exitCode = null;
      expect((await manager.start()).gatewayUrl).toBe(origin);
      const secondResolver = manager.workKeyResolver(origin)!;
      expect(secondResolver()).toBeTruthy();
      expect(secondResolver()).not.toBe(key);
      expect(firstResolver()).toBeUndefined();

      child.emit('exit', 1);
      expect(manager.status().state).toBe('failed');
      expect(secondResolver()).toBeUndefined();
    } finally {
      await manager.shutdown();
      await fs.rm(root, { recursive: true, force: true });
    }
  });
  it('does not share a pending catalog read with a restarted process on the same port', async () => {
    const ports = [21001, 21002, 21001, 21003];
    const old = Promise.withResolvers<{ id: string }[]>();
    const parsing = Promise.withResolvers<void>();
    const parseCatalog = vi
      .fn(async () => [{ id: 'next/model' }])
      .mockImplementationOnce(() => {
        parsing.resolve();
        return old.promise;
      });
    const { manager, root, child } = await setup(undefined, undefined, undefined, {
      managerOptions: { port: async () => ports.shift()!, parseCatalog },
    });
    try {
      const first = await manager.start();
      const before = manager.models();
      const oldRejected = expect(before).rejects.toThrow();
      await parsing.promise;
      await manager.stop();
      child.exitCode = null;
      expect((await manager.start()).gatewayUrl).toBe(first.gatewayUrl);
      const after = manager.models();
      expect(after).not.toBe(before);
      expect(await after).toEqual([{ id: 'next/model' }]);
      old.resolve([{ id: 'previous/model' }]);
      await oldRejected;
    } finally {
      old.resolve([]);
      await manager.shutdown();
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
      lanEnabled = true;
      expect((await manager.onLanAccessChanged()).state).toBe('running');
      expect(enabled).toBe(false);
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

  it('does not relaunch a pending LAN restart after application shutdown', async () => {
    let lanEnabled = false;
    const write = vi.fn();
    const { manager, root, spawn } = await setup({ read: () => true, write }, undefined, {
      read: () => ({ enabled: lanEnabled, lanToken: 'sk-lan-token' }),
    });
    try {
      await manager.start();
      write.mockClear();
      lanEnabled = true;
      const toggling = manager.onLanAccessChanged();
      const shutdown = manager.shutdown();
      expect(await toggling).toMatchObject({ state: 'stopped', enabled: true });
      await shutdown;
      await expect(manager.ensureRunning()).rejects.toThrow();
      await expect(manager.start()).rejects.toThrow();
      expect((await manager.onLanAccessChanged()).state).toBe('stopped');
      expect(spawn).toHaveBeenCalledOnce();
      expect(write).not.toHaveBeenCalled();
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

  it('keeps only the latest LAN key when a rotation overlaps the startup import', async () => {
    let lanToken = 'sk-lan-startup';
    const { manager, root, fetcher, callerKeys } = await setup(undefined, undefined, {
      read: () => ({ enabled: true, lanToken }),
    });
    const originalFetch = fetcher.getMockImplementation()!;
    const firstRead = Promise.withResolvers<Response>();
    const started = Promise.withResolvers<void>();
    const steps: string[] = [];
    fetcher.mockImplementation(async (url, init) => {
      if (url.endsWith('/api/caller-keys')) {
        steps.push('read');
        if (steps.length === 1) {
          started.resolve();
          return firstRead.promise;
        }
      }
      if (url.endsWith('/api/caller-keys/add-key')) steps.push('add');
      return originalFetch(url, init);
    });
    try {
      await manager.start();
      await started.promise;
      lanToken = 'sk-lan-latest';
      const rotated = manager.onLanAccessTokenRegenerated();
      await new Promise<void>(resolve => setImmediate(resolve));
      firstRead.resolve(Response.json({ keys: [] }));
      await rotated;
      expect(steps).toEqual(['read', 'add', 'read', 'add']);
      await vi.waitFor(() => expect(callerKeys.map(key => key.secret)).toEqual(['sk-lan-latest']));
    } finally {
      firstRead.resolve(Response.json({ keys: [] }));
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
      platform: 'darwin',
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
        'Unable to start the verified model service',
      );
      expect(manager.status()).toMatchObject({
        state: 'failed',
        error: 'Unable to start the verified model service',
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

  it('retries once inside recoverIfNeeded when the first post-wake restart fails', async () => {
    const { manager, root, spawn, fetcher } = await setup(
      { read: () => true, write: () => {} },
      undefined,
      undefined,
      { managerOptions: { recoveryRetryDelayMs: 0 } },
    );
    try {
      await manager.start();
      expect(spawn).toHaveBeenCalledTimes(1);

      const originalFetch = fetcher.getMockImplementation()!;
      let failHelloProbe = true;
      fetcher.mockImplementation(async (url: string, init?: RequestInit) => {
        if (url.endsWith('/api/hello') && failHelloProbe) {
          failHelloProbe = false;
          throw new Error('connect ECONNREFUSED 127.0.0.1:18425');
        }
        return originalFetch(url, init);
      });
      // First restart's child (1st call after mock swap) exits before probe succeeds; retry succeeds.
      let restartSpawnCount = 0;
      const originalSpawnImpl = spawn.getMockImplementation()!;
      spawn.mockImplementation(((...args: Parameters<typeof originalSpawnImpl>) => {
        restartSpawnCount += 1;
        if (restartSpawnCount === 1) {
          const deadChild = Object.assign(new EventEmitter(), {
            exitCode: 1 as number | null,
            signalCode: null as string | null,
            kill: vi.fn(() => true),
          });
          queueMicrotask(() => {
            deadChild.emit('exit', 1, null);
          });
          return deadChild as never;
        }
        return originalSpawnImpl(...args);
      }) as typeof originalSpawnImpl);

      manager.onSuspend();
      const recovered = await manager.recoverIfNeeded();
      expect(recovered.state).toBe('running');
      expect(spawn).toHaveBeenCalledTimes(3);
    } finally {
      await manager.shutdown();
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('refuses an unsupervised Windows launch when the bundled job runner is missing', async () => {
    const { manager, root, spawn } = await setup(undefined, undefined, undefined, {
      managerOptions: { platform: 'win32' },
    });
    try {
      expect((await manager.start()).state).toBe('failed');
      expect(spawn).not.toHaveBeenCalled();
    } finally {
      await manager.shutdown();
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('wraps Magpie in the Windows job runner and confirms that the runner exited', async () => {
    const { manager, root, spawn } = await setup(
      { read: () => true, write: () => {} },
      undefined,
      undefined,
      {
        managerOptions: { platform: 'win32' },
      },
    );
    const originalSpawnImpl = spawn.getMockImplementation()!;
    let spawnedChild: ReturnType<typeof originalSpawnImpl> | undefined;
    const signals: Array<NodeJS.Signals | number | undefined> = [];
    spawn.mockImplementation(((...args: Parameters<typeof originalSpawnImpl>) => {
      const child = originalSpawnImpl(...args);
      spawnedChild = child;
      (child as { pid?: number }).pid = 43210;
      // Keep the supervisor alive until the direct force signal.
      const origKill = child.kill.bind(child);
      child.kill = ((sig?: NodeJS.Signals | number) => {
        signals.push(sig);
        if (sig === 'SIGTERM') return true;
        return origKill(sig);
      }) as typeof child.kill;
      return child;
    }) as typeof originalSpawnImpl);

    try {
      const jobRunner = await installJobRunnerFixture(root);
      const started = await manager.start();
      expect(started.state).toBe('running');
      expect(spawn).toHaveBeenCalledWith(
        jobRunner,
        [
          String(process.pid),
          expect.stringContaining('magpie'),
          'web',
          '--addr',
          expect.any(String),
          '--no-open',
        ],
        expect.objectContaining({ windowsHide: true, shell: false }),
      );
      expect(spawnedChild).toBeDefined();
      vi.useFakeTimers();
      const stopped = vi.fn();
      const stopping = manager.shutdown().then(stopped);
      await vi.advanceTimersByTimeAsync(400);
      expect(signals).toEqual(['SIGTERM']);
      expect(stopped).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1_000);
      expect(signals).toEqual(['SIGTERM', 'SIGKILL']);
      expect(stopped).toHaveBeenCalledWith(expect.objectContaining({ state: 'stopped' }));
      expect(spawnedChild?.exitCode).toBe(0);
      await stopping;
    } finally {
      vi.useRealTimers();
      await manager.shutdown();
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('keeps ownership and refuses to launch a replacement if the process never exits', async () => {
    const { manager, root, child, spawn, fetcher } = await setup();
    const originalKill = child.kill.getMockImplementation()!;
    try {
      await manager.start();
      child.kill.mockImplementation(() => true);
      vi.useFakeTimers();
      const failure = expect(manager.stop()).rejects.toThrow();
      await vi.advanceTimersByTimeAsync(5_000);
      await failure;
      expect(manager.status().state).toBe('failed');
      await expect(manager.start()).rejects.toThrow('previous model service');
      expect(spawn).toHaveBeenCalledOnce();
      expect(fetcher.mock.calls.some(([url]) => url.endsWith('/api/window/quit'))).toBe(true);
    } finally {
      vi.useRealTimers();
      child.kill.mockImplementation(originalKill);
      await manager.shutdown();
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
