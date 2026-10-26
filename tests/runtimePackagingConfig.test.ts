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

test('unsigned macOS release builds do not receive empty signing credentials', () => {
  const workflow = readFileSync(
    path.join(root, '.github', 'workflows', 'build-inference-editions.yml'),
    'utf8',
  );
  const unsignedStart = workflow.indexOf('- name: Build unsigned macOS release');
  const signedStart = workflow.indexOf('- name: Build signed macOS release');
  const verifyStart = workflow.indexOf('- name: Verify signed and notarized macOS release');

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
  for (const workflow of ['build-inference-editions.yml']) {
    const content = readFileSync(path.join(root, '.github', 'workflows', workflow), 'utf8');
    assert.match(content, /with-download-retries\.sh bun run setup:posix-uv-runtime/);
    assert.match(content, /with-download-retries\.sh bun run setup:posix-python-runtime/);
    assert.doesNotMatch(content, /setup:pandoc-runtime/);
  }
});

test('Windows release workflow runs the clean-path bundled runtime gate', () => {
  for (const workflowName of ['build-inference-editions.yml', 'windows-installer-pr.yml']) {
    const workflow = readFileSync(path.join(root, '.github', 'workflows', workflowName), 'utf8');
    assert.match(workflow, /windows-runtime-smoke\.ps1/);
  }
  const smoke = readFileSync(path.join(root, 'scripts', 'ci', 'windows-runtime-smoke.ps1'), 'utf8');
  assert.match(smoke, /skill-python\\layers\\shared\\Scripts\\python\.exe/);
  assert.doesNotMatch(smoke, /skill-python\\(?:xlsx|pdf)\\Scripts\\python\.exe/);
  assert.match(smoke, /bundled XLSX dependency probe/);
  assert.match(smoke, /bundled PDF dependency probe/);
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

test('protected Windows releases authenticate with Certum and require valid signatures', () => {
  const packageJson = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')) as {
    scripts: Record<string, string>;
  };
  assert.equal(packageJson.scripts['dist:win:signed'], 'node scripts/build-windows.cjs --signed');
  assert.equal(packageJson.scripts['dist:win:offline'], 'node scripts/build-windows.cjs');

  const releaseWorkflow = readFileSync(
    path.join(root, '.github', 'workflows', 'release.yml'),
    'utf8',
  );
  assert.match(releaseWorkflow, /uses: \.\/\.github\/workflows\/build-inference-editions\.yml/);
  assert.match(releaseWorkflow, /CERTUM_CERT_THUMBPRINT:/);

  const buildWorkflow = readFileSync(
    path.join(root, '.github', 'workflows', 'build-inference-editions.yml'),
    'utf8',
  );
  assert.match(buildWorkflow, /\.\/\.github\/actions\/setup-certum-signing/);
  assert.match(buildWorkflow, /bun run dist:win:signed/);
  assert.match(buildWorkflow, /verify-windows-authenticode\.ps1/);

  const setupAction = readFileSync(
    path.join(root, '.github', 'actions', 'setup-certum-signing', 'action.yml'),
    'utf8',
  );
  assert.match(setupAction, /dismine\/windows-app-signing-setup-action@[0-9a-f]{40}/);
  assert.match(setupAction, /SimplySignDesktop-9\.4\.3\.90-64-bit-en\.msi/);
  assert.match(setupAction, /SignerCertificate\.Subject[\s\S]*Asseco Data Systems/);
  assert.match(setupAction, /capture-diagnostics: false/);

  const signedConfigPath = path.join(root, 'electron-builder.windows-signed.cjs');
  const signedConfig = JSON.parse(
    execFileSync(
      process.execPath,
      [
        '-e',
        'const c=require(process.argv[1]); process.stdout.write(JSON.stringify(c.win.signtoolOptions));',
        signedConfigPath,
      ],
      {
        encoding: 'utf8',
        env: {
          ...process.env,
          CERTUM_CERT_THUMBPRINT: '0123456789abcdef0123456789abcdef01234567',
        },
      },
    ),
  ) as {
    certificateSha1: string;
    signingHashAlgorithms: string[];
    rfc3161TimeStampServer: string;
  };
  assert.equal(signedConfig.certificateSha1, '0123456789ABCDEF0123456789ABCDEF01234567');
  assert.deepEqual(signedConfig.signingHashAlgorithms, ['sha256']);
  assert.equal(signedConfig.rfc3161TimeStampServer, 'http://time.certum.pl');

  const signatureVerifier = readFileSync(
    path.join(root, 'scripts', 'ci', 'verify-windows-authenticode.ps1'),
    'utf8',
  );
  assert.match(
    signatureVerifier,
    /electron-builder\.json'[\s\S]*-Raw -Encoding UTF8 \| ConvertFrom-Json/,
  );
});

test('installer-related pull requests build and exercise the Windows installer', () => {
  const workflow = readFileSync(
    path.join(root, '.github', 'workflows', 'windows-installer-pr.yml'),
    'utf8',
  );
  assert.match(workflow, /workflow_call:/);
  assert.doesNotMatch(workflow, /pull_request:/);
  assert.doesNotMatch(workflow, /paths:/);
  assert.match(workflow, /runs-on: windows-latest/);
  assert.match(workflow, /@\('run', 'dist:win:offline'\)/);
  assert.match(workflow, /windows-runtime-smoke\.ps1/);
  assert.match(workflow, /windows-installer-size-smoke\.ps1/);
  assert.match(workflow, /windows-installer-smoke\.ps1/);

  const smoke = readFileSync(
    path.join(root, 'scripts', 'ci', 'windows-installer-smoke.ps1'),
    'utf8',
  );
  assert.match(smoke, /'cold installation'/);
  assert.match(smoke, /'cache-hit upgrade'/);
  assert.match(smoke, /phase=component-cache-miss/);
  assert.match(smoke, /phase=component-cache-hit/);
  assert.doesNotMatch(smoke, /phase=defender-exclusion/);
  assert.match(smoke, /'uninstall'/);
  assert.match(smoke, /function Invoke-Checked/);
  assert.match(smoke, /verify-packaged-acp-resources\.mjs/);

  const sizeSmoke = readFileSync(
    path.join(root, 'scripts', 'ci', 'windows-installer-size-smoke.ps1'),
    'utf8',
  );
  assert.match(sizeSmoke, /\$_\.archiveSizeBytes/);
  assert.doesNotMatch(sizeSmoke, /\$_\.archiveBytes\b/);
  assert.match(sizeSmoke, /component archive bytes/);
  assert.doesNotMatch(sizeSmoke, /Maximum\w+Bytes/);
  assert.match(sizeSmoke, /\$uncapped = \$true/);
  assert.match(sizeSmoke, /\$nsisComponentBytes = \$componentBytes/);
});

test('tag release publishes beta and archives build metadata for promotion', () => {
  const workflow = readFileSync(path.join(root, '.github', 'workflows', 'release.yml'), 'utf8');
  const buildWorkflow = readFileSync(
    path.join(root, '.github', 'workflows', 'build-inference-editions.yml'),
    'utf8',
  );

  assert.match(workflow, /push:\s*\n\s*tags:/);
  assert.match(workflow, /TAG_NAME:/);
  assert.match(workflow, /git merge-base --is-ancestor/);
  assert.match(workflow, /app-build-version:/);
  assert.match(workflow, /uses: \.\/\.github\/workflows\/build-inference-editions\.yml/);
  assert.match(workflow, /uses: \.\/\.github\/workflows\/build-windows-release\.yml/);
  assert.match(workflow, /needs: \[prepare-release, build-windows, build-macos, build-linux\]/);
  assert.match(buildWorkflow, /create-release-candidate\.mjs/);
  const publishScript = readFileSync(
    path.join(root, 'scripts', 'release', 'publish-platform-beta-release.sh'),
    'utf8',
  );
  assert.match(publishScript, /verify-release-candidate\.mjs/);
  assert.match(publishScript, /upload-release-candidate\.mjs/);
  assert.match(publishScript, /UPDATE_RELEASE_CHANNEL=beta/);
  assert.match(publishScript, /channels\/beta-pointer\.json/);
  assert.match(publishScript, /build-metadata/);
  assert.match(publishScript, /verify-published-update\.mjs --channel beta/);
  assert.match(workflow, /softprops\/action-gh-release@v2/);
  assert.match(workflow, /prerelease: true/);
});

test('published update smoke reads the electron feed of the channel it verifies', () => {
  const script = readFileSync(
    path.join(root, 'scripts', 'release', 'verify-published-update.mjs'),
    'utf8',
  );

  assert.match(script, /v2\/electron\/\$\{channel\}\//);
  assert.doesNotMatch(script, /v2\/electron\/stable\//);
});

test('stable promotion rechannels beta without rebuilding installers', () => {
  const workflowText = readFileSync(path.join(root, '.github', 'workflows', 'promote.yml'), 'utf8');

  assert.match(workflowText, /workflow_dispatch:/);
  assert.match(workflowText, /^\s+version:/m);
  assert.doesNotMatch(workflowText, /candidate_run_id:/);
  assert.match(workflowText, /environment: release/);
  assert.match(workflowText, /rechannel-signed-manifest\.mjs/);
  assert.match(workflowText, /is-stable-rollback\.mjs/);
  assert.match(workflowText, /ALLOW_STABLE_ROLLBACK/);
  assert.match(workflowText, /channels\/stable-pointer\.json/);
  assert.match(workflowText, /verify-published-update\.mjs --channel stable/);
  assert.match(workflowText, /gh release edit/);
  assert.doesNotMatch(workflowText, /upload-release-candidate\.mjs/);
  assert.doesNotMatch(workflowText, /dist:win:signed/);
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
