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
    throw new Error(
      `[PackagedRuntimeVerify] Missing Windows component manifest: ${manifestPath}`,
    );
  }
  return JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
}

function verifyWindowsCompressedChannelRuntime(context, targetId, expectedChecksum, binaryName) {
  const projectRoot = context.packager.projectDir;
  const componentsDir = path.join(projectRoot, 'build-tar', 'windows-components');
  const componentKey = 'channel-runtime';
  const manifest = readWindowsComponentManifest(componentsDir, componentKey);
  const archivePath = path.join(componentsDir, manifest.archive || `${componentKey}.7z`);
  if (!fs.existsSync(archivePath)) {
    throw new Error(`[PackagedRuntimeVerify] Missing Windows channel-runtime archive: ${archivePath}`);
  }

  const archiveSha256 = sha256File(archivePath);
  if (manifest.archiveSha256 && manifest.archiveSha256 !== archiveSha256) {
    throw new Error(
      `[PackagedRuntimeVerify] channel-runtime archive SHA-256 mismatch (expected ${manifest.archiveSha256}, got ${archiveSha256})`,
    );
  }

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zhiyuan-channel-runtime-verify-'));
  try {
    extractWindowsComponentArchive(resolveWindows7zaPath(projectRoot), archivePath, tempDir);
    const binaryPath = path.join(tempDir, manifest.prefix || componentKey, binaryName);
    if (!fs.existsSync(binaryPath)) {
      throw new Error(
        `[PackagedRuntimeVerify] Missing channel-runtime ${targetId} sidecar after extracting ${archivePath}`,
      );
    }
    const actualChecksum = sha256File(binaryPath);
    if (actualChecksum.toLowerCase() !== expectedChecksum.trim().toLowerCase()) {
      throw new Error(
        `[PackagedRuntimeVerify] channel-runtime ${targetId} SHA-256 mismatch (expected ${expectedChecksum}, got ${actualChecksum})`,
      );
    }
    if (manifest.sentinelSha256 && manifest.sentinelSha256 !== actualChecksum) {
      throw new Error(
        '[PackagedRuntimeVerify] channel-runtime sentinel SHA-256 does not match extracted sidecar.',
      );
    }

    const buildInfoPath = path.join(path.dirname(binaryPath), 'runtime-build-info.json');
    if (!fs.existsSync(buildInfoPath)) {
      throw new Error(
        `[PackagedRuntimeVerify] Missing channel-runtime runtime-build-info.json for ${targetId} inside Windows component archive`,
      );
    }
    const buildInfo = JSON.parse(fs.readFileSync(buildInfoPath, 'utf8'));
    const packageJson = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8'));
    const config = packageJson.channelRuntime;
    const assetName = config?.runtimeAssets?.[targetId];
    if (
      buildInfo?.schemaVersion !== 1 ||
      buildInfo?.repo !== config?.repo ||
      buildInfo?.version !== config?.version ||
      buildInfo?.sourceRevision !== config?.sourceRevision ||
      buildInfo?.target !== targetId ||
      buildInfo?.assetName !== assetName ||
      buildInfo?.checksum !== expectedChecksum
    ) {
      throw new Error(
        '[PackagedRuntimeVerify] Packaged channel runtime metadata does not match package.json channelRuntime pin.',
      );
    }
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

module.exports = {
  extractWindowsComponentArchive,
  readWindowsComponentManifest,
  verifyWindowsCompressedChannelRuntime,
};
