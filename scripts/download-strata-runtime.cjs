'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const tar = require('tar');
const extractZip = require('extract-zip');

const ROOT = path.resolve(__dirname, '..');
const RELEASE_BASE = 'https://github.com/Niko1221/Strata/releases/download';
const VENDOR_ROOT = path.join(ROOT, 'vendor', 'strata', 'win-cuda13');

function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function readPinnedManifest() {
  const packageJson = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const strata = packageJson.strata;
  if (!strata?.releaseTag || !strata.control || !strata.engineQwen || !strata.engineDsv41) {
    throw new Error('package.json is missing the pinned Strata runtime configuration.');
  }
  return strata;
}

async function download(url, destination) {
  const response = await fetch(url, {
    headers: { 'User-Agent': 'ZhiYuanAgent/strata-runtime-downloader' },
  });
  if (!response.ok) {
    throw new Error(`Strata download failed (${url}): HTTP ${response.status}`);
  }
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(destination, Buffer.from(await response.arrayBuffer()));
}

async function extractArchive(archivePath, destination) {
  fs.mkdirSync(destination, { recursive: true });
  if (archivePath.endsWith('.zip')) {
    await extractZip(archivePath, { dir: destination });
    return;
  }
  if (archivePath.endsWith('.tar.gz')) {
    await tar.x({ file: archivePath, cwd: destination });
    return;
  }
  throw new Error(`Unsupported Strata archive: ${archivePath}`);
}

function findManifestRoot(extractedDir) {
  const direct = path.join(extractedDir, 'engine-component.json');
  if (fs.existsSync(direct)) return extractedDir;
  for (const entry of fs.readdirSync(extractedDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const nested = path.join(extractedDir, entry.name, 'engine-component.json');
    if (fs.existsSync(nested)) return path.join(extractedDir, entry.name);
  }
  throw new Error(`engine-component.json not found under ${extractedDir}`);
}

async function installAsset({ tag, asset, expectedSha256, targetDir }) {
  const archivePath = path.join(VENDOR_ROOT, '_archives', asset.assetName);
  const url = `${RELEASE_BASE}/${tag}/${asset.assetName}`;
  if (!fs.existsSync(archivePath)) {
    console.log(`[download-strata-runtime] Downloading ${url}`);
    await download(url, archivePath);
  }
  const digest = sha256File(archivePath);
  if (digest !== expectedSha256.toLowerCase()) {
    throw new Error(
      `[download-strata-runtime] SHA-256 mismatch for ${asset.assetName}: expected ${expectedSha256}, got ${digest}`,
    );
  }
  const staging = path.join(VENDOR_ROOT, '_staging', asset.assetName);
  fs.rmSync(staging, { recursive: true, force: true });
  fs.mkdirSync(staging, { recursive: true });
  await extractArchive(archivePath, staging);
  fs.rmSync(targetDir, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(targetDir), { recursive: true });
  if (asset.assetName.endsWith('.zip')) {
    fs.cpSync(staging, targetDir, { recursive: true });
  } else {
    fs.cpSync(findManifestRoot(staging), targetDir, { recursive: true });
  }
  fs.rmSync(staging, { recursive: true, force: true });
}

async function main() {
  if (process.platform !== 'win32' && process.env.ZHIYUAN_STRATA_RUNTIME_DOWNLOAD !== '1') {
    console.log(
      '[download-strata-runtime] Skipping download on non-Windows host (set ZHIYUAN_STRATA_RUNTIME_DOWNLOAD=1 to force).',
    );
    return;
  }
  const pinned = readPinnedManifest();
  const controlTarget = path.join(VENDOR_ROOT, 'control');
  const qwenTarget = path.join(
    VENDOR_ROOT,
    'components',
    'engine',
    pinned.engineQwen.installFolder,
  );
  const dsv41Target = path.join(
    VENDOR_ROOT,
    'components',
    'engine-dsv41',
    pinned.engineDsv41.installFolder,
  );
  if (
    fs.existsSync(path.join(controlTarget, 'serve', 'server.py')) &&
    fs.existsSync(path.join(qwenTarget, 'engine-component.json')) &&
    fs.existsSync(path.join(dsv41Target, 'engine-component.json'))
  ) {
    console.log('[download-strata-runtime] Vendor Strata runtime already present.');
    return;
  }
  await installAsset({
    tag: pinned.releaseTag,
    asset: pinned.control,
    expectedSha256: pinned.control.sha256,
    targetDir: controlTarget,
  });
  await installAsset({
    tag: pinned.releaseTag,
    asset: pinned.engineQwen,
    expectedSha256: pinned.engineQwen.sha256,
    targetDir: qwenTarget,
  });
  await installAsset({
    tag: pinned.releaseTag,
    asset: pinned.engineDsv41,
    expectedSha256: pinned.engineDsv41.sha256,
    targetDir: dsv41Target,
  });
  fs.writeFileSync(
    path.join(VENDOR_ROOT, 'manifest.json'),
    `${JSON.stringify({ schemaVersion: 1, stagedAt: new Date().toISOString(), releaseTag: pinned.releaseTag }, null, 2)}\n`,
  );
  console.log(
    '[download-strata-runtime] Strata Windows CUDA13 runtime staged under vendor/strata/win-cuda13.',
  );
}

if (require.main === module) {
  main().catch(error => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}

module.exports = {
  VENDOR_ROOT,
  readPinnedManifest,
  sha256File,
  findManifestRoot,
};
