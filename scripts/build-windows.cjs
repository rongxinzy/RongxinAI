#!/usr/bin/env node
'use strict';

const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const enterprise = process.argv.includes('--enterprise');
const signed =
  process.argv.includes('--signed') || (enterprise && Boolean(process.env.CERTUM_CERT_THUMBPRINT));
const env = {
  ...process.env,
  ZHIYUAN_ALLOW_HOST_CHANNEL_RUNTIME: '1',
  ZHIYUAN_ENTERPRISE_BUILD: enterprise ? '1' : '0',
};
if (enterprise) env.ZHIYUAN_UPDATE_VARIANT = 'lite';

function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, env, stdio: 'inherit' });
  if (result.error || result.status !== 0) {
    throw new Error(`${command} failed: ${result.error?.message || result.status}`);
  }
}

for (const task of [
  'channel:runtime:win-x64',
  'engram:runtime:win-x64',
  'prepare:update-release',
]) {
  run('bun', ['run', task]);
}
run(process.execPath, ['scripts/ensure-build-version.js']);
run('bun', ['run', 'build']);
if (enterprise) run('bun', ['run', 'build:enterprise']);
run('bun', ['run', 'build:skills']);
const config = enterprise
  ? 'electron-builder.enterprise.cjs'
  : signed
    ? 'electron-builder.windows-signed.cjs'
    : 'electron-builder.json';
run('bun', [
  'x',
  'electron-builder',
  '--win',
  'nsis',
  '--x64',
  '--config',
  config,
  '--publish',
  'never',
]);
run(process.execPath, [
  'scripts/installer-shell/build-distribution.cjs',
  ...(signed ? ['--signed'] : []),
]);
