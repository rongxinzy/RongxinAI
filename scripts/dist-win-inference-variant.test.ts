import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import vm from 'node:vm';

import { expect, test, vi } from 'vitest';

const root = path.resolve(import.meta.dirname, '..');
const packageJson = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')) as {
  scripts: Record<string, string>;
};
const source = readFileSync(path.join(root, 'scripts/build-windows.cjs'), 'utf8');
const require = createRequire(import.meta.url);

function captureBuild(args: string[], env: NodeJS.ProcessEnv, failingStep?: string) {
  const ensureWindowsJobRunner = vi.fn(() => ({ status: 'fresh', outputPath: 'fixture' }));
  const calls: Array<{
    command: string;
    args: string[];
    options: { env: NodeJS.ProcessEnv };
  }> = [];
  const modules = {
    'node:path': path,
    'node:child_process': {
      spawnSync: (command: string, args: string[], options: { env: NodeJS.ProcessEnv }) => {
        calls.push({ command, args, options });
        return { status: failingStep && args.includes(failingStep) ? 1 : 0 };
      },
    },
    './python-runtime/ensure-job-runner.cjs': {
      ensureWindowsJobRunner,
    },
    './packaging/package-windows-installer.cjs': require('./packaging/package-windows-installer.cjs'),
  };
  const execute = () =>
    vm.runInNewContext(source, {
      __dirname: path.join(root, 'scripts'),
      require: (name: keyof typeof modules) => modules[name],
      process: { env, argv: ['node', 'build-windows.cjs', ...args], execPath: process.execPath },
    });
  return { calls, execute, ensureWindowsJobRunner };
}

test('Windows dist scripts preserve ZHIYUAN_UPDATE_VARIANT for each inference edition', () => {
  const offline = packageJson.scripts['dist:win:offline'];
  expect(offline).not.toMatch(/ZHIYUAN_UPDATE_VARIANT=lite/);
  expect(offline).toBe('node scripts/build-windows.cjs');

  expect(packageJson.scripts['dist:win:cpu']).toBe(
    'cross-env ZHIYUAN_UPDATE_VARIANT=cpu bun run dist:win:offline',
  );
  expect(packageJson.scripts['dist:win:cuda']).toBe(
    'cross-env ZHIYUAN_UPDATE_VARIANT=cuda bun run dist:win:offline',
  );
  expect(packageJson.scripts['dist:win:lite']).toContain('dist:win:offline');

  const signed = packageJson.scripts['dist:win:signed'];
  expect(signed).not.toMatch(/ZHIYUAN_UPDATE_VARIANT=lite/);
  expect(signed).toBe('node scripts/build-windows.cjs --signed');
  expect(packageJson.scripts['dist:win:signed:cpu']).toBe(
    'cross-env ZHIYUAN_UPDATE_VARIANT=cpu bun run dist:win:signed',
  );
  expect(packageJson.scripts['dist:win:signed:cuda']).toBe(
    'cross-env ZHIYUAN_UPDATE_VARIANT=cuda bun run dist:win:signed',
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
      const staging = f.calls.filter(call =>
        call.args.includes('scripts/prepare-inference-edition-runtime.cjs'),
      );
      const engram = f.calls.filter(call => call.args.includes('engram:runtime:win-x64'));
      expect(versionIndex).toBeGreaterThan(-1);
      expect(packageIndex).toBeGreaterThan(versionIndex);
      expect(engram).toHaveLength(1);
      expect(staging).toHaveLength(edition === 'lite' ? 0 : 1);
      if (edition !== 'lite') expect(f.calls[packageIndex - 1]).toBe(staging[0]);
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

test.each([false, true])(
  'enterprise shares the installer with certificate present=%s',
  certificate => {
    const f = captureBuild(['--enterprise'], {
      ZHIYUAN_UPDATE_VARIANT: 'cuda',
      ...(certificate ? { CERTUM_CERT_THUMBPRINT: 'fixture' } : {}),
    });
    f.execute();
    const packageIndex = f.calls.findIndex(call => call.args.includes('electron-builder'));
    expect(f.calls.filter(call => call.args.includes('build:enterprise:verified'))).toHaveLength(1);
    expect(f.calls[packageIndex - 1].args).toEqual(['run', 'build:enterprise:verified']);
    expect(f.calls[packageIndex].args).toContain(
      certificate ? 'electron-builder.windows-signed.cjs' : 'electron-builder.enterprise.cjs',
    );
    expect(f.calls[packageIndex + 1].args).toEqual([
      'scripts/installer-shell/build-distribution.cjs',
      ...(certificate ? ['--signed'] : []),
    ]);
    expect(f.calls.every(call => call.options.env.ZHIYUAN_UPDATE_VARIANT === 'lite')).toBe(true);
    expect(f.calls.every(call => call.options.env.ZHIYUAN_ENTERPRISE_BUILD === '1')).toBe(true);
  },
);

test('explicit enterprise signing uses the same required signing config as community', () => {
  const f = captureBuild(['--enterprise', '--signed'], {});
  f.execute();
  const packageIndex = f.calls.findIndex(call => call.args.includes('electron-builder'));
  expect(f.calls[packageIndex].args).toContain('electron-builder.windows-signed.cjs');
  expect(f.calls[packageIndex].options.env.ZHIYUAN_ENTERPRISE_BUILD).toBe('1');
});

test('Xiaoruan uses the shared Windows preparation and its own NSIS target', () => {
  expect(packageJson.scripts['dist:win:xiaoruan']).toBe(
    'node scripts/build-windows.cjs --xiaoruan',
  );
  const f = captureBuild(['--xiaoruan'], { ZHIYUAN_UPDATE_VARIANT: 'cuda' });
  f.execute();
  expect(f.ensureWindowsJobRunner).toHaveBeenCalledExactlyOnceWith({ projectRoot: root });
  expect(f.calls.map(call => call.args)).toEqual([
    ['run', 'channel:runtime:win-x64'],
    ['run', 'engram:runtime:win-x64'],
    ['run', 'prepare:update-release'],
    ['scripts/ensure-build-version.js'],
    ['run', 'build'],
    [
      'x',
      'electron-builder',
      '--win',
      'nsis',
      '--x64',
      '--config',
      'electron-builder.xiaoruan.cjs',
      '--publish',
      'never',
    ],
  ]);
  for (const { options } of f.calls) {
    expect(options.env).toMatchObject({
      APP_EDITION: 'xiaoruan',
      ZHIYUAN_UPDATE_VARIANT: 'lite',
      ZHIYUAN_ENTERPRISE_BUILD: '0',
    });
  }
});

test.each([{ args: [] }, { args: ['--signed'] }, { args: ['--enterprise'] }])(
  'a failed NSIS package cannot assemble a shell from stale files with args $args',
  ({ args }) => {
    const f = captureBuild(args, {}, 'electron-builder');
    expect(f.execute).toThrow('failed: 1');
    expect(
      f.calls.some(call => call.args.includes('scripts/installer-shell/build-distribution.cjs')),
    ).toBe(false);
  },
);

test('enterprise verification must succeed before invoking NSIS', () => {
  const f = captureBuild(['--enterprise'], {}, 'build:enterprise:verified');
  expect(f.execute).toThrow('failed: 1');
  expect(f.calls.some(call => call.args.includes('electron-builder'))).toBe(false);
});
