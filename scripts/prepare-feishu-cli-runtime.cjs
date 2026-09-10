'use strict';

const crypto = require('crypto');
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const PACKAGE_NAME = '@larksuite/cli';
const PACKAGE_VERSION = '1.0.93';
const MANIFEST_FILE = 'runtime-manifest.json';
const RUNTIME_DIRECTORY = path.join('MCPs', 'feishu', 'runtime');

function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function getHostTarget() {
  return `${process.platform}-${process.arch}`;
}

function getRuntimeDirectory(projectRoot, target = getHostTarget()) {
  return path.join(projectRoot, RUNTIME_DIRECTORY, target);
}

function getCliPackagePath(runtimeDirectory) {
  return path.join(runtimeDirectory, 'node_modules', '@larksuite', 'cli', 'package.json');
}

function getCliBinaryPath(runtimeDirectory, target) {
  const binaryName = target.startsWith('win32-') ? 'lark-cli.exe' : 'lark-cli';
  return path.join(runtimeDirectory, 'node_modules', '@larksuite', 'cli', 'bin', binaryName);
}

function readJson(filePath, label) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    throw new Error(
      `[FeishuCliRuntime] Could not read ${label}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function validateRuntime(projectRoot, target = getHostTarget()) {
  const runtimeDirectory = getRuntimeDirectory(projectRoot, target);
  const manifestPath = path.join(runtimeDirectory, MANIFEST_FILE);
  const runtimePackagePath = path.join(runtimeDirectory, 'package.json');
  const cliPackagePath = getCliPackagePath(runtimeDirectory);
  const cliBinaryPath = getCliBinaryPath(runtimeDirectory, target);
  if (
    !fs.existsSync(manifestPath) ||
    !fs.existsSync(runtimePackagePath) ||
    !fs.existsSync(cliPackagePath) ||
    !fs.existsSync(cliBinaryPath)
  ) {
    throw new Error(
      '[FeishuCliRuntime] Missing bundled Feishu CLI. Run npm run vendor:feishu-cli-runtime before packaging.',
    );
  }

  const manifest = readJson(manifestPath, 'runtime manifest');
  const cliPackage = readJson(cliPackagePath, 'CLI package metadata');
  if (
    manifest?.schemaVersion !== 1 ||
    manifest?.packageName !== PACKAGE_NAME ||
    manifest?.packageVersion !== PACKAGE_VERSION ||
    manifest?.runtimePackageSha256 !== sha256File(runtimePackagePath) ||
    manifest?.cliPackageSha256 !== sha256File(cliPackagePath) ||
    manifest?.cliBinarySha256 !== sha256File(cliBinaryPath) ||
    cliPackage?.name !== PACKAGE_NAME ||
    cliPackage?.version !== PACKAGE_VERSION
  ) {
    throw new Error('[FeishuCliRuntime] Bundled Feishu CLI does not match the pinned manifest.');
  }
  return runtimeDirectory;
}

function runNpmInstall(projectRoot, stagingDirectory) {
  const npmCliPath = path.join(projectRoot, 'node_modules', 'npm', 'bin', 'npm-cli.js');
  if (!fs.existsSync(npmCliPath)) {
    throw new Error('[FeishuCliRuntime] Bundled npm is unavailable. Run bun install first.');
  }
  fs.writeFileSync(
    path.join(stagingDirectory, 'package.json'),
    `${JSON.stringify({ private: true, dependencies: { [PACKAGE_NAME]: PACKAGE_VERSION } }, null, 2)}\n`,
    'utf8',
  );
  const result = spawnSync(
    process.execPath,
    [
      npmCliPath,
      'install',
      '--prefix',
      stagingDirectory,
      '--omit=dev',
      '--ignore-scripts',
      '--no-audit',
      '--no-fund',
      '--package-lock=false',
    ],
    { encoding: 'utf8', timeout: 300_000, windowsHide: true },
  );
  if (result.status !== 0 || result.error) {
    const detail = result.error?.message || result.stderr || result.stdout || 'unknown error';
    throw new Error(`[FeishuCliRuntime] npm install failed: ${detail.trim()}`);
  }
}

function provisionCliBinary(stagingDirectory) {
  const result = spawnSync(
    process.execPath,
    [
      path.join(stagingDirectory, 'node_modules', '@larksuite', 'cli', 'scripts', 'run.js'),
      '--version',
    ],
    { encoding: 'utf8', timeout: 300_000, windowsHide: true },
  );
  if (result.status !== 0 || result.error) {
    const detail = result.error?.message || result.stderr || result.stdout || 'unknown error';
    throw new Error(`[FeishuCliRuntime] CLI binary provisioning failed: ${detail.trim()}`);
  }
}

function replaceDirectory(stagingDirectory, targetDirectory) {
  const backupDirectory = `${targetDirectory}.backup-${process.pid}-${Date.now()}`;
  const hadTarget = fs.existsSync(targetDirectory);
  try {
    if (hadTarget) fs.renameSync(targetDirectory, backupDirectory);
    fs.renameSync(stagingDirectory, targetDirectory);
  } catch (error) {
    if (!fs.existsSync(targetDirectory) && fs.existsSync(backupDirectory)) {
      fs.renameSync(backupDirectory, targetDirectory);
    }
    throw error;
  }
  if (hadTarget) fs.rmSync(backupDirectory, { recursive: true, force: true });
}

function vendorRuntime(projectRoot, target = getHostTarget()) {
  if (target !== getHostTarget()) {
    throw new Error(
      `[FeishuCliRuntime] Cross-platform vendoring is unsupported. Build ${target} on ${target}.`,
    );
  }
  const runtimeDirectory = getRuntimeDirectory(projectRoot, target);
  const runtimeParent = path.dirname(runtimeDirectory);
  fs.mkdirSync(runtimeParent, { recursive: true });
  // Keep the staging directory beside the target so promotion is an atomic
  // rename on every supported volume.
  const stagingDirectory = fs.mkdtempSync(path.join(runtimeParent, '.runtime.staging-'));
  try {
    runNpmInstall(projectRoot, stagingDirectory);
    provisionCliBinary(stagingDirectory);
    const cliPackage = readJson(getCliPackagePath(stagingDirectory), 'staged CLI package metadata');
    if (cliPackage?.name !== PACKAGE_NAME || cliPackage?.version !== PACKAGE_VERSION) {
      throw new Error('[FeishuCliRuntime] npm resolved an unexpected CLI version.');
    }
    fs.writeFileSync(
      path.join(stagingDirectory, MANIFEST_FILE),
      `${JSON.stringify(
        {
          schemaVersion: 1,
          packageName: PACKAGE_NAME,
          packageVersion: PACKAGE_VERSION,
          runtimePackageSha256: sha256File(path.join(stagingDirectory, 'package.json')),
          cliPackageSha256: sha256File(getCliPackagePath(stagingDirectory)),
          cliBinarySha256: sha256File(getCliBinaryPath(stagingDirectory, target)),
        },
        null,
        2,
      )}\n`,
      'utf8',
    );
    replaceDirectory(stagingDirectory, runtimeDirectory);
    // Remove the pre-platform-layout payload created by older development
    // builds. It is generated content and would otherwise be packaged twice.
    for (const legacyEntry of [
      'node_modules',
      'package.json',
      'package-lock.json',
      MANIFEST_FILE,
    ]) {
      fs.rmSync(path.join(runtimeParent, legacyEntry), { recursive: true, force: true });
    }
  } finally {
    fs.rmSync(stagingDirectory, { recursive: true, force: true });
  }
  return validateRuntime(projectRoot, target);
}

function ensureRuntime(projectRoot, target = getHostTarget()) {
  try {
    return validateRuntime(projectRoot, target);
  } catch (error) {
    console.warn(
      `[FeishuCliRuntime] Rebuilding ${target}: ${error instanceof Error ? error.message : String(error)}`,
    );
    return vendorRuntime(projectRoot, target);
  }
}

function main() {
  const projectRoot = path.resolve(__dirname, '..');
  const command = process.argv[2] || 'check';
  const target = process.argv[3] || getHostTarget();
  if (command === 'vendor') {
    const runtimeDirectory = vendorRuntime(projectRoot, target);
    console.log(`[FeishuCliRuntime] Bundled runtime ready: ${runtimeDirectory}`);
    return;
  }
  if (command === 'check') {
    const runtimeDirectory = validateRuntime(projectRoot, target);
    console.log(`[FeishuCliRuntime] Bundled runtime verified: ${runtimeDirectory}`);
    return;
  }
  if (command === 'ensure') {
    const runtimeDirectory = ensureRuntime(projectRoot, target);
    console.log(`[FeishuCliRuntime] Bundled runtime ready: ${runtimeDirectory}`);
    return;
  }
  throw new Error(`[FeishuCliRuntime] Unknown command: ${command}`);
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

module.exports = {
  getHostTarget,
  getRuntimeDirectory,
  validateRuntime,
  vendorRuntime,
  ensureRuntime,
};
