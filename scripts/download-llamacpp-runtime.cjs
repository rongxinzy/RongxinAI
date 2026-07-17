'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const extractZip = require('extract-zip');
const tar = require('tar');

const DEFAULT_LLAMACPP_RUNTIME_GITHUB_REPO = 'ggml-org/llama.cpp';
const DEFAULT_LLAMACPP_RUNTIME_RELEASE_TAG = 'b9505';
const DEFAULT_LLAMACPP_RUNTIME_RELEASES_URL = 'https://rongxinai.krli.org/llamacpp';
const OfficialAssetByTarget = {
  'mac-arm64': 'llama-{tag}-bin-macos-arm64.tar.gz',
  'mac-x64': 'llama-{tag}-bin-macos-x64.tar.gz',
  'win-x64': 'llama-{tag}-bin-win-cpu-x64.tar.gz',
  'win-x64-cuda-12': 'llama-{tag}-bin-win-cuda-12.4-x64.tar.gz',
  'win-arm64': 'llama-{tag}-bin-win-cpu-arm64.tar.gz',
  'linux-x64': 'llama-{tag}-bin-ubuntu-x64.tar.gz',
  'linux-arm64': 'llama-{tag}-bin-ubuntu-arm64.tar.gz',
};
const CompanionAssetsByTarget = {
  'win-x64-cuda-12': ['cudart-llama-bin-win-cuda-12.4-x64.tar.gz'],
};

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

function readPackageJson(rootDir) {
  try {
    return JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));
  } catch {
    return null;
  }
}

