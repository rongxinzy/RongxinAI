import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, test } from 'vitest';

const installerScriptPath = path.resolve('scripts/nsis-installer.nsh');
const brandAssetScriptPath = path.resolve('scripts/generate-nsis-brand-assets.cjs');

describe('NSIS local inference runtime signing flow', () => {
  test('declares the installer as DPI-aware for high-DPI displays', () => {
    const installerScript = fs.readFileSync(installerScriptPath, 'utf8');

    expect(installerScript).toContain('ManifestDPIAware true');
  });

  test('requires interactive confirmation before invoking the runtime helper', () => {
    const installerScript = fs.readFileSync(installerScriptPath, 'utf8');
    const confirmationIndex = installerScript.indexOf(
      'MessageBox MB_OKCANCEL|MB_ICONQUESTION "本地推理运行时包含未签名的程序文件。',
    );
    const helperInvocationIndex = installerScript.indexOf('LlamaCppBackendInstallExecute:');

    expect(confirmationIndex).toBeGreaterThan(-1);
    expect(helperInvocationIndex).toBeGreaterThan(confirmationIndex);
    expect(installerScript).toContain('StrCpy $R8 "--local-signing-confirmed"');
    expect(installerScript).toContain('Goto LlamaCppBackendInstallRun');
    expect(installerScript).toContain('点击“取消”将跳过本地推理，App 仍可正常安装。');
  });

  test('continues app installation when local signing is declined', () => {
    const installerScript = fs.readFileSync(installerScriptPath, 'utf8');
    const cancellationBlock = installerScript.slice(
      installerScript.indexOf('LlamaCppBackendLocalSigningCancelled:'),
      installerScript.indexOf('LlamaCppBackendInstallRun:'),
    );

    expect(cancellationBlock).toContain(
      'phase=llamacpp-backend-install-skipped reason=user-declined-local-signing',
    );
    expect(cancellationBlock).toContain('Goto LlamaCppBackendInstallDone');
    expect(cancellationBlock).not.toContain('Abort');
  });

  test('does not silently authorize local signing during unattended updates', () => {
    const installerScript = fs.readFileSync(installerScriptPath, 'utf8');

    expect(installerScript).toContain('IfSilent LlamaCppBackendInstallDeferred 0');
    expect(installerScript).toContain(
      'phase=llamacpp-backend-install-skipped reason=silent-no-local-signing-confirmation',
    );
    expect(installerScript).not.toContain('IfSilent LlamaCppBackendLocalSigningConfirmed 0');
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
