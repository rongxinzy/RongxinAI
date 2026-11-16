import { createRequire } from 'node:module';
import path from 'node:path';
import { expect, test, vi } from 'vitest';

const require = createRequire(import.meta.url);
const { signWindowsPythonJobHelper } = require('./electron-builder-hooks.cjs') as {
  signWindowsPythonJobHelper: (
    context: { electronPlatformName: string; appOutDir: string },
    env?: NodeJS.ProcessEnv,
    spawn?: ReturnType<typeof vi.fn>,
  ) => void;
};

test('signs the Windows Python job helper with the release certificate', () => {
  const spawn = vi.fn(() => ({ status: 0 }));
  const context = { electronPlatformName: 'win32', appOutDir: path.join('tmp', 'app') };

  signWindowsPythonJobHelper(context, { CERTUM_CERT_THUMBPRINT: 'thumbprint' }, spawn);

  expect(spawn).toHaveBeenCalledWith(
    'powershell.exe',
    [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      path.join(process.cwd(), 'scripts', 'runtime-signing', 'sign-runtime.ps1'),
      '-Path',
      path.join(context.appOutDir, 'resources', 'python-runtime', 'job-runner.exe'),
    ],
    { stdio: 'inherit', windowsHide: true },
  );
});

test('skips job helper signing for unsigned or non-Windows packages', () => {
  const spawn = vi.fn(() => ({ status: 0 }));

  signWindowsPythonJobHelper({ electronPlatformName: 'win32', appOutDir: 'app' }, {}, spawn);
  signWindowsPythonJobHelper(
    { electronPlatformName: 'darwin', appOutDir: 'app' },
    { CERTUM_CERT_THUMBPRINT: 'thumbprint' },
    spawn,
  );

  expect(spawn).not.toHaveBeenCalled();
});

test('fails packaging when job helper signing fails', () => {
  const spawn = vi.fn(() => ({ status: 2 }));

  expect(() =>
    signWindowsPythonJobHelper(
      { electronPlatformName: 'win32', appOutDir: 'app' },
      { CERTUM_CERT_THUMBPRINT: 'thumbprint' },
      spawn,
    ),
  ).toThrow('Windows Python job helper signing failed with exit code 2');
});
