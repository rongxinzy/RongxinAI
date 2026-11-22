#!/usr/bin/env node
'use strict';

const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { ensureWindowsJobRunner } = require('./python-runtime/ensure-job-runner.cjs');
const { packageWindowsInstaller } = require('./packaging/package-windows-installer.cjs');

const root = path.resolve(__dirname, '..');
const enterprise = process.argv.includes('--enterprise');
const xiaoruan = process.argv.includes('--xiaoruan');
const signed =
  process.argv.includes('--signed') || (enterprise && Boolean(process.env.CERTUM_CERT_THUMBPRINT));
if (xiaoruan && (enterprise || signed)) {
  throw new Error('The Xiaoruan NSIS package has a separate product configuration.');
}
const env = {
  ...process.env,
  ZHIYUAN_ALLOW_HOST_CHANNEL_RUNTIME: '1',
  ZHIYUAN_ENTERPRISE_BUILD: enterprise ? '1' : '0',
};
if (enterprise || xiaoruan) env.ZHIYUAN_UPDATE_VARIANT = 'lite';
if (xiaoruan) env.APP_EDITION = 'xiaoruan';

function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, env, stdio: 'inherit' });
  if (result.error || result.status !== 0) {
    throw new Error(`${command} failed: ${result.error?.message || result.status}`);
  }
}

ensureWindowsJobRunner({ projectRoot: root });

for (const task of [
  'channel:runtime:win-x64',
  'engram:runtime:win-x64',
  'prepare:update-release',
]) {
  run('bun', ['run', task]);
}
run(process.execPath, ['scripts/ensure-build-version.js']);
run('bun', ['run', 'build']);
if (enterprise) run('bun', ['run', 'build:enterprise:verified']);
const edition = (env.ZHIYUAN_UPDATE_VARIANT || 'lite').trim().toLowerCase();
packageWindowsInstaller(run, { signed, enterprise, xiaoruan, edition });
