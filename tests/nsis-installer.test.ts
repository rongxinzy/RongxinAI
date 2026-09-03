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
    expect(installerScript).toContain('-Mode cache');
    expect(installerScript).toContain('-Mode expand');
    expect(installerScript).toContain('component-${KEY}.cache-valid');
    expect(installerScript).toContain('ComponentBatchHashFailed:');
    expect(installerScript).not.toContain('Get-FileHash -LiteralPath \\"$R2\\${SENTINEL}\\"');
    expect(installerScript).not.toContain('validate-component-archive.ps1');
    expect(installerScript).not.toContain('File /oname=win-resources.tar');
  });

  test('validates each batched archive path before extracting it', () => {
    const validatorScript = fs.readFileSync(offlineComponentValidatorPath, 'utf8');

    expect(validatorScript).toContain("$Value.Replace('\\', '/')");
    expect(validatorScript).toContain(
      '$normalizedEntry.StartsWith("$normalizedPrefix/", [System.StringComparison]::Ordinal)',
    );
    expect(validatorScript).toContain("$normalized -match '(^|/)\\.\\.(/|$)'");
    expect(validatorScript).toContain("$value -and $value -ne '-'");
    expect(validatorScript).toContain("[ValidateSet('cache', 'expand')]");
    expect(validatorScript).toContain('Get-FileHash -LiteralPath $sentinel');
    expect(validatorScript).toContain('Stop-WithCode 2 "hash-mismatch:$($component.Key)"');
  });

  test('uses per-user installation and rolls back pointer changes after normal failures', () => {
    const installerScript = fs.readFileSync(installerScriptPath, 'utf8');

    expect(installerScript).toContain('RequestExecutionLevel user');
    expect(installerScript).not.toContain('RequestExecutionLevel admin');
    expect(installerScript).toContain('current.next');
    expect(installerScript).toContain('current.previous');
    expect(installerScript).toContain('component-manifest.json');
    expect(installerScript).not.toContain('component-targets.txt');
    expect(installerScript).toContain('$$ErrorActionPreference = \\"Stop\\"');
    expect(installerScript).toContain('Set-StrictMode -Version Latest');
    expect(installerScript).toContain('Missing prepared component target:');
    expect(installerScript).toContain(
      'New-Item -ItemType Junction -Path $$next -Target $$target -Force -ErrorAction Stop',
    );
    expect(installerScript).toContain(
      'New-Item -ItemType Junction -Path $$link -Target $$target -Force -ErrorAction Stop',
    );
    expect(installerScript).toContain('component-switch-state.txt');
    expect(installerScript).toContain('Keep the journal in the persistent cache');
    expect(installerScript).toContain('Join-Path $$runtimeRoot \\"component-switch-state.txt\\"');
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
    expect(installerScript).toContain('Get-Content -LiteralPath $$idPath -Raw -ErrorAction Stop');
    expect(installerScript).toContain('^[0-9a-f]{64}\\z');
    expect(installerScript).not.toContain('^[0-9a-f]{64}$$');
    expect(installerScript).toContain(
      'New-Item -ItemType Junction -Path $$next -Target $$target -Force -ErrorAction Stop',
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
    expect(installerScript.match(/!insertmacro OpenTimingLogForAppend \$[28]/g)).toHaveLength(11);
  });

  test('records optional local inference intent via an options checkbox instead of a popup', () => {
    const installerScript = fs.readFileSync(installerScriptPath, 'utf8');

    expect(installerScript).toContain('pending-local-inference-install');
    expect(installerScript).toContain('${NSD_CreateCheckbox}');
    expect(installerScript).toContain('LocalInferencePageCreate');
    expect(installerScript).toContain('LocalInferencePageLeave');
    expect(installerScript).toContain(
      'Page custom LocalInferencePageCreate LocalInferencePageLeave',
    );
    expect(installerScript).toContain('!ifndef BUILD_UNINSTALLER');
    expect(installerScript.indexOf('!ifndef BUILD_UNINSTALLER')).toBeLessThan(
      installerScript.indexOf('Var /GLOBAL installLocalInference'),
    );
    expect(installerScript).not.toContain('MB_YESNO|MB_ICONQUESTION|MB_DEFBUTTON2');
    expect(installerScript).not.toContain('install-llamacpp-backend-nsis.cjs');
    expect(installerScript).not.toContain('llamacpp-backends\\manifest.json');
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

    expect(installerScript.indexOf('Scheduling previous version cleanup')).toBeGreaterThan(
      installerScript.indexOf('RuntimeLinksReady:'),
    );
    expect(installerScript).toContain('Get-ChildItem -Path "$INSTDIR.old*"');
  });

  test('detaches expanded runtime caches before deleting them asynchronously', () => {
    const installerScript = fs.readFileSync(installerScriptPath, 'utf8');
    const uninstallBlock = installerScript.slice(installerScript.indexOf('!macro customUnInstall'));

    expect(uninstallBlock).toContain('StrCpy $3 "$LOCALAPPDATA\\ZhiYuanAgent\\runtimes"');
    expect(uninstallBlock).toContain('StrCpy $4 "$3.uninstall.$4"');
    expect(uninstallBlock).toContain('Rename "$3" "$4"');
    expect(uninstallBlock).toContain('cmd /d /c rd /s /q "$4"');
    expect(uninstallBlock).not.toContain('Remove-Item -LiteralPath $$runtimeRoot -Recurse -Force');
    expect(uninstallBlock).toContain('SetOutPath "$TEMP"');
    expect(uninstallBlock.indexOf('SetOutPath "$TEMP"')).toBeLessThan(
      uninstallBlock.indexOf("nsExec::ExecToLog 'powershell"),
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
  test('uses the matching application icon layer for each installer artwork size', () => {
    const brandAssetScript = fs.readFileSync(brandAssetScriptPath, 'utf8');

    expect(brandAssetScript).toContain('const sidebarIconPath');
    expect(brandAssetScript).toContain('const headerIconPath');
    expect(brandAssetScript).toContain('drawAppIcon(side, sidebarIcon, 14, 14, 58)');
    expect(brandAssetScript).toContain('drawAppIcon(head, headerIcon, 7, 5, 40)');
    expect(brandAssetScript).not.toContain('drawWordmarkMark');
  });
});
