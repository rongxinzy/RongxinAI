import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { getMakeNsisPath } from 'app-builder-lib/out/toolsets/windows';
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
  expect(progress).toContain('::HasBrandedProgress($script:wizard.Handle, $expectedTitle)');
  expect(progress).toContain('::AssertProgressRemoved($script:wizard.Handle)');
  expect(progress).not.toContain('$_.ControlId');
  expect(progress).toContain('automatic transition from progress to actionable finish page');
  expect(progress).not.toContain('::Click(');
  expect(helper).toContain('!control.Visible || !control.Enabled');
  expect(helper).toContain('PostMessage(window, 0x00F5');
  expect(helper).not.toContain('0x0111');
});

test('scopes progress identity to wizard-owned controls instead of reused nsDialogs IDs', () => {
  expect(helper).toContain('ParentHandle = GetParent(window).ToInt64()');
  expect(helper).toContain(
    'control.ParentHandle == wizard && control.ControlId >= 1200 && control.ControlId <= 1206',
  );
  expect(helper).toContain('controls.Length != 7');
  expect(helper).toContain('control.ClassName != "Static" || !ids.Add(control.ControlId)');
  expect(helper).toContain('control.Visible && control.Text == expectedTitle');
  const removal = helper.slice(
    helper.indexOf('public static void AssertProgressRemoved('),
    helper.indexOf('public static int Checked('),
  );
  expect(removal).toContain('ProgressControls(wizard)');
  expect(removal).toContain('controls.Length != 0');
  expect(removal).not.toMatch(/if\s*\([^)]*Visible/);
  const pages = readFileSync('scripts/installer-ui/zy-pages.nsh', 'utf8');
  for (let id = 1200; id <= 1206; id++) {
    expect(pages).toContain(`i $HWNDPARENT, i ${id},`);
  }
  expect(script).toContain("'正在安装知远智能体' } else { 'Installing ZhiYuan Agent'");
});

test.skipIf(process.platform !== 'win32')(
  'distinguishes real cross-process page ID reuse and rejects visible or hidden progress residue',
  () => {
    const result = spawnSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        path.join(__dirname, 'windows-installer-progress-regression.ps1'),
        '-ProjectRoot',
        path.resolve('.'),
      ],
      { encoding: 'utf8', timeout: 90_000 },
    );
    expect(result.error, result.stderr).toBeUndefined();
    expect(result.status, result.stderr || result.stdout).toBe(0);
    expect(result.stdout).toContain(
      'PASS: real page-scoped IDs distinguish hero, progress and finish; visible and hidden progress residue fail',
    );
  },
  100_000,
);

test('uses a real native Button and its parent notification in the progress fixture', () => {
  const fixture = readFileSync(
    path.join(__dirname, 'windows-installer-progress-fixture.cs'),
    'utf8',
  );
  expect(fixture).toContain('CreateWindowEx(0, "Button", "Advance fixture"');
  expect(fixture).toContain('message.Msg == 0x0111 && message.LParam == AdvanceButton');
  expect(fixture).toContain('((message.WParam.ToInt64() >> 16) & 0xffff) == 0');
  expect(fixture).not.toContain('new Button');
  expect(helper).toContain('control.ClassName != "Button"');
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

test('measures the production font locally instead of using another process private GDI handle', () => {
  const layout = helper.slice(
    helper.indexOf('public static void AssertActionLayout('),
    helper.indexOf('public static void Capture('),
  );
  expect(layout).not.toContain('0x0031');
  expect(layout).toContain('CreateFont(height, 0, 0, 0, weight');
  expect(layout).toContain('oldFont == IntPtr.Zero || oldFont == new IntPtr(-1)');
  expect(layout).toContain('DrawText(dc, control.Text, -1, ref measured, 0x0420) <= 0');
  expect(layout).toContain('DeleteObject(font)');
  expect(layout).toContain('20 * control.Dpi / 96.0');
  expect(script).toContain('ReadActionFontContract');
  expect(script).toContain('$actionFont.BodyWeight');
  expect(script).toContain('$actionFont.ButtonWeight');
  const pages = readFileSync('scripts/installer-ui/zy-pages.nsh', 'utf8');
  expect(pages).toContain('ZY_SetFont $heroLicense ${ZY_FONT_BODY_SIZE} ${ZY_FONT_BODY_WT}');
  expect(pages).toMatch(
    /NSD_CreateLink[\s\S]*?ZY_SetFont \$0 \$\{ZY_FONT_BODY_SIZE\} \$\{ZY_FONT_BODY_WT\}/,
  );
  expect(pages).toMatch(
    /NSD_CreateButton[^\n]*ZY_FINISH_LAUNCH_X[\s\S]*?ZY_SetFont \$0 \$\{ZY_FONT_BODY_SIZE\} \$\{ZY_FONT_BUTTON_WT\}/,
  );
});

test.skipIf(process.platform !== 'win32')(
  'checks real cross-process font measurements and rejects deliberately clipped controls before packaging',
  () => {
    const result = spawnSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        path.join(__dirname, 'windows-installer-layout-regression.ps1'),
        '-ProjectRoot',
        path.resolve('.'),
      ],
      { encoding: 'utf8', timeout: 45_000 },
    );
    expect(result.error, result.stderr).toBeUndefined();
    expect(result.status, result.stderr || result.stdout).toBe(0);
    expect(result.stdout).toContain(
      'PASS: cross-process Chinese and English action fonts fit; clipped width and height fail',
    );
  },
  50_000,
);

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
  expect(script).toContain(
    'FindDialogAcknowledgement($window.Handle, $script:wizard.ProcessId, $script:wizard.Text, $launchErrorPattern, $script:wizard.Handle)',
  );
  expect(script).toContain(
    'ClickDialogAcknowledgement($launchError.Handle, $script:wizard.ProcessId, $script:wizard.Text, $launchErrorPattern, $script:wizard.Handle)',
  );
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
  expect(script).toContain('@($install, $license, $licenseLink, $cancel)');
  const installer = readFileSync('scripts/nsis-installer.nsh', 'utf8');
  expect(installer).toMatch(
    /!macro customInit\s+!insertmacro ApplyRequestedInstallerLanguage\s+!insertmacro StageInstallSafetyScripts/,
  );
});

