'use strict';

const path = require('node:path');
const { spawnSync } = require('node:child_process');

const projectRoot = path.resolve(__dirname, '..');

const KYLIN_ENV = Object.freeze({
  ZHIYUAN_DEFAULT_LOCALE: 'zh-CN',
  ZHIYUAN_UPDATE_VARIANT: 'cpu',
  ZHIYUAN_DISTRIBUTION: 'kylin-v11',
});

function defaultRun(command, args, options = {}) {
  return spawnSync(command, args, {
    cwd: projectRoot,
    env: { ...process.env, ...KYLIN_ENV, ...options.env },
    stdio: 'inherit',
    windowsHide: true,
  });
}

function runStep(run, command, args, options = {}) {
  const result = run(command, args, options);
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} exited with code ${result.status ?? 'unknown'}`);
  }
}

function buildKylin({ run = defaultRun, platform = process.platform, arch = process.arch } = {}) {
  if (platform !== 'linux' || arch !== 'x64') {
    throw new Error(`Kylin V11 packages require a linux-x64 host, got ${platform}-${arch}`);
  }

  const steps = [
    ['bun', ['run', 'channel:runtime:linux-x64']],
    ['bun', ['run', 'engram:runtime:linux-x64']],
    ['node', ['scripts/ensure-build-version.js']],
    ['bun', ['run', 'sync:vendor-llamacpp-cpu']],
    ['bun', ['run', 'prepare:inference-edition-runtime']],
    ['bun', ['run', 'build']],
    ['bun', ['run', 'build:skills']],
    ['bun', ['run', 'rebuild:electron-native:linux-packaging']],
    [
      'bunx',
      [
        'electron-builder',
        '--linux',
        'rpm',
        '--x64',
        '--config',
        'electron-builder.kylin.cjs',
        '--publish',
        'never',
      ],
    ],
  ];

  for (const [command, args] of steps) runStep(run, command, args);
}

if (require.main === module) {
  try {
    buildKylin();
  } catch (error) {
    console.error(`[kylin-build] ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}

module.exports = { KYLIN_ENV, buildKylin, runStep };
