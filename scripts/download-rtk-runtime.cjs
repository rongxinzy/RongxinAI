'use strict';

const crypto = require('crypto');
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const extractZip = require('extract-zip');
const tar = require('tar');

const TARGET_BY_HOST = {
  'darwin-x64': 'mac-x64',
  'darwin-arm64': 'mac-arm64',
  'win32-x64': 'win-x64',
  'linux-x64': 'linux-x64',
};

function resolveHostTargetId() {
  const target = TARGET_BY_HOST[`${process.platform}-${process.arch}`];
  if (!target) throw new Error(`Unsupported RTK host: ${process.platform}/${process.arch}.`);
  return target;
}

function readRuntimeConfig(rootDir) {
  const packageJson = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));
  const config = packageJson.rtkRuntime;
  if (!config?.version || !config?.repo || !config?.sourceRevision) {
    throw new Error('package.json is missing the pinned RTK runtime configuration.');
  }
  if (!/^v\d+\.\d+\.\d+$/.test(config.version)) {
    throw new Error(`Unsupported RTK runtime version "${config.version}".`);
  }
  if (!/^[a-f0-9]{40}$/i.test(config.sourceRevision)) {
    throw new Error('RTK sourceRevision must be a full Git commit hash.');
  }
  return config;
}

function sha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function resolveProxy(url, environment = process.env, runCommand = spawnSync) {
  for (const key of [
    'npm_config_https_proxy',
    'npm_config_proxy',
    'HTTPS_PROXY',
    'https_proxy',
    'HTTP_PROXY',
    'http_proxy',
    'ALL_PROXY',
    'all_proxy',
  ]) {
    const value = environment[key]?.trim();
    if (value) return value;
  }
  try {
    const result = runCommand('git', ['config', '--get-urlmatch', 'http.proxy', url], {
      encoding: 'utf8',
      timeout: 5_000,
      windowsHide: true,
    });
    return result.status === 0 ? String(result.stdout || '').trim() || null : null;
  } catch {
    return null;
  }
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
  const proxy = resolveProxy(url, options.environment, runCommand);
  if (proxy) {
    console.log('[RtkRuntime] Downloading through the configured proxy.');
    downloadWithCurl(url, destination, proxy, runCommand);
    return;
  }
  try {
    const response = await (options.fetchImplementation ?? fetch)(url, {
      headers: { 'User-Agent': 'ZhiYuanAgent/rtk-runtime-downloader' },
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
    if (process.platform === 'win32') {
      const systemTar = spawnSync('tar', ['-xf', archivePath, '-C', destination], {
        timeout: 120_000,
        windowsHide: true,
      });
      if (systemTar.status === 0) return;
    }
    await extractZip(archivePath, { dir: destination });
    return;
  }
  if (archivePath.endsWith('.tar.gz')) {
    await tar.x({ file: archivePath, cwd: destination });
    return;
  }
  throw new Error(`Unsupported RTK runtime archive: ${archivePath}.`);
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
    buildInfo?.target === targetId &&
    buildInfo?.version === config.version &&
    buildInfo?.repo === config.repo &&
    buildInfo?.sourceRevision === config.sourceRevision &&
    buildInfo?.assetName === assetName &&
    buildInfo?.checksum === checksum
  );
}

function replaceDirectoryAtomically(stagedDirectory, targetDirectory) {
  const backupDirectory = path.join(
    path.dirname(targetDirectory),
    `.${path.basename(targetDirectory)}.backup-${crypto.randomUUID()}`,
  );
  const hadTarget = fs.existsSync(targetDirectory);
  try {
    if (hadTarget) fs.renameSync(targetDirectory, backupDirectory);
    fs.renameSync(stagedDirectory, targetDirectory);
  } catch (error) {
    if (fs.existsSync(targetDirectory))
      fs.rmSync(targetDirectory, { recursive: true, force: true });
    if (hadTarget && fs.existsSync(backupDirectory)) {
      fs.renameSync(backupDirectory, targetDirectory);
    }
    throw error;
  }
  if (hadTarget) fs.rmSync(backupDirectory, { recursive: true, force: true });
}

function verifyExecutable(executablePath, expectedVersion) {
  const result = spawnSync(executablePath, ['--version'], {
    encoding: 'utf8',
    timeout: 10_000,
    windowsHide: true,
  });
  if (result.error || result.status !== 0) {
    throw new Error(`RTK runtime failed its version smoke test for ${expectedVersion}.`);
  }
  const output = `${result.stdout || ''}\n${result.stderr || ''}`;
  if (!output.includes(expectedVersion.replace(/^v/, ''))) {
    throw new Error(`RTK runtime reported an unexpected version: ${output.trim()}.`);
  }
}

async function ensureRtkRuntime(rootDir, targetId, options = {}) {
  const config = options.config ?? readRuntimeConfig(rootDir);
  const assetName = config.runtimeAssets?.[targetId];
  const checksum = config.runtimeChecksums?.[targetId];
  if (!assetName || !checksum) throw new Error(`Unsupported RTK runtime target: ${targetId}.`);
  if (!/^[a-f0-9]{64}$/i.test(checksum)) {
    throw new Error(`RTK runtime checksum is not finalized for ${targetId}.`);
  }

  const executableName = targetId.startsWith('win-') ? 'rtk.exe' : 'rtk';
  const runtimeRoot = path.join(rootDir, 'vendor', 'rtk-runtime');
  const targetDirectory = path.join(runtimeRoot, targetId);
  const targetExecutable = path.join(targetDirectory, executableName);
  const buildInfo = readBuildInfo(path.join(targetDirectory, 'runtime-build-info.json'));
  fs.mkdirSync(runtimeRoot, { recursive: true });

  if (
    !fs.existsSync(targetExecutable) ||
    !runtimeMatchesConfig(buildInfo, config, targetId, assetName, checksum)
  ) {
    const temporaryDirectory = fs.mkdtempSync(
      path.join(options.temporaryRoot ?? os.tmpdir(), 'zhiyuan-rtk-'),
    );
    const stagedDirectory = fs.mkdtempSync(path.join(runtimeRoot, `.${targetId}.staging-`));
    try {
      const archivePath = path.join(temporaryDirectory, assetName);
      const extractDirectory = path.join(temporaryDirectory, 'extract');
      fs.mkdirSync(extractDirectory, { recursive: true });
      console.log(`[RtkRuntime] Downloading and verifying ${assetName}.`);
      await (options.downloadRuntime ?? download)(
        `https://github.com/${config.repo}/releases/download/${config.version}/${assetName}`,
        archivePath,
      );
      if (sha256(archivePath) !== checksum)
        throw new Error(`RTK runtime checksum mismatch for ${assetName}.`);
      await (options.extractRuntime ?? extract)(archivePath, extractDirectory);
      const sourceExecutable = findExecutable(extractDirectory, executableName);
      if (!sourceExecutable) throw new Error(`Archive does not contain ${executableName}.`);
      const stagedExecutable = path.join(stagedDirectory, executableName);
      fs.copyFileSync(sourceExecutable, stagedExecutable);
      if (!targetId.startsWith('win-')) fs.chmodSync(stagedExecutable, 0o755);
      await (options.verifyRuntime ?? verifyExecutable)(stagedExecutable, config.version);
      fs.copyFileSync(
        path.join(rootDir, 'third_party', 'rtk.LICENSE'),
        path.join(stagedDirectory, 'LICENSE'),
      );
      fs.writeFileSync(
        path.join(stagedDirectory, 'runtime-build-info.json'),
        `${JSON.stringify({ schemaVersion: 1, target: targetId, version: config.version, repo: config.repo, sourceRevision: config.sourceRevision, assetName, checksum }, null, 2)}\n`,
      );
      replaceDirectoryAtomically(stagedDirectory, targetDirectory);
    } catch (error) {
      fs.rmSync(stagedDirectory, { recursive: true, force: true });
      throw error;
    } finally {
      fs.rmSync(temporaryDirectory, { recursive: true, force: true });
    }
  }

  const stagedCurrent = fs.mkdtempSync(path.join(runtimeRoot, '.current.staging-'));
  try {
    fs.cpSync(targetDirectory, stagedCurrent, { recursive: true });
    replaceDirectoryAtomically(stagedCurrent, path.join(runtimeRoot, 'current'));
  } catch (error) {
    fs.rmSync(stagedCurrent, { recursive: true, force: true });
    throw error;
  }
  return targetDirectory;
}

async function main() {
  const targetId = process.argv[2]?.trim() || resolveHostTargetId();
  await ensureRtkRuntime(path.resolve(__dirname, '..'), targetId);
  console.log(`[RtkRuntime] Runtime ready for ${targetId}.`);
}

if (require.main === module) {
  main().catch(error => {
    console.error(`[RtkRuntime] ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
}

module.exports = { ensureRtkRuntime, readRuntimeConfig, resolveHostTargetId, runtimeMatchesConfig };
