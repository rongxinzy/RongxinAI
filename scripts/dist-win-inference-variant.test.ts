import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import vm from 'node:vm';

import { expect, test } from 'vitest';

const root = path.resolve(import.meta.dirname, '..');
const packageJson = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')) as {
  scripts: Record<string, string>;
};
const source = readFileSync(path.join(root, 'scripts/build-windows.cjs'), 'utf8');
const requireFromScripts = createRequire(path.join(root, 'scripts/build-windows.cjs'));

function captureBuild(args: string[], env: NodeJS.ProcessEnv, failPackaging = false) {
  const calls: Array<{
    command: string;
    args: string[];
    options: { env: NodeJS.ProcessEnv };
  }> = [];
  const modules = {
    'node:path': path,
    './packaging/defense-edition.cjs': requireFromScripts('./packaging/defense-edition.cjs'),
    'node:child_process': {
      spawnSync: (command: string, args: string[], options: { env: NodeJS.ProcessEnv }) => {
        calls.push({ command, args, options });
        return {
          status: failPackaging && args.includes('electron-builder') ? 1 : 0,
          stdout: command === 'dotnet' ? '8.0.100' : '',
        };
      },
    },
  };
  const execute = () =>
    vm.runInNewContext(source, {
      __dirname: path.join(root, 'scripts'),
      require: (name: keyof typeof modules) => modules[name],
      process: {
        env,
        argv: ['node', 'build-windows.cjs', ...args],
        execPath: process.execPath,
        platform: 'win32',
        arch: 'x64',
      },
    });
  return { calls, execute };
}

test('Windows dist scripts preserve ZHIYUAN_UPDATE_VARIANT for each inference edition', () => {
  const offline = packageJson.scripts['dist:win:offline'];
  expect(offline).not.toMatch(/ZHIYUAN_UPDATE_VARIANT=lite/);
  expect(offline).toBe('node scripts/build-windows.cjs');

  expect(packageJson.scripts['dist:win:cpu']).toMatch(
    /ZHIYUAN_UPDATE_VARIANT=cpu[\s\S]*dist:win:offline/,
  );
  expect(packageJson.scripts['dist:win:cuda']).toMatch(
    /ZHIYUAN_UPDATE_VARIANT=cuda[\s\S]*dist:win:offline/,
  );
  expect(packageJson.scripts['dist:win:lite']).toContain('dist:win:offline');

  const signed = packageJson.scripts['dist:win:signed'];
  expect(signed).not.toMatch(/ZHIYUAN_UPDATE_VARIANT=lite/);
  expect(signed).toBe('node scripts/build-windows.cjs --signed');
  expect(packageJson.scripts['dist:win:signed:cpu']).toMatch(
    /ZHIYUAN_UPDATE_VARIANT=cpu[\s\S]*dist:win:signed/,
  );
  expect(packageJson.scripts['dist:win:signed:cuda']).toMatch(
    /ZHIYUAN_UPDATE_VARIANT=cuda[\s\S]*dist:win:signed/,
  );
});

test.each(['lite', 'cpu', 'cuda'])(
  'the shared CLI preserves the %s edition and packages NSIS before the shell',
  edition => {
    for (const signed of [false, true]) {
      const f = captureBuild(signed ? ['--signed'] : [], { ZHIYUAN_UPDATE_VARIANT: edition });
      f.execute();
      const versionIndex = f.calls.findIndex(call =>
        call.args.includes('scripts/ensure-build-version.js'),
      );
      const packageIndex = f.calls.findIndex(call => call.args.includes('electron-builder'));
      expect(versionIndex).toBeGreaterThan(-1);
      expect(packageIndex).toBeGreaterThan(versionIndex);
      expect(f.calls[packageIndex].args).toEqual([
        'x',
        'electron-builder',
        '--win',
        'nsis',
        '--x64',
        '--config',
        signed ? 'electron-builder.windows-signed.cjs' : 'electron-builder.json',
        '--publish',
        'never',
      ]);
      expect(f.calls[packageIndex + 1].args).toEqual([
        'scripts/installer-shell/build-distribution.cjs',
        ...(signed ? ['--signed'] : []),
      ]);
      expect(f.calls.every(call => call.options.env.ZHIYUAN_UPDATE_VARIANT === edition)).toBe(true);
      expect(f.calls.every(call => call.options.env.ZHIYUAN_ENTERPRISE_BUILD === '0')).toBe(true);
    }
  },
);

test('the defense CLI builds only its offline installer and does not inherit signing by default', () => {
  const f = captureBuild(['--defense'], {
    ZHIYUAN_UPDATE_VARIANT: 'cuda',
    CERTUM_CERT_THUMBPRINT: 'fixture',
    INCLUDE: 'msvc-include',
    LIB: 'msvc-lib',
  });
  f.execute();
  const packageCall = f.calls.at(-1);
  expect(packageCall?.args).toContain('electron-builder.defense.cjs');
  expect(packageCall?.options.env).toMatchObject({
    APP_EDITION: 'defense',
    ZHIYUAN_UPDATE_VARIANT: 'lite',
  });
  expect(packageCall?.options.env.CERTUM_CERT_THUMBPRINT).toBeUndefined();
  expect(f.calls.some(call => call.args.includes('python:build:job-runner'))).toBe(true);
  expect(f.calls.some(call => call.args.includes('scripts/build-docx-runtime.cjs'))).toBe(true);
  expect(f.calls.some(call => call.args.includes('channel:runtime:win-x64'))).toBe(false);
  expect(f.calls.some(call => call.args.includes('prepare:update-release'))).toBe(false);
});

test.each([false, true])(
  'enterprise shares the installer with certificate present=%s',
  certificate => {
    const f = captureBuild(['--enterprise'], {
      ZHIYUAN_UPDATE_VARIANT: 'cuda',
      ...(certificate ? { CERTUM_CERT_THUMBPRINT: 'fixture' } : {}),
    });
    f.execute();
    const packageIndex = f.calls.findIndex(call => call.args.includes('electron-builder'));
    const extensionIndex = f.calls.findIndex(call => call.args.includes('build:enterprise'));
    expect(extensionIndex).toBeGreaterThan(-1);
    expect(packageIndex).toBeGreaterThan(extensionIndex);
    expect(f.calls[packageIndex].args).toContain('electron-builder.enterprise.cjs');
    expect(f.calls[packageIndex + 1].args).toEqual([
      'scripts/installer-shell/build-distribution.cjs',
      ...(certificate ? ['--signed'] : []),
    ]);
    expect(f.calls.every(call => call.options.env.ZHIYUAN_UPDATE_VARIANT === 'lite')).toBe(true);
    expect(f.calls.every(call => call.options.env.ZHIYUAN_ENTERPRISE_BUILD === '1')).toBe(true);
  },
);

test.each([{ args: [] }, { args: ['--signed'] }, { args: ['--enterprise'] }])(
  'a failed NSIS package cannot assemble a shell from stale files with args $args',
  ({ args }) => {
    const f = captureBuild(args, {}, true);
    expect(f.execute).toThrow('failed: 1');
    expect(
      f.calls.some(call => call.args.includes('scripts/installer-shell/build-distribution.cjs')),
    ).toBe(false);
  },
);
