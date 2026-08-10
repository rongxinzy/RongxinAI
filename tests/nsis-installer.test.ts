import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, test } from 'vitest';

const installerScriptPath = path.resolve('scripts/nsis-installer.nsh');
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
    expect(installerScript).toContain('$LOCALAPPDATA\\ZhiYuanAgent\\runtimes\\${KEY}\\$R1');
    expect(installerScript).not.toContain('File /oname=win-resources.tar');
  });

  test('atomically switches component pointers and retains a rollback path until success', () => {
    const installerScript = fs.readFileSync(installerScriptPath, 'utf8');

    expect(installerScript).toContain('current.next');
    expect(installerScript).toContain('current.previous');
    expect(installerScript).toContain('component-switch-state.txt');
    expect(installerScript).toContain('phase=component-set-rollback');
    expect(installerScript).toContain('phase=component-cleanup-complete');
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

    expect(installerScript).toContain('MB_YESNO|MB_ICONQUESTION|MB_DEFBUTTON2');
    expect(installerScript).toContain(
      'Add-MpPreference -ExclusionPath \\"$LOCALAPPDATA\\ZhiYuanAgent\\runtimes\\"',
    );
    expect(installerScript).toContain('defender-exclusion-managed');
    expect(installerScript).toContain(
      'Remove-MpPreference -ExclusionPath \\"$LOCALAPPDATA\\ZhiYuanAgent\\runtimes\\"',
    );
    expect(installerScript).not.toMatch(/Add-MpPreference[^\n]*compile-cache/);
    expect(installerScript).not.toMatch(/Add-MpPreference[^\n]*app\.asar\.unpacked/);
  });

  test('delays old version cleanup until runtime links are ready', () => {
    const installerScript = fs.readFileSync(installerScriptPath, 'utf8');

    expect(installerScript.indexOf('Scheduling previous version cleanup')).toBeGreaterThan(
      installerScript.indexOf('RuntimeLinksReady:'),
    );
    expect(installerScript).toContain('Get-ChildItem -Path "$INSTDIR.old*"');
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
