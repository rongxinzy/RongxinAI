import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { prerelease } from 'semver';
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
    ['resources/uv-mac', 'resources/python-mac', 'resources/skill-python'].every(source =>
      mac.includes(source),
    ),
    true,
  );
  assert.deepEqual(
    ['resources/uv-linux', 'resources/python-linux', 'resources/skill-python'].every(source =>
      linux.includes(source),
    ),
    true,
  );

  // Windows puts large resources in a tar consumed by the NSIS installer.
  const windowsResourcePack = readFileSync(
    path.join(root, 'scripts', 'windows-resource-pack.cjs'),
    'utf8',
  );
  for (const resource of ['mingit', 'python-win', 'skill-python', 'uv-win']) {
    assert.match(windowsResourcePack, new RegExp(`prefix: '${resource}'`));
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

test('stable release metadata does not inherit the build prerelease channel', () => {
  const config = JSON.parse(readFileSync(path.join(root, 'electron-builder.json'), 'utf8')) as {
    detectUpdateChannel?: boolean;
    linux?: { publish?: Array<{ url?: string }> };
    mac?: { publish?: Array<{ url?: string }> };
    win?: { publish?: Array<{ url?: string }> };
  };

  assert.deepEqual(prerelease('2026.8.6-build.1'), ['build', 1]);
  assert.equal(config.detectUpdateChannel, false);
  for (const target of [config.win, config.mac, config.linux]) {
    assert.match(target?.publish?.[0]?.url || '', /\/v2\/electron\/stable\//);
  }
});

test('publish verification uses portable jq flags and preserves updater filenames per target', () => {
  const workflow = readFileSync(
    path.join(root, '.github', 'workflows', 'online-update-release.yml'),
    'utf8',
  );
  assert.match(workflow, /jq -s -r/);
  assert.doesNotMatch(workflow, /jq -rsr/);
  assert.match(workflow, /output="manifest\/electron\/\$\{target_file\}\/\$\{filename\}"/);
  assert.match(workflow, /manifest\/electron\/win32-x64-lite\/latest\.yml:win32:x64:lite/);
  assert.match(
    workflow,
    /manifest\/electron\/darwin-arm64-default\/latest-mac\.yml:darwin:arm64:default/,
  );
  assert.match(
    workflow,
    /manifest\/electron\/linux-x64-appimage\/latest-linux\.yml:linux:x64:appimage/,
  );
  assert.match(workflow, /manifest\/electron\/linux-x64-deb\/latest-linux\.yml:linux:x64:deb/);
});

test('unsigned macOS release builds do not receive empty signing credentials', () => {
  const workflow = readFileSync(
    path.join(root, '.github', 'workflows', 'online-update-release.yml'),
    'utf8',
  );
  const unsignedStart = workflow.indexOf('- name: Build unsigned macOS package');
  const signedStart = workflow.indexOf('- name: Build signed macOS package');
  const verifyStart = workflow.indexOf('- name: Verify signed and notarized macOS app');

  assert.ok(unsignedStart >= 0 && signedStart > unsignedStart && verifyStart > signedStart);
  const unsignedStep = workflow.slice(unsignedStart, signedStart);
  const signedStep = workflow.slice(signedStart, verifyStart);
  assert.match(unsignedStep, /ZHIYUAN_MAC_AUTO_UPDATE_ENABLED != 'true'/);
  assert.doesNotMatch(
    unsignedStep,
    /CSC_LINK|CSC_KEY_PASSWORD|APPLE_ID|APPLE_APP_SPECIFIC_PASSWORD|APPLE_TEAM_ID/,
  );
  assert.match(signedStep, /ZHIYUAN_MAC_AUTO_UPDATE_ENABLED == 'true'/);
  assert.match(signedStep, /CSC_LINK:[\s\S]*APPLE_TEAM_ID:/);
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
  assert.match(smoke, /docx\\scripts\\markdown_to_docx\.mjs/);
  assert.match(smoke, /electron-builder\.json/);
  assert.match(smoke, /release\\win-unpacked/);
  assert.match(smoke, /packaged Electron Node runtime/);
  assert.doesNotMatch(smoke, /node_modules\\electron\\dist\\electron\.exe/);
  assert.match(smoke, /ELECTRON_RUN_AS_NODE/);
  assert.match(smoke, /Start-Process[\s\S]*-Wait[\s\S]*-PassThru/);
  assert.match(smoke, /DOCX Markdown conversion/);
  assert.match(smoke, /validate-docx-smoke\.mjs/);
  assert.match(smoke, /generated DOCX validation/);
  assert.doesNotMatch(smoke, /Invoke-Checked \$electron/);
  assert.match(smoke, /External command unexpectedly remains discoverable/);
  assert.match(smoke, /mingit\\usr\\bin\\bash\.exe/);
  assert.match(smoke, /PATH = "\$env:SystemRoot\\System32;\$env:SystemRoot"/);
  const packageScript = readFileSync(
    path.join(root, 'scripts', 'ci', 'package-windows.ps1'),
    'utf8',
  );
  assert.match(packageScript, /windows-runtime-smoke\.ps1/);
});

test('DOCX smoke validator accepts the bundled Markdown converter output', () => {
  const workspace = mkdtempSync(path.join(tmpdir(), 'zhiyuan-docx-smoke-'));
  const markdown = path.join(workspace, 'smoke.md');
  const docx = path.join(workspace, 'smoke.docx');
  try {
    writeFileSync(markdown, '# Runtime smoke\n\nPackaged Electron conversion works.\n');
    execFileSync(
      process.execPath,
      [path.join(root, 'SKILLs', 'docx', 'scripts', 'markdown_to_docx.mjs'), markdown, docx],
      { stdio: 'pipe' },
    );
    execFileSync(
      process.execPath,
      [path.join(root, 'scripts', 'ci', 'validate-docx-smoke.mjs'), docx],
      {
        stdio: 'pipe',
      },
    );
    assert.equal(existsSync(docx), true);
    assert.ok(statSync(docx).size > 0);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});
