import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  clearLegacyHostAgentStorage,
  mergeOpenCodeConfigToUser,
  revertOpenCodeConfigFromUser,
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
