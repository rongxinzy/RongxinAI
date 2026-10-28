import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  clearLegacyHostAgentStorage,
  collectDirectorySnapshot,
  mergeOpenCodeConfigToUser,
  revertOpenCodeConfigFromUser,
  syncOpenCodeConfigToUser,
  stripCodexMagpieProviderBlock,
} from './externalAgentHostConfig';

describe('externalAgentHostConfig', () => {
  const roots: string[] = [];
  afterEach(async () => {
    await Promise.all(roots.map(root => fs.rm(root, { recursive: true, force: true })));
    roots.length = 0;
  });

  it('merges magpie provider keys without removing the user provider entries', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'magpie-opencode-'));
    roots.push(root);
    const privateHome = path.join(root, 'service');
    const userFile = path.join(root, '.config', 'opencode', 'opencode.json');
    const original = `${JSON.stringify({ provider: { mine: { baseUrl: 'https://mine.test' } }, model: 'user-model' }, null, 2)}\n`;
    await fs.mkdir(path.dirname(userFile), { recursive: true });
    await fs.writeFile(userFile, original);
    const privateFile = path.join(privateHome, 'config', 'opencode', 'opencode.json');
    await fs.mkdir(path.dirname(privateFile), { recursive: true });
    await fs.writeFile(
      privateFile,
      `${JSON.stringify({ provider: { magpie: { baseUrl: 'http://127.0.0.1:1/v1' } }, model: 'magpie-model' }, null, 2)}\n`,
    );
    await mergeOpenCodeConfigToUser(privateHome, root);
    const merged = JSON.parse(await fs.readFile(userFile, 'utf8'));
    expect(merged.provider.mine.baseUrl).toBe('https://mine.test');
    expect(merged.provider.magpie.baseUrl).toContain('127.0.0.1');
    expect(merged.model).toBe('magpie-model');
    await revertOpenCodeConfigFromUser(privateHome, root);
    expect(await fs.readFile(userFile, 'utf8')).toBe(original);
  });

  it('syncs a new gateway port into the user config without rewriting the stash', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'magpie-opencode-port-sync-'));
    roots.push(root);
    const privateHome = path.join(root, 'service');
    const userFile = path.join(root, '.config', 'opencode', 'opencode.json');
    const stashFile = path.join(privateHome, 'host-agent-stash', 'opencode-merge.json');
    const original = `${JSON.stringify({ provider: { mine: { baseUrl: 'https://mine.test/v1' } } }, null, 2)}\n`;
    await fs.mkdir(path.dirname(userFile), { recursive: true });
    await fs.writeFile(userFile, original);
    const privateFile = path.join(privateHome, 'config', 'opencode', 'opencode.json');
    const writePrivate = async (port: number) => {
      await fs.mkdir(path.dirname(privateFile), { recursive: true });
      await fs.writeFile(
        privateFile,
        `${JSON.stringify({ provider: { magpie: { baseUrl: `http://127.0.0.1:${port}/v1` } }, model: 'gateway/model' }, null, 2)}\n`,
      );
    };

    await writePrivate(1111);
    await mergeOpenCodeConfigToUser(privateHome, root);
    expect(await fs.readFile(userFile, 'utf8')).toContain('127.0.0.1:1111');

    await writePrivate(2222);
    await syncOpenCodeConfigToUser(privateHome, root);

    const synced = JSON.parse(await fs.readFile(userFile, 'utf8')) as {
      provider: Record<string, { baseUrl: string }>;
    };
    expect(synced.provider.magpie.baseUrl).toContain('127.0.0.1:2222');
    expect(synced.provider.mine.baseUrl).toBe('https://mine.test/v1');

    const stash = JSON.parse(await fs.readFile(stashFile, 'utf8')) as {
      addedProviderKeys: string[];
      replacedProviderValues: Record<string, unknown>;
    };
    expect(stash.addedProviderKeys).toEqual(['magpie']);
    expect(stash.replacedProviderValues).toEqual({});

    await revertOpenCodeConfigFromUser(privateHome, root);
    expect(await fs.readFile(userFile, 'utf8')).toBe(original);
  });

  it('leaves the user file untouched when it already matches the private config', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'magpie-opencode-port-noop-'));
    roots.push(root);
    const privateHome = path.join(root, 'service');
    const userFile = path.join(root, '.config', 'opencode', 'opencode.json');
    await fs.mkdir(path.dirname(userFile), { recursive: true });
    await fs.writeFile(
      userFile,
      `${JSON.stringify({ provider: { mine: { baseUrl: 'https://mine.test/v1' } } }, null, 2)}\n`,
    );
    const privateFile = path.join(privateHome, 'config', 'opencode', 'opencode.json');
    const writePrivate = async (port: number) => {
      await fs.mkdir(path.dirname(privateFile), { recursive: true });
      await fs.writeFile(
        privateFile,
        `${JSON.stringify({ provider: { magpie: { baseUrl: `http://127.0.0.1:${port}/v1` } }, model: 'gateway/model' }, null, 2)}\n`,
      );
    };
    await writePrivate(1111);
    await mergeOpenCodeConfigToUser(privateHome, root);

    const before = await fs.readFile(userFile, 'utf8');
    const stashBefore = await fs.readFile(
      path.join(privateHome, 'host-agent-stash', 'opencode-merge.json'),
      'utf8',
    );
    await syncOpenCodeConfigToUser(privateHome, root);
    expect(await fs.readFile(userFile, 'utf8')).toBe(before);
    expect(
      await fs.readFile(path.join(privateHome, 'host-agent-stash', 'opencode-merge.json'), 'utf8'),
    ).toBe(stashBefore);
  });

  it('moves the user file onto the live gateway when magpie keeps no private copy', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'magpie-opencode-gateway-sync-'));
    roots.push(root);
    const privateHome = path.join(root, 'service');
    const userFile = path.join(root, '.config', 'opencode', 'opencode.json');
    await fs.mkdir(path.dirname(userFile), { recursive: true });
    await fs.writeFile(
      userFile,
      `${JSON.stringify(
        {
          $schema: 'https://opencode.ai/config.json',
          provider: {
            mine: { baseUrl: 'https://mine.test/v1' },
            magpie: { options: { apiKey: 'magpie', baseURL: 'http://127.0.0.1:1111/v1' } },
          },
          model: 'magpie/model',
        },
        null,
        2,
      )}\n`,
    );

    await syncOpenCodeConfigToUser(privateHome, root, 'http://127.0.0.1:2222');
    const synced = JSON.parse(await fs.readFile(userFile, 'utf8')) as {
      provider: Record<string, { options?: { baseURL?: string } }>;
      model: string;
    };
    expect(synced.provider.magpie.options?.baseURL).toBe('http://127.0.0.1:2222/v1');
    expect(synced.provider.mine).toEqual({ baseUrl: 'https://mine.test/v1' });
    expect(synced.model).toBe('magpie/model');

    const settled = await fs.readFile(userFile, 'utf8');
    await syncOpenCodeConfigToUser(privateHome, root, 'http://127.0.0.1:2222');
    expect(await fs.readFile(userFile, 'utf8')).toBe(settled);

    // A config without our provider is left alone even when the gateway moved.
    const otherHome = path.join(root, 'other-home');
    const otherUserFile = path.join(otherHome, '.config', 'opencode', 'opencode.json');
    await fs.mkdir(path.dirname(otherUserFile), { recursive: true });
    const withoutMagpie = `${JSON.stringify({ provider: { mine: { baseUrl: 'https://mine.test/v1' } } }, null, 2)}\n`;
    await fs.writeFile(otherUserFile, withoutMagpie);
    await syncOpenCodeConfigToUser(privateHome, otherHome, 'http://127.0.0.1:3333');
    expect(await fs.readFile(otherUserFile, 'utf8')).toBe(withoutMagpie);
  });

  it('takes the address from the live gateway even when magpie keeps an older copy', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'magpie-opencode-gateway-wins-'));
    roots.push(root);
    const privateHome = path.join(root, 'service');
    const userFile = path.join(root, '.config', 'opencode', 'opencode.json');
    const privateFile = path.join(privateHome, 'config', 'opencode', 'opencode.json');
    await fs.mkdir(path.dirname(userFile), { recursive: true });
    await fs.writeFile(
      userFile,
      `${JSON.stringify({ provider: { magpie: { options: { baseURL: 'http://127.0.0.1:1111/v1' } } } }, null, 2)}\n`,
    );
    await fs.mkdir(path.dirname(privateFile), { recursive: true });
    await fs.writeFile(
      privateFile,
      `${JSON.stringify({ provider: { magpie: { options: { baseURL: 'http://127.0.0.1:1111/v1' } } }, model: 'magpie/model' }, null, 2)}\n`,
    );

    await syncOpenCodeConfigToUser(privateHome, root, 'http://127.0.0.1:2222');
    const synced = JSON.parse(await fs.readFile(userFile, 'utf8')) as {
      provider: { magpie: { options: { baseURL: string } } };
      model: string;
    };
    expect(synced.provider.magpie.options.baseURL).toBe('http://127.0.0.1:2222/v1');
    expect(synced.model).toBe('magpie/model');
  });

  it('clears legacy snapshot trees under host-agent-stash', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'magpie-stash-legacy-'));
    roots.push(root);
    const privateHome = path.join(root, 'service');
    const legacyDir = path.join(privateHome, 'host-agent-stash', 'claude');
    await fs.mkdir(legacyDir, { recursive: true });
    await fs.writeFile(path.join(legacyDir, 'settings.json'), '{"secret":true}\n');
    await clearLegacyHostAgentStorage(privateHome);
    expect(await fs.readdir(path.join(privateHome, 'host-agent-stash'))).toEqual([]);
  });

  it('collectDirectorySnapshot returns relative paths without deleting anything', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'magpie-snapshot-read-'));
    roots.push(root);
    await fs.mkdir(path.join(root, 'nested'), { recursive: true });
    await fs.writeFile(path.join(root, 'nested', 'note.txt'), 'keep\n');
    const snapshot = await collectDirectorySnapshot(root);
    expect([...snapshot.keys()]).toEqual(['nested/note.txt']);
  });

  it('strips Codex magpie provider blocks and stray magpie keys', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'magpie-codex-strip-'));
    roots.push(root);
    const codexDir = path.join(root, '.codex');
    await fs.mkdir(codexDir, { recursive: true });
    const original =
      'model = "x"\n\n[model_providers.magpie]\nbase_url = "dead"\nmagpie_token = "secret"\n';
    await fs.writeFile(path.join(codexDir, 'config.toml'), original);
    await stripCodexMagpieProviderBlock(root);
    expect(await fs.readFile(path.join(codexDir, 'config.toml'), 'utf8')).toBe('model = "x"\n');
  });
});