function resolveGitHubRepo(env = process.env) {
  const envRepo = env.LLAMACPP_RUNTIME_GITHUB_REPO?.trim();
  if (envRepo) return envRepo.replace(/^https:\/\/github\.com\//, '').replace(/\.git$/, '');

  const packageJson = readPackageJson(path.resolve(__dirname, '..'));
  const packageRepo = packageJson?.llamacpp?.runtimeRepo;
  if (typeof packageRepo === 'string' && packageRepo.trim()) {
    return packageRepo
      .trim()
      .replace(/^https:\/\/github\.com\//, '')
      .replace(/\.git$/, '');
  }

  return DEFAULT_LLAMACPP_RUNTIME_GITHUB_REPO;
}

function resolveRuntimeReleaseTag(rootDir, env = process.env) {
  const explicitTag = env.LLAMACPP_RUNTIME_RELEASE_TAG?.trim();
  if (explicitTag) {
    return explicitTag;
  }

  const packageJson = readPackageJson(rootDir);
  const packageTag = packageJson?.llamacpp?.runtimeReleaseTag;
  if (typeof packageTag === 'string' && packageTag.trim()) {
    return packageTag.trim();
  }

  return DEFAULT_LLAMACPP_RUNTIME_RELEASE_TAG;
}

function resolveOfficialRuntimeAssetName(targetId, env = process.env) {
  const rootDir = path.resolve(__dirname, '..');
  const overridePrefix = env.LLAMACPP_RUNTIME_ASSET_PREFIX?.trim();
  const releaseTag = resolveRuntimeReleaseTag(rootDir, env);
  const packageJson = readPackageJson(rootDir);
  const configuredAssetTemplate = packageJson?.llamacpp?.runtimeAssets?.[targetId];
  if (typeof configuredAssetTemplate === 'string' && configuredAssetTemplate.trim()) {
    return configuredAssetTemplate.trim().replace(/\{tag\}/g, releaseTag);
  }

  const assetTemplate = OfficialAssetByTarget[targetId];
  if (!assetTemplate) {
    throw new Error(`Unsupported prebuilt llama.cpp runtime target: ${targetId}`);
  }
  const assetName = assetTemplate.replace(/\{tag\}/g, releaseTag);

  if (!overridePrefix) return assetName;
  return assetName.replace(/^llama-[^-]+-bin/, overridePrefix);
}

function resolveOfficialRuntimeCompanionAssetNames(targetId, env = process.env) {
  const rootDir = path.resolve(__dirname, '..');
  const releaseTag = resolveRuntimeReleaseTag(rootDir, env);
  const packageJson = readPackageJson(rootDir);
  const configuredTemplates = packageJson?.llamacpp?.runtimeCompanionAssets?.[targetId];
  const templates = Array.isArray(configuredTemplates)
    ? configuredTemplates
    : (CompanionAssetsByTarget[targetId] ?? []);
  return templates
    .filter(template => typeof template === 'string' && template.trim())
    .map(template => template.trim().replace(/\{tag\}/g, releaseTag));
}

function resolveArchiveExtension(archiveName) {
  if (archiveName.endsWith('.tar.gz')) return '.tar.gz';
  if (archiveName.endsWith('.zip')) return '.zip';
  throw new Error(`Unsupported runtime archive format: ${archiveName}`);
}

function resolveRuntimeDownloadSource(targetId, options = {}) {
  return resolveRuntimeDownloadSources(targetId, options)[0];
}

function resolveRuntimeDownloadSources(targetId, options = {}) {
  const env = options.env ?? process.env;
  const rootDir = options.rootDir ?? path.resolve(__dirname, '..');
  const assetName = resolveOfficialRuntimeAssetName(targetId, env);
  return resolveAssetDownloadSources(targetId, assetName, options);
}

function resolveRuntimeCompanionDownloadSources(targetId, options = {}) {
  return resolveOfficialRuntimeCompanionAssetNames(targetId, options.env ?? process.env).map(
    assetName => ({
      assetName,
      urls: resolveAssetDownloadSources(targetId, assetName, options),
    }),
  );
}

function resolveAssetDownloadSources(targetId, assetName, options = {}) {
  const env = options.env ?? process.env;
  const rootDir = options.rootDir ?? path.resolve(__dirname, '..');

  const explicitUrl = env.LLAMACPP_RUNTIME_URL?.trim();
  if (explicitUrl) {
    return [explicitUrl.replace(/\{target\}/g, targetId).replace(/\{asset\}/g, assetName)];
  }

  const baseUrl = env.LLAMACPP_RUNTIME_BASE_URL?.trim();
  if (baseUrl) {
    return [`${baseUrl.replace(/\/$/, '')}/${assetName}`];
  }

  const repo = resolveGitHubRepo(env);
  const releaseTag = resolveRuntimeReleaseTag(rootDir, env);
  return [
    `${DEFAULT_LLAMACPP_RUNTIME_RELEASES_URL}/${releaseTag}/${assetName}`,
    `https://github.com/${repo}/releases/download/${releaseTag}/${assetName}`,
  ];
}

function formatDownloadFailureMessage(status, statusText, url, targetId, rootDir) {
  if (status === 404 && url.includes('github.com/')) {
    const repo = resolveGitHubRepo();
    const releaseTag = resolveRuntimeReleaseTag(rootDir);
    const assetName = resolveOfficialRuntimeAssetName(targetId);
    const acquisitionHint =
      targetId === 'win-x64-cuda-12'
        ? 'Set LLAMACPP_RUNTIME_URL / LLAMACPP_RUNTIME_BASE_URL if you want to use a mirror, or use npm run llamacpp:runtime:download:win-x64-cuda-12.'
        : `Set LLAMACPP_RUNTIME_URL / LLAMACPP_RUNTIME_BASE_URL if you want to use a mirror, or build locally with npm run llamacpp:runtime:${targetId}.`;
    return [
      `Download failed: HTTP ${status} ${statusText}.`,
      `${url} does not exist.`,
      `The default downloader expects the published upstream llama.cpp asset ${assetName} from ${repo}@${releaseTag}.`,
      acquisitionHint,
    ].join(' ');
  }

  return `Download failed: HTTP ${status} ${statusText}`;
}

async function downloadFile(url, outputPath, rootDir, targetId) {
  console.log(`[download-llamacpp-runtime] Downloading ${url}`);
  const response = await fetch(url, {
    headers: { 'User-Agent': 'ZhiYuanAgent/llamacpp-runtime-downloader' },
  });
  if (!response.ok || !response.body) {
    throw new Error(
      formatDownloadFailureMessage(response.status, response.statusText, url, targetId, rootDir),
    );
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
    file.end(error => (error ? reject(error) : resolve()));
  });
  if (total > 0) process.stdout.write('\n');
  return url;
}

async function downloadFileWithFallback(urls, outputPath, rootDir, targetId) {
  const errors = [];
  for (const url of urls) {
    try {
      return await downloadFile(url, outputPath, rootDir, targetId);
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }
  throw new Error(errors.join('; '));
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
    const urls = resolveRuntimeDownloadSources(targetId, { rootDir });
    const url = urls[0];
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'llamacpp-runtime-'));
    const archiveName =
      path.basename(new URL(url).pathname) || resolveOfficialRuntimeAssetName(targetId);
    const archivePath = path.join(tempDir, archiveName);
    const extractDir = path.join(tempDir, 'extract');
    const sourceUrl = await downloadFileWithFallback(urls, archivePath, rootDir, targetId);
    fs.mkdirSync(extractDir, { recursive: true });
    await extractArchive(archivePath, extractDir);
    fs.rmSync(targetRuntimeDir, { recursive: true, force: true });
    installNormalizedRuntime({
      extractDir,
      targetRuntimeDir,
      targetId,
      executableName,
      rootDir,
      sourceUrl,
      assetName: archiveName,
    });
    fs.rmSync(tempDir, { recursive: true, force: true });
  }

  if (!fs.existsSync(targetExecutable)) {
    throw new Error(`Downloaded runtime is missing ${path.join('bin', executableName)}.`);
  }

  const sync = spawnSync(
    process.execPath,
    [path.join(rootDir, 'scripts', 'sync-llamacpp-runtime-current.cjs'), targetId],
    {
      cwd: rootDir,
      stdio: 'inherit',
    },
  );
  if (sync.status !== 0) process.exit(sync.status || 1);
}

