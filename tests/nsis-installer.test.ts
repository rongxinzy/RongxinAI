import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, test } from 'vitest';

const installerScriptPath = path.resolve('scripts/nsis-installer.nsh');

describe('NSIS local inference runtime signing flow', () => {
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
    expect(installerScript).toContain('证书不会上传，也不会用于其他应用。');
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