test.skipIf(process.platform !== 'win32' && !process.env.ELECTRON_BUILDER_NSIS_DIR)(
  'compiles the production language parser and executes real NSIS language selection on Windows',
  async () => {
    const root = realpathSync.native(
      mkdtempSync(path.join(os.tmpdir(), 'nsis-language-contract-')),
    );
    try {
      const installer = readFileSync('scripts/nsis-installer.nsh', 'utf8');
      const parser = installer.match(
        /!macro ApplyRequestedInstallerLanguage\r?\n[\s\S]*?!macroend/,
      );
      expect(parser).not.toBeNull();
      const executable = path.join(root, 'language.exe');
      const output = path.join(root, 'language.txt');
      const source = path.join(root, 'language.nsi');
      writeFileSync(
        source,
        `Unicode true
!include "FileFunc.nsh"
!include "LogicLib.nsh"
Name "Production language parser regression"
OutFile "${executable}"
RequestExecutionLevel user
SilentInstall silent
LoadLanguageFile "\${NSISDIR}\\Contrib\\Language files\\English.nlf"
LoadLanguageFile "\${NSISDIR}\\Contrib\\Language files\\SimpChinese.nlf"
LoadLanguageFile "\${NSISDIR}\\Contrib\\Language files\\TradChinese.nlf"
LangString Choice 1033 "Install"
LangString Choice 2052 "安装"
LangString Choice 1028 "安裝"
${parser![0]}
Function .onInit
  StrCpy $LANGUAGE 1028
  StrCpy $0 "register-zero"
  StrCpy $1 "register-one"
  !insertmacro ApplyRequestedInstallerLanguage
FunctionEnd
; NSIS resolves the new language table only after .onInit returns. Like the
; real wizard, inspect translated strings after that lifecycle boundary.
; https://nsis.sourceforge.io/Reference/LangString
Section
  FileOpen $2 "${output}" w
  FileWriteUTF16LE /BOM $2 "$LANGUAGE|$(Choice)|$0|$1|$INSTDIR"
  FileClose $2
  SetErrorLevel 0
SectionEnd
`,
        'utf8',
      );
      const compiler = await getMakeNsisPath(undefined);
      const built = spawnSync(compiler.path, ['-WX', '-INPUTCHARSET', 'UTF8', source], {
        env: { ...process.env, ...compiler.env },
        encoding: 'utf8',
        timeout: 30_000,
      });
      expect(built.error, built.stderr).toBeUndefined();
      expect(built.status, built.stderr || built.stdout).toBe(0);
      if (process.platform !== 'win32') return;
      for (const [option, expected] of [
        ['/LANGUAGE=2052', '2052|安装'],
        ['/LANGUAGE=1033', '1033|Install'],
        ['/LANGUAGE=1028', '1028|安裝'],
        ['', '1028|安裝'],
        ['/LANGUAGE=9999', null],
        ['/LANGUAGE=', null],
      ] as const) {
        rmSync(output, { force: true });
        const destination = path.join(root, '安装路径 with spaces');
        const result = spawnSync(executable, [...(option ? [option] : []), `/D=${destination}`], {
          windowsVerbatimArguments: true,
          encoding: 'utf8',
          timeout: 15_000,
        });
        expect(result.error, result.stderr).toBeUndefined();
        expect(result.status, `${option}: ${result.stderr}`).toBe(expected === null ? 87 : 0);
        if (expected !== null) {
          expect(readFileSync(output, 'utf16le').replace(/^\uFEFF/, '')).toBe(
            `${expected}|register-zero|register-one|${destination}`,
          );
        } else {
          expect(() => readFileSync(output)).toThrow();
        }
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  },
  120_000,
);

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