async function extractArchive(archivePath, extractDir) {
  const extension = resolveArchiveExtension(archivePath);
  if (extension === '.tar.gz') {
    await tar.x({
      file: archivePath,
      cwd: extractDir,
    });
    return;
  }
  await extractZip(archivePath, { dir: extractDir });
}

function installNormalizedRuntime(options) {
  const { extractDir, targetRuntimeDir, targetId, executableName, rootDir, sourceUrl, assetName } =
    options;
  const executablePath = findExecutablePath(extractDir, executableName);
  if (!executablePath) {
    throw new Error(`Downloaded runtime archive does not contain ${executableName}.`);
  }

  const executableDir = path.dirname(executablePath);
  const targetBinDir = path.join(targetRuntimeDir, 'bin');
  fs.mkdirSync(targetBinDir, { recursive: true });
  copyDirectoryContents(executableDir, targetBinDir);
  for (const companion of resolveRuntimeCompanionDownloadSources(targetId, { rootDir })) {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'llamacpp-runtime-companion-'));
    try {
      const archivePath = path.join(tempDir, companion.assetName);
      const extractDir = path.join(tempDir, 'extract');
      downloadFileWithFallbackSync(companion.urls, archivePath, rootDir, targetId);
      fs.mkdirSync(extractDir, { recursive: true });
      extractArchiveSync(archivePath, extractDir);
      copyDirectoryContents(findRuntimePayloadDirectory(extractDir), targetBinDir);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  }
  writeRuntimeBuildInfo(targetRuntimeDir, {
    target: targetId,
    version: resolveRuntimeReleaseTag(rootDir),
    sourceUrl,
    assetName,
  });
}

function downloadFileWithFallbackSync(urls, outputPath, rootDir, targetId) {
  const result = spawnSync(
    process.execPath,
    [__filename, '--download-one', JSON.stringify({ urls, outputPath, rootDir, targetId })],
    {
      cwd: path.resolve(__dirname, '..'),
      stdio: 'inherit',
    },
  );
  if (result.status !== 0) {
    throw new Error(`Failed to download companion runtime asset: ${path.basename(outputPath)}`);
  }
}

