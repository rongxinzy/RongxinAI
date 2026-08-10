'use strict';

const crypto = require('crypto');
const { spawnSync } = require('child_process');
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
  // Fork 运行时校验：ZhiYuan 使用带 -zhiyuan 后缀的 fork 标签。
  // 防呆——若配置回退到上游裸版本号（v1.20.0 无后缀），说明配置被
  // 误改或 fork 发布未完成，此时应显式失败而不是静默下载上游二进制。
  const version = packageJson.engram.version;
  if (!/^v\d+\.\d+\.\d+-zhiyuan\.\d+$/.test(version)) {
    throw new Error(
      `Unsupported memory runtime version "${version}": expected a fork tag like v1.20.0-zhiyuan.1. ` +
        'Publish the fork release first, then update package.json engram.version and runtimeChecksums.',
    );
  }
  return packageJson.engram;
}

function sha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

const PROXY_ENV_KEYS = [
  'npm_config_https_proxy',
  'npm_config_proxy',
  'HTTPS_PROXY',
  'https_proxy',
  'HTTP_PROXY',
  'http_proxy',
  'ALL_PROXY',
  'all_proxy',
];

function readProxyFromEnvironment(environment = process.env) {
  for (const key of PROXY_ENV_KEYS) {
    const value = environment[key]?.trim();
    if (value) return value;
  }
  return null;
}

function readGitProxy(url, runCommand = spawnSync) {
  try {
    const result = runCommand('git', ['config', '--get-urlmatch', 'http.proxy', url], {
      encoding: 'utf8',
      timeout: 5_000,
      windowsHide: true,
    });
    if (result.status === 0) return String(result.stdout || '').trim() || null;
  } catch {
    // Git is optional; curl can still use environment or system proxy configuration.
  }
  return null;
}

function resolveDownloadProxy(url, options = {}) {
  const environment = options.environment ?? process.env;
  return (
    readProxyFromEnvironment(environment) || readGitProxy(url, options.runCommand ?? spawnSync)
  );
}

function downloadWithCurl(url, destination, proxy, runCommand = spawnSync) {
  const curlArgs = [
    '-L',
    '--fail',
    '--retry',
    '5',
    '--retry-all-errors',
    '--retry-delay',
    '2',
    '--connect-timeout',
    '30',
  ];
  if (proxy) curlArgs.push('--proxy', proxy);
  curlArgs.push('-o', destination, url);

  const result = runCommand('curl', curlArgs, {
    stdio: 'inherit',
    timeout: 360_000,
    windowsHide: true,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`curl exited ${result.status ?? 'without a status'}.`);
  }
}

async function download(url, destination, options = {}) {
  const runCommand = options.runCommand ?? spawnSync;
  const proxy = resolveDownloadProxy(url, {
    environment: options.environment,
    runCommand,
  });
  if (proxy) {
    console.log('[MemoryRuntime] Downloading through the configured proxy.');
    downloadWithCurl(url, destination, proxy, runCommand);
    return;
  }
  try {
    const response = await (options.fetchImplementation ?? fetch)(url, {
      headers: { 'User-Agent': 'ZhiYuanAgent/memory-runtime-downloader' },
    });
    if (!response.ok) throw new Error(`Download failed with HTTP ${response.status}.`);
    fs.writeFileSync(destination, Buffer.from(await response.arrayBuffer()));
  } catch (fetchError) {
    // curl has a more robust network stack and retries transient direct
    // connection failures before the download is rejected.
    try {
      downloadWithCurl(url, destination, null, runCommand);
    } catch (curlError) {
      throw new Error(
        `Download failed (fetch: ${fetchError.message}; curl: ${curlError.message}).`,
      );
    }
  }
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
    await extractZipArchive(archivePath, destination);
    return;
  }
  if (archivePath.endsWith('.tar.gz')) {
    await tar.x({ file: archivePath, cwd: destination });
    return;
  }
  throw new Error(`Unsupported memory runtime archive: ${archivePath}`);
}

