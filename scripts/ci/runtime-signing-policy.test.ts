import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test } from 'vitest';

const root = path.resolve(__dirname, '../..');

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
  expect(smoke).not.toMatch(/Assert-WindowsRuntimeSignature|Get-AuthenticodeSignature|runtime-authenticode/);
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
  expect(config.win.signExts).toContain('!engram.exe');
});
