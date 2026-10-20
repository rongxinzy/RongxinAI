#!/usr/bin/env node
'use strict';

/**
 * Package another Windows edition from the already compiled application.
 * Edition metadata and offline components must be regenerated before signing;
 * --prepackaged skips those hooks and would leave cpu/cuda labeled as lite.
 */

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..', '..', '..');
const edition = (process.env.ZHIYUAN_UPDATE_VARIANT || process.argv[2] || '').trim().toLowerCase();

if (!['cpu', 'cuda'].includes(edition)) {
  console.error('[assemble-windows-edition] Only cpu and cuda editions are assembled here.');
  process.exit(1);
}

function run(command, args, env = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, ...env },
  });
  if (result.error || result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed: ${result.error?.message || result.status}`);
  }
}

const unpacked = path.join(root, 'release', 'win-unpacked');
if (!fs.existsSync(unpacked)) {
  throw new Error(`Missing signed win-unpacked directory: ${unpacked}`);
}

for (const entry of fs.readdirSync(path.join(root, 'release'), { withFileTypes: true })) {
  if (entry.isFile() && (/\.exe(?:\.blockmap)?$/i.test(entry.name) || entry.name === 'latest.yml')) {
    fs.rmSync(path.join(root, 'release', entry.name));
  }
}

run(process.execPath, [path.join(root, 'scripts/prepare-inference-edition-runtime.cjs')], {
  ZHIYUAN_UPDATE_VARIANT: edition,
});

const signedConfig = path.join(root, 'electron-builder.windows-signed.cjs');
run(process.execPath, [path.join(root, 'scripts/ensure-build-version.js')], {
  ZHIYUAN_UPDATE_VARIANT: edition,
});
run('bun', ['x', 'electron-builder', '--win', 'nsis', '--x64', '--config', signedConfig, '--publish', 'never'], {
  ZHIYUAN_UPDATE_VARIANT: edition,
});

run(process.execPath, [path.join(root, 'scripts/installer-shell/build-distribution.cjs'), '--signed'], {
  ZHIYUAN_UPDATE_VARIANT: edition,
});

console.log(`[assemble-windows-edition] ${edition} edition ready under release/`);
