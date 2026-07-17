'use strict';

const fs = require('fs');
const path = require('path');

function fail(message) {
  console.error(`[sync-llamacpp-runtime-current] ${message}`);
  process.exit(1);
}

const targetId = (process.argv[2] || '').trim();
if (!targetId) fail('Missing target id.');

const rootDir = path.resolve(__dirname, '..');
const runtimeBaseDir = path.join(rootDir, 'vendor', 'llamacpp-runtime');
const targetRuntimeDir = path.join(runtimeBaseDir, targetId);
const currentRuntimeDir = path.join(runtimeBaseDir, 'current');

if (!fs.existsSync(targetRuntimeDir)) {
  fail(`Target runtime does not exist: ${targetRuntimeDir}`);
}

try {
  const stat = fs.lstatSync(currentRuntimeDir);
  if (stat.isSymbolicLink()) {
    fs.unlinkSync(currentRuntimeDir);
  } else {
    fs.rmSync(currentRuntimeDir, { recursive: true, force: true });
  }
} catch {}

const linkType = process.platform === 'win32' ? 'junction' : 'dir';
fs.symlinkSync(targetRuntimeDir, currentRuntimeDir, linkType);
console.log(
  `[sync-llamacpp-runtime-current] Synced ${targetId} -> vendor/llamacpp-runtime/current`,
);
