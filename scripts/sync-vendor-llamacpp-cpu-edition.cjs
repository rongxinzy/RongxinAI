'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const {
  resolveRuntimeDownloadSources,
  resolveRuntimeReleaseTag,
  resolveOfficialRuntimeAssetName,
  resolveExecutableName,
  extractArchiveToDirectory,
} = require('./download-llamacpp-runtime.cjs');

const ROOT = path.resolve(__dirname, '..');
const CPU_EDITION_ROOT = path.join(ROOT, 'vendor', 'llamacpp', 'cpu');
const BUNDLE_CHECKSUMS_PATH = path.join(
  ROOT,
  'resources',
  'llamacpp-backends',
  'bundle-checksums.json',
);

const CPU_VULKAN_BUNDLE = {
  'win-x64': [
    { backend: 'win-x64', targetId: 'win-x64', accelerator: 'cpu' },
    { backend: 'win-x64-vulkan', targetId: 'win-x64-vulkan', accelerator: 'vulkan' },
  ],
  'linux-x64': [
    { backend: 'linux-x64', targetId: 'linux-x64', accelerator: 'cpu' },
    { backend: 'linux-x64-vulkan', targetId: 'linux-x64-vulkan', accelerator: 'vulkan' },
  ],
};

function sha256File(filePath) {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('hex');
}

function resolveRuntimeTargetId(platform = process.platform, arch = process.arch) {
  if (platform === 'win32' && arch === 'x64') return 'win-x64';
  if (platform === 'linux' && arch === 'x64') return 'linux-x64';
  if (platform === 'darwin' && arch === 'arm64') return 'mac-arm64';
  if (platform === 'darwin' && arch === 'x64') return 'mac-x64';
  throw new Error(`Unsupported host for cpu edition sync: ${platform}/${arch}`);
}

function readExpectedArchiveSha256(assetName) {
  if (fs.existsSync(BUNDLE_CHECKSUMS_PATH)) {
    const checksums = JSON.parse(fs.readFileSync(BUNDLE_CHECKSUMS_PATH, 'utf8'));
    const pinned = checksums.sha256?.[assetName];
    if (typeof pinned === 'string' && /^[a-f0-9]{64}$/.test(pinned)) {
      return pinned.toLowerCase();
    }
  }
  return undefined;
}

async function downloadToFile(urls, outputPath) {
  const errors = [];
  for (const url of urls) {
    const response = await fetch(url, {
      headers: { 'User-Agent': 'ZhiYuanAgent/sync-vendor-llamacpp-cpu-edition' },
    });
    if (!response.ok || !response.body) {
      errors.push(`${url} HTTP ${response.status}`);
      continue;
    }
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, Buffer.from(await response.arrayBuffer()));
    return url;
  }
  throw new Error(`CPU runtime download failed: ${errors.join('; ')}`);
}

function findExecutablePath(rootDir, executableName) {
  const queue = [rootDir];
  while (queue.length > 0) {
    const current = queue.shift();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) queue.push(fullPath);
      else if (entry.name === executableName) return fullPath;
    }
  }
  return null;
}

function copyDirectoryContents(sourceDir, targetDir) {
  fs.mkdirSync(targetDir, { recursive: true });
  for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
    const sourcePath = path.join(sourceDir, entry.name);
    const targetPath = path.join(targetDir, entry.name);
    if (entry.isSymbolicLink()) {
      fs.symlinkSync(fs.readlinkSync(sourcePath), targetPath);
      continue;
    }
    if (entry.isDirectory()) {
      copyDirectoryContents(sourcePath, targetPath);
      continue;
    }
    fs.copyFileSync(sourcePath, targetPath);
  }
}

function removeModelWeights(rootDir) {
  const queue = [rootDir];
  while (queue.length > 0) {
    const current = queue.shift();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) queue.push(fullPath);
      else if (entry.isFile() && entry.name.toLowerCase().endsWith('.gguf')) {
        fs.rmSync(fullPath, { force: true });
      }
    }
  }
}

function runVersionSmoke(executablePath, platform) {
  const binDir = path.dirname(executablePath);
  const env = { ...process.env };
  if (platform === 'linux') {
    env.LD_LIBRARY_PATH =
      binDir + (env.LD_LIBRARY_PATH ? path.delimiter + env.LD_LIBRARY_PATH : '');
  } else if (platform === 'win32') {
    env.PATH = binDir + (env.PATH ? path.delimiter + env.PATH : '');
  }
  const result = spawnSync(executablePath, ['--version'], {
    encoding: 'utf8',
    env,
    timeout: 30_000,
    windowsHide: true,
  });
  if (result.status !== 0) {
    throw new Error(
      `${path.basename(executablePath)} --version failed: ${result.stderr || result.stdout || result.status}`,
    );
  }
}

