import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { load as loadYaml } from 'js-yaml';
import { expect, test } from 'vitest';

const scriptPath = path.join(__dirname, 'windows-shell-uninstall.ps1');
const helperPath = path.join(__dirname, 'windows-shell-uninstall-helpers.ps1');
const driver = fs.readFileSync(scriptPath, 'utf8');
const helpers = fs.readFileSync(helperPath, 'utf8');
const installedPathDefinition = driver.slice(
  driver.indexOf('$unicodeInstallName ='),
  driver.indexOf('$customData ='),
);

test('native uninstall independently constructs Unicode paths safely under Windows PowerShell 5', () => {
  expect([...driver, ...helpers].every(character => character.codePointAt(0)! < 128)).toBe(true);
  expect(installedPathDefinition).toContain('$unicodeInstallName =');
  expect(installedPathDefinition).toContain('$app = Join-Path $installRoot $appName');
  expect(driver).toContain('Assert-SameAcceptancePath $shellReport.installedExecutable $app');
});

test('hashing streams bytes and host modules cannot depend on inherited pwsh search paths', () => {
  expect(helpers).not.toContain('Get-FileHash');
  expect(helpers).toContain('[IO.File]::OpenRead($Path)');
  expect(helpers).toContain('$sha256.ComputeHash($stream)');
  expect(helpers).toContain('$stream.Dispose()');
  expect(helpers).toContain('$sha256.Dispose()');
  expect(helpers).toContain("[IO.Path]::Combine($PSHOME, 'Modules', $name, ($name + '.psd1'))");
  expect(helpers).toContain('Import-Module -Name $manifest -Global -ErrorAction Stop');
  expect(driver).toContain('Initialize-AcceptanceModules');
  expect(driver).toContain('Microsoft.PowerShell.Security\\Get-AuthenticodeSignature');
});

