'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const extractZip = require('extract-zip');
const tar = require('tar');

function resolveHostTargetId() {
  const platform = { darwin: 'mac', win32: 'win', linux: 'linux' }[process.platform];
  const architecture = { x64: 'x64', arm64: 'arm64' }[process.arch];
  if (!platform || !architecture) {
    throw new Error(`Unsupported host platform/arch: ${process.platform}/${process.arch}`);
  }
  return `${platform}-${architecture}`;
}

function readRuntimeConfig(rootDir) {
  const packageJson = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));
  if (!packageJson.engram?.version || !packageJson.engram?.repo) {
    throw new Error('package.json is missing the pinned memory runtime configuration.');
  }
  return packageJson.engram;
}

function sha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

async function download(url, destination) {
  const response = await fetch(url, {
    headers: { 'User-Agent': 'ZhiYuanAgent/memory-runtime-downloader' },
  });
  if (!response.ok) throw new Error(`Download failed with HTTP ${response.status}.`);
  fs.writeFileSync(destination, Buffer.from(await response.arrayBuffer()));
}

function findExecutable(rootDir, executableName) {
  const queue = [rootDir];
  while (queue.length > 0) {
    const current = queue.shift();
    const direct = path.join(current, executableName);
    if (fs.existsSync(direct)) return direct;
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (entry.isDirectory()) queue.push(path.join(current, entry.name));
    }
  }
  return null;
}

async function extract(archivePath, destination) {
  if (archivePath.endsWith('.zip')) {
    await extractZip(archivePath, { dir: destination });
    return;
  }
  if (archivePath.endsWith('.tar.gz')) {
    await tar.x({ file: archivePath, cwd: destination });
    return;
  }
  throw new Error(`Unsupported memory runtime archive: ${archivePath}`);
}

async function main() {
  const rootDir = path.resolve(__dirname, '..');
  const targetId = process.argv[2]?.trim() || resolveHostTargetId();
  const config = readRuntimeConfig(rootDir);
  const assetName = config.runtimeAssets?.[targetId];
  const checksum = config.runtimeChecksums?.[targetId];
  if (!assetName || !checksum) throw new Error(`Unsupported memory runtime target: ${targetId}`);

  const executableName = targetId.startsWith('win-') ? 'engram.exe' : 'engram';
  const runtimeRoot = path.join(rootDir, 'vendor', 'engram-runtime');
  const targetDirectory = path.join(runtimeRoot, targetId);
  const targetExecutable = path.join(targetDirectory, executableName);
  if (!fs.existsSync(targetExecutable)) {
    const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'zhiyuan-memory-runtime-'));
    try {
      const archivePath = path.join(temporaryDirectory, assetName);
      const extractDirectory = path.join(temporaryDirectory, 'extract');
      const url = `https://github.com/${config.repo}/releases/download/${config.version}/${assetName}`;
      console.log(`[MemoryRuntime] Downloading ${assetName}.`);
      await download(url, archivePath);
      const actualChecksum = sha256(archivePath);
      if (actualChecksum !== checksum) {
        throw new Error(`Memory runtime checksum mismatch for ${assetName}.`);
      }
      fs.mkdirSync(extractDirectory, { recursive: true });
      await extract(archivePath, extractDirectory);
      const sourceExecutable = findExecutable(extractDirectory, executableName);
      if (!sourceExecutable) throw new Error(`Archive does not contain ${executableName}.`);
      fs.mkdirSync(targetDirectory, { recursive: true });
      fs.copyFileSync(sourceExecutable, targetExecutable);
      if (process.platform !== 'win32') fs.chmodSync(targetExecutable, 0o755);
      fs.copyFileSync(
        path.join(rootDir, 'third_party', 'engram.LICENSE'),
        path.join(targetDirectory, 'LICENSE'),
      );
      fs.writeFileSync(
        path.join(targetDirectory, 'runtime-build-info.json'),
        `${JSON.stringify({ target: targetId, version: config.version, assetName, checksum }, null, 2)}\n`,
      );
    } finally {
      fs.rmSync(temporaryDirectory, { recursive: true, force: true });
    }
  }

  const currentDirectory = path.join(runtimeRoot, 'current');
  fs.rmSync(currentDirectory, { recursive: true, force: true });
  fs.cpSync(targetDirectory, currentDirectory, { recursive: true });
  console.log(`[MemoryRuntime] Runtime ready for ${targetId}.`);
}

if (require.main === module) {
  main().catch(error => {
    console.error(`[MemoryRuntime] ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
}

module.exports = { resolveHostTargetId, readRuntimeConfig, sha256 };
