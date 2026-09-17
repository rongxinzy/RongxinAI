import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, test } from 'vitest';

const root = path.resolve(__dirname, '../..');

test.skipIf(process.platform !== 'win32')(
  'rejects unsafe runtime signatures without cloud keys',
  () => {
    const workspace = mkdtempSync(path.join(tmpdir(), 'runtime-signature-policy-'));
    const scriptPath = path.join(workspace, 'policy.ps1');
    const helper = path.join(__dirname, 'runtime-authenticode.ps1').replace(/'/g, "''");
    const script = `
$ErrorActionPreference = 'Stop'
. '${helper}'
$trusted = '0123456789ABCDEF0123456789ABCDEF01234567'
$script:status = 'Valid'
$script:signer = $trusted
$script:timestamp = [pscustomobject]@{ Subject = 'Timestamp authority' }
$script:eku = '1.3.6.1.5.5.7.3.3'
function Get-AuthenticodeSignature {
  param([string]$LiteralPath)
  [pscustomobject]@{
    Status = $script:status
    SignerCertificate = [pscustomobject]@{
      Thumbprint = $script:signer
      Extensions = @([pscustomobject]@{
        Oid = [pscustomobject]@{ Value = '2.5.29.37' }
        EnhancedKeyUsages = @([pscustomobject]@{ Value = $script:eku })
      })
    }
    TimeStamperCertificate = $script:timestamp
  }
}
function Expect-Rejection {
  param([scriptblock]$Operation, [string]$Message)
  $rejected = $false
  try { & $Operation | Out-Null } catch {
    if ($_.Exception.Message -notlike "*$Message*") { throw }
    $rejected = $true
  }
  if (-not $rejected) { throw "Expected rejection: $Message" }
}
$fixture = $PSCommandPath
Assert-WindowsRuntimeSignature $fixture $trusted | Out-Null
Assert-WindowsRuntimeSignature $fixture $trusted.ToLowerInvariant() | Out-Null
Expect-Rejection { Assert-WindowsRuntimeSignature $fixture '' } 'RUNTIME_SIGNER_THUMBPRINT'
Expect-Rejection { Assert-WindowsRuntimeSignature $fixture ("z$trusted") } 'RUNTIME_SIGNER_THUMBPRINT'
Expect-Rejection { Assert-WindowsRuntimeSignature "$fixture.missing" $trusted } 'not found'
foreach ($value in @('NotSigned', 'HashMismatch', 'NotTrusted', 'UnknownError')) {
  $script:status = $value
  Expect-Rejection { Assert-WindowsRuntimeSignature $fixture $trusted } 'expected Valid'
}
$script:status = 'Valid'
$script:signer = '1123456789ABCDEF0123456789ABCDEF01234567'
Expect-Rejection { Assert-WindowsRuntimeSignature $fixture $trusted } 'trusted certificate'
$script:signer = $trusted
$script:timestamp = $null
Expect-Rejection { Assert-WindowsRuntimeSignature $fixture $trusted } 'trusted timestamp'
$script:timestamp = [pscustomobject]@{ Subject = 'Timestamp authority' }
$script:eku = '1.3.6.1.5.5.7.3.1'
Expect-Rejection { Assert-WindowsRuntimeSignature $fixture $trusted } 'code signing'
Write-Output 'Runtime signature policy tests passed.'
`;
    try {
      writeFileSync(scriptPath, script);
      const output = execFileSync('powershell.exe', ['-NoProfile', '-File', scriptPath], {
        encoding: 'utf8',
        timeout: 30_000,
      });
      expect(output).toContain('Runtime signature policy tests passed.');
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  },
);

test('verification requires no certificate store or private signing credentials', () => {
  const helper = readFileSync(path.join(__dirname, 'runtime-authenticode.ps1'), 'utf8');
  const verifier = readFileSync(
    path.join(__dirname, 'verify-windows-runtime-signatures.ps1'),
    'utf8',
  );
  expect(helper + verifier).not.toMatch(/Cert:\\|CERTUM_USER_ID|CERTUM_OTP_URI|HasPrivateKey/);
  expect(verifier).toContain('cc-connect-sidecar.exe');
  expect(verifier).toContain('engram.exe');
});

test('prepack verification downloads checksum-pinned binaries and fails closed', () => {
  const action = readFileSync(
    path.join(root, '.github/actions/verify-windows-runtime-signatures/action.yml'),
    'utf8',
  );
  expect(action.indexOf('bun run channel:runtime:win-x64')).toBeLessThan(
    action.indexOf('verify-windows-runtime-signatures.ps1'),
  );
  expect(action.indexOf('bun run engram:runtime:win-x64')).toBeLessThan(
    action.indexOf('verify-windows-runtime-signatures.ps1'),
  );
  expect(action).not.toContain('continue-on-error');
});

test('cold install and cache-hit upgrade both verify installed runtime signatures', () => {
  const smoke = readFileSync(path.join(__dirname, 'windows-installer-smoke.ps1'), 'utf8');
  expect(smoke.match(/verify-windows-runtime-signatures\.ps1/g)).toHaveLength(2);
});

test('packaging preserves the memory runtime publisher signature', () => {
  const config = JSON.parse(readFileSync(path.join(root, 'electron-builder.json'), 'utf8')) as {
    win: { signExts?: string[] };
  };
  expect(config.win.signExts).toContain('!engram.exe');
});

test('all Windows CI packaging routes verify runtimes before building', () => {
  for (const [filename, buildName] of [
    ['build-platforms.yml', 'Build Windows'],
    ['windows-installer-pr.yml', 'Build complete offline installer'],
    ['release-candidate.yml', 'Build Windows candidate'],
    ['online-update-release.yml', 'Build Windows package'],
  ]) {
    const filenamePath = path.join(root, '.github/workflows', filename);
    if (!existsSync(filenamePath)) continue;
    const workflow = readFileSync(filenamePath, 'utf8');
    const gate = workflow.indexOf('uses: ./.github/actions/verify-windows-runtime-signatures');
    expect(gate).toBeGreaterThan(-1);
    expect(gate).toBeLessThan(workflow.indexOf(`- name: ${buildName}`));
    expect(workflow).toContain('RUNTIME_SIGNER_THUMBPRINT: ${{ vars.RUNTIME_SIGNER_THUMBPRINT }}');
  }
});

test('postpack smoke verifies the extracted sidecar and copied memory executable', () => {
  const smoke = readFileSync(path.join(__dirname, 'windows-runtime-smoke.ps1'), 'utf8');
  expect(smoke).toContain("Join-Path $resourcesRoot 'channel-runtime\\cc-connect-sidecar.exe'");
  expect(smoke).toContain(
    "Join-Path $ProjectRoot 'release\\win-unpacked\\resources\\memory\\engram.exe'",
  );
});

test('standalone signature CI installs download dependencies without native lifecycle scripts', () => {
  const workflow = readFileSync(
    path.join(root, '.github/workflows/runtime-signature-gate.yml'),
    'utf8',
  );
  const install = workflow.indexOf('bun install --frozen-lockfile --ignore-scripts');
  expect(install).toBeGreaterThan(-1);
  expect(install).toBeLessThan(
    workflow.indexOf('uses: ./.github/actions/verify-windows-runtime-signatures'),
  );
});
