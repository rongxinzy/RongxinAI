'use strict';

const fs = require('fs');
const { spawnSync } = require('child_process');
const path = require('path');

function resolveHostTargetId() {
  const platformMap = {
    darwin: 'mac',
    win32: 'win',
    linux: 'linux',
  };
  const archMap = {
    x64: 'x64',
    arm64: 'arm64',
    ia32: 'ia32',
  };
  const platform = platformMap[process.platform];
  const arch = archMap[process.arch];
  if (!platform || !arch) {
    throw new Error(`Unsupported host platform/arch: ${process.platform}/${process.arch}`);
  }
  return `${platform}-${arch}`;
}

function resolveExecutableName(targetId) {
  return targetId.startsWith('win-') ? 'llama-server.exe' : 'llama-server';
}

const targetId = resolveHostTargetId();
const rootDir = path.resolve(__dirname, '..');
const runtimeDir = path.join(rootDir, 'vendor', 'llamacpp-runtime', targetId);
const executableName = resolveExecutableName(targetId);
const targetExecutable = path.join(runtimeDir, 'bin', executableName);

if (!fs.existsSync(targetExecutable)) {
  console.error(`[llamacpp-runtime-host] Missing prebuilt llama.cpp runtime for ${targetId}.`);
  console.error('[llamacpp-runtime-host] Run `npm run llamacpp:runtime:download` to fetch the prebuilt runtime, or set LLAMACPP_BIN to an existing llama-server executable.');
  process.exit(1);
}

const result = spawnSync(process.execPath, [
  path.join(rootDir, 'scripts', 'sync-llamacpp-runtime-current.cjs'),
  targetId,
], {
  cwd: rootDir,
  stdio: 'inherit',
});

const currentExecutable = path.join(rootDir, 'vendor', 'llamacpp-runtime', 'current', 'bin', executableName);
if (result.status === 0 && fs.existsSync(currentExecutable)) {
  console.log(`[llamacpp-runtime-host] Runtime ready: ${path.relative(rootDir, currentExecutable)}`);
}

process.exit(typeof result.status === 'number' ? result.status : 1);
