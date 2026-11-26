import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { load } from 'js-yaml';
import { test } from 'vitest';
import { readInferenceWorkflow } from '../scripts/ci/read-inference-workflow.mjs';

const root = path.resolve(__dirname, '..');

test('one macOS build command passes signing credentials only to signed releases', () => {
  const workflow = load(readInferenceWorkflow(root)) as {
    jobs: Record<string, { steps?: Array<{ name?: string; run?: string; if?: string }> }>;
  };
  const steps = Object.values(workflow.jobs).flatMap(job => job.steps ?? []);
  const step = steps.find(candidate => candidate.name === 'Build macOS packages');
  assert.ok(step?.run);
  assert.equal(
    step.if,
    "${{ matrix.platform == 'macos' && (inputs.mode == 'verify' || inputs.mode == 'release') }}",
  );
  assert.ok(
    steps.findIndex(candidate => candidate.name === 'Verify signed and notarized macOS release') >
      steps.indexOf(step),
  );
  const fixture = `
node() { printf '%s\\n' "$*"; }
bun() {
  printf '%s\\n' "$*" "$CSC_IDENTITY_AUTO_DISCOVERY" "$ZHIYUAN_MAC_AUTO_UPDATE_ENABLED"
  for name in CSC_LINK CSC_KEY_PASSWORD APPLE_ID APPLE_APP_SPECIFIC_PASSWORD APPLE_TEAM_ID; do
    if declare -p "$name" >/dev/null 2>&1; then
      printf '%s\\n' "$name"
    fi
  done
}
`;
  const credentials = {
    CSC_LINK: 'fixture',
    CSC_KEY_PASSWORD: 'fixture',
    APPLE_ID: 'fixture',
    APPLE_APP_SPECIFIC_PASSWORD: 'fixture',
    APPLE_TEAM_ID: 'fixture',
  };
  for (const [mode, signing, arch] of [
    ['verify', 'true', 'x64'],
    ['release', 'false', 'arm64'],
    ['release', 'true', 'x64'],
  ]) {
    const signed = mode === 'release' && signing === 'true';
    const output = execFileSync('bash', ['-e', '-c', fixture + step.run], {
      encoding: 'utf8',
      env: {
        ...process.env,
        ...credentials,
        PACKAGING_MODE: mode,
        MACOS_ARCH: arch,
        ZHIYUAN_MAC_AUTO_UPDATE_ENABLED: signing,
        CSC_IDENTITY_AUTO_DISCOVERY: signing,
      },
    });
    assert.deepEqual(output.trim().split('\n'), [
      'scripts/ensure-build-version.js',
      `run dist:mac:${arch}`,
      String(signed),
      String(signed),
      ...(signed ? Object.keys(credentials) : []),
    ]);
  }
});

test('release workflows explicitly provision the private POSIX toolchain', () => {
  const content = readInferenceWorkflow(root);
  assert.match(content, /with-download-retries\.sh bun run setup:posix-uv-runtime/);
  assert.match(content, /with-download-retries\.sh bun run setup:posix-python-runtime/);
  assert.doesNotMatch(content, /setup:pandoc-runtime/);
});

test('Windows release workflow runs the clean-path bundled runtime gate', () => {
  for (const workflowName of ['build-inference-editions.yml', 'windows-installer-pr.yml']) {
    const workflow =
      workflowName === 'build-inference-editions.yml'
        ? readInferenceWorkflow(root)
        : readFileSync(path.join(root, '.github', 'workflows', workflowName), 'utf8');
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
  assert.match(smoke, /\[Diagnostics\.Process\]::Start\(\$startInfo\)/);
  assert.match(smoke, /\$process\.WaitForExit\(\)/);
  assert.match(smoke, /DOCX Markdown conversion/);
  assert.match(smoke, /validate-docx-smoke\.mjs/);
  assert.match(smoke, /generated DOCX validation/);
  assert.doesNotMatch(smoke, /Invoke-Checked \$electron/);
  assert.match(smoke, /External command unexpectedly remains discoverable/);
  assert.doesNotMatch(smoke, /mingit/);
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

  const buildWorkflow = readInferenceWorkflow();
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
          ZHIYUAN_ENTERPRISE_BUILD: '0',
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
  const buildWorkflow = readInferenceWorkflow();

  assert.match(workflow, /push:\s*\n\s*tags:/);
  assert.match(workflow, /TAG_NAME:/);
  assert.match(workflow, /git merge-base --is-ancestor/);
  assert.match(workflow, /app-build-version:/);
  assert.match(workflow, /uses: \.\/\.github\/workflows\/build-inference-editions\.yml/);
  assert.match(workflow, /uses: \.\/\.github\/workflows\/build-windows-release\.yml/);
  assert.doesNotMatch(workflow, /build-kylin-release\.yml/);
  assert.match(workflow, /needs: \[prepare-release, build-windows, build-macos, build-linux\]/);
  const kylinWorkflow = readFileSync(
    path.join(root, '.github', 'workflows', 'package-kylin-v11.yml'),
    'utf8',
  );
  assert.match(kylinWorkflow, /workflow_dispatch:/);
  assert.match(kylinWorkflow, /uses: \.\/\.github\/workflows\/build-kylin-release\.yml/);
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
