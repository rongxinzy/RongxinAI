import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, test } from 'vitest';

const installerScriptPath = path.resolve('scripts/nsis-installer.nsh');
const installerSmokeScriptPath = path.resolve('scripts/ci/windows-installer-smoke.ps1');
const elevatedActionsScriptPath = path.resolve('scripts/nsis-elevated-actions.ps1');
const offlineComponentsPath = path.resolve('scripts/nsis-offline-components.json');
const brandAssetScriptPath = path.resolve('scripts/generate-nsis-brand-assets.cjs');
const offlineComponentValidatorPath = path.resolve(
  'scripts/installer/validate-offline-components.ps1',
);

describe('NSIS offline resource and local inference flow', () => {
  test('declares the installer as DPI-aware for high-DPI displays', () => {
    const installerScript = fs.readFileSync(installerScriptPath, 'utf8');

    expect(installerScript).toContain('ManifestDPIAware true');
  });

  test('batches component validation while keeping archive payloads conditional on cache misses', () => {
    const installerScript = fs.readFileSync(installerScriptPath, 'utf8');

    const cacheMissIndex = installerScript.indexOf('ComponentCacheMiss_${TOKEN}:');
    const payloadIndex = installerScript.indexOf(
      'File /oname=component-${KEY}.7z "${PROJECT_DIR}\\build-tar\\windows-components\\${KEY}.7z"',
    );
    expect(cacheMissIndex).toBeGreaterThan(-1);
    expect(payloadIndex).toBeGreaterThan(cacheMissIndex);
    expect(installerScript.match(/!insertmacro QueueOfflineComponent /g)).toHaveLength(7);
    expect(installerScript).toContain('phase=component-cache-hit');
    expect(installerScript).toContain('component-${KEY}.sentinel-sha256');
    expect(installerScript).toContain('File /oname=7za.exe');
    expect(installerScript).toContain('component-${KEY}.7z');
    expect(installerScript).not.toContain('Nsis7z::Extract "$PLUGINSDIR');
    expect(installerScript).toContain('SetCompress off');
    expect(installerScript).toContain('SetCompress auto');
    expect(installerScript).toContain('File /oname=validate-offline-components.ps1');
    expect(
      installerScript.match(/-File "\$PLUGINSDIR\\validate-offline-components\.ps1"/g),
    ).toHaveLength(2);
    expect(
      installerScript.match(/-TimingLogPath "\$APPDATA\\ZhiYuanAgent\\install-timing\.log"/g),
    ).toHaveLength(2);
    expect(installerScript).toContain('-Mode cache');
    expect(installerScript).toContain('-Mode expand');
    expect(installerScript).toContain('component-${KEY}.cache-valid');
    expect(installerScript).not.toContain('ComponentBatchHashFailed');
    expect(installerScript).not.toContain('Get-FileHash -LiteralPath \\"$R2\\${SENTINEL}\\"');
    expect(installerScript).not.toContain('validate-component-archive.ps1');
    expect(installerScript).not.toContain('File /oname=win-resources.tar');
  });

  test('validates each batched archive path before extracting it', () => {
    const validatorScript = fs.readFileSync(offlineComponentValidatorPath, 'utf8');

    expect(validatorScript).toContain("$Value.Replace('\\', '/')");
    expect(validatorScript).toContain('"Missing ${Description}: ${Path}"');
    expect(validatorScript).toContain('"Invalid ${Description}: ${Value}"');
    expect(validatorScript).not.toContain('"Missing $Description: $Path"');
    expect(validatorScript).toContain(
      '$normalizedEntry.StartsWith("$normalizedPrefix/", [System.StringComparison]::Ordinal)',
    );
    expect(validatorScript).toContain("$normalized -match '(^|/)\\.\\.(/|$)'");
    expect(validatorScript).toContain("$value -and $value -ne '-'");
    expect(validatorScript).toContain("[ValidateSet('cache', 'expand')]");
    expect(validatorScript).toContain('Get-FileHash -LiteralPath $sentinel');
    // Full-archive hashing was removed: staged archives come from the
    // installer payload and 7z verifies per-entry CRCs during extraction,
    // while the sentinel hash plus manifest binding pin the content.
    expect(validatorScript).not.toContain('Get-FileHash -LiteralPath $archivePath');
    expect(validatorScript).not.toContain('hash-mismatch:');
  });

  test('measures component trees with long-path-safe enumeration', () => {
    const validatorScript = fs.readFileSync(offlineComponentValidatorPath, 'utf8');

    // Get-ChildItem is not long-path aware under Windows PowerShell 5.1 and
    // throws DirectoryNotFoundException on trees deeper than 260 characters,
    // so the measurement must go through .NET with an extended-length path.
    expect(validatorScript).not.toContain('Get-ChildItem -LiteralPath $Root -Recurse');
    expect(validatorScript).toContain(
      '[System.IO.DirectoryInfo]::new((ConvertTo-LongPath $rootFull))',
    );
    expect(validatorScript).toContain(
      "EnumerateFiles('*', [System.IO.SearchOption]::AllDirectories)",
    );
    expect(validatorScript).toContain(
      "if ($Path.StartsWith('\\\\')) { return '\\\\?\\UNC\\' + $Path.Substring(2) }",
    );
    expect(validatorScript).toContain("return '\\\\?\\' + $Path");
    // The completion record must stay excluded from the measurement.
    expect(validatorScript).toContain('if ($file.FullName -eq $completeFull) { continue }');
    expect(validatorScript.match(/Measure-ComponentTree \$target/g)).toHaveLength(2);
    // The full audit is opt-in: re-walking every cached file on each upgrade
    // costs minutes under real-time scanners, while the cheap checks already
    // reject anything an interrupted install can produce.
    expect(validatorScript).toContain('[switch]$DeepAudit');
    expect(validatorScript).toContain(
      '$measured = Measure-ComponentTree $target\n          if ($measured.FileCount',
    );
    // NSIS relays stdout into a single-line dialog and log field.
    expect(validatorScript).toContain("Write-Output ($Message -replace '[\\r\\n]+', ' ')");
  });

  test('reports the failing component when offline component extraction fails', () => {
    const installerScript = fs.readFileSync(installerScriptPath, 'utf8');
    const failureBlock = installerScript.slice(
      installerScript.indexOf('ComponentBatchExtractFailed:'),
      installerScript.indexOf('ComponentBatchVerificationFailed:'),
    );

    expect(failureBlock).not.toContain('StrTrimNewLines');
    expect(failureBlock).toContain('离线组件展开失败：$1。请检查磁盘空间或安全软件后重试。');
    expect(failureBlock).not.toContain('"离线组件展开失败。请检查磁盘空间或安全软件后重试。"');
    expect(failureBlock).toContain('Goto OfflineComponentInstallFailed');
  });

  test('uses per-user installation and rolls back pointer changes after normal failures', () => {
    const installerScript = fs.readFileSync(installerScriptPath, 'utf8');
    const activateScript = fs.readFileSync(
      path.resolve('scripts/installer/activate-components.ps1'),
      'utf8',
    );
    const uninstallCleanupScript = fs.readFileSync(
      path.resolve('scripts/installer/uninstall-cleanup.ps1'),
      'utf8',
    );

    expect(installerScript).toContain('RequestExecutionLevel user');
    expect(installerScript).not.toContain('RequestExecutionLevel admin');
    expect(installerScript).toContain('current.previous');
    // current.next only remains in the shared uninstall cleanup script.
    expect(installerScript).toContain('component-manifest.json');
    expect(installerScript).not.toContain('component-targets.txt');
    // The switch/link/cleanup PowerShell moved into shared scripts (also used
    // by the WebView2 shell); the NSIS side only stages and -File-invokes them.
    expect(installerScript).toContain(
      '-File "$PLUGINSDIR\\activate-components.ps1" -PluginDir "$PLUGINSDIR" -RuntimeRoot "$LOCALAPPDATA\\ZhiYuanAgent\\runtimes"',
    );
    expect(installerScript).toContain(
      '-File "$PLUGINSDIR\\link-runtime-junctions.ps1" -ResourceRoot "$INSTDIR\\resources"',
    );
    expect(installerScript).toContain(
      '-File "$PLUGINSDIR\\cleanup-after-install.ps1" -InstallDir "$INSTDIR"',
    );
    // The uninstall cleanup PowerShell moved into a shared script (also used
    // by the WebView2 shell); the NSIS side only stages and -File-invokes it.
    expect(installerScript).toContain(
      'File /oname=uninstall-cleanup.ps1 "${PROJECT_DIR}\\scripts\\installer\\uninstall-cleanup.ps1"',
    );
    expect(installerScript).toContain(
      '-File "$PLUGINSDIR\\uninstall-cleanup.ps1" -InstallDir "$INSTDIR" -RuntimeRoot "$LOCALAPPDATA\\ZhiYuanAgent\\runtimes"',
    );
    expect(uninstallCleanupScript).toContain('current.next');
    expect(uninstallCleanupScript).toContain('current.previous');
    expect(uninstallCleanupScript).toContain('.uninstall.');
    expect(uninstallCleanupScript).toContain('cmd /d /c rd /s /q');
    for (const moved of [
      '$$ErrorActionPreference = \\"Stop\\"',
      'Set-StrictMode -Version Latest',
      'Missing prepared component target:',
      'New-Item -ItemType Junction -Path $$next -Target $$target -Force -ErrorAction Stop',
      'New-Item -ItemType Junction -Path $$link -Target $$target -Force -ErrorAction Stop',
    ]) {
      expect(installerScript, `inline block must no longer contain ${moved}`).not.toContain(moved);
    }
    // The rollback protocol itself is unchanged, now in the shared script.
    expect(activateScript).toContain("$ErrorActionPreference = 'Stop'");
    expect(activateScript).toContain('Set-StrictMode -Version Latest');
    expect(activateScript).toContain('Missing prepared component target:');
    expect(activateScript).toContain(
      'New-Item -ItemType Junction -Path $next -Target $target -Force -ErrorAction Stop',
    );
    expect(activateScript).toContain('component-switch-state.txt');
    expect(installerScript).toContain('component-switch-state.txt');
    expect(installerScript).toContain('Keep the journal in the persistent cache');
    expect(installerScript).toContain('^[^=|]+\\\\|(?:True|False)\\\\z');
    expect(installerScript).not.toContain('(?:True|False)$$');
    expect(installerScript).toContain('phase=component-set-rollback');
    expect(installerScript).toContain('phase=component-cleanup-complete');
    expect(installerScript).not.toContain('离线组件原子切换失败');
  });

  test('uses an embedded component manifest instead of NSIS-generated routing rows', () => {
    const installerScript = fs.readFileSync(installerScriptPath, 'utf8');
    const offlineComponents = JSON.parse(fs.readFileSync(offlineComponentsPath, 'utf8'));

    expect(installerScript).toContain(
      'File /oname=component-targets.json "${PROJECT_DIR}\\scripts\\nsis-offline-components.json"',
    );
    expect(installerScript).not.toContain('component-targets.txt');
    expect(installerScript).not.toContain('FileWrite $2 "${KEY}|${PREFIX}');
    // The manifest binding check moved into the shared activation script.
    const activateScript = fs.readFileSync(
      path.resolve('scripts/installer/activate-components.ps1'),
      'utf8',
    );
    expect(installerScript).not.toContain(
      'Get-Content -LiteralPath $$idPath -Raw -ErrorAction Stop',
    );
    expect(activateScript).toContain('Get-Content -LiteralPath $idPath -Raw -ErrorAction Stop');
    expect(activateScript).toContain('^[0-9a-f]{64}\\z');
    expect(activateScript).not.toContain('^[0-9a-f]{64}$');
    expect(activateScript).toContain(
      'New-Item -ItemType Junction -Path $next -Target $target -Force -ErrorAction Stop',
    );
    expect(offlineComponents).toEqual([
      {
        key: 'channel-runtime',
        prefix: 'channel-runtime',
        sentinel: 'channel-runtime\\cc-connect-sidecar.exe',
      },
      { key: 'skills', prefix: 'SKILLs', sentinel: 'SKILLs\\skills.config.json' },
      { key: 'mcps', prefix: 'MCPs', sentinel: 'MCPs\\compatibility-review.md' },
      { key: 'portable-git', prefix: 'mingit', sentinel: 'mingit\\usr\\bin\\bash.exe' },
      { key: 'python', prefix: 'python-win', sentinel: 'python-win\\python.exe' },
      {
        key: 'skill-python',
        prefix: 'skill-python',
        sentinel: 'skill-python\\layers\\shared\\Scripts\\python.exe',
      },
      { key: 'uv', prefix: 'uv-win', sentinel: 'uv-win\\uv.exe' },
    ]);
  });

  test('does not show a blocking failure dialog during silent installs', () => {
    const installerScript = fs.readFileSync(installerScriptPath, 'utf8');
    const failureBlock = installerScript.slice(
      installerScript.indexOf('OfflineComponentInstallFailed:'),
      installerScript.indexOf('OfflineComponentsReady:'),
    );

    expect(failureBlock).toContain('IfSilent OfflineComponentInstallFailedSilent 0');
    expect(failureBlock.indexOf('IfSilent OfflineComponentInstallFailedSilent 0')).toBeLessThan(
      failureBlock.indexOf('MessageBox MB_OK|MB_ICONSTOP'),
    );
    expect(failureBlock).toContain('SetErrorLevel 1');
  });

  test('seeks to the end before appending installer timing records', () => {
    const installerScript = fs.readFileSync(installerScriptPath, 'utf8');
    const normalizedInstallerScript = installerScript.replace(/\r\n/g, '\n');

    expect(normalizedInstallerScript).toContain(
      '!macro OpenTimingLogForAppend HANDLE\n' +
        '  ; NSIS append mode preserves existing data but starts at offset zero.\n' +
        '  FileOpen ${HANDLE} "$APPDATA\\ZhiYuanAgent\\install-timing.log" a\n' +
        '  FileSeek ${HANDLE} 0 END\n' +
        '!macroend',
    );
    expect(installerScript).not.toMatch(
      /^\s*FileOpen \$\d+ "\$APPDATA\\ZhiYuanAgent\\install-timing\.log" a$/m,
    );
    expect(installerScript.match(/!insertmacro OpenTimingLogForAppend \$[28]/g)).toHaveLength(15);
  });

  test('records optional local inference intent via an options checkbox instead of a popup', () => {
    const installerScript = fs.readFileSync(installerScriptPath, 'utf8');
    const themeScript = fs.readFileSync(path.resolve('scripts/installer-ui/zy-pages.nsh'), 'utf8');

    expect(installerScript).toContain('pending-local-inference-install');
    expect(installerScript).toContain('!ifndef BUILD_UNINSTALLER');
    expect(installerScript).toContain('Var /GLOBAL installLocalInference');
    expect(installerScript.indexOf('!ifndef BUILD_UNINSTALLER')).toBeLessThan(
      installerScript.indexOf('Var /GLOBAL installLocalInference'),
    );
    expect(installerScript).not.toContain('MB_YESNO|MB_ICONQUESTION|MB_DEFBUTTON2');
    expect(installerScript).not.toContain('install-llamacpp-backend-nsis.cjs');
    expect(installerScript).not.toContain('llamacpp-backends\\manifest.json');

    // The hero page hosts the checkbox; leaving it commits the install and
    // runs the destructive pre-extraction steps. Layout positions come from
    // the ZY_HERO_* constants in zy-theme.nsh.
    expect(themeScript).toContain(
      '${NSD_CreateCheckbox} ${ZY_ROW_X} ${ZY_HERO_INFER_Y} ${ZY_HERO_INFER_W} ${ZY_HERO_INFER_H} "$(ZY_UI_LOCAL_INFERENCE)"',
    );
    expect(themeScript).toContain('Function ZYHeroCreate');
    expect(themeScript).toContain('Function ZYHeroLeave');
    const heroLeaveBlock = themeScript.slice(
      themeScript.indexOf('Function ZYHeroLeave'),
      themeScript.indexOf('FunctionEnd', themeScript.indexOf('Function ZYHeroLeave')),
    );
    expect(heroLeaveBlock).toContain('${NSD_GetState} $heroInference $installLocalInference');
    expect(heroLeaveBlock).toContain(
      '!insertmacro PrepareExistingInstallForExtraction INTERACTIVE',
    );
    expect(installerScript).toContain('Page custom ZYHeroCreate ZYHeroLeave');
  });

  test('does not request or manage Microsoft Defender exclusions', () => {
    const installerScript = fs.readFileSync(installerScriptPath, 'utf8');
    const elevatedActionsScript = fs.readFileSync(elevatedActionsScriptPath, 'utf8');

    expect(installerScript).toContain('ExecShellWait "runas"');
    expect(installerScript).toContain('-ExecutionPolicy Bypass -File');
    expect(installerScript).toContain('!insertmacro RunElevatedAction INSTALL_VC');
    expect(installerScript).not.toContain('!insertmacro RunElevatedAction ADD_DEFENDER');
    expect(installerScript).not.toContain('!insertmacro RunElevatedAction REMOVE_DEFENDER');
    expect(installerScript).not.toContain('defender-exclusion-managed');
    expect(installerScript).not.toContain('Get-MpPreference');
    expect(installerScript).not.toContain('Defender');
    expect(installerScript).not.toContain('Defender exclusion');
    expect(installerScript).not.toContain("''");
    expect(installerScript).not.toContain('Start-Process -FilePath powershell.exe -Verb RunAs');
    expect(elevatedActionsScript).not.toContain('Add-MpPreference');
    expect(elevatedActionsScript).not.toContain('Remove-MpPreference');
    expect(elevatedActionsScript).toContain('-ArgumentList @(');
    expect(elevatedActionsScript).toContain("'/install'");
    expect(elevatedActionsScript).toContain("'/quiet'");
    expect(elevatedActionsScript).toContain("'/norestart'");
    expect(elevatedActionsScript).toContain('$exitCode -notin @(0, 1638, 3010)');
    expect(elevatedActionsScript).not.toMatch(/Add-MpPreference[^\n]*compile-cache/);
    expect(elevatedActionsScript).not.toMatch(/Add-MpPreference[^\n]*app\.asar\.unpacked/);
  });

  test('delays old version cleanup until runtime links are ready', () => {
    const installerScript = fs.readFileSync(installerScriptPath, 'utf8');
    const cleanupScript = fs.readFileSync(
      path.resolve('scripts/installer/cleanup-after-install.ps1'),
      'utf8',
    );

    expect(installerScript.indexOf('Scheduling previous version cleanup')).toBeGreaterThan(
      installerScript.indexOf('RuntimeLinksReady:'),
    );
    expect(installerScript).toContain(
      '-File "$PLUGINSDIR\\cleanup-after-install.ps1" -InstallDir "$INSTDIR"',
    );
    expect(installerScript).not.toContain('Get-ChildItem -Path "$$INSTDIR.old*"');
    expect(installerScript).not.toContain('Get-ChildItem -Path "$INSTDIR.old*"');
    expect(cleanupScript).toContain('Get-ChildItem -Path "$InstallDir.old*"');
  });

  test('stops processes by install-root path prefix so orphaned sidecars cannot block setup', () => {
    const installerScript = fs.readFileSync(installerScriptPath, 'utf8');

    expect(installerScript.indexOf('!macro StopAppProcesses')).toBeGreaterThan(-1);
    expect(installerScript.indexOf('!macro StopAppProcesses')).toBeLessThan(
      installerScript.indexOf('!macro customInit'),
    );
    expect(installerScript.match(/!insertmacro StopAppProcesses/g)).toHaveLength(3);

    const macroStart = installerScript.indexOf('!macro StopAppProcesses');
    const macroBlock = installerScript.slice(
      macroStart,
      installerScript.indexOf('!macroend', macroStart),
    );
    expect(macroBlock).toContain('Get-CimInstance Win32_Process');
    expect(macroBlock).toContain('$$roots = @(\\"$INSTDIR\\"');
    expect(macroBlock).toContain('$LOCALAPPDATA\\ZhiYuanAgent\\runtimes');
    expect(macroBlock).toContain('StartsWith($$roots[0]');
    expect(macroBlock).toContain('StartsWith($$roots[1]');
    expect(macroBlock).toContain('CurrentCultureIgnoreCase');
    expect(macroBlock).toContain('Stop-Process -Id $$proc.ProcessId -Force');
    // An in-place uninstaller runs from $INSTDIR and must not kill itself.
    expect(macroBlock).toContain('GetCurrentProcessId');
    expect(macroBlock).toContain('$$_.ProcessId -ne $$selfPid');

    const customInitBlock = installerScript.slice(
      installerScript.indexOf('!macro customInit'),
      installerScript.indexOf('!macroend', installerScript.indexOf('!macro customInit')),
    );
    expect(customInitBlock).not.toContain('!insertmacro StopAppProcesses');
    const prepareMacroStart = installerScript.indexOf('!macro PrepareExistingInstallForExtraction');
    const prepareMacroBlock = installerScript.slice(
      prepareMacroStart,
      installerScript.indexOf('!macroend', prepareMacroStart),
    );
    expect(prepareMacroBlock).toContain('!insertmacro StopAppProcesses');
    // Silent installs never show pages, so the committed-work macro must run
    // straight from .onInit; interactive installs defer it to the page leave.
    expect(customInitBlock).toContain('${If} ${Silent}');
    expect(customInitBlock).toContain('!insertmacro PrepareExistingInstallForExtraction SILENT');
    const customUnInitBlock = installerScript.slice(
      installerScript.indexOf('!macro customUnInit'),
      installerScript.indexOf('!macroend', installerScript.indexOf('!macro customUnInit')),
    );
    expect(customUnInitBlock).toContain('!insertmacro StopAppProcesses');
    // The interactive page leave callback lives in the UI include; it must run
    // the same committed-work macro.
    const pagesScript = fs.readFileSync(path.resolve('scripts/installer-ui/zy-pages.nsh'), 'utf8');
    const pageLeaveStart = pagesScript.indexOf('Function ZYHeroLeave');
    const pageLeaveBlock = pagesScript.slice(
      pageLeaveStart,
      pagesScript.indexOf('FunctionEnd', pageLeaveStart),
    );
    expect(pageLeaveBlock).toContain(
      '!insertmacro PrepareExistingInstallForExtraction INTERACTIVE',
    );
    // Re-preparing only when the directory changed keeps the guard useful when
    // the user goes back, changes $INSTDIR and leaves again.
    expect(prepareMacroBlock).toContain('${If} $preparedInstallRoot != $INSTDIR');

    expect(installerScript).not.toContain('Stop-Process -Name 知远');
    expect(installerScript).not.toContain('Get-Process node');
  });

  test('keeps every destructive pre-flight step out of the interactive init path', () => {
    const installerScript = fs.readFileSync(installerScriptPath, 'utf8');
    const customInitBlock = installerScript.slice(
      installerScript.indexOf('!macro customInit'),
      installerScript.indexOf('!macroend', installerScript.indexOf('!macro customInit')),
    );

    // Cancelling at any wizard page must leave the running application and
    // its installation directory untouched; those steps only run once the
    // user commits (see PrepareExistingInstallForExtraction).
    for (const destructive of ['StopAppProcesses', 'Detaching previous application version']) {
      expect(customInitBlock).not.toContain(destructive);
    }
    expect(customInitBlock).not.toContain('skill-migration-complete');

    // The timing log appends across runs with an explicit run marker, and the
    // previously uninstrumented application-files span gets its own marker.
    expect(customInitBlock).toContain('phase=run-start');
    expect(customInitBlock).toContain('!insertmacro OpenTimingLogForAppend $8');
    expect(installerScript).not.toMatch(
      /FileOpen \$8 "\$APPDATA\\ZhiYuanAgent\\install-timing\.log" w/,
    );
    const customInstallBlock = installerScript.slice(
      installerScript.indexOf('!macro customInstall'),
      installerScript.indexOf('CustomInstallStartMarked:'),
    );
    expect(customInstallBlock).toContain('phase=custom-install-start app_files_ms=$R6');
    // Long nsExec spans must stay visible to the user instead of freezing
    // the progress page.
    expect(installerScript).toContain('ShowInstDetails show');
    expect(installerScript).not.toContain('ShowInstDetails nevershow');
  });

  test('distinguishes a locked install directory from a running app with translated messages', () => {
    const installerScript = fs.readFileSync(installerScriptPath, 'utf8');

    // A failed detach must be diagnosed: processes are counted first, and the
    // retry dialog uses cause-specific LangStrings instead of the misleading
    // electron-builder "cannot be closed" message. Labels carry the macro
    // token because the macro is compiled once per invocation mode.
    expect(installerScript).toContain('!macro CountInstallDirProcesses RESULT');
    expect(installerScript).toContain('OldInstallDetachRetry_${TOKEN}');
    expect(installerScript).toContain('!insertmacro CountInstallDirProcesses $R0');
    expect(installerScript).toContain(
      'MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "$(ZY_APP_UNCLOSABLE)"',
    );
    expect(installerScript).toContain(
      'MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "$(ZY_DIR_OCCUPIED)"',
    );
    // Cancelling must leave the installer outright; Abort inside a page-leave
    // callback would only cancel the page change.
    const detachStart = installerScript.indexOf('Detaching previous application version');
    const detachBlock = installerScript.slice(
      detachStart,
      installerScript.indexOf('!insertmacro ForgetOldInstallRegistry', detachStart),
    );
    expect(detachBlock).toContain('Quit');

    // Messages ship an entry for every bundled NSIS language: zh-CN and
    // zh-TW translated, the rest on English fallback (makensis promotes an
    // unset-per-language LangString to a build error).
    const bundledLcids = [
      '1033',
      '1031',
      '1036',
      '3082',
      '2052',
      '1028',
      '1041',
      '1042',
      '1040',
      '1043',
      '1030',
      '1053',
      '1044',
      '1035',
      '1049',
      '2070',
      '1046',
      '1045',
      '1058',
      '1029',
      '1051',
      '1038',
      '1025',
      '1055',
      '1054',
      '1066',
    ];
    for (const message of ['ZY_APP_UNCLOSABLE', 'ZY_DIR_OCCUPIED']) {
      for (const lcid of bundledLcids) {
        expect(installerScript).toContain(`LangString ${message} ${lcid} `);
      }
    }

    // The detached previous version is unregistered so electron-builder skips
    // the legacy uninstaller whose exit code 2 caused the misleading dialog;
    // any uninstaller it still launches must not abort the installation.
    expect(installerScript).toContain('!macro ForgetOldInstallRegistry');
    expect(installerScript).toContain('!insertmacro ForgetOldInstallRegistry');
    expect(installerScript).toContain('DeleteRegKey HKCU "${UNINSTALL_REGISTRY_KEY}"');
    expect(installerScript).toContain('!macro customUnInstallCheck');
    expect(installerScript).toContain('!macro customUnInstallCheckCurrentUser');
  });

  test('detaches expanded runtime caches before deleting them asynchronously', () => {
    const installerScript = fs.readFileSync(installerScriptPath, 'utf8');
    const uninstallBlock = installerScript.slice(
      installerScript.indexOf('!macro customUnInstall\n'),
    );
    const uninstallCleanupScript = fs.readFileSync(
      path.resolve('scripts/installer/uninstall-cleanup.ps1'),
      'utf8',
    );

    // The NSIS macro now only stages and -File-invokes the shared script.
    expect(uninstallBlock).toContain(
      '-File "$PLUGINSDIR\\uninstall-cleanup.ps1" -InstallDir "$INSTDIR" -RuntimeRoot "$LOCALAPPDATA\\ZhiYuanAgent\\runtimes"',
    );
    expect(uninstallBlock).toContain('SetOutPath "$TEMP"');
    expect(uninstallBlock).toContain('Pop $0');
    expect(uninstallBlock.indexOf('SetOutPath "$TEMP"')).toBeLessThan(
      uninstallBlock.indexOf("nsExec::ExecToLog 'powershell"),
    );
    // Detach semantics moved into the shared script: rename the live cache to
    // a .uninstall.<tick> name and hand it to a background recursive delete.
    expect(uninstallCleanupScript).toContain('.uninstall.');
    expect(uninstallCleanupScript).toContain('Rename-Item');
    expect(uninstallCleanupScript).toContain('start "" /b cmd /d /c rd /s /q');
    expect(uninstallCleanupScript).toContain('runtime-packs');
    expect(uninstallCleanupScript).not.toContain(
      'Remove-Item -LiteralPath $RuntimeRoot -Recurse -Force',
    );
    expect(uninstallCleanupScript).not.toContain(
      'Remove-Item -LiteralPath $legacyRoot -Recurse -Force',
    );
  });

  test('waits for the spawned NSIS uninstaller to remove managed roots', () => {
    const smokeScript = fs.readFileSync(installerSmokeScriptPath, 'utf8');

    expect(smokeScript).toContain('function Wait-ForUninstallCompletion');
    expect(smokeScript).toContain("$_.Name -like 'Un_*.exe'");
    expect(smokeScript).toContain('Wait-ForUninstallCompletion $installRoot $runtimeRoot 300');
    expect(
      smokeScript.indexOf('Wait-ForUninstallCompletion $installRoot $runtimeRoot 300'),
    ).toBeGreaterThan(
      smokeScript.indexOf("Invoke-Installer $uninstallers[0].FullName 'uninstall'"),
    );
  });
});

