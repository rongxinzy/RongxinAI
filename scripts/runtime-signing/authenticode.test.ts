import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, test } from 'vitest';

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
