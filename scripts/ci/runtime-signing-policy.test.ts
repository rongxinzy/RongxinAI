import { createRequire } from 'node:module';
import crypto from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { expect, test } from 'vitest';

const require = createRequire(import.meta.url);
const { upstream } = require('../magpie-runtime.cjs');

const root = path.resolve(__dirname, '../..');

function decouplingScript(): string {
  const filename = readdirSync(__dirname).find(name => name.endsWith('decoupling.mjs'));
  if (!filename) throw new Error('Missing architecture gate');
  return filename;
}

test('architecture gate accepts the currently pinned signed runtime release', () => {
  const filename = readdirSync(__dirname).find(name => name.endsWith('decoupling.mjs'));
  expect(filename).toBeDefined();
  const result = spawnSync(process.execPath, [path.join(__dirname, filename!)], {
    cwd: root,
    encoding: 'utf8',
    timeout: 30_000,
    windowsHide: true,
  });
  expect(result.error).toBeUndefined();
  expect(result.status, result.stderr).toBe(0);
});

function read(filename: string): string {
  return readFileSync(path.join(root, filename), 'utf8');
}

test('Windows packaging does not require runtime signature verification or public signer configuration', () => {
  for (const filename of [
    'build-platforms.yml',
    'windows-installer-pr.yml',
    'release-candidate.yml',
    'online-update-release.yml',
  ]) {
    const file = `.github/workflows/${filename}`;
    if (!existsSync(path.join(root, file))) continue;
    expect(read(file)).not.toMatch(/verify-windows-runtime-signatures|RUNTIME_SIGNER_THUMBPRINT/);
  }
  expect(existsSync(path.join(root, '.github/workflows/runtime-signature-gate.yml'))).toBe(false);
});

test('package smoke retains component hashes and runtime presence checks without Authenticode', () => {
  const smoke = read('scripts/ci/windows-runtime-smoke.ps1');
  expect(smoke).not.toMatch(
    /Assert-WindowsRuntimeSignature|Get-AuthenticodeSignature|runtime-authenticode/,
  );
  expect(smoke).toContain('SHA-256 mismatch for Windows component');
  expect(smoke).toContain('Sentinel SHA-256 mismatch');
  expect(smoke).toContain("'channel-runtime\\cc-connect-sidecar.exe'");
  expect(smoke).toContain("'release\\win-unpacked\\resources\\memory\\engram.exe'");
  expect(smoke).toContain("$env:UV_OFFLINE = '1'");
});

test('cold installation and cache-hit upgrade retain runtime existence and component checks', () => {
  const smoke = read('scripts/ci/windows-installer-smoke.ps1');
  expect(smoke).not.toContain('verify-windows-runtime-signatures');
  expect(smoke.match(/resources\\channel-runtime\\cc-connect-sidecar\.exe/g)).toHaveLength(2);
  expect(smoke.match(/resources\\memory\\engram\.exe/g)).toHaveLength(2);
  expect(smoke).toContain('phase=component-cache-hit');
  expect(smoke).toContain('phase=component-cache-miss');
  expect(smoke).toContain('Wait-ForUninstallCompletion $installRoot $runtimeRoot');
});

test('desktop signing preserves the centrally signed memory runtime bytes', () => {
  const config = JSON.parse(read('electron-builder.json')) as { win: { signExts?: string[] } };
  expect(config.win.signExts).toEqual(['!engram.exe']);
});

test('signed releases check the packaged Magpie helper signature and sealed digest', () => {
  const authenticode = read('scripts/ci/verify-windows-authenticode.ps1');
  expect(authenticode).toContain('release\\win-unpacked\\resources\\magpie\\win32-x64');
  expect(authenticode).toContain("Join-Path $magpieDirectory 'magpie.exe'");
  expect(authenticode).toContain('Magpie SHA-256 does not match the sealed manifest');
  expect(authenticode).toContain("signing.format -ne 'authenticode'");
  for (const filename of [
    'daily-release.yml',
    'release-candidate.yml',
    'online-update-release.yml',
  ]) {
    const workflow = read(`.github/workflows/${filename}`);
    const staple = workflow.indexOf('xcrun stapler validate "$app_path"');
    const helper = workflow.indexOf(
      'node scripts/ci/verify-packaged-magpie-signature.mjs "$app_path"',
    );
    const gatekeeper = workflow.indexOf('spctl --assess --type execute --verbose=4 "$app_path"');
    expect(staple).toBeGreaterThan(-1);
    expect(helper).toBeGreaterThan(staple);
    expect(gatekeeper).toBeGreaterThan(helper);
  }
});

test('architecture gate accepts a pinned gateway binary that contains a retired-runtime label', () => {
  const directory = path.join(root, 'resources', 'magpie', 'linux-x64');
  const binary = path.join(directory, 'magpie');
  const manifestPath = path.join(directory, 'manifest.json');
  const previousBinary = existsSync(binary) ? readFileSync(binary) : null;
  const previousManifest = existsSync(manifestPath) ? readFileSync(manifestPath) : null;
  const marker = ['open', 'claw'].join('');
  const bytes = Buffer.from(`pinned gateway ${marker}`);
  const digest = crypto.createHash('sha256').update(bytes).digest('hex');
  const runGate = () =>
    spawnSync(process.execPath, [path.join(__dirname, decouplingScript())], {
      cwd: root,
      encoding: 'utf8',
      timeout: 30_000,
      windowsHide: true,
    });
  try {
    mkdirSync(directory, { recursive: true });
    writeFileSync(binary, bytes);
    writeFileSync(
      manifestPath,
      JSON.stringify({
        schemaVersion: 1,
        platform: 'linux',
        arch: 'x64',
        binary: 'magpie',
        version: upstream.version,
        sha256: digest,
        buildSha256: digest,
        source: { commit: upstream.commit },
      }),
    );
    const accepted = runGate();
    expect(accepted.status, accepted.stderr).toBe(0);

    writeFileSync(
      manifestPath,
      JSON.stringify({
        schemaVersion: 1,
        platform: 'linux',
        arch: 'x64',
        binary: 'magpie',
        version: 'not-the-pinned-version',
        sha256: digest,
        buildSha256: digest,
        source: { commit: upstream.commit },
      }),
    );
    const rejected = runGate();
    expect(rejected.status).not.toBe(0);
    expect(rejected.stderr).toMatch(/resources[/\\]magpie[/\\]linux-x64[/\\]magpie/);
  } finally {
    if (previousBinary) writeFileSync(binary, previousBinary);
    else rmSync(binary, { force: true });
    if (previousManifest) writeFileSync(manifestPath, previousManifest);
    else rmSync(manifestPath, { force: true });
    if (!previousBinary && !previousManifest) rmSync(directory, { recursive: true, force: true });
  }
});