describe('NSIS visual assets', () => {
  test('generates every branded bitmap the custom UI references', () => {
    const brandAssetScript = fs.readFileSync(brandAssetScriptPath, 'utf8');
    const themeScript = fs.readFileSync(path.resolve('scripts/installer-ui/zy-theme.nsh'), 'utf8');
    const pagesScript = fs.readFileSync(path.resolve('scripts/installer-ui/zy-pages.nsh'), 'utf8');
    const assetDir = path.resolve('build/installer-assets');

    // The generator owns all artwork; no MUI chrome bitmap helpers remain.
    for (const legacy of ['drawAppIcon(', 'sidebarIconPath', 'headerIconPath']) {
      expect(brandAssetScript).not.toContain(legacy);
    }
    for (const generatorFn of [
      'drawBackground',
      'drawBar',
      'drawWordmark',
      'drawDoneGlyph',
      'drawSide',
      'FLAT_ZONE_TOP',
    ]) {
      expect(brandAssetScript).toContain(generatorFn);
    }

    // Every asset referenced by the theme/pages exists on disk and is
    // produced by the generator (license.txt is a straight LICENSE copy).
    const referenced = new Set<string>();
    for (const script of [themeScript, pagesScript]) {
      for (const match of script.matchAll(/\$\{ZY_ASSET_([A-Z_]+)\}/g)) {
        referenced.add(match[1]);
      }
    }
    const fileByKey: Record<string, string> = {
      BAND: 'zy-band.bmp',
      BG: 'zy-bg.bmp',
      WORDMARK: 'zy-wordmark.bmp',
      BAR_FILL: 'zy-bar-fill.bmp',
      BAR_DONE: 'zy-bar-complete.bmp',
      BAR_TRACK: 'zy-bar-track.bmp',
      DONE: 'zy-done.bmp',
      LICENSE: 'license.txt',
    };
    expect([...referenced].sort()).toEqual(Object.keys(fileByKey).sort());
    for (const [key, file] of Object.entries(fileByKey)) {
      expect(fs.existsSync(path.join(assetDir, file)), `${key} -> ${file}`).toBe(true);
      if (key !== 'LICENSE') {
        expect(brandAssetScript).toContain(`'${file}'`);
      }
    }
    expect(brandAssetScript).toContain('copyFileSync(licenseSource, licenseTarget)');
  });
});

