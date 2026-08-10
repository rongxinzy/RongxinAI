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

  test('embeds the offline resource pack but expands it only on a cache miss', () => {
    const installerScript = fs.readFileSync(installerScriptPath, 'utf8');

    const cacheMissIndex = installerScript.indexOf('ResourcePackCacheMiss:');
    const payloadIndex = installerScript.indexOf(
      'File /oname=win-resources.tar "${PROJECT_DIR}\\build-tar\\win-resources.tar"',
    );
    expect(cacheMissIndex).toBeGreaterThan(-1);
    expect(payloadIndex).toBeGreaterThan(cacheMissIndex);
    expect(installerScript).toContain('phase=resource-pack-cache-hit');
    expect(installerScript).toContain('$LOCALAPPDATA\\ZhiYuanAgent\\runtime-packs\\$R1');
    expect(installerScript).toContain('StrCmp $R4 $R1 0 ResourcePackCacheMiss');
  });

  test('records optional local inference intent without downloading in NSIS', () => {
    const installerScript = fs.readFileSync(installerScriptPath, 'utf8');

    expect(installerScript).toContain('pending-local-inference-install');
    expect(installerScript).toContain('MB_YESNO|MB_ICONQUESTION|MB_DEFBUTTON2');
    expect(installerScript).not.toContain('install-llamacpp-backend-nsis.cjs');
    expect(installerScript).not.toContain('llamacpp-backends\\manifest.json');
  });

  test('does not modify Defender exclusions and delays old version cleanup', () => {
    const installerScript = fs.readFileSync(installerScriptPath, 'utf8');

    expect(installerScript).not.toContain('Add-MpPreference');
    expect(installerScript).not.toContain('Remove-MpPreference');
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
