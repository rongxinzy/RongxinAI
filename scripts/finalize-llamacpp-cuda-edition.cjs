'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const {
  resolveRuntimeDownloadSources,
  resolveRuntimeReleaseTag,
  resolveExecutableName,
  extractArchiveToDirectory,
} = require('./download-llamacpp-runtime.cjs');
const {
  assertNoNvidiaDriverLibraries,
  NVIDIA_DRIVER_CUDA_LIB,
} = require('./finalize-llamacpp-cuda-edition.lib.cjs');
const { verifyLinuxCudaServerLdd } = require('./stage-linux-cuda-runtime-libs.cjs');

const ROOT = path.resolve(__dirname, '..');
const BUNDLED_MANIFEST_PATH = path.join(ROOT, 'resources', 'llamacpp-backends', 'manifest.json');
const CUDA_EDITION_ROOT = path.join(ROOT, 'vendor', 'llamacpp', 'cuda');
const CPU_EDITION_ROOT = path.join(ROOT, 'vendor', 'llamacpp', 'cpu');

function sha256File(filePath) {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('hex');
}

function resolveCudaBackendId(platform) {
  if (platform === 'win32' || platform === 'win') return 'win-x64-cuda-12';
  if (platform === 'linux') return 'linux-x64-cuda-12';
  throw new Error(`Unsupported platform for CUDA edition finalize: ${platform}`);
}

function readExpectedArchiveSha256(backendId) {
  if (!fs.existsSync(BUNDLED_MANIFEST_PATH)) return undefined;
  const manifest = JSON.parse(fs.readFileSync(BUNDLED_MANIFEST_PATH, 'utf8'));
  const entry = manifest.backends?.find(item => item.backend === backendId);
  return entry?.archive?.sha256?.trim().toLowerCase();
}

async function downloadToFile(urls, outputPath) {
  const errors = [];
  for (const url of urls) {
    const response = await fetch(url, {
      headers: { 'User-Agent': 'ZhiYuanAgent/finalize-llamacpp-cuda-edition' },
    });
    if (!response.ok || !response.body) {
      errors.push(`${url} HTTP ${response.status}`);
      continue;
    }
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, Buffer.from(await response.arrayBuffer()));
    return url;
  }
  throw new Error(`CUDA runtime archive download failed: ${errors.join('; ')}`);
}

function findRuntimePayloadDirectory(rootDir) {
  const queue = [rootDir];
  let fallback = null;
  while (queue.length > 0) {
    const currentDir = queue.shift();
    const entries = fs.readdirSync(currentDir, { withFileTypes: true });
    if (entries.some(entry => entry.isFile() && /\.(dll|so|dylib)$/i.test(entry.name))) {
      if (path.basename(currentDir).toLowerCase() === 'bin') return currentDir;
      fallback ||= currentDir;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) queue.push(path.join(currentDir, entry.name));
    }
  }
  return fallback || rootDir;
}

function copyDirectoryContents(sourceDir, targetDir) {
  fs.mkdirSync(targetDir, { recursive: true });
  for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
    const sourcePath = path.join(sourceDir, entry.name);
    const targetPath = path.join(targetDir, entry.name);
    if (entry.isDirectory()) {
      copyDirectoryContents(sourcePath, targetPath);
      continue;
    }
    if (NVIDIA_DRIVER_CUDA_LIB.test(entry.name)) {
      continue;
    }
    fs.copyFileSync(sourcePath, targetPath);
  }
}

function ensureCpuEditionStaged(targetId) {
  const cpuManifestPath = path.join(CPU_EDITION_ROOT, 'manifest.json');
  if (fs.existsSync(cpuManifestPath)) return;
  const sync = spawnSync(
    process.execPath,
    [path.join(__dirname, 'sync-vendor-llamacpp-cpu-edition.cjs')],
    {
      cwd: ROOT,
      stdio: 'inherit',
      env: { ...process.env, LLAMACPP_CPU_TARGET_ID: targetId },
    },
  );
  if (sync.status !== 0) {
    throw new Error('CPU edition sync failed; required for CUDA cpu-fallback embedding.');
  }
}