describe('NSIS custom installer UI wiring', () => {
  const installerScript = fs.readFileSync(path.resolve('scripts/nsis-installer.nsh'), 'utf8');
  const themeScript = fs.readFileSync(path.resolve('scripts/installer-ui/zy-theme.nsh'), 'utf8');
  const pagesScript = fs.readFileSync(path.resolve('scripts/installer-ui/zy-pages.nsh'), 'utf8');

  test('replaces the native directory page and wires the custom pages', () => {
    // The native directory page is withdrawn; the hero page hosts the
    // install-location row instead.
    expect(installerScript).toContain('!undef allowToChangeInstallationDirectory');
    expect(installerScript).not.toContain('MUI_PAGE_DIRECTORY');
    expect(installerScript).not.toContain('MUI_PAGE_WELCOME');
    expect(installerScript).not.toContain('LocalInferencePageCreate');

    // Page hook macros consumed by the assisted template.
    expect(installerScript).toContain('Page custom ZYHeroCreate ZYHeroLeave');
    expect(installerScript).toContain('Page custom ZYFinishCreate ZYFinishLeave');
    // Uninstaller page callbacks carry the un. prefix in the uninstaller
    // build via ZY_UNPREFIX.
    expect(installerScript).toContain(
      'UninstPage custom ${ZY_UNPREFIX}ZYUnWelcomeCreate ${ZY_UNPREFIX}ZYUnWelcomeLeave',
    );
    // The old options page is gone; its hook only injects the instfiles
    // page callbacks now (MUI undefines MUI_PAGE_CUSTOMFUNCTION_* after each
    // page insertion, so the SHOW/LEAVE defines must be re-created at every
    // insertion point).
    const afterChangeDirStart = installerScript.indexOf('!macro customPageAfterChangeDir');
    const afterChangeDir = installerScript.slice(
      afterChangeDirStart,
      installerScript.indexOf('!macroend', afterChangeDirStart),
    );
    expect(afterChangeDir).toContain(
      '!define MUI_PAGE_CUSTOMFUNCTION_SHOW ${ZY_UNPREFIX}ZY_MuiPageShow',
    );
    expect(afterChangeDir).toContain('!define MUI_PAGE_CUSTOMFUNCTION_LEAVE ZY_MuiPageLeave');
    expect(afterChangeDir).not.toContain('Page custom');
    // Install-mode page: skipped unless a per-machine installation exists.
    expect(installerScript).toContain('!macro customInstallMode');
    expect(installerScript).toContain('StrCpy $isForceCurrentInstall "1"');
    // The native uninstaller finish page gets the branded side art.
    expect(installerScript).toContain('!define MUI_UNWELCOMEFINISHPAGE_BITMAP');
    expect(installerScript).toContain('!macro customUninstallPage');
  });

  test('declares one progress phase per customInstall stage boundary', () => {
    expect(installerScript.match(/!insertmacro ZY_ProgressPhase /g)).toHaveLength(10);
    for (const phase of [
      'VALIDATING',
      'STAGING',
      'EXPANDING',
      'ACTIVATING',
      'CONNECTING',
      'VERIFYING',
      'VC',
      'CLEANUP',
      'FINALIZING',
      'DONE',
    ]) {
      expect(installerScript).toContain(`!insertmacro ZY_ProgressPhase ${phase} `);
      expect(pagesScript).toContain(`ZY_LangString ZY_PHASE_${phase}`);
    }
    // The macro no-ops under /S and swaps in the complete art at 100%.
    const phaseMacro = themeScript.slice(
      themeScript.indexOf('!macro ZY_ProgressPhase TOKEN TEXT'),
      themeScript.indexOf('!macroend', themeScript.indexOf('!macro ZY_ProgressPhase TOKEN TEXT')),
    );
    expect(phaseMacro).toContain('${IfNot} ${Silent}');
    expect(phaseMacro).toContain('ShowWindow $zyComplete ${SW_SHOW}');
  });

  test('keeps UI code out of the silent execution paths', () => {
    // customInit/customUnInit also run for /S: only file staging is allowed.
    for (const macro of ['!macro customInit', '!macro customUnInit']) {
      const start = installerScript.indexOf(macro);
      const block = installerScript.slice(start, installerScript.indexOf('!macroend', start));
      for (const gui of [
        'nsDialogs::Create',
        'CreateWindowEx',
        'ZY_BgInit',
        'BgImage::',
        'ZY_ProgressPhase',
        'nsDialogs::Show',
      ]) {
        expect(block, `${macro} must not contain ${gui}`).not.toContain(gui);
      }
      expect(block).toContain('!insertmacro ZY_StageUiAssets');
    }
    // The phase macro itself no-ops under /S (it lives in the theme file).
    expect(themeScript).toContain('${IfNot} ${Silent}');
    // The license text is guarded at compile time and the link degrades to a
    // notice when it was not staged.
    expect(themeScript).toContain(
      '!if /fileexists "${PROJECT_DIR}\\build\\installer-assets\\license.txt"',
    );
    expect(pagesScript).toContain('$(ZY_LICENSE_MISSING)');
  });

  test('ships an entry for every bundled language on the new strings', () => {
    // The string table is emitted through ZY_LangString helpers: three
    // translated LCIDs inline plus one shared English block that must list
    // every remaining bundled LCID, so verify the macro bodies instead of
    // expanded lines.
    const enBlock = pagesScript.slice(
      pagesScript.indexOf('!macro ZY_LangStringEn NAME VALUE'),
      pagesScript.indexOf('!macroend', pagesScript.indexOf('!macro ZY_LangStringEn NAME VALUE')),
    );
    const zhBlock = pagesScript.slice(
      pagesScript.indexOf('!macro ZY_LangString NAME ZHCN ZHTW EN'),
      pagesScript.indexOf(
        '!macroend',
        pagesScript.indexOf('!macro ZY_LangString NAME ZHCN ZHTW EN'),
      ),
    );
    const englishFallbackLcids = [
      '1033',
      '1031',
      '1036',
      '3082',
      '1041',
      '1042',
      '1040',
      '1043',
      '1030',
      '1053',
      '1044',
      '1035',
      '1049',
      '2070',
      '1046',
      '1045',
      '1058',
      '1029',
      '1038',
      '1025',
      '1055',
      '1054',
      '1066',
      '1051',
    ];
    for (const lcid of englishFallbackLcids) {
      expect(enBlock).toContain(`LangString \${NAME} ${lcid} `);
    }
    expect(zhBlock).toContain('LangString ${NAME} 2052 ');
    expect(zhBlock).toContain('LangString ${NAME} 1028 ');
    // 2052/1028 must not be duplicated in the English fallback block.
    expect(enBlock).not.toContain('${NAME} 2052 ');
    expect(enBlock).not.toContain('${NAME} 1028 ');
    // Every UI key goes through the trilingual macro.
    expect(pagesScript.match(/!insertmacro ZY_LangString ZY_/g)!.length).toBeGreaterThanOrEqual(25);
  });

  test('registers the vendored StdUtils plugin bundle before the pages compile', () => {
    // electron-builder emits the shared header's !addplugindir from concurrent
    // generator tasks, so it can land after this include while ZYFinishLeave
    // already compiles ${isUpdated} (StdUtils::TestParameter) and
    // ${StdUtils.ExecShellAsUser} at include time; the pages must register
    // the repo-vendored bundle themselves, before any plugin call.
    const firstPluginCall = Math.min(
      pagesScript.indexOf('${if} ${isUpdated}'),
      pagesScript.indexOf('${StdUtils.ExecShellAsUser} $1'),
    );
    const pluginDir = pagesScript.indexOf(
      '!addplugindir /x86-unicode "${PROJECT_DIR}\\build\\nsis-resources\\plugins\\x86-unicode"',
    );
    expect(pluginDir).toBeGreaterThanOrEqual(0);
    expect(firstPluginCall).toBeGreaterThan(pluginDir);
    expect(
      fs.existsSync(path.resolve('build/nsis-resources/plugins/x86-unicode/StdUtils.dll')),
    ).toBe(true);
  });

  test('drops the legacy MUI chrome bitmaps from the packaging config', () => {
    const builderConfig = fs.readFileSync(path.resolve('electron-builder.json'), 'utf8');
    expect(builderConfig).not.toContain('installerHeader');
    expect(builderConfig).not.toContain('installerSidebar');
    expect(builderConfig).not.toContain('uninstallerSidebar');
    expect(builderConfig).toContain('"include": "scripts/nsis-installer.nsh"');
    for (const legacy of [
      'installerHeader.bmp',
      'installerSidebar.bmp',
      'uninstallerSidebar.bmp',
    ]) {
      expect(fs.existsSync(path.resolve('build/installer-assets', legacy))).toBe(false);
    }
  });
});
