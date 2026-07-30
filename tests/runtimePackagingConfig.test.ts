import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { test } from 'vitest';

const root = path.resolve(__dirname, '..');

function resourceSources(config: { extraResources?: Array<{ from?: string }> }): string[] {
  return (config.extraResources || []).flatMap(item => (typeof item.from === 'string' ? [item.from] : []));
}

test('each desktop target keeps the private document and Python toolchain resources', () => {
  const config = JSON.parse(readFileSync(path.join(root, 'electron-builder.json'), 'utf8')) as {
    mac: { extraResources?: Array<{ from?: string }> };
    linux: { extraResources?: Array<{ from?: string }> };
    win: { extraResources?: Array<{ from?: string }> };
  };
  const mac = resourceSources(config.mac);
  const linux = resourceSources(config.linux);

  assert.deepEqual(
    ['resources/pandoc', 'resources/uv-mac', 'resources/python-mac'].every(source =>
      mac.includes(source),
    ),
    true,
  );
  assert.deepEqual(
    ['resources/pandoc', 'resources/uv-linux', 'resources/python-linux'].every(source =>
      linux.includes(source),
    ),
    true,
  );

  // Windows puts large resources in a tar consumed by the NSIS installer.
  const hooks = readFileSync(path.join(root, 'scripts', 'electron-builder-hooks.cjs'), 'utf8');
  for (const resource of ['python-win', 'uv-win', 'pandoc']) {
    assert.match(hooks, new RegExp(`prefix: '${resource}'`));
  }
});

test('release workflows explicitly provision the private POSIX toolchain', () => {
  for (const workflow of ['build-platforms.yml', 'online-update-release.yml']) {
    const content = readFileSync(path.join(root, '.github', 'workflows', workflow), 'utf8');
    assert.match(content, /bun run setup:posix-uv-runtime/);
    assert.match(content, /bun run setup:posix-python-runtime/);
    assert.match(content, /bun run setup:pandoc-runtime/);
  }
});
