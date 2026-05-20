'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const tar = require('tar');

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

function resolveGitHubRepo() {
  const envRepo = process.env.LLAMACPP_RUNTIME_GITHUB_REPO?.trim();
  if (envRepo) return envRepo.replace(/^https:\/\/github\.com\//, '').replace(/\.git$/, '');

  const result = spawnSync('git', ['config', '--get', 'remote.origin.url'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  const remote = result.stdout?.trim();
  if (!remote) return null;

  const httpsMatch = remote.match(/^https:\/\/github\.com\/(.+?)(?:\.git)?$/);
  if (httpsMatch) return httpsMatch[1];

  const sshMatch = remote.match(/^git@github\.com:(.+?)(?:\.git)?$/);
  if (sshMatch) return sshMatch[1];

  return null;
}

function resolveRuntimeUrl(targetId) {
  const explicitUrl = process.env.LLAMACPP_RUNTIME_URL?.trim();
  if (explicitUrl) return explicitUrl.replace(/\{target\}/g, targetId);

  const baseUrl = process.env.LLAMACPP_RUNTIME_BASE_URL?.trim();
  if (baseUrl) {
    return `${baseUrl.replace(/\/$/, '')}/llamacpp-runtime-${targetId}.tar.gz`;
  }

  const repo = resolveGitHubRepo();
  if (!repo) {
    throw new Error('Set LLAMACPP_RUNTIME_URL, LLAMACPP_RUNTIME_BASE_URL, or LLAMACPP_RUNTIME_GITHUB_REPO to download a prebuilt runtime.');
  }
  return `https://github.com/${repo}/releases/latest/download/llamacpp-runtime-${targetId}.tar.gz`;
}

async function downloadFile(url, outputPath) {
  console.log(`[download-llamacpp-runtime] Downloading ${url}`);
  const response = await fetch(url, {
    headers: { 'User-Agent': 'RongxinAI/llamacpp-runtime-downloader' },
  });
  if (!response.ok || !response.body) {
    throw new Error(`Download failed: HTTP ${response.status} ${response.statusText}`);
  }

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  const file = fs.createWriteStream(outputPath);
  const reader = response.body.getReader();
  let downloaded = 0;
  const total = Number(response.headers.get('content-length') || 0);

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    downloaded += value.byteLength;
    file.write(Buffer.from(value));
    if (total > 0) {
      const percent = Math.floor((downloaded / total) * 100);
      process.stdout.write(`\r[download-llamacpp-runtime] ${percent}%`);
    }
  }

  await new Promise((resolve, reject) => {
    file.end((error) => error ? reject(error) : resolve());
  });
  if (total > 0) process.stdout.write('\n');
}

async function main() {
  const targetId = (process.argv[2] || '').trim() || resolveHostTargetId();
  const rootDir = path.resolve(__dirname, '..');
  const runtimeBaseDir = path.join(rootDir, 'vendor', 'llamacpp-runtime');
  const targetRuntimeDir = path.join(runtimeBaseDir, targetId);
  const executableName = resolveExecutableName(targetId);
  const targetExecutable = path.join(targetRuntimeDir, 'bin', executableName);

  if (fs.existsSync(targetExecutable)) {
    console.log(`[download-llamacpp-runtime] Runtime already exists: ${targetRuntimeDir}`);
  } else {
    const url = resolveRuntimeUrl(targetId);
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'llamacpp-runtime-'));
    const archivePath = path.join(tempDir, `llamacpp-runtime-${targetId}.tar.gz`);
    const extractDir = path.join(tempDir, 'extract');
    await downloadFile(url, archivePath);
    fs.mkdirSync(extractDir, { recursive: true });
    await tar.x({
      file: archivePath,
      cwd: extractDir,
    });
    const extractedSourceDir = resolveExtractedRuntimeRoot(extractDir, executableName, targetId);
    fs.rmSync(targetRuntimeDir, { recursive: true, force: true });
    fs.mkdirSync(path.dirname(targetRuntimeDir), { recursive: true });
    fs.cpSync(extractedSourceDir, targetRuntimeDir, { recursive: true });
    fs.rmSync(tempDir, { recursive: true, force: true });
  }

  if (!fs.existsSync(targetExecutable)) {
    throw new Error(`Downloaded runtime is missing ${path.join('bin', executableName)}.`);
  }

  const sync = spawnSync(process.execPath, [
    path.join(rootDir, 'scripts', 'sync-llamacpp-runtime-current.cjs'),
    targetId,
  ], {
    cwd: rootDir,
    stdio: 'inherit',
  });
  if (sync.status !== 0) process.exit(sync.status || 1);
}

function resolveExtractedRuntimeRoot(extractDir, executableName, targetId) {
  const directExecutable = path.join(extractDir, 'bin', executableName);
  if (fs.existsSync(directExecutable)) {
    validateRuntimeTarget(extractDir, targetId);
    return extractDir;
  }

  const entries = fs.readdirSync(extractDir, { withFileTypes: true }).filter((entry) => entry.isDirectory());
  if (entries.length === 1) {
    const candidate = path.join(extractDir, entries[0].name);
    if (fs.existsSync(path.join(candidate, 'bin', executableName))) {
      validateRuntimeTarget(candidate, targetId);
      return candidate;
    }
  }

  throw new Error(`Downloaded runtime archive does not contain bin/${executableName}.`);
}

function validateRuntimeTarget(runtimeDir, targetId) {
  const buildInfoPath = path.join(runtimeDir, 'runtime-build-info.json');
  if (!fs.existsSync(buildInfoPath)) return;
  try {
    const buildInfo = JSON.parse(fs.readFileSync(buildInfoPath, 'utf8'));
    if (buildInfo && typeof buildInfo.target === 'string' && buildInfo.target !== targetId) {
      throw new Error(`Downloaded runtime target mismatch: expected ${targetId}, got ${buildInfo.target}.`);
    }
  } catch (error) {
    throw new Error(`Failed to validate runtime-build-info.json: ${error instanceof Error ? error.message : String(error)}`);
  }
}

main().catch((error) => {
  console.error(`[download-llamacpp-runtime] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