/**
 * extract-zip (the package) occasionally resolves its promise before the last
 * file is fully flushed on Windows, yielding a truncated binary. Prefer the
 * OS's own extractors, which are known-correct: Windows 10+ ships bsdtar
 * (tar.exe) with zip support; PowerShell Expand-Archive is the fallback.
 */
async function extractZipArchive(archivePath, destination) {
  const { spawnSync } = require('child_process');
  const trySystemTar = () => {
    if (process.platform !== 'win32') return null;
    const result = spawnSync('tar', ['-xf', archivePath, '-C', destination], { timeout: 120_000 });
    return result.status === 0 ? 'ok' : null;
  };
  const tryExpandArchive = async () => {
    if (process.platform !== 'win32') return false;
    const { execFileSync } = require('child_process');
    try {
      execFileSync(
        'powershell.exe',
        [
          '-NoProfile',
          '-Command',
          `Expand-Archive -LiteralPath '${archivePath}' -DestinationPath '${destination}' -Force`,
        ],
        { timeout: 120_000, stdio: 'ignore' },
      );
      return true;
    } catch {
      return false;
    }
  };
  if (trySystemTar()) return;
  if (await tryExpandArchive()) return;
  // Last resort: the npm package (may truncate on Windows, see above).
  await extractZip(archivePath, { dir: destination });
}

function readBuildInfo(buildInfoPath) {
  try {
    return JSON.parse(fs.readFileSync(buildInfoPath, 'utf8'));
  } catch {
    return null;
  }
}

function runtimeMatchesConfig(buildInfo, config, targetId, assetName, checksum) {
  return (
    buildInfo?.target === targetId &&
    buildInfo?.version === config.version &&
    buildInfo?.repo === config.repo &&
    buildInfo?.assetName === assetName &&
    buildInfo?.checksum === checksum
  );
}

function replaceDirectoryAtomically(stagedDirectory, targetDirectory, fileSystem = fs) {
  const parentDirectory = path.dirname(targetDirectory);
  const backupDirectory = path.join(
    parentDirectory,
    `.${path.basename(targetDirectory)}.backup-${crypto.randomUUID()}`,
  );
  const hadTarget = fileSystem.existsSync(targetDirectory);

  try {
    if (hadTarget) fileSystem.renameSync(targetDirectory, backupDirectory);
    fileSystem.renameSync(stagedDirectory, targetDirectory);
  } catch (error) {
    if (fileSystem.existsSync(targetDirectory)) {
      fileSystem.rmSync(targetDirectory, { recursive: true, force: true });
    }
    if (hadTarget && fileSystem.existsSync(backupDirectory)) {
      fileSystem.renameSync(backupDirectory, targetDirectory);
    }
    throw error;
  }

  if (hadTarget) fileSystem.rmSync(backupDirectory, { recursive: true, force: true });
}

async function prepareRuntimeDirectory(options) {
  const { rootDir, runtimeRoot, targetId, executableName, config, assetName, checksum } = options;
  const downloadRuntime = options.downloadRuntime ?? download;
  const extractRuntime = options.extractRuntime ?? extract;
  const temporaryRoot = options.temporaryRoot ?? os.tmpdir();
  const temporaryDirectory = fs.mkdtempSync(
    path.join(temporaryRoot, 'zhiyuan-memory-runtime-download-'),
  );
  const stagedDirectory = fs.mkdtempSync(path.join(runtimeRoot, `.${targetId}.staging-`));

  try {
    const archivePath = path.join(temporaryDirectory, assetName);
    const extractDirectory = path.join(temporaryDirectory, 'extract');
    const url = `https://github.com/${config.repo}/releases/download/${config.version}/${assetName}`;
    fs.mkdirSync(extractDirectory, { recursive: true });
    await downloadRuntime(url, archivePath);
    const actualChecksum = sha256(archivePath);
    if (actualChecksum !== checksum) {
      throw new Error(`Memory runtime checksum mismatch for ${assetName}.`);
    }
    await extractRuntime(archivePath, extractDirectory);
    const sourceExecutable = findExecutable(extractDirectory, executableName);
    if (!sourceExecutable) throw new Error(`Archive does not contain ${executableName}.`);

    fs.copyFileSync(sourceExecutable, path.join(stagedDirectory, executableName));
    if (process.platform !== 'win32') {
      fs.chmodSync(path.join(stagedDirectory, executableName), 0o755);
    }
    fs.copyFileSync(
      path.join(rootDir, 'third_party', 'engram.LICENSE'),
      path.join(stagedDirectory, 'LICENSE'),
    );
    fs.writeFileSync(
      path.join(stagedDirectory, 'runtime-build-info.json'),
      `${JSON.stringify({ target: targetId, version: config.version, repo: config.repo, assetName, checksum }, null, 2)}\n`,
    );
    return stagedDirectory;
  } catch (error) {
    fs.rmSync(stagedDirectory, { recursive: true, force: true });
    throw error;
  } finally {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  }
}