function extractArchiveSync(archivePath, extractDir) {
  const result = spawnSync(
    process.execPath,
    [
      '-e',
      [
        "const extractZip=require('extract-zip');",
        "const tar=require('tar');",
        'const [archive,dir]=process.argv.slice(1);',
        '(async()=>{',
        "if(archive.endsWith('.zip')) await extractZip(archive,{dir});",
        "else if(archive.endsWith('.tar.gz')) await tar.x({file:archive,cwd:dir});",
        "else throw new Error('Unsupported archive '+archive);",
        '})().catch(e=>{console.error(e.message);process.exit(1);});',
      ].join(''),
      archivePath,
      extractDir,
    ],
    {
      cwd: path.resolve(__dirname, '..'),
      stdio: 'inherit',
    },
  );
  if (result.status !== 0) {
    throw new Error(`Failed to extract companion runtime asset: ${path.basename(archivePath)}`);
  }
}

function copyDirectoryContents(sourceDir, targetDir) {
  for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
    const sourcePath = path.join(sourceDir, entry.name);
    const targetPath = path.join(targetDir, entry.name);
    if (entry.isDirectory()) {
      fs.mkdirSync(targetPath, { recursive: true });
      copyDirectoryContents(sourcePath, targetPath);
      continue;
    }
    fs.copyFileSync(sourcePath, targetPath);
  }
}

function findExecutablePath(rootDir, executableName) {
  const queue = [rootDir];
  while (queue.length > 0) {
    const currentDir = queue.shift();
    if (!currentDir) continue;
    const directExecutable = path.join(currentDir, executableName);
    if (fs.existsSync(directExecutable)) return directExecutable;
    for (const entry of fs.readdirSync(currentDir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        queue.push(path.join(currentDir, entry.name));
      }
    }
  }
  return null;
}

function findRuntimePayloadDirectory(rootDir) {
  const queue = [rootDir];
  let fallback = null;
  while (queue.length > 0) {
    const currentDir = queue.shift();
    if (!currentDir) continue;
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

function writeRuntimeBuildInfo(runtimeDir, details) {
  const buildInfo = {
    target: details.target,
    version: details.version,
    source: 'official-release',
    sourceUrl: details.sourceUrl,
    assetName: details.assetName,
    downloadedAt: new Date().toISOString(),
  };
  fs.writeFileSync(
    path.join(runtimeDir, 'runtime-build-info.json'),
    JSON.stringify(buildInfo, null, 2) + '\n',
    'utf8',
  );
}

function validateRuntimeTarget(runtimeDir, targetId) {
  const buildInfoPath = path.join(runtimeDir, 'runtime-build-info.json');
  if (!fs.existsSync(buildInfoPath)) return;
  try {
    const buildInfo = JSON.parse(fs.readFileSync(buildInfoPath, 'utf8'));
    if (buildInfo && typeof buildInfo.target === 'string' && buildInfo.target !== targetId) {
      throw new Error(
        `Downloaded runtime target mismatch: expected ${targetId}, got ${buildInfo.target}.`,
      );
    }
  } catch (error) {
    throw new Error(
      `Failed to validate runtime-build-info.json: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

if (require.main === module && process.argv[2] === '--download-one') {
  const payload = JSON.parse(process.argv[3] || '{}');
  downloadFileWithFallback(
    payload.urls,
    payload.outputPath,
    payload.rootDir,
    payload.targetId,
  ).catch(error => {
    console.error(
      `[download-llamacpp-runtime] ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exit(1);
  });
} else if (require.main === module) {
  main().catch(error => {
    console.error(
      `[download-llamacpp-runtime] ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exit(1);
  });
}

module.exports = {
  formatDownloadFailureMessage,
  resolveArchiveExtension,
  resolveExecutableName,
  resolveGitHubRepo,
  resolveHostTargetId,
  resolveOfficialRuntimeAssetName,
  resolveOfficialRuntimeCompanionAssetNames,
  resolveRuntimeDownloadSource,
  resolveRuntimeDownloadSources,
  resolveRuntimeCompanionDownloadSources,
  resolveRuntimeReleaseTag,
};
