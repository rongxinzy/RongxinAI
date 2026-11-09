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

  for (const target of [config.mac, config.linux]) {
    const mcpResource = target.extraResources?.find(resource => resource.from === 'MCPs');
    assert.ok(mcpResource);
    assert.deepEqual(
      (mcpResource as { filter?: string[] }).filter?.includes('!feishu/runtime/**'),
      true,
    );
  }

  // Windows puts large resources in independently reusable component archives.
  const windowsResourcePack = readFileSync(
    path.join(root, 'scripts', 'windows-resource-pack.cjs'),
    'utf8',
  );
  for (const resource of ['mingit', 'python-win', 'skill-python', 'uv-win']) {
    assert.match(windowsResourcePack, new RegExp(`prefix: ["']${resource}["']`));
  }
});

test('unpacks AnyDoc native bindings from the application archive', () => {
  const config = JSON.parse(readFileSync(path.join(root, 'electron-builder.json'), 'utf8')) as {
    asarUnpack?: string[];
  };
  assert.ok(config.asarUnpack?.includes('node_modules/@firecrawl/**'));

  const viteConfig = readFileSync(path.join(root, 'vite.config.ts'), 'utf8');
  const runtimeDependencies = readFileSync(
    path.join(root, 'scripts', 'electron-runtime-dependencies.mjs'),
    'utf8',
  );
  assert.match(viteConfig, /ELECTRON_MAIN_EXTERNALS\.includes\(id\)/);
  assert.match(
    runtimeDependencies,
    /ELECTRON_MAIN_EXTERNALS\s*=\s*\[[\s\S]*['"]@firecrawl\/anydoc['"]/,
  );
});

test('unpacks npm for connector installation without a system Node.js runtime', () => {
  const config = JSON.parse(readFileSync(path.join(root, 'electron-builder.json'), 'utf8')) as {
    asarUnpack?: string[];
  };

  assert.ok(config.asarUnpack?.includes('node_modules/npm/**'));
});

test('does not package ModelScope token files or source maps', () => {
  const config = JSON.parse(readFileSync(path.join(root, 'electron-builder.json'), 'utf8')) as {
    files?: Array<string | { filter?: string[] }>;
    extraResources?: Array<{ from?: string; to?: string }>;
  };
  assert.equal(
    (config.extraResources ?? []).some(entry =>
      `${entry.from ?? ''} ${entry.to ?? ''}`.includes('modelscope.tokens'),
    ),
    false,
  );

  const patterns = [
    '!**/*.map',
    '!*.map',
    '!**/*.local.json',
    '!**/token.json',
    '!**/tokens.json',
    '!**/modelscope.tokens*.json',
  ];
  for (const pattern of patterns) {
    assert.equal(config.files?.includes(pattern), true, pattern);
  }
  for (const entry of config.files ?? []) {
    if (typeof entry === 'string' || !entry.filter) continue;
    assert.equal(entry.filter.includes('!**/*.map'), true);
    assert.equal(entry.filter.includes('!*.map'), true);
    assert.equal(entry.filter.includes('!**/*.local.json'), true);
  }

  const hooks = readFileSync(path.join(root, 'scripts', 'electron-builder-hooks.cjs'), 'utf8');
  assert.match(hooks, /pinElectronLanguages\(context\.packager\.config\)/);
  assert.match(hooks, /applyPackagingExcludes\(context\.packager\.config\)/);
  assert.match(hooks, /assertPackagedApp\(/);
  assert.match(hooks, /verifyPackagedDeliverables\(context\)/);

  const runtimeVerify = readFileSync(
    path.join(root, 'scripts', 'packaging', 'verify-packaged-runtimes.cjs'),
    'utf8',
  );
  assert.match(runtimeVerify, /verifyPackagedNodePty\(context\)/);

  const packageJson = readFileSync(path.join(root, 'package.json'), 'utf8');
  assert.doesNotMatch(packageJson, /prepare:modelscope-tokens &&/);
});

test('unpacks ACP adapters without bundling external agent binaries', () => {
  const config = JSON.parse(readFileSync(path.join(root, 'electron-builder.json'), 'utf8')) as {
    files?: string[];
    asarUnpack?: string[];
  };

  assert.ok(config.asarUnpack?.includes('node_modules/@agentclientprotocol/codex-acp/**'));
  assert.ok(config.asarUnpack?.includes('node_modules/@agentclientprotocol/claude-agent-acp/**'));
  assert.ok(config.asarUnpack?.includes('node_modules/@anthropic-ai/claude-agent-sdk/**'));
  assert.ok(config.asarUnpack?.includes('node_modules/zod/**'));
  assert.ok(!config.asarUnpack?.includes('node_modules/@anthropic-ai/**'));
  assert.ok(!config.asarUnpack?.includes('node_modules/@agentclientprotocol/**'));
  assert.ok(!config.asarUnpack?.includes('node_modules/@openai/**'));
  assert.ok(config.files?.includes('!node_modules/zod/src/**'));

  for (const platform of ['darwin', 'linux', 'win32']) {
    assert.ok(
      config.files?.includes(`!node_modules/@anthropic-ai/claude-agent-sdk-${platform}-*/**`),
    );
    assert.ok(config.files?.includes(`!node_modules/@openai/codex-${platform}-*/**`));
  }
});

test('macOS Launchpad uses icon.icns instead of an asset-catalog icon name', () => {
  const config = JSON.parse(readFileSync(path.join(root, 'electron-builder.json'), 'utf8')) as {
    mac?: { icon?: string; extendInfo?: Record<string, unknown> };
  };
  assert.equal(config.mac?.icon, 'build/icons/mac/icon.icns');
  assert.equal(config.mac?.extendInfo?.CFBundleIconName, undefined);

  const hooks = readFileSync(path.join(root, 'scripts', 'electron-builder-hooks.cjs'), 'utf8');
  assert.match(hooks, /'-remove', 'CFBundleIconName'/);
  assert.doesNotMatch(hooks, /'-insert', 'CFBundleIconName'/);

  const fixScript = readFileSync(path.join(root, 'scripts', 'fix-mac-icon-display.sh'), 'utf8');
  assert.match(fixScript, /plutil -remove CFBundleIconName/);
  assert.doesNotMatch(fixScript, /plutil -insert CFBundleIconName/);
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
  const publishScript = readFileSync(
    path.join(root, 'scripts', 'release', 'publish-platform-beta-release.sh'),
    'utf8',
  );
  assert.match(publishScript, /jq -s -r/);
  assert.doesNotMatch(publishScript, /jq -rsr/);
  assert.match(publishScript, /manifest\/electron\/\$\{target_file\}\/\$\{filename\}/);
  assert.match(publishScript, /print-electron-updater-verify-specs\.mjs/);
  assert.match(publishScript, /verify-electron-updater-generation\.mjs/);
  assert.match(publishScript, /print-release-candidate-layout\.mjs/);
});

test('release supply-chain gates track every checked-in npm lockfile', () => {
  const trackedLockfiles = execFileSync('git', ['ls-files', '*package-lock.json'], {
    cwd: root,
    encoding: 'utf8',
  })
    .trim()
    .split(/\r?\n/)
    .filter(Boolean)
    .sort();
  const policy = readFileSync(
    path.join(root, 'scripts', 'ci', 'check-supply-chain-inputs.mjs'),
    'utf8',
  );
  const workflow = readFileSync(
    path.join(root, '.github', 'workflows', 'release-preflight.yml'),
    'utf8',
  );
  const policyLockfiles = Array.from(
    policy.matchAll(/^\s+'([^']+package-lock\.json)',?$/gm),
    match => match[1],
  ).sort();
  const signatureStep = workflow.slice(
    workflow.indexOf('- name: Verify npm package signatures'),
    workflow.indexOf('- name: Validate source and dependency policy'),
  );
  const workflowLockfiles = Array.from(
    signatureStep.matchAll(/^\s+([^\s]+package-lock\.json)(?: \\|; do)?$/gm),
    match => match[1],
  ).sort();

  assert.deepEqual(policyLockfiles, trackedLockfiles);
  assert.deepEqual(workflowLockfiles, trackedLockfiles);
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

test('macOS notarization is delegated to afterSign with staple retry', () => {
  const config = JSON.parse(readFileSync(path.join(root, 'electron-builder.json'), 'utf8')) as {
    afterSign?: string;
    mac?: { notarize?: boolean };
  };
  assert.equal(config.afterSign, 'scripts/notarize.js');
  assert.equal(config.mac?.notarize, false);
});

test('every Electron main, preload, and worker entry in vite.config.ts and build-electron-development.mjs exists on disk', () => {
  const viteConfig = readFileSync(path.join(root, 'vite.config.ts'), 'utf8');
  const devBuild = readFileSync(
    path.join(root, 'scripts', 'build-electron-development.mjs'),
    'utf8',
  );
  const viteEntries = [...viteConfig.matchAll(/entry:\s*['"]([^'"]+)['"]/g)].map(m => m[1]);
  const devEntries = [...devBuild.matchAll(/createBuildOptions\(\s*['"]([^'"]+)['"]/g)].map(
    m => m[1],
  );

  assert.ok(viteEntries.length >= 10);
  assert.deepEqual(viteEntries.slice().sort(), devEntries.slice().sort());
  for (const entry of viteEntries) {
    assert.equal(existsSync(path.join(root, entry)), true, `Missing Electron entry: ${entry}`);
  }
});
