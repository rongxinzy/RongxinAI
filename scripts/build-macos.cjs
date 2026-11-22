#!/usr/bin/env node
'use strict';

const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const archFlags = ['--arm64', '--x64'];
const selected = archFlags.filter(flag => args.includes(flag));
const archFlag = selected[0] ?? `--${process.arch}`;
if (args.includes('--universal') || selected.length > 1 || !archFlags.includes(archFlag)) {
  throw new Error('Choose one macOS packaging architecture: --arm64 or --x64.');
}
const architecture = archFlag.slice(2);
const builderArgs = args.filter(arg => arg !== archFlag);

function run(args) {
  const result = spawnSync('bun', args, { cwd: root, stdio: 'inherit' });
  if (result.error || result.status !== 0) {
    throw new Error(
      `bun ${args.join(' ')} failed: ${result.error?.message ?? result.status ?? result.signal}`,
    );
  }
}

for (const task of [
  'prepare:update-release',
  'build',
  `channel:runtime:mac-${architecture}`,
  `engram:runtime:mac-${architecture}`,
]) {
  run(['run', task]);
}
run(['x', 'electron-builder', '--mac', archFlag, '--publish', 'never', ...builderArgs]);
