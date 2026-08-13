'use strict';

const crypto = require('crypto');
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const TARGETS = Object.freeze({
  'darwin-x64': 'mac-x64',
  'darwin-arm64': 'mac-arm64',
  'win32-x64': 'win-x64',
  'linux-x64': 'linux-x64',
});

function resolveHostTargetId() {
  const targetId = TARGETS[`${process.platform}-${process.arch}`];
  if (!targetId)
    throw new Error(`Unsupported channel runtime host: ${process.platform}/${process.arch}`);
  return targetId;
}

function readRuntimeConfig(rootDir) {
  const packageJson = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));
  const config = packageJson.channelRuntime;
  if (!config?.version || !config?.repo || !config?.sourceRevision) {
    throw new Error('package.json is missing the pinned channel runtime configuration.');
  }
  return config;
}

function sha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function readBuildInfo(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function runtimeMatchesConfig(buildInfo, config, targetId, assetName, checksum) {
  return (
    buildInfo?.schemaVersion === 1 &&
    buildInfo?.repo === config.repo &&
    buildInfo?.version === config.version &&
    buildInfo?.sourceRevision === config.sourceRevision &&
    buildInfo?.target === targetId &&
    buildInfo?.assetName === assetName &&
    buildInfo?.checksum === checksum
  );
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
    // Git is optional; direct download and environment proxy configuration remain available.
  }
  return null;
}

function resolveDownloadProxy(url, options = {}) {
  return (
    readProxyFromEnvironment(options.environment ?? process.env) ||
    readGitProxy(url, options.runCommand ?? spawnSync)
  );
}

function downloadWithCurl(url, destination, proxy, runCommand = spawnSync) {
  const args = [
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
  if (proxy) args.push('--proxy', proxy);
  args.push('-o', destination, url);
  const result = runCommand('curl', args, {
    stdio: 'inherit',
    timeout: 360_000,
    windowsHide: true,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`curl exited ${result.status ?? 'without a status'}.`);
}

async function download(url, destination, options = {}) {
  const runCommand = options.runCommand ?? spawnSync;
  const proxy = resolveDownloadProxy(url, { environment: options.environment, runCommand });
  if (proxy) {
    console.log('[ChannelRuntime] Downloading through the configured proxy.');
    downloadWithCurl(url, destination, proxy, runCommand);
    return;
  }
  try {
    const response = await (options.fetchImplementation ?? fetch)(url, {
      headers: { 'User-Agent': 'ZhiYuanAgent/channel-runtime-downloader' },
    });
    if (!response.ok) throw new Error(`Download failed with HTTP ${response.status}.`);
    fs.writeFileSync(destination, Buffer.from(await response.arrayBuffer()));
  } catch (fetchError) {
    try {
      downloadWithCurl(url, destination, null, runCommand);
    } catch (curlError) {
      throw new Error(
        `Download failed (fetch: ${fetchError.message}; curl: ${curlError.message}).`,
      );
    }
  }
}

function replaceDirectory(stagedDirectory, targetDirectory) {
  const backupDirectory = `${targetDirectory}.backup-${process.pid}-${Date.now()}`;
  const hadTarget = fs.existsSync(targetDirectory);
  try {
    if (hadTarget) fs.renameSync(targetDirectory, backupDirectory);
    fs.renameSync(stagedDirectory, targetDirectory);
  } catch (error) {
    if (!fs.existsSync(targetDirectory) && fs.existsSync(backupDirectory)) {
      fs.renameSync(backupDirectory, targetDirectory);
    }
    throw error;
  }
  if (hadTarget) fs.rmSync(backupDirectory, { recursive: true, force: true });
}

async function ensureChannelRuntime(rootDir, targetId, options = {}) {
  const config = options.config ?? readRuntimeConfig(rootDir);
  const assetName = config.runtimeAssets?.[targetId];
  const checksum = config.runtimeChecksums?.[targetId];
  if (!assetName || !checksum) throw new Error(`Unsupported channel runtime target: ${targetId}`);
  if (!/^[a-f0-9]{64}$/i.test(checksum)) {
    throw new Error(`Channel runtime checksum is not finalized for ${targetId}.`);
  }

  const binaryName = targetId.startsWith('win-') ? 'cc-connect-sidecar.exe' : 'cc-connect-sidecar';
  const runtimeRoot = path.join(rootDir, 'vendor', 'channel-runtime');
  const targetDirectory = path.join(runtimeRoot, targetId);
  const targetBinary = path.join(targetDirectory, binaryName);
  const buildInfoPath = path.join(targetDirectory, 'runtime-build-info.json');
  const buildInfo = readBuildInfo(buildInfoPath);
  const cacheIsValid =
    fs.existsSync(targetBinary) &&
    sha256(targetBinary) === checksum &&
    runtimeMatchesConfig(buildInfo, config, targetId, assetName, checksum);

  fs.mkdirSync(runtimeRoot, { recursive: true });
  if (!cacheIsValid) {
    const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'zhiyuan-channel-runtime-'));
    const stagedDirectory = fs.mkdtempSync(path.join(runtimeRoot, `.${targetId}.staging-`));
    try {
      const downloadedBinary = path.join(temporaryDirectory, assetName);
      const url = `https://github.com/${config.repo}/releases/download/${config.version}/${assetName}`;
      console.log(`[ChannelRuntime] Downloading and verifying ${assetName}.`);
      await (options.downloadRuntime ?? download)(url, downloadedBinary);
      if (sha256(downloadedBinary) !== checksum) {
        throw new Error(`Channel runtime checksum mismatch for ${assetName}.`);
      }
      fs.copyFileSync(downloadedBinary, path.join(stagedDirectory, binaryName));
      if (process.platform !== 'win32') fs.chmodSync(path.join(stagedDirectory, binaryName), 0o755);
      fs.writeFileSync(
        path.join(stagedDirectory, 'runtime-build-info.json'),
        `${JSON.stringify(
          {
            schemaVersion: 1,
            repo: config.repo,
            version: config.version,
            sourceRevision: config.sourceRevision,
            target: targetId,
            assetName,
            checksum,
          },
          null,
          2,
        )}\n`,
      );
      replaceDirectory(stagedDirectory, targetDirectory);
    } finally {
      fs.rmSync(temporaryDirectory, { recursive: true, force: true });
      fs.rmSync(stagedDirectory, { recursive: true, force: true });
    }
  }

  const currentDirectory = path.join(runtimeRoot, 'current');
  const stagedCurrentDirectory = fs.mkdtempSync(path.join(runtimeRoot, '.current.staging-'));
  try {
    fs.cpSync(targetDirectory, stagedCurrentDirectory, { recursive: true });
    replaceDirectory(stagedCurrentDirectory, currentDirectory);
  } finally {
    fs.rmSync(stagedCurrentDirectory, { recursive: true, force: true });
  }
  return targetDirectory;
}

async function main() {
  const rootDir = path.resolve(__dirname, '..');
  const targetId = process.argv[2]?.trim() || resolveHostTargetId();
  await ensureChannelRuntime(rootDir, targetId);
  console.log(`[ChannelRuntime] Runtime ready for ${targetId}.`);
}

if (require.main === module) {
  main().catch(error => {
    console.error(`[ChannelRuntime] ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
}

module.exports = {
  download,
  downloadWithCurl,
  ensureChannelRuntime,
  readGitProxy,
  readProxyFromEnvironment,
  readRuntimeConfig,
  resolveDownloadProxy,
  resolveHostTargetId,
  runtimeMatchesConfig,
};