async function ensureMemoryRuntime(rootDir, targetId, options = {}) {
  const config = options.config ?? readRuntimeConfig(rootDir);
  const assetName = config.runtimeAssets?.[targetId];
  const checksum = config.runtimeChecksums?.[targetId];
  if (!assetName || !checksum) throw new Error(`Unsupported memory runtime target: ${targetId}`);
  if (!/^[a-f0-9]{64}$/i.test(checksum)) {
    throw new Error(`Memory runtime checksum is not finalized for ${targetId}.`);
  }

  const executableName = targetId.startsWith('win-') ? 'engram.exe' : 'engram';
  const runtimeRoot = path.join(rootDir, 'vendor', 'engram-runtime');
  const targetDirectory = path.join(runtimeRoot, targetId);
  const targetExecutable = path.join(targetDirectory, executableName);
  const buildInfo = readBuildInfo(path.join(targetDirectory, 'runtime-build-info.json'));
  const cacheIsValid =
    fs.existsSync(targetExecutable) &&
    runtimeMatchesConfig(buildInfo, config, targetId, assetName, checksum);

  fs.mkdirSync(runtimeRoot, { recursive: true });
  if (!cacheIsValid) {
    console.log(`[MemoryRuntime] Downloading and verifying ${assetName}.`);
    const stagedDirectory = await prepareRuntimeDirectory({
      ...options,
      rootDir,
      runtimeRoot,
      targetId,
      executableName,
      config,
      assetName,
      checksum,
    });
    try {
      replaceDirectoryAtomically(stagedDirectory, targetDirectory);
    } catch (error) {
      fs.rmSync(stagedDirectory, { recursive: true, force: true });
      throw error;
    }
  }

  const currentDirectory = path.join(runtimeRoot, 'current');
  const stagedCurrentDirectory = fs.mkdtempSync(path.join(runtimeRoot, '.current.staging-'));
  try {
    fs.cpSync(targetDirectory, stagedCurrentDirectory, { recursive: true });
    replaceDirectoryAtomically(stagedCurrentDirectory, currentDirectory);
  } catch (error) {
    fs.rmSync(stagedCurrentDirectory, { recursive: true, force: true });
    throw error;
  }

  return targetDirectory;
}

async function main() {
  const rootDir = path.resolve(__dirname, '..');
  const targetId = process.argv[2]?.trim() || resolveHostTargetId();
  await ensureMemoryRuntime(rootDir, targetId);
  console.log(`[MemoryRuntime] Runtime ready for ${targetId}.`);
}

if (require.main === module) {
  main().catch(error => {
    console.error(`[MemoryRuntime] ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
}

module.exports = {
  download,
  downloadWithCurl,
  ensureMemoryRuntime,
  readBuildInfo,
  readGitProxy,
  readProxyFromEnvironment,
  readRuntimeConfig,
  replaceDirectoryAtomically,
  resolveDownloadProxy,
  resolveHostTargetId,
  runtimeMatchesConfig,
  sha256,
};