test('native uninstall gate runs only after real shell evidence and protects the earlier native cache', () => {
  const workflow = loadYaml(
    fs.readFileSync('.github/workflows/windows-installer-pr.yml', 'utf8'),
  ) as {
    jobs: { 'package-and-install': { steps: { name?: string; run?: string }[] } };
  };
  const steps = workflow.jobs['package-and-install'].steps;
  const position = (command: string) => steps.findIndex(step => step.run?.includes(command));
  expect(position('windows-shell-uninstall.ps1 -Action prepare')).toBeGreaterThan(-1);
  expect(position('windows-shell-uninstall.ps1 -Action prepare')).toBeLessThan(
    position('-File scripts/ci/windows-installer-smoke.ps1'),
  );
  expect(position('windows-shell-uninstall.ps1 -Action verify')).toBeGreaterThan(
    position('node scripts/ci/windows-shell-evidence.mjs'),
  );
  expect(driver).toContain("$env:GITHUB_ACTIONS -cne 'true'");
  expect(driver).toContain('[switch]$OwnedAcceptanceContext');
  expect(driver).toContain("'^zhiyuan-package-acceptance-[a-f0-9]{32}$'");
  expect(driver).toContain('initiallyAbsent = $true');
  expect(driver).toContain('Assert-AcceptanceLease $lease $commit $runId $runtimeRoot $runnerRoot');
  expect(driver).toContain('[IO.Directory]::Move($runtimeRoot, $quarantine)');
  expect(driver).toMatch(/finally\s*\{[\s\S]*Restore-AcceptanceRuntime \$quarantine \$runtimeRoot/);
  expect(driver).not.toContain('Remove-Item');
  expect(driver).not.toContain('Invoke-Expression');
  expect(driver).toContain("$native.StartInfo.Arguments = '/S'");
  expect(driver).toContain("[Environment]::GetFolderPath('ApplicationData')");
  expect(driver).toContain('realDefaultUserDataPreserved = $true');
  expect(driver).toContain('not reclaimed by the fixed-root NSIS uninstaller');
  expect(driver).toContain("$signature.Status -ne 'Valid'");
  expect(driver).toContain('$signature.SignerCertificate.Thumbprint -cne $thumbprint');
  expect(driver).toContain('$null -eq $signature.TimeStamperCertificate');
});

test('internal and unsigned artifact delivery also require fresh lease and real uninstall before upload', () => {
  const workflow = fs.readFileSync('.github/workflows/release.yml', 'utf8');
  expect(workflow.indexOf('windows-shell-uninstall.ps1 -Action prepare')).toBeLessThan(
    workflow.indexOf('node scripts/ci/windows-shell-interactive.mjs'),
  );
  expect(workflow.indexOf('windows-shell-uninstall.ps1 -Action verify')).toBeGreaterThan(
    workflow.indexOf('node scripts/ci/windows-shell-evidence.mjs'),
  );
  const internal = fs.readFileSync('scripts/ci/package-windows.ps1', 'utf8');
  expect(internal.indexOf('-Action prepare -OwnedAcceptanceContext')).toBeLessThan(
    internal.indexOf('& node scripts/ci/windows-shell-interactive.mjs'),
  );
  const verify = internal.indexOf('-Action verify -OwnedAcceptanceContext');
  expect(verify).toBeGreaterThan(internal.indexOf('& node scripts/ci/windows-shell-evidence.mjs'));
  expect(verify).toBeLessThan(internal.indexOf('$uploadUrl ='));
  expect(internal).toContain('Existing runtime data was not removed.');
  expect(internal).not.toContain('$env:GITHUB_ACTIONS =');
});

test.skipIf(process.platform !== 'win32')(
  'real PowerShell rejects wrong leases, commands, host bytes and restore collisions without deleting data',
  () => {
    const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'shell-uninstall-contract-'));
    const probe = path.join(fixture, 'probe.ps1');
    const quote = (value: string) => `'${value.replaceAll("'", "''")}'`;
    fs.writeFileSync(
      probe,
      `
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
foreach ($file in @(${quote(scriptPath)}, ${quote(helperPath)})) {
  $errors = $null
  $null = [System.Management.Automation.Language.Parser]::ParseFile($file, [ref]$null, [ref]$errors)
  if ($errors.Count) { throw ($errors | Out-String) }
}
. ${quote(helperPath)}
$root = ${quote(fixture)}
$sandbox = Join-Path $root 'zhiyuan-shell-acceptance'
${installedPathDefinition}
[IO.File]::WriteAllText((Join-Path $root 'installed-path.txt'), $app, [Text.UTF8Encoding]::new($false))
$env:PSModulePath = [IO.Path]::Combine($root, 'no-module-search-path')
Initialize-AcceptanceModules
$hashFixture = Join-Path $root 'hash [literal] $x.bin'
[IO.File]::WriteAllBytes($hashFixture, [Text.Encoding]::ASCII.GetBytes('abc'))
if ((Get-AcceptanceSha256 $hashFixture) -cne 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad') { throw 'SHA256 abc known-answer mismatch' }
[IO.File]::WriteAllBytes($hashFixture, [byte[]]@())
if ((Get-AcceptanceSha256 $hashFixture) -cne 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855') { throw 'SHA256 empty-file known-answer mismatch' }
$hashLock = [IO.File]::Open($hashFixture, [IO.FileMode]::Open, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
$hashLock.Dispose()
if ((Get-Command Microsoft.PowerShell.Security\\Get-AuthenticodeSignature).ModuleName -cne 'Microsoft.PowerShell.Security') { throw 'Real host Security module did not load' }
if ((Microsoft.PowerShell.Security\\Get-AuthenticodeSignature -LiteralPath $PSCommandPath).Status -ne 'NotSigned') { throw 'Real unsigned Authenticode verification failed' }
if ((Get-Command CimCmdlets\\Get-CimInstance).ModuleName -cne 'CimCmdlets') { throw 'Real host CIM module did not load' }
if ($null -eq (CimCmdlets\\Get-CimInstance Win32_Process -Filter ('ProcessId = ' + $PID))) { throw 'Real CIM query failed without inherited module search paths' }
Write-Output 'PASS: standard SHA256 vectors and real Security/CIM modules with no module search path'
$runtime = Join-Path $root 'runtime [literal] $x'
$backup = Join-Path $root 'quarantine'
$lease = [pscustomobject]@{ kind='native-uninstall-runtime-lease'; version=1; initiallyAbsent=$true; commit='abc'; runId='1'; runtimeRoot=$runtime; runnerRoot=$root }
Assert-AcceptanceLease $lease 'abc' '1' $runtime $root
function Expect-Rejection([scriptblock]$Action) {
  $rejected = $false
  try { & $Action } catch { $rejected = $true }
  if (-not $rejected) { throw 'Unsafe acceptance operation was allowed' }
}
Expect-Rejection { Assert-AcceptanceLease $lease 'other' '1' $runtime $root }
Expect-Rejection { Assert-AcceptanceLease $lease 'abc' '2' $runtime $root }
$lease.initiallyAbsent = $false
Expect-Rejection { Assert-AcceptanceLease $lease 'abc' '1' $runtime $root }
$lease.initiallyAbsent = $true
[IO.Directory]::CreateDirectory($runtime) | Out-Null
[IO.File]::WriteAllText((Join-Path $runtime 'original'), 'preserved')
[IO.Directory]::Move($runtime, $backup)
[IO.Directory]::CreateDirectory($runtime) | Out-Null
[IO.File]::WriteAllText((Join-Path $runtime 'new'), 'do not replace')
Expect-Rejection { Restore-AcceptanceRuntime $backup $runtime }
if ([IO.File]::ReadAllText((Join-Path $runtime 'new')) -cne 'do not replace' -or [IO.File]::ReadAllText((Join-Path $backup 'original')) -cne 'preserved') { throw 'Restore collision changed data' }
[IO.File]::Delete((Join-Path $runtime 'new'))
[IO.Directory]::Delete($runtime)
Restore-AcceptanceRuntime $backup $runtime
if ([IO.File]::ReadAllText((Join-Path $runtime 'original')) -cne 'preserved') { throw 'Atomic runtime restore lost original data' }
$captured = Join-Path $root 'captured.exe'
$installed = Join-Path $root 'Uninstall Fixture.exe'
[IO.File]::WriteAllText($captured, 'original signed-byte fixture')
[IO.File]::Copy($captured, $installed)
$hash = Get-AcceptanceSha256 $captured
$manifest = [pscustomobject]@{ kind='nsis-uninstall-host'; sourceCommit='abc'; sha256=$hash; sourceSha256=$hash; sourceFileName='Fixture.__uninstaller.exe'; installedFileName='Uninstall Fixture.exe'; bytes=(Get-Item -LiteralPath $captured).Length }
Assert-NativeHostIdentity $manifest $captured $installed 'abc'
$registration = [pscustomobject]@{ InstallLocation=$root; UninstallString=('"' + $installed + '"'); QuietUninstallString=('"' + $installed + '" /S') }
Assert-NativeUninstallCommands $registration $installed $root
$registration.QuietUninstallString = '"' + $installed + '" --silent'
Expect-Rejection { Assert-NativeUninstallCommands $registration $installed $root }
Expect-Rejection { Assert-NativeHostIdentity $manifest $captured $installed 'other' }
[IO.File]::AppendAllText($installed, 'tamper')
Expect-Rejection { Assert-NativeHostIdentity $manifest $captured $installed 'abc' }
$linked = Join-Path $root 'linked'
$env:ZY_ACCEPTANCE_LINK = $linked
$env:ZY_ACCEPTANCE_TARGET = $runtime
& $env:COMSPEC /d /c 'mklink /J "%ZY_ACCEPTANCE_LINK%" "%ZY_ACCEPTANCE_TARGET%"' | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Could not create literal-path junction fixture' }
Expect-Rejection { Assert-PhysicalAcceptancePath $linked }
Expect-Rejection { Assert-PhysicalAcceptancePath (Join-Path $linked 'child') }
[IO.Directory]::Delete($linked)
Write-Output 'PASS: actual leases, literal paths, host identity and non-destructive restore conflicts'
`,
    );
    try {
      const result = spawnSync(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', probe],
        { encoding: 'utf8', timeout: 30_000 },
      );
      expect(result.error, result.stderr).toBeUndefined();
      expect(result.status, result.stderr || result.stdout).toBe(0);
      expect(result.stdout).toContain(
        'PASS: actual leases, literal paths, host identity and non-destructive restore conflicts',
      );
      expect(result.stdout).toContain(
        'PASS: standard SHA256 vectors and real Security/CIM modules with no module search path',
      );
      expect(fs.readFileSync(path.join(fixture, 'installed-path.txt'), 'utf8')).toBe(
        path.join(fixture, 'zhiyuan-shell-acceptance/安装路径/知远.exe'),
      );
    } finally {
      fs.rmSync(fixture, { recursive: true, force: true });
    }
  },
  40_000,
);
