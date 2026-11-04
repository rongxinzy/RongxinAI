'use strict';

const path = require('node:path');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');

const { LINUX_NATIVE_GLIBC_BASELINE } = require('./packaging/linux-native-baseline.constants.cjs');
const { assertMaxGlibcVersion } = require('./packaging/linux-glibc-version.cjs');

const projectRoot = path.join(__dirname, '..');

function runDockerRebuild() {
  const scriptPath = path.join(projectRoot, 'scripts/ci/rebuild-electron-native-linux-docker.sh');
  const result = spawnSync('bash', [scriptPath], {
    cwd: projectRoot,
    stdio: 'inherit',
    env: process.env,
  });
  if (result.error) {
    throw new Error(
      `[LinuxNativePackaging] Failed to start Docker rebuild: ${result.error.message}`,
    );
  }
  if (result.status !== 0) {
    throw new Error(
      `[LinuxNativePackaging] Docker rebuild exited with code ${result.status ?? 'unknown'}`,
    );
  }
}

function verifyLinuxNativeArtifacts() {
  const nodePtyBinding = path.join(projectRoot, 'node_modules/node-pty/build/Release/pty.node');
  const nodePtyHelper = path.join(projectRoot, 'node_modules/node-pty/build/Release/spawn-helper');
  const sqliteBinding = path.join(
    projectRoot,
    'node_modules/better-sqlite3/build/Release/better_sqlite3.node',
  );

  for (const artifact of [nodePtyBinding, nodePtyHelper, sqliteBinding]) {
    if (!fs.existsSync(artifact)) {
      throw new Error(`[LinuxNativePackaging] Missing native artifact after rebuild: ${artifact}`);
    }
  }

  const ptyGlibc = assertMaxGlibcVersion(nodePtyBinding, LINUX_NATIVE_GLIBC_BASELINE);
  const sqliteGlibc = assertMaxGlibcVersion(sqliteBinding, LINUX_NATIVE_GLIBC_BASELINE);
  console.log(
    `[LinuxNativePackaging] Verified glibc baseline (<= ${LINUX_NATIVE_GLIBC_BASELINE}): ` +
      `node-pty=${ptyGlibc}, better-sqlite3=${sqliteGlibc}`,
  );
}

function main() {
  if (process.platform !== 'linux') {
    console.log('[LinuxNativePackaging] Non-Linux host; skipping Docker native rebuild.');
    return;
  }

  if (process.env.ZHIYUAN_ALLOW_HOST_NATIVE_REBUILD === '1') {
    console.warn(
      '[LinuxNativePackaging] ZHIYUAN_ALLOW_HOST_NATIVE_REBUILD=1: using host electron-rebuild (not for release).',
    );
    const result = spawnSync('bun', ['run', 'rebuild:electron-native'], {
      cwd: projectRoot,
      stdio: 'inherit',
    });
    if (result.status !== 0) {
      throw new Error('[LinuxNativePackaging] Host electron-rebuild failed');
    }
    return;
  }

  runDockerRebuild();
  verifyLinuxNativeArtifacts();
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

module.exports = { main, verifyLinuxNativeArtifacts };
