'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

function sha256File(filePath) {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('hex');
}

function resolveWindows7zaPath(projectRoot) {
  const sevenZipPath = path.join(projectRoot, 'node_modules', '7zip-bin', 'win', 'x64', '7za.exe');
  if (!fs.existsSync(sevenZipPath)) {
    throw new Error(`[PackagedRuntimeVerify] Missing Windows 7za.exe at ${sevenZipPath}`);
  }
  return sevenZipPath;
}

function extractWindowsComponentArchive(sevenZipPath, archivePath, destinationDir) {
  fs.mkdirSync(destinationDir, { recursive: true });
  const result = spawnSync(sevenZipPath, ['x', archivePath, `-o${destinationDir}`, '-y'], {
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    throw new Error(
      `[PackagedRuntimeVerify] Failed to extract ${archivePath}: ${result.stderr || result.stdout || result.status}`,
    );
  }
}

function readWindowsComponentManifest(componentsDir, componentKey) {
  const manifestPath = path.join(componentsDir, `${componentKey}.manifest.json`);
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`[PackagedRuntimeVerify] Missing Windows component manifest: ${manifestPath}`);
  }
  return JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
}

function verifyWindowsCompressedLlamaCppBundled(context, options = {}) {
  const projectRoot = context.packager.projectDir;
  const componentsDir = path.join(projectRoot, 'build-tar', 'windows-components');
  const componentKey = 'llamacpp-bundled';
  const manifest = readWindowsComponentManifest(componentsDir, componentKey);
  const archivePath = path.join(componentsDir, manifest.archive || `${componentKey}.7z`);
  if (!fs.existsSync(archivePath)) {
    throw new Error(
      `[PackagedRuntimeVerify] Missing Windows llamacpp-bundled archive: ${archivePath}`,
    );
  }
  if (
    !/^[a-f0-9]{64}$/.test(manifest.archiveSha256 ?? '') ||
    manifest.archiveSha256 !== sha256File(archivePath)
  ) {
    throw new Error('[PackagedRuntimeVerify] llamacpp-bundled archive SHA-256 mismatch.');
  }

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zhiyuan-llamacpp-bundled-verify-'));
  try {
    extractWindowsComponentArchive(
      options.sevenZipPath ?? resolveWindows7zaPath(projectRoot),
      archivePath,
      tempDir,
    );
    const manifestPath = path.join(tempDir, manifest.prefix || componentKey, 'manifest.json');
    if (!fs.existsSync(manifestPath)) {
      throw new Error(
        `[PackagedRuntimeVerify] Missing llamacpp-bundled manifest after extracting ${archivePath}`,
      );
    }
    if (manifest.sentinelSha256 && manifest.sentinelSha256 !== sha256File(manifestPath)) {
      throw new Error('[PackagedRuntimeVerify] llamacpp-bundled manifest SHA-256 mismatch.');
    }
    const bundledManifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const bundledRoot = path.dirname(manifestPath);
    for (const [executableKey, shaKey] of [
      ['executable', 'sha256'],
      ['vulkanExecutable', 'vulkanSha256'],
      ['cpuFallbackExecutable', 'cpuFallbackSha256'],
    ]) {
      const relative = bundledManifest[executableKey];
      const expected = bundledManifest[shaKey];
      if (typeof relative !== 'string' || !relative) continue;
      const filePath = path.join(bundledRoot, relative);
      if (!fs.existsSync(filePath)) {
        throw new Error(`[PackagedRuntimeVerify] Missing llamacpp ${executableKey}: ${filePath}`);
      }
      const actual = sha256File(filePath);
      if (expected && actual.toLowerCase() !== expected.trim().toLowerCase()) {
        throw new Error(
          `[PackagedRuntimeVerify] llamacpp ${executableKey} SHA-256 mismatch (expected ${expected}, got ${actual})`,
        );
      }
    }
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

module.exports = {
  extractWindowsComponentArchive,
  readWindowsComponentManifest,
  verifyWindowsCompressedLlamaCppBundled,
};
