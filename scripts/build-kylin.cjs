'use strict';

const path = require('node:path');
const { spawnSync } = require('node:child_process');

const projectRoot = path.resolve(__dirname, '..');

const KYLIN_ENV = Object.freeze({
  ZHIYUAN_DEFAULT_LOCALE: 'zh-CN',
  ZHIYUAN_UPDATE_VARIANT: 'cpu',
  ZHIYUAN_DISTRIBUTION: 'kylin-v11',
  UPDATE_MANIFEST_KEY_ID: '',
  UPDATE_MANIFEST_PUBLIC_KEY_BASE64: '',
});

function defaultRun(command, args) {
  return spawnSync(command, args, {
    cwd: projectRoot,
    env: { ...process.env, ...KYLIN_ENV },
    stdio: 'inherit',
    windowsHide: true,
  });
}

function buildKylin({ run = defaultRun, platform = process.platform, arch = process.arch } = {}) {
  if (platform !== 'linux' || arch !== 'x64') {
    throw new Error(`Kylin V11 packages require a linux-x64 host, got ${platform}-${arch}`);
  }

  const args = ['run', 'dist:linux:cpu', '--', '--x64', '--config', 'electron-builder.kylin.cjs'];
  const result = run('bun', args);
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`bun ${args.join(' ')} exited with code ${result.status ?? 'unknown'}`);
  }
}

if (require.main === module) {
  try {
    buildKylin();
  } catch (error) {
    console.error(`[kylin-build] ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}

module.exports = { KYLIN_ENV, buildKylin };
