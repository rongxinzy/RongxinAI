import { readFileSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { expect, test } from 'vitest';

const scriptPath = path.join(__dirname, 'windows-installer-interactive.ps1');
const helperPath = path.join(__dirname, 'windows-installer-ui.cs');
const script = readFileSync(scriptPath, 'utf8');
const helper = readFileSync(helperPath, 'utf8');
const workflow = readFileSync('.github/workflows/windows-installer-pr.yml', 'utf8');

test('uses real visible controls and waits for completion without clicking hidden Next', () => {
  expect(script).toContain(
    'Start-Process -FilePath $installer.FullName -ArgumentList "/LANGUAGE=$Language /D=$installRoot"',
  );
  expect(script).not.toMatch(/-ArgumentList[^\r\n]*\/S\b/);
  const progress = script.slice(
    script.indexOf('function Wait-ForProgressAndFinish'),
    script.indexOf('function Wait-InstallerExit'),
  );
  expect(progress).toContain('$_.ControlId -eq 1201 -and $_.Visible');
  expect(progress).toContain('$_.ControlId -ge 1200 -and $_.ControlId -le 1206');
  expect(progress).toContain('automatic transition from progress to actionable finish page');
  expect(progress).not.toContain('::Click(');
  expect(helper).toContain('!control.Visible || !control.Enabled');
  expect(helper).toContain('PostMessage(window, 0x00F5');
  expect(helper).not.toContain('0x0111');
});

test('requires actual windows, screenshots, real DPI and usable actions', () => {
  for (const marker of [
    'PrintWindow(window, dc, 2)',
    'Window capture is blank',
    'Dpi = GetDpiForWindow(window)',
    'Action is clipped by the wizard',
    'Action text does not fit at',
  ]) {
    expect(helper).toContain(marker);
  }
  expect(script).toContain('$script:wizard.Dpi -ne $ExpectedDpi');
  expect(script).toContain("throw 'Finish actions overlap'");
  expect(script).toContain("Save-Page 'launched-installed-app'");
  expect(script).not.toMatch(
    /Defender|Add-MpPreference|Set-MpPreference|Set-WinUILanguageOverride/,
  );
});

test('checks cancellation against the live app, exact bytes, registration and directory identity', () => {
  for (const assertion of [
    'Opening/cancelling setup terminated the existing application',
    'Cancelling setup changed the existing installation bytes',
    'Cancelling setup changed the existing installation registration',
    'Cancelling setup detached the existing installation',
    'Cancelling setup created or replaced an installation backup:',
  ]) {
    expect(script).toContain(assertion);
  }
  expect(helper).toContain('GetFileInformationByHandle(directory, out information)');
  expect(helper).toContain('CreateFile(path, 0, 7, IntPtr.Zero, 3, 0x02200000');
  expect(script).toContain('$Before.identity -ne $After.identity');
  expect(script).toContain('$_.identity -eq $backup.identity');
  expect(script).not.toMatch(/\$env:(?:USERPROFILE|APPDATA|LOCALAPPDATA|HOME)\s*=/);
});

test('recovers from a real sharing violation and real failed launch', () => {
  expect(script).toContain('[IO.FileShare]::Read)');
  expect(script).toContain('recoverable locked-directory Retry/Cancel dialog');
  expect(script).toContain(
    'Committed reinstall did not stop the existing application before retry',
  );
  expect(
    script.indexOf('$fileLock.Dispose()', script.indexOf("Save-Page 'recovery-locked-directory'")),
  ).toBeLessThan(script.indexOf('::Click((Get-Button -Id 4'));
  expect(script).toContain('Move-Item -LiteralPath $app -Destination $launchBackup');
  expect(script).toContain('usable finish page after launch failure');
  expect(script).toContain('Launch failure closed the installer instead of allowing recovery');
  expect(script).toMatch(
    /finally\s*\{[\s\S]*Move-Item -LiteralPath \$launchBackup -Destination \$app/,
  );
});

test('keeps native and WebView2 artifacts separate and preserves the full silent regression', () => {
  for (const name of [
    'windows-installer-interactive.ps1',
    'windows-installer-smoke.ps1',
    'windows-installer-size-smoke.ps1',
  ]) {
    expect(readFileSync(path.join(__dirname, name), 'utf8')).toContain(
      "$_.Name -notlike 'ZhiYuanAgent-Setup-*'",
    );
  }
  for (const check of [
    'freshInstall',
    'closeWithoutLaunch',
    'cancelPreservesRunningInstallation',
    'lockedDirectoryRetry',
    'launchFailureRecovery',
    'finishLaunchesInstalledApplication',
    'visibleActionsFitActualDpi',
    'chineseAndEnglish',
  ]) {
    expect(script).toContain(`$report.checks.${check} = $true`);
  }
  expect(workflow).toContain('run: ./scripts/ci/windows-installer-interactive.ps1');
  expect(workflow).toContain('-File scripts/ci/windows-installer-smoke.ps1');
  expect(workflow).not.toContain('continue-on-error');
  expect(readFileSync('scripts/ci/windows-installer-smoke.ps1', 'utf8')).toContain(
    'exactly seven offline components',
  );
});

test('preserves Chinese source text and validates both languages', () => {
  expect(readFileSync(scriptPath).subarray(0, 3)).toEqual(Buffer.from([0xef, 0xbb, 0xbf]));
  expect(script).toContain('已阅读并同意');
  expect(script).toContain('安装路径');
  expect(script).toContain('Start-Installer -Language 2052');
  expect(script).toContain('Start-Installer -Language 1033');
  expect(script).toContain('The real installer did not display the requested language');
});

test.skipIf(process.platform !== 'win32')(
  'exercises real registration aliases and cancellation directory identities',
  () => {
    const result = spawnSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        path.join(__dirname, 'windows-installer-interactive-regression.ps1'),
        '-DriverPath',
        scriptPath,
      ],
      { encoding: 'utf8', timeout: 30_000 },
    );
    expect(result.error, result.stderr).toBeUndefined();
    expect(result.status, result.stderr || result.stdout).toBe(0);
    expect(result.stdout).toContain(
      'PASS: real directory identities and cancellation backup differences',
    );
    expect(result.stdout).toContain(
      'PASS: all seven owned component sets and preserved personal runtime content',
    );
  },
);