async function installBackendEntry(releaseTag, entry, hostPlatform) {
  const assetName = resolveOfficialRuntimeAssetName(entry.targetId);
  const urls = resolveRuntimeDownloadSources(entry.targetId, { rootDir: ROOT });
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'llamacpp-cpu-edition-'));
  const archivePath = path.join(tempDir, assetName);
  const extractDir = path.join(tempDir, 'extract');
  try {
    const sourceUrl = await downloadToFile(urls, archivePath);
    const expectedSha256 = readExpectedArchiveSha256(assetName);
    if (expectedSha256) {
      const actualSha256 = sha256File(archivePath);
      if (actualSha256 !== expectedSha256) {
        throw new Error(
          `Archive SHA-256 mismatch for ${assetName}: expected ${expectedSha256}, got ${actualSha256}`,
        );
      }
    }
    fs.mkdirSync(extractDir, { recursive: true });
    await extractArchiveToDirectory(archivePath, extractDir);
    const executableName = resolveExecutableName(entry.targetId);
    const executablePath = findExecutablePath(extractDir, executableName);
    if (!executablePath) {
      throw new Error(`${assetName} does not contain ${executableName}`);
    }
    const backendDir = path.join(CPU_EDITION_ROOT, 'backends', releaseTag, entry.backend);
    fs.rmSync(backendDir, { recursive: true, force: true });
    const binDir = path.join(backendDir, 'bin');
    fs.mkdirSync(binDir, { recursive: true });
    copyDirectoryContents(path.dirname(executablePath), binDir);
    removeModelWeights(backendDir);
    const stagedExecutable = path.join(binDir, executableName);
    if (hostPlatform === process.platform) {
      runVersionSmoke(stagedExecutable, hostPlatform);
    }
    return {
      backend: entry.backend,
      accelerator: entry.accelerator,
      relativeExecutable: path.relative(CPU_EDITION_ROOT, stagedExecutable).replace(/\\/g, '/'),
      sha256: sha256File(stagedExecutable),
      sourceUrl,
      archiveSha256: sha256File(archivePath),
    };
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

function hostPlatformForTarget(targetId) {
  if (targetId.startsWith('win-')) return 'win32';
  if (targetId.startsWith('linux-')) return 'linux';
  return 'darwin';
}

async function main() {
  const targetId = process.env.LLAMACPP_CPU_TARGET_ID?.trim() || resolveRuntimeTargetId();
  const releaseTag = resolveRuntimeReleaseTag(ROOT);
  const bundle = CPU_VULKAN_BUNDLE[targetId];
  fs.rmSync(CPU_EDITION_ROOT, { recursive: true, force: true });
  fs.mkdirSync(CPU_EDITION_ROOT, { recursive: true });

  const hostPlatform = hostPlatformForTarget(targetId);
  /** @type {Record<string, import('./sync-vendor-llamacpp-cpu-edition.cjs')>} */
  const installed = {};

  if (bundle) {
    for (const entry of bundle) {
      installed[entry.accelerator] = await installBackendEntry(releaseTag, entry, hostPlatform);
    }
    const vulkan = installed.vulkan;
    const cpu = installed.cpu;
    const manifest = {
      schemaVersion: 2,
      backend: {
        version: releaseTag,
        backend: `${targetId}-cpu-vulkan-bundle`,
        versionBackend: `${releaseTag}/${targetId}-cpu-vulkan-bundle`,
      },
      executable: vulkan.relativeExecutable,
      sha256: vulkan.sha256,
      vulkanExecutable: vulkan.relativeExecutable,
      vulkanSha256: vulkan.sha256,
      vulkanBackend: {
        version: releaseTag,
        backend: vulkan.backend,
        versionBackend: `${releaseTag}/${vulkan.backend}`,
      },
      cpuFallbackExecutable: cpu.relativeExecutable,
      cpuFallbackSha256: cpu.sha256,
      cpuFallbackBackend: {
        version: releaseTag,
        backend: cpu.backend,
        versionBackend: `${releaseTag}/${cpu.backend}`,
      },
    };
    fs.writeFileSync(
      path.join(CPU_EDITION_ROOT, 'manifest.json'),
      `${JSON.stringify(manifest, null, 2)}\n`,
    );
    console.log(
      `[sync-vendor-llamacpp-cpu-edition] Staged ${targetId} cpu+vulkan edition (${vulkan.sha256.slice(0, 12)}… / ${cpu.sha256.slice(0, 12)}…).`,
    );
    return;
  }

  const single = await installBackendEntry(
    releaseTag,
    { backend: targetId, targetId, accelerator: targetId.startsWith('mac') ? 'metal' : 'cpu' },
    hostPlatform,
  );
  const manifest = {
    schemaVersion: 2,
    backend: {
      version: releaseTag,
      backend: targetId,
      versionBackend: `${releaseTag}/${targetId}`,
    },
    executable: single.relativeExecutable,
    sha256: single.sha256,
  };
  fs.writeFileSync(
    path.join(CPU_EDITION_ROOT, 'manifest.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  console.log(
    `[sync-vendor-llamacpp-cpu-edition] Staged ${targetId} cpu edition at ${CPU_EDITION_ROOT} (${single.sha256.slice(0, 12)}…).`,
  );
}

if (require.main === module) {
  main().catch(error => {
    console.error(
      '[sync-vendor-llamacpp-cpu-edition]',
      error instanceof Error ? error.message : error,
    );
    process.exit(1);
  });
}

module.exports = { CPU_EDITION_ROOT, resolveRuntimeTargetId };
