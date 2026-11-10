#!/usr/bin/env node
'use strict';

const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { defenseEdition } = require('./packaging/defense-edition.cjs');

const root = path.resolve(__dirname, '..');
const enterprise = process.argv.includes('--enterprise');
const defense = process.argv.includes('--defense');
const signed =
  process.argv.includes('--signed') || (enterprise && Boolean(process.env.CERTUM_CERT_THUMBPRINT));
if (defense && enterprise) throw new Error('Select either the defense or the enterprise edition.');
if (defense && (process.platform !== 'win32' || process.arch !== 'x64')) {
  throw new Error('Defense packages require a Windows x64 build host.');
}
if (defense && signed && !process.env.CERTUM_CERT_THUMBPRINT) {
  throw new Error('CERTUM_CERT_THUMBPRINT is required for a signed defense package.');
}
const env = {
  ...process.env,
  ZHIYUAN_ALLOW_HOST_CHANNEL_RUNTIME: '1',
  ZHIYUAN_ENTERPRISE_BUILD: enterprise ? '1' : '0',
};
if (enterprise || defense) env.ZHIYUAN_UPDATE_VARIANT = 'lite';
if (defense) {
  env.APP_EDITION = defenseEdition;
  if (!signed) delete env.CERTUM_CERT_THUMBPRINT;
}

function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, env, stdio: 'inherit' });
  if (result.error || result.status !== 0) {
    throw new Error(`${command} failed: ${result.error?.message || result.status}`);
  }
}

if (defense) {
  const compiler = spawnSync('where.exe', ['cl.exe'], { env, windowsHide: true });
  if (compiler.status !== 0 || !env.INCLUDE || !env.LIB) {
    throw new Error('Run the defense build in an x64 Visual Studio Developer PowerShell.');
  }
  const dotnet = spawnSync('dotnet', ['--list-sdks'], { env, encoding: 'utf8', windowsHide: true });
  if (dotnet.status !== 0 || !dotnet.stdout?.trim()) {
    throw new Error('Install the .NET 8 SDK to build the offline DOCX runtime.');
  }
}

const runtimeTasks = defense
  ? ['engram:runtime:win-x64', 'python:build:job-runner']
  : ['channel:runtime:win-x64', 'engram:runtime:win-x64', 'prepare:update-release'];
for (const task of runtimeTasks) {
  run('bun', ['run', task]);
}
run(process.execPath, ['scripts/ensure-build-version.js']);
run('bun', ['run', 'build']);
if (enterprise) run('bun', ['run', 'build:enterprise']);
if (defense) run(process.execPath, ['scripts/build-docx-runtime.cjs', '--required']);
else run('bun', ['run', 'build:skills']);
const config = defense
  ? 'electron-builder.defense.cjs'
  : enterprise
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
if (!defense) {
  run(process.execPath, [
    'scripts/installer-shell/build-distribution.cjs',
    ...(signed ? ['--signed'] : []),
  ]);
}
