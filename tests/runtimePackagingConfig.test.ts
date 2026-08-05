import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { test } from 'vitest';

const root = path.resolve(__dirname, '..');

function resourceSources(config: { extraResources?: Array<{ from?: string }> }): string[] {
  return (config.extraResources || []).flatMap(item =>
    typeof item.from === 'string' ? [item.from] : [],
  );
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
    [
      'resources/uv-mac',
      'resources/python-mac',
      'resources/skill-python',
    ].every(source => mac.includes(source)),
    true,
  );
  assert.deepEqual(
    [
      'resources/uv-linux',
      'resources/python-linux',
      'resources/skill-python',
    ].every(source => linux.includes(source)),
    true,
  );

  // Windows puts large resources in a tar consumed by the NSIS installer.
  const hooks = readFileSync(path.join(root, 'scripts', 'electron-builder-hooks.cjs'), 'utf8');
  for (const resource of ['mingit', 'python-win', 'skill-python', 'uv-win']) {
    assert.match(hooks, new RegExp(`prefix: '${resource}'`));
  }
});

test('unpacks AnyDoc native bindings from the application archive', () => {
  const config = JSON.parse(readFileSync(path.join(root, 'electron-builder.json'), 'utf8')) as {
    asarUnpack?: string[];
  };
  assert.ok(config.asarUnpack?.includes('node_modules/@firecrawl/**'));

  const viteConfig = readFileSync(path.join(root, 'vite.config.ts'), 'utf8');
  assert.match(viteConfig, /staticExternals\s*=\s*\[[\s\S]*['"]@firecrawl\/anydoc['"]/);
});

test('release workflows explicitly provision the private POSIX toolchain', () => {
  for (const workflow of ['build-platforms.yml', 'online-update-release.yml']) {
    const content = readFileSync(path.join(root, '.github', 'workflows', workflow), 'utf8');
    assert.match(content, /bun run setup:posix-uv-runtime/);
    assert.match(content, /bun run setup:posix-python-runtime/);
    assert.doesNotMatch(content, /setup:pandoc-runtime/);
  }
});

test('Windows release workflow runs the clean-path bundled runtime gate', () => {
  for (const workflowName of ['build-platforms.yml', 'online-update-release.yml']) {
    const workflow = readFileSync(path.join(root, '.github', 'workflows', workflowName), 'utf8');
    assert.match(workflow, /windows-runtime-smoke\.ps1/);
  }
  const smoke = readFileSync(path.join(root, 'scripts', 'ci', 'windows-runtime-smoke.ps1'), 'utf8');
  assert.match(smoke, /skill-python\\xlsx/);
  assert.match(smoke, /skill-python\\pdf/);
  assert.match(smoke, /markdown_to_docx\.mjs/);
  assert.match(smoke, /External command unexpectedly remains discoverable/);
  assert.match(smoke, /mingit\\usr\\bin\\bash\.exe/);
  assert.match(smoke, /PATH = "\$env:SystemRoot\\System32;\$env:SystemRoot"/);
  const packageScript = readFileSync(
    path.join(root, 'scripts', 'ci', 'package-windows.ps1'),
    'utf8',
  );
  assert.match(packageScript, /windows-runtime-smoke\.ps1/);
});
