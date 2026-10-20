import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { load } from 'js-yaml';
import { expect, test } from 'vitest';

type Step = { name?: string; run?: string; uses?: string; if?: string };
const workflow = load(readFileSync('.github/workflows/build-windows-release.yml', 'utf8')) as {
  jobs: Record<string, { steps: Step[] }>;
};
const helper = path.resolve(__dirname, 'windows-signing-certificate.ps1');

test('windows-release signs in one Certum session and verifier enforces public DER and timestamp', () => {
  const buildSteps = workflow.jobs['windows-release'].steps;
  expect(buildSteps.some(step => step.uses?.includes('setup-certum-signing'))).toBe(true);
  expect(workflow.jobs.acceptance).toBeUndefined();
  const verifier = readFileSync('scripts/ci/verify-windows-authenticode.ps1', 'utf8');
  expect(verifier).toContain('$actualCertificateDer -ne $expectedCertificateDer');
  expect(verifier).toContain("$signature.Status -ne 'Valid'");
  expect(verifier).toContain('$null -eq $signature.TimeStamperCertificate');
});

test.skipIf(process.platform !== 'win32')(
  'public certificate acceptance works after deleting the signing-store entry and rejects a different pin',
  () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'public-signing-context-'));
    try {
      mkdirSync(path.join(root, 'release'));
      mkdirSync(path.join(root, 'scripts/ci'), { recursive: true });
      copyFileSync(helper, path.join(root, 'scripts/ci/windows-signing-certificate.ps1'));
      writeFileSync(path.join(root, 'export.ps1'), exportStep.run!);
      const probe = path.join(root, 'probe.ps1');
      writeFileSync(
        probe,
        `$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSHOME 'Modules/Microsoft.PowerShell.Security/Microsoft.PowerShell.Security.psd1')
Import-Module (Join-Path $PSHOME 'Modules/PKI/PKI.psd1')
$certificate = New-SelfSignedCertificate -Type CodeSigningCert -Subject 'CN=CI public certificate fixture' -CertStoreLocation Cert:\\CurrentUser\\My -KeyExportPolicy NonExportable
$storePath = 'Cert:\\CurrentUser\\My\\' + $certificate.Thumbprint
try {
  $env:CERTUM_CERT_THUMBPRINT = $certificate.Thumbprint
  $expectedDer = [Convert]::ToBase64String($certificate.RawData)
  & ./export.ps1
  Remove-Item -LiteralPath $storePath -Force
  . ./scripts/ci/windows-signing-certificate.ps1
  $public = Resolve-WindowsSigningCertificate -ExpectedThumbprint $env:CERTUM_CERT_THUMBPRINT -CertificatePath release/signing-certificate.cer
  if ($public.HasPrivateKey -or [Convert]::ToBase64String($public.RawData) -cne $expectedDer) { throw 'Public DER identity changed' }
  function Expect-Rejection([scriptblock]$Operation) {
    $rejected = $false
    try { & $Operation } catch { $rejected = $true }
    if (-not $rejected) { throw 'Invalid certificate identity was accepted' }
  }
  Expect-Rejection { Resolve-WindowsSigningCertificate -ExpectedThumbprint ('0' * 40) -CertificatePath release/signing-certificate.cer }
  Expect-Rejection { Resolve-WindowsSigningCertificate -ExpectedThumbprint $env:CERTUM_CERT_THUMBPRINT -CertificatePath release/missing.cer }
  Expect-Rejection { Resolve-WindowsSigningCertificate -ExpectedThumbprint $env:CERTUM_CERT_THUMBPRINT }
  [IO.File]::WriteAllText((Join-Path $PWD 'release/corrupt.cer'), 'invalid certificate')
  Expect-Rejection { Resolve-WindowsSigningCertificate -ExpectedThumbprint $env:CERTUM_CERT_THUMBPRINT -CertificatePath release/corrupt.cer }
  Write-Output 'PASS: public certificate verified without a signing store or private key'
} finally {
  if (Test-Path -LiteralPath $storePath) { Remove-Item -LiteralPath $storePath -Force }
}
`,
      );
      const result = spawnSync(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', probe],
        { cwd: root, encoding: 'utf8', timeout: 30_000 },
      );
      expect(result.error, result.stderr).toBeUndefined();
      expect(result.status, result.stderr || result.stdout).toBe(0);
      expect(result.stdout).toContain(
        'PASS: public certificate verified without a signing store or private key',
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  },
  35_000,
);
