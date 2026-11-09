import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { load } from 'js-yaml';
import { expect, test } from 'vitest';

type Step = {
  name?: string;
  run?: string;
  uses?: string;
  if?: string;
  with?: Record<string, string>;
};
type Job = {
  needs?: string;
  'runs-on'?: string;
  strategy?: { matrix: { edition: string[] } };
  steps: Step[];
};
const workflow = load(readFileSync('.github/workflows/build-windows-release.yml', 'utf8')) as {
  jobs: Record<string, Job>;
};
const checkpointAction = load(
  readFileSync('.github/actions/checkpoint-windows-package/action.yml', 'utf8'),
) as { runs: { steps: Step[] } };
const exportStep = checkpointAction.runs.steps.find(
  step => step.name === 'Export public signing certificate only',
)!;
const helper = path.resolve(__dirname, 'windows-signing-certificate.ps1');

test('windows-release signs in one Certum session and verifier enforces public DER and timestamp', () => {
  const buildSteps = workflow.jobs['windows-release'].steps;
  const signingSteps = Object.values(workflow.jobs)
    .flatMap(job => job.steps)
    .filter(step => step.uses?.includes('setup-certum-signing'));
  expect(signingSteps).toHaveLength(1);
  expect(buildSteps).toContain(signingSteps[0]);
  const acceptance = workflow.jobs.acceptance;
  expect(acceptance.needs).toBe('windows-release');
  expect(acceptance['runs-on']).toBe('windows-2022');
  expect(acceptance.strategy?.matrix.edition).toEqual(['lite', 'cpu', 'cuda']);
  expect(JSON.stringify(acceptance)).not.toContain('secrets.');
  expect(JSON.stringify(acceptance)).not.toContain('setup-certum-signing');
  const restore = acceptance.steps.findIndex(
    step => step.run?.includes('build-checkpoint.mjs restore'),
  );
  const publicIdentity = acceptance.steps.findIndex(step => step.run?.includes('X509Certificate2'));
  const verify = acceptance.steps.findIndex(
    step => step.uses === './.github/actions/verify-windows-package',
  );
  expect(restore).toBeGreaterThan(-1);
  expect(publicIdentity).toBeGreaterThan(restore);
  expect(verify).toBeGreaterThan(publicIdentity);
  expect(acceptance.steps[publicIdentity].run).toContain('if ($certificate.HasPrivateKey) { throw');
  expect(acceptance.steps[verify].with?.['certificate-path']).toBe('release/signing-certificate.cer');
  expect(acceptance.steps[verify].with?.['certificate-thumbprint']).toBe(
    '${{ steps.public-signing-identity.outputs.thumbprint }}',
  );
  expect(exportStep.run).toContain('-Type CERT');
  expect(exportStep.run).not.toContain('Export-PfxCertificate');
  const verifier = readFileSync('scripts/ci/verify-windows-authenticode.ps1', 'utf8');
  expect(verifier).toContain('$actualCertificateDer -ne $expectedCertificateDer');
  expect(verifier).toContain("$signature.Status -ne 'Valid'");
  expect(verifier).toContain('$null -eq $signature.TimeStamperCertificate');
});

test.skipIf(process.platform !== 'win32')(
  'public certificate acceptance works after deleting the signing-store entry and rejects a different pin',
  () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'public-signing-context-'));
    const fixtureId = process.env.WINDOWS_CERT_FIXTURE_ID || path.basename(root);
    const recordPath = process.env.WINDOWS_CERT_FIXTURE_RECORD || path.join(root, 'certificate.json');
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
$subject = 'CN=CI public certificate fixture ' + $env:WINDOWS_CERT_FIXTURE_ID
if (@(Get-ChildItem Cert:\\CurrentUser\\My | Where-Object { $_.Subject -ceq $subject }).Count -ne 0) { throw 'Fixture certificate identity already exists' }
@{ subject = $subject; thumbprint = $null } | ConvertTo-Json | Set-Content -LiteralPath $env:WINDOWS_CERT_FIXTURE_RECORD
$certificate = New-SelfSignedCertificate -Type CodeSigningCert -Subject $subject -CertStoreLocation Cert:\\CurrentUser\\My -KeyExportPolicy NonExportable
$storePath = 'Cert:\\CurrentUser\\My\\' + $certificate.Thumbprint
try {
  @{ subject = $subject; thumbprint = $certificate.Thumbprint } | ConvertTo-Json | Set-Content -LiteralPath $env:WINDOWS_CERT_FIXTURE_RECORD
  $env:CERTUM_CERT_THUMBPRINT = $certificate.Thumbprint
  $env:THUMBPRINT = $certificate.Thumbprint
  $expectedDer = [Convert]::ToBase64String($certificate.RawData)
  & ./export.ps1
  Remove-Item -LiteralPath $storePath -Force -DeleteKey
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
  if (Test-Path -LiteralPath $storePath) { Remove-Item -LiteralPath $storePath -Force -DeleteKey }
}
`,
      );
      const result = spawnSync(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', probe],
        {
          cwd: root,
          encoding: 'utf8',
          timeout: 30_000,
          env: {
            ...process.env,
            WINDOWS_CERT_FIXTURE_ID: fixtureId,
            WINDOWS_CERT_FIXTURE_RECORD: recordPath,
          },
        },
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
