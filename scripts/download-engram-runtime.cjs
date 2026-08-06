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

const http = require('http');
const https = require('https');

function downloadWithAgent(url, destination, proxyUrl) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const isProxy = Boolean(proxyUrl);
    const requestUrl = isProxy ? new URL(proxyUrl) : target;
    const requestPath = isProxy ? url : target.pathname + target.search;
    const module = requestUrl.protocol === 'http:' ? http : https;
    const headers = {
      Host: target.host,
      'User-Agent': 'ZhiYuanAgent/memory-runtime-downloader',
    };
    if (isProxy && requestUrl.username) {
      headers['Proxy-Authorization'] =
        'Basic ' +
        Buffer.from(
          `${decodeURIComponent(requestUrl.username)}:${decodeURIComponent(requestUrl.password)}`,
        ).toString('base64');
    }
    const request = module.get(
      {
        hostname: requestUrl.hostname,
        port: requestUrl.port || (requestUrl.protocol === 'http:' ? 80 : 443),
        path: requestPath,
        headers,
        timeout: 60_000,
      },
      response => {
        if (response.statusCode === 200) {
          response.pipe(fs.createWriteStream(destination));
          response.on('end', resolve);
          response.on('error', reject);
        } else if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
          // Follow a single redirect (GitHub release URLs redirect to objects.githubusercontent.com).
          const nextUrl = new URL(response.headers.location, url).toString();
          reject(new Error(`Redirect to ${nextUrl} is not supported in proxy mode.`));
        } else {
          response.resume();
          reject(new Error(`Download failed with HTTP ${response.statusCode}.`));
        }
      },
    );
    request.on('timeout', () => request.destroy(new Error('Download timed out.')));
    request.on('error', reject);
  });
}

async function download(url, destination) {
  // npm_config_proxy / HTTPS_PROXY are commonly configured in corporate or
  // restricted environments; honor them so the runtime can be fetched.
  const proxy =
    process.env.npm_config_https_proxy ||
    process.env.npm_config_proxy ||
    process.env.HTTPS_PROXY ||
    process.env.https_proxy ||
    process.env.HTTP_PROXY ||
    process.env.http_proxy;
  if (proxy) {
    await downloadWithAgent(url, destination, proxy);
    return;
  }
  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': 'ZhiYuanAgent/memory-runtime-downloader' },
    });
    if (!response.ok) throw new Error(`Download failed with HTTP ${response.status}.`);
    fs.writeFileSync(destination, Buffer.from(await response.arrayBuffer()));
  } catch (error) {
    // Node's fetch can fail on flaky or restricted networks (TLS, connection
    // resets, no fallback to keep-alive sockets). curl has a more robust
    // network stack and retries — fall back to it before failing.
    const { spawnSync } = require('child_process');
    const curlArgs = ['-L', '--fail', '--retry', '3', '--retry-all-errors', '-o', destination, url];
    if (process.env.npm_config_proxy) curlArgs.push('--proxy', process.env.npm_config_proxy);
    const result = spawnSync('curl', curlArgs, { stdio: 'inherit', timeout: 240_000 });
    if (result.status !== 0) {
      throw new Error(`Download failed (fetch: ${error.message}; curl exited ${result.status}).`);
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
