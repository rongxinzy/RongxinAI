import { describe, it, expect, vi } from 'vitest';

import fs from 'node:fs/promises';

import path from 'node:path';

import { mergeOpenCodeConfigToUser } from './externalAgentHostConfig';
import { setup } from './manager.testHarness';
describe('Magpie agent lifecycle', () => {
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

  it('pushes a reapply port change into the user OpenCode config and keeps the stash', async () => {
    const { manager, root } = await setup(undefined, undefined, undefined, {
      agents: [{ id: 'opencode', name: 'OpenCode', wired: true }],
    });
    const userFile = path.join(root, '.config', 'opencode', 'opencode.json');
    const privateFile = path.join(root, 'config', 'opencode', 'opencode.json');
    const stashFile = path.join(root, 'host-agent-stash', 'opencode-merge.json');
    const writePrivate = async (port: number) => {
      await fs.mkdir(path.dirname(privateFile), { recursive: true });
      await fs.writeFile(
        privateFile,
        `${JSON.stringify({ provider: { magpie: { baseUrl: `http://127.0.0.1:${port}/v1` } }, model: 'gateway/model' }, null, 2)}\n`,
      );
    };
    try {
      await fs.mkdir(path.dirname(userFile), { recursive: true });
      await fs.writeFile(
        userFile,
        `${JSON.stringify({ provider: { mine: { baseUrl: 'https://mine.test/v1' } } }, null, 2)}\n`,
      );
      await writePrivate(1111);
      await mergeOpenCodeConfigToUser(root, root);
      await writePrivate(2222);

      await manager.start();
      const gateway = manager.status().gatewayUrl;
      expect(gateway).toBeTruthy();
      await vi.waitFor(async () => {
        expect(await fs.readFile(userFile, 'utf8')).toContain(`${gateway}/v1`);
      });
      const written = await fs.readFile(userFile, 'utf8');
      expect(written).not.toContain('127.0.0.1:2222');
      const stash = JSON.parse(await fs.readFile(stashFile, 'utf8')) as {
        addedProviderKeys: string[];
        replacedProviderValues: Record<string, unknown>;
      };
      expect(stash.addedProviderKeys).toEqual(['magpie']);
      expect(stash.replacedProviderValues).toEqual({});
      expect(written).toContain('https://mine.test/v1');
    } finally {
      await manager.shutdown();
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('retries a slow startup sweep before syncing the user config', async () => {
    const { manager, root, fetcher } = await setup(undefined, undefined, undefined, {
      agents: [{ id: 'opencode', name: 'OpenCode', wired: true }],
      failAgentsTimes: 1,
    });
    const userFile = path.join(root, '.config', 'opencode', 'opencode.json');
    try {
      await fs.mkdir(path.dirname(userFile), { recursive: true });
      await fs.writeFile(
        userFile,
        `${JSON.stringify({ provider: { magpie: { options: { baseURL: 'http://127.0.0.1:1111/v1' } } } }, null, 2)}\n`,
      );
      await manager.start();
      const gateway = manager.status().gatewayUrl;
      await vi.waitFor(
        async () => {
          expect(await fs.readFile(userFile, 'utf8')).toContain(`${gateway}/v1`);
        },
        { timeout: 5_000 },
      );
      expect(
        fetcher.mock.calls.filter(([url]) => url.includes('/api/agents/reapply/opencode')).length,
      ).toBeGreaterThan(0);
    } finally {
      await manager.shutdown();
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('updates the user OpenCode config when magpie keeps no private copy', async () => {
    const { manager, root } = await setup(undefined, undefined, undefined, {
      agents: [{ id: 'opencode', name: 'OpenCode', wired: true }],
    });
    const userFile = path.join(root, '.config', 'opencode', 'opencode.json');
    try {
      await fs.mkdir(path.dirname(userFile), { recursive: true });
      await fs.writeFile(
        userFile,
        `${JSON.stringify({ provider: { magpie: { options: { baseURL: 'http://127.0.0.1:1111/v1' } } } }, null, 2)}\n`,
      );

      await manager.start();
      const gateway = manager.status().gatewayUrl;
      expect(gateway).toBeTruthy();
      await vi.waitFor(async () => {
        expect(await fs.readFile(userFile, 'utf8')).toContain(`${gateway}/v1`);
      });
    } finally {
      await manager.shutdown();
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('keeps the previous gateway port when the opencode reapply fails', async () => {
    const { manager, root, fetcher } = await setup(undefined, undefined, undefined, {
      agents: [{ id: 'opencode', name: 'OpenCode', wired: true }],
      failReapply: ['opencode'],
    });
    const userFile = path.join(root, '.config', 'opencode', 'opencode.json');
    const privateFile = path.join(root, 'config', 'opencode', 'opencode.json');
    const writePrivate = async (port: number) => {
      await fs.mkdir(path.dirname(privateFile), { recursive: true });
      await fs.writeFile(
        privateFile,
        `${JSON.stringify({ provider: { magpie: { baseUrl: `http://127.0.0.1:${port}/v1` } } }, null, 2)}\n`,
      );
    };
    try {
      await fs.mkdir(path.dirname(userFile), { recursive: true });
      await fs.writeFile(userFile, `${JSON.stringify({ provider: {} }, null, 2)}\n`);
      await writePrivate(1111);
      await mergeOpenCodeConfigToUser(root, root);
      await writePrivate(2222);

      await manager.start();
      await vi.waitFor(() => {
        expect(
          fetcher.mock.calls.some(([url]) => url.includes('/api/agents/reapply/opencode')),
        ).toBe(true);
      });
      await new Promise(resolve => setTimeout(resolve, 100));
      const user = await fs.readFile(userFile, 'utf8');
      expect(user).toContain('127.0.0.1:1111');
      expect(user).not.toContain('127.0.0.1:2222');
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
});
