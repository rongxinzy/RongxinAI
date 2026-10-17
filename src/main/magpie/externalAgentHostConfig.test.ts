import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  mirrorOpenCodeConfigToUser,
  restoreAgentHostTrees,
  snapshotAgentHostTrees,
  stripCodexMagpieProviderBlock,
} from './externalAgentHostConfig';

describe('externalAgentHostConfig', () => {
  const roots: string[] = [];
  afterEach(async () => {
    await Promise.all(roots.map(root => fs.rm(root, { recursive: true, force: true })));
    roots.length = 0;
  });

  it('mirrors private OpenCode config into the user XDG tree', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'magpie-opencode-'));
    roots.push(root);
    const privateHome = path.join(root, 'service');
    const privateFile = path.join(privateHome, 'config', 'opencode', 'opencode.json');
    await fs.mkdir(path.dirname(privateFile), { recursive: true });
    await fs.writeFile(privateFile, '{"provider":{"magpie":true}}\n');
    await mirrorOpenCodeConfigToUser(privateHome, root);
    expect(await fs.readFile(path.join(root, '.config', 'opencode', 'opencode.json'), 'utf8')).toBe(
      '{"provider":{"magpie":true}}\n',
    );
  });

  it('restores host trees from stash after disconnect cleanup', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'magpie-stash-'));
    roots.push(root);
    const privateHome = path.join(root, 'service');
    const codexDir = path.join(root, '.codex');
    await fs.mkdir(codexDir, { recursive: true });
    await fs.writeFile(path.join(codexDir, 'config.toml'), 'model = "before"\n');
    await snapshotAgentHostTrees(privateHome, 'codex', root);
    await fs.writeFile(path.join(codexDir, 'config.toml'), 'model = "mutated"\n');
    await restoreAgentHostTrees(privateHome, 'codex', root);
    expect(await fs.readFile(path.join(codexDir, 'config.toml'), 'utf8')).toBe(
      'model = "before"\n',
    );
  });

  it('strips Codex magpie provider blocks', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'magpie-codex-strip-'));
    roots.push(root);
    const codexDir = path.join(root, '.codex');
    await fs.mkdir(codexDir, { recursive: true });
    await fs.writeFile(
      path.join(codexDir, 'config.toml'),
      'model = "x"\n\n[model_providers.magpie]\nbase_url = "dead"\ntoken = "secret"\n',
    );
    await stripCodexMagpieProviderBlock(root);
    expect(await fs.readFile(path.join(codexDir, 'config.toml'), 'utf8')).toBe('model = "x"\n');
  });
});