test.skipIf(process.platform !== 'win32')(
  'parses PowerShell and compiles the native driver before packaging',
  () => {
    const quote = (value: string) => `'${value.replaceAll("'", "''")}'`;
    const command = [
      "$ErrorActionPreference = 'Stop'",
      '$parseErrors = $null',
      `$null = [System.Management.Automation.Language.Parser]::ParseFile(${quote(scriptPath)}, [ref]$null, [ref]$parseErrors)`,
      'if ($parseErrors.Count) { throw ($parseErrors | Out-String) }',
      'Add-Type -AssemblyName System.Drawing',
      `Add-Type -Path ${quote(helperPath)} -ReferencedAssemblies System,System.Core,System.Drawing`,
      '[ZhiYuan.Acceptance.InstallerUi]::UsePhysicalCoordinates()',
    ].join('; ');
    const result = spawnSync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', command],
      { encoding: 'utf8', timeout: 20_000 },
    );
    expect(result.error, result.stderr).toBeUndefined();
    expect(result.status, result.stderr).toBe(0);
  },
);

test('process regression retains native handles and verifies nonzero exit-status capture', () => {
  const regression = readFileSync(
    path.join(__dirname, 'windows-installer-process-regression.ps1'),
    'utf8',
  );
  const helper = regression.split('function Invoke-BoundedHelper {')[1]?.split('\nfunction ')[0];
  expect(helper).toContain('New-Object System.Diagnostics.Process');
  expect(helper).toContain('$helper.StartInfo.UseShellExecute = $false');
  expect(helper).toContain('$helper.get_ExitCode()');
  expect(helper).toContain('$null -eq $exitCode');
  expect(helper).toContain('$helper.StandardOutput.ReadToEndAsync()');
  expect(helper).toContain('$helper.StandardError.ReadToEndAsync()');
  expect(helper).toContain('$helper.WaitForExit(20000)');
  expect(helper).toContain('$helper.Dispose()');
  expect(helper).not.toMatch(/^\s*\$helper\s*=\s*Start-Process/m);
  expect(regression).toContain('foreach ($code in @(0, 3, 200))');
  expect(regression).toContain('Format-ProcessFailure $countBefore');
});

test.skipIf(process.platform !== 'win32')(
  'parses production process helpers and stops only bounded real app, sidecar and runtime children',
  () => {
    const result = spawnSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        path.join(__dirname, 'windows-installer-process-regression.ps1'),
        '-InstallerScriptPath',
        path.resolve('scripts/nsis-installer.nsh'),
      ],
      { encoding: 'utf8', timeout: 60_000 },
    );
    expect(result.error, result.stderr).toBeUndefined();
    expect(result.status, result.stderr || result.stdout).toBe(0);
    expect(result.stdout).toContain(
      'PASS: real bounded helper preserves exit codes 0, 3, 200 and both output streams',
    );
    expect(result.stdout).toContain(
      'PASS: production NSIS commands parse and stop only real owned processes',
    );
  },
  70_000,
);
