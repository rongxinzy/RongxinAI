'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

const NVIDIA_DRIVER_CUDA_LIB = /^libcuda\.so(\.|$)/i;
const DEFAULT_CUDA_LIB_DIRS = ['/usr/local/cuda/lib64', '/usr/local/cuda/lib'];

function sha256File(filePath) {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('hex');
}

function parseLddOutput(output) {
  const dependencies = [];
  for (const line of output.split('\n')) {
    const match = line.match(/^\s*(\S+)\s+=>\s+(\S+)\s+\(/);
    if (!match) continue;
    const soname = match[1];
    const resolved = match[2];
    if (resolved === 'not' || resolved === 'found') continue;
    dependencies.push({ soname, resolvedPath: resolved });
  }
  return dependencies;
}

function parseLddDependencies(serverPath) {
  return parseLddOutput(execFileSync('ldd', [serverPath], { encoding: 'utf8' }));
}

function resolveLibrarySource(resolvedPath, searchDirs) {
  if (fs.existsSync(resolvedPath)) {
    return fs.realpathSync(resolvedPath);
  }
  for (const directory of searchDirs) {
    const candidate = path.join(directory, path.basename(resolvedPath));
    if (fs.existsSync(candidate)) {
      return fs.realpathSync(candidate);
    }
  }
  throw new Error(`Could not resolve shared library path: ${resolvedPath}`);
}

function copyLibraryWithSoname(sourcePath, targetDir, soname) {
  if (NVIDIA_DRIVER_CUDA_LIB.test(soname) || NVIDIA_DRIVER_CUDA_LIB.test(path.basename(sourcePath))) {
    throw new Error(`Refusing to bundle NVIDIA driver library ${soname}`);
  }
  fs.mkdirSync(targetDir, { recursive: true });
  const targetPath = path.join(targetDir, soname);
  fs.copyFileSync(sourcePath, targetPath);
  fs.chmodSync(targetPath, 0o755);
  return targetPath;
}

function applyOriginRpath(serverPath) {
  const patchelf = spawnSync('patchelf', ['--set-rpath', '$ORIGIN', serverPath], {
    encoding: 'utf8',
  });
  if (patchelf.status !== 0) {
    throw new Error(
      `patchelf failed to set RUNPATH on ${serverPath}: ${patchelf.stderr || patchelf.stdout || patchelf.status}`,
    );
  }
}

function verifyLinuxCudaServerLdd(serverPath) {
  const output = execFileSync('ldd', [serverPath], { encoding: 'utf8' });
  const missing = [];
  for (const line of output.split('\n')) {
    const notFound = line.match(/^\s*(\S+)\s+=>\s+not found/);
    if (!notFound) continue;
    const soname = notFound[1];
    if (NVIDIA_DRIVER_CUDA_LIB.test(soname)) continue;
    missing.push(soname);
  }
  if (missing.length > 0) {
    throw new Error(
      `llama-server has unresolved dependencies besides libcuda: ${missing.join(', ')}`,
    );
  }
}

function stageLinuxCudaRuntimeLibraries(serverPath, options = {}) {
  const binDir = options.binDir || path.dirname(serverPath);
  const searchDirs = [...DEFAULT_CUDA_LIB_DIRS, ...(options.searchDirs || [])];
  if (!fs.existsSync(serverPath)) {
    throw new Error(`Missing llama-server for CUDA runtime staging: ${serverPath}`);
  }

  const copied = [];
  for (const dependency of parseLddDependencies(serverPath)) {
    if (NVIDIA_DRIVER_CUDA_LIB.test(dependency.soname)) continue;
    const sourcePath = resolveLibrarySource(dependency.resolvedPath, searchDirs);
    const targetPath = copyLibraryWithSoname(sourcePath, binDir, dependency.soname);
    copied.push({ soname: dependency.soname, path: targetPath, sha256: sha256File(targetPath) });
  }

  applyOriginRpath(serverPath);
  verifyLinuxCudaServerLdd(serverPath);

  copied.sort((a, b) => a.soname.localeCompare(b.soname));
  const librariesDigest = crypto
    .createHash('sha256')
    .update(copied.map(entry => `${entry.soname}\0${entry.sha256}\0`).join(''))
    .digest('hex');

  const buildInfo = {
    schemaVersion: 1,
    source: 'nvidia-cuda-toolkit',
    toolkitRoot: '/usr/local/cuda',
    libraries: copied.map(entry => ({ soname: entry.soname, sha256: entry.sha256 })),
    librariesDigest,
    stagedAt: new Date().toISOString(),
  };
  fs.writeFileSync(
    path.join(binDir, 'runtime-build-info.json'),
    `${JSON.stringify(buildInfo, null, 2)}\n`,
  );

  return { copied, librariesDigest, buildInfo };
}

if (require.main === module) {
  const serverPath = path.resolve(process.argv[2] || '');
  if (!serverPath) {
    console.error('[stage-linux-cuda-runtime-libs] Usage: node scripts/stage-linux-cuda-runtime-libs.cjs <path/to/llama-server>');
    process.exit(1);
  }
  try {
    const result = stageLinuxCudaRuntimeLibraries(serverPath);
    console.log(
      `[stage-linux-cuda-runtime-libs] Staged ${result.copied.length} libraries (${result.librariesDigest.slice(0, 12)}…).`,
    );
  } catch (error) {
    console.error(
      '[stage-linux-cuda-runtime-libs]',
      error instanceof Error ? error.message : error,
    );
    process.exit(1);
  }
}

module.exports = {
  NVIDIA_DRIVER_CUDA_LIB,
  parseLddOutput,
  parseLddDependencies,
  resolveLibrarySource,
  stageLinuxCudaRuntimeLibraries,
  verifyLinuxCudaServerLdd,
};
