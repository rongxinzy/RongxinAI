import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, test } from 'vitest';

const installerScriptPath = path.resolve('scripts/nsis-installer.nsh');
const installerSmokeScriptPath = path.resolve('scripts/ci/windows-installer-smoke.ps1');
const elevatedActionsScriptPath = path.resolve('scripts/nsis-elevated-actions.ps1');
const offlineComponentsPath = path.resolve('scripts/nsis-offline-components.json');
const brandAssetScriptPath = path.resolve('scripts/generate-nsis-brand-assets.cjs');

describe('NSIS offline resource and local inference flow', () => {
  test('declares the installer as DPI-aware for high-DPI displays', () => {
    const installerScript = fs.readFileSync(installerScriptPath, 'utf8');

    expect(installerScript).toContain('ManifestDPIAware true');
  });

  test('embeds seven offline components but expands each only on its own cache miss', () => {
    const installerScript = fs.readFileSync(installerScriptPath, 'utf8');

    const cacheMissIndex = installerScript.indexOf('ComponentCacheMiss_${TOKEN}:');
    const payloadIndex = installerScript.indexOf(
      'File /oname=component-${KEY}.tar "${PROJECT_DIR}\\build-tar\\windows-components\\${KEY}.tar"',
    );
    expect(cacheMissIndex).toBeGreaterThan(-1);
    expect(payloadIndex).toBeGreaterThan(cacheMissIndex);
    expect(installerScript.match(/!insertmacro EnsureOfflineComponent /g)).toHaveLength(7);
    expect(installerScript).toContain('phase=component-cache-hit');
    expect(installerScript).toContain('component-${KEY}.sentinel-sha256');
    expect(installerScript).toContain('Get-FileHash -LiteralPath \\"$R2\\${SENTINEL}\\"');
    expect(installerScript).toContain('$LOCALAPPDATA\\ZhiYuanAgent\\runtimes\\${KEY}\\$R1');
    expect(installerScript).not.toContain('File /oname=win-resources.tar');
  });

  test('uses per-user installation and rolls back pointer changes after normal failures', () => {
    const installerScript = fs.readFileSync(installerScriptPath, 'utf8');

    expect(installerScript).toContain('RequestExecutionLevel user');
    expect(installerScript).not.toContain('RequestExecutionLevel admin');
    expect(installerScript).toContain('current.next');
    expect(installerScript).toContain('current.previous');
    expect(installerScript).toContain('component-switch-state.txt');
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
      { key: 'openclaw', prefix: 'cfmind' },
      { key: 'skills', prefix: 'SKILLs' },
      { key: 'mcps', prefix: 'MCPs' },
      { key: 'portable-git', prefix: 'mingit' },
      { key: 'python', prefix: 'python-win' },
      { key: 'skill-python', prefix: 'skill-python' },
      { key: 'uv', prefix: 'uv-win' },
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

    expect(installerScript).toContain(
      '!macro OpenTimingLogForAppend HANDLE\n' +
        '  ; NSIS append mode preserves existing data but starts at offset zero.\n' +
        '  FileOpen ${HANDLE} "$APPDATA\\ZhiYuanAgent\\install-timing.log" a\n' +
        '  FileSeek ${HANDLE} 0 END\n' +
        '!macroend',
    );
    expect(installerScript).not.toMatch(
      /^\s*FileOpen \$\d+ "\$APPDATA\\ZhiYuanAgent\\install-timing\.log" a$/m,
    );
    expect(installerScript.match(/!insertmacro OpenTimingLogForAppend \$[28]/g)).toHaveLength(18);
  });

  test('records optional local inference intent without downloading in NSIS', () => {
    const installerScript = fs.readFileSync(installerScriptPath, 'utf8');

    expect(installerScript).toContain('pending-local-inference-install');
    expect(installerScript).toContain('MB_YESNO|MB_ICONQUESTION|MB_DEFBUTTON2');
    expect(installerScript).not.toContain('install-llamacpp-backend-nsis.cjs');
    expect(installerScript).not.toContain('llamacpp-backends\\manifest.json');
  });

  test('adds only a user-approved scoped Defender exclusion and removes managed exclusions', () => {
    const installerScript = fs.readFileSync(installerScriptPath, 'utf8');
    const elevatedActionsScript = fs.readFileSync(elevatedActionsScriptPath, 'utf8');

    expect(installerScript).toContain('MB_YESNO|MB_ICONQUESTION|MB_DEFBUTTON1');
    expect(installerScript).toContain('ExecShellWait "runas"');
    expect(installerScript).toContain('-ExecutionPolicy Bypass -File');
    expect(installerScript).toContain('!insertmacro RunElevatedAction ADD_DEFENDER');
    expect(installerScript).toContain('!insertmacro RunElevatedAction INSTALL_VC');
    expect(installerScript).toContain('!insertmacro RunElevatedAction REMOVE_DEFENDER');
    expect(installerScript).toContain('defender-exclusion-managed');
    expect(installerScript).not.toContain("''");
    expect(installerScript).not.toContain('Start-Process -FilePath powershell.exe -Verb RunAs');
    expect(elevatedActionsScript).toContain('Add-MpPreference -ExclusionPath $Target');
    expect(elevatedActionsScript).toContain('Remove-MpPreference -ExclusionPath $Target');
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
