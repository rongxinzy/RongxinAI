#!/usr/bin/env node
'use strict';

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { writeSetupManifest } = require('./sfx-format.cjs');
const { verifyRetainedHost } = require('./retain-uninstaller.cjs');
const { verifyFinalSetupBudget, verifyFinalNsisBudget } = require('./distribution-budget.cjs');

const root = path.resolve(__dirname, '..', '..');
const signed = process.argv.includes('--signed');
const version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
const setup = path.join(root, 'release', `ZhiYuanAgent-Setup-${version}.exe`);
const uninstall = path.join(__dirname, 'out', 'ZhiYuanUninstall.exe');

function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit' });
  if (result.error || result.status !== 0) {
    throw new Error(`${command} failed: ${result.error?.message || result.status}`);
  }
}

function sign(file) {
  run('powershell.exe', [
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    path.join(__dirname, 'sign-shell.ps1'),
    '-Path',
    file,
  ]);
}

// electron-builder has already produced and signed the app and NSIS updater.
// Preserve latest.yml / its blockmap unchanged: electron-updater requires NSIS.
run(process.execPath, [path.join(__dirname, 'build-shell.cjs')]);
// NSIS's official !finalize hook retained the exact native uninstaller after
// electron-builder signed it. Do not overwrite or re-sign that copy.
verifyRetainedHost(root, uninstall);
run(process.execPath, [
  path.join(__dirname, 'pack-setup.cjs'),
  '--app-dir',
  path.join(root, 'release', 'win-unpacked'),
  '--components-dir',
  path.join(root, 'build-tar', 'windows-components'),
  '--uninstall-host',
  uninstall,
  '--out',
  setup,
]);
if (signed) sign(setup);
const finalBudget = verifyFinalSetupBudget(
  setup,
  path.join(root, 'build-tar', 'windows-components'),
);
console.log(`[installer-shell] final signed-byte budget ${JSON.stringify(finalBudget)}`);
const nsisBudget = verifyFinalNsisBudget(
  path.join(root, 'release'),
  finalBudget.componentArchiveBytes,
);
console.log(`[installer-shell] final NSIS updater budget ${JSON.stringify(nsisBudget)}`);
// The report must describe the final signed bytes, never the pre-signing file.
const report = writeSetupManifest(setup, version);
if (report.signed !== signed) throw new Error('Unexpected setup signature state');
console.log(`[installer-shell] distribution ready: ${setup} (${report.sha256})`);