function writeCpuFallback(hostTargetId, executableName) {
  const cpuFallbackRoot = path.join(CUDA_EDITION_ROOT, 'cpu-fallback');
  fs.rmSync(cpuFallbackRoot, { recursive: true, force: true });
  const releaseTag = resolveRuntimeReleaseTag(ROOT);
  const cpuBackendDir = path.join(CPU_EDITION_ROOT, 'backends', releaseTag, hostTargetId, 'bin');
  const cpuBinSource = fs.existsSync(cpuBackendDir)
    ? cpuBackendDir
    : path.join(CPU_EDITION_ROOT, 'bin');
  copyDirectoryContents(cpuBinSource, cpuFallbackRoot);
  assertNoNvidiaDriverLibraries(cpuFallbackRoot);
  return path.join('cpu-fallback', executableName).replace(/\\/g, '/');
}

function writeManifest(input) {
  const manifest = {
    schemaVersion: 1,
    backend: {
      version: 'bundled',
      backend: `${input.hostTargetId}-cuda-rtx40-sm89`,
      versionBackend: `${input.releaseTag}/${input.cudaBackendId}-sm89`,
    },
    executable: `bin/${input.executableName}`,
    cpuFallbackExecutable: input.cpuFallbackExecutable,
    cudaLibraries: input.cudaLibraries,
    archiveSha256: input.archiveSha256,
  };
  if (input.cudaRuntimeLibrariesDigest) {
    manifest.cudaRuntimeLibrariesDigest = input.cudaRuntimeLibrariesDigest;
  }
  if (input.cpuFallbackArchiveSha256) {
    manifest.cpuFallbackArchiveSha256 = input.cpuFallbackArchiveSha256;
  }
  manifest.sha256 = sha256File(path.join(CUDA_EDITION_ROOT, manifest.executable));
  manifest.cpuFallbackSha256 = sha256File(
    path.join(CUDA_EDITION_ROOT, input.cpuFallbackExecutable),
  );
  fs.writeFileSync(
    path.join(CUDA_EDITION_ROOT, 'manifest.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  return manifest;
}

async function finalizeLinuxEdition(hostTargetId, cudaBackendId, executableName, builtServerBytes) {
  ensureCpuEditionStaged(hostTargetId);
  const binDir = path.join(CUDA_EDITION_ROOT, 'bin');
  const builtServerPath = path.join(binDir, executableName);
  if (!fs.existsSync(builtServerPath)) {
    throw new Error(
      `Missing self-built CUDA llama-server at ${builtServerPath}. Run build-llamacpp-cuda-rtx40.sh first.`,
    );
  }

  const buildInfoPath = path.join(binDir, 'runtime-build-info.json');
  if (!fs.existsSync(buildInfoPath)) {
    throw new Error(
      'Missing staged CUDA runtime libraries. Run scripts/stage-linux-cuda-runtime-libs.cjs inside the CUDA devel container after building llama-server.',
    );
  }
  const buildInfo = JSON.parse(fs.readFileSync(buildInfoPath, 'utf8'));
  assertNoNvidiaDriverLibraries(binDir);
  fs.writeFileSync(builtServerPath, builtServerBytes);
  if (process.platform === 'linux') {
    verifyLinuxCudaServerLdd(builtServerPath);
  }

  const cpuFallbackExecutable = writeCpuFallback(hostTargetId, executableName);
  const releaseTag = resolveRuntimeReleaseTag(ROOT);
  const cpuArchiveSha256 = readExpectedArchiveSha256('linux-x64');
  const manifest = writeManifest({
    hostTargetId,
    cudaBackendId,
    executableName,
    cpuFallbackExecutable,
    cudaLibraries: 'cuda-toolkit-staged',
    archiveSha256: buildInfo.librariesDigest,
    cudaRuntimeLibrariesDigest: buildInfo.librariesDigest,
    cpuFallbackArchiveSha256: cpuArchiveSha256,
    releaseTag,
  });
  console.log(
    `[finalize-llamacpp-cuda-edition] Staged Linux CUDA edition with toolkit libraries and CPU fallback (${manifest.sha256.slice(0, 12)}…).`,
  );
}

async function finalizeWindowsEdition(
  hostTargetId,
  cudaBackendId,
  executableName,
  builtServerBytes,
) {
  ensureCpuEditionStaged(hostTargetId);

  const urls = resolveRuntimeDownloadSources(cudaBackendId, { rootDir: ROOT });
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'llamacpp-cuda-edition-'));
  const archiveName = path.basename(new URL(urls[0]).pathname);
  const archivePath = path.join(tempDir, archiveName);
  const extractDir = path.join(tempDir, 'extract');

  try {
    await downloadToFile(urls, archivePath);
    const expectedSha256 = readExpectedArchiveSha256(cudaBackendId);
    if (expectedSha256) {
      const actualSha256 = sha256File(archivePath);
      if (actualSha256 !== expectedSha256) {
        throw new Error(
          `CUDA archive SHA-256 mismatch: expected ${expectedSha256}, got ${actualSha256}`,
        );
      }
    }

    fs.mkdirSync(extractDir, { recursive: true });
    await extractArchiveToDirectory(archivePath, extractDir);

    const payloadDir = findRuntimePayloadDirectory(extractDir);
    const binDir = path.join(CUDA_EDITION_ROOT, 'bin');
    fs.rmSync(binDir, { recursive: true, force: true });
    copyDirectoryContents(payloadDir, binDir);
    assertNoNvidiaDriverLibraries(binDir);
    fs.writeFileSync(path.join(binDir, executableName), builtServerBytes);
    fs.chmodSync(path.join(binDir, executableName), 0o755);

    const cpuFallbackExecutable = writeCpuFallback(hostTargetId, executableName);
    const releaseTag = resolveRuntimeReleaseTag(ROOT);
    const manifest = writeManifest({
      hostTargetId,
      cudaBackendId,
      executableName,
      cpuFallbackExecutable,
      cudaLibraries: 'bundled-full',
      archiveSha256: expectedSha256 || sha256File(archivePath),
      releaseTag,
    });
    console.log(
      `[finalize-llamacpp-cuda-edition] Staged Windows CUDA edition with full runtime libs and embedded CPU fallback (${manifest.sha256.slice(0, 12)}…).`,
    );
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

async function main() {
  const platform = (
    process.env.LLAMACPP_CUDA_PLATFORM ||
    process.argv[2] ||
    process.platform
  ).trim();
  const hostTargetId =
    platform === 'win' || platform === 'win32'
      ? 'win-x64'
      : platform === 'linux'
        ? 'linux-x64'
        : null;
  if (!hostTargetId) {
    throw new Error(`Unsupported LLAMACPP_CUDA_PLATFORM: ${platform}`);
  }

  const cudaBackendId = resolveCudaBackendId(platform);
  const executableName = resolveExecutableName(hostTargetId);
  const builtServerPath = path.join(CUDA_EDITION_ROOT, 'bin', executableName);
  if (!fs.existsSync(builtServerPath)) {
    throw new Error(
      `Missing self-built CUDA llama-server at ${builtServerPath}. Run build-llamacpp-cuda-rtx40.sh first.`,
    );
  }
  const builtServerBytes = fs.readFileSync(builtServerPath);

  if (platform === 'linux') {
    await finalizeLinuxEdition(hostTargetId, cudaBackendId, executableName, builtServerBytes);
    return;
  }

  await finalizeWindowsEdition(hostTargetId, cudaBackendId, executableName, builtServerBytes);
}

module.exports = {
  assertNoNvidiaDriverLibraries,
  NVIDIA_DRIVER_CUDA_LIB,
};

if (require.main === module) {
  main().catch(error => {
    console.error(
      '[finalize-llamacpp-cuda-edition]',
      error instanceof Error ? error.message : error,
    );
    process.exit(1);
  });
}
