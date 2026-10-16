'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const { verifyPackagedMagpie } = require('../magpie-runtime.cjs');

const RETIRED_RUNTIME_IN_PATH = /(?:^|[/\\])\.openclaw(?:[/\\]|$)|(?:^|[/\\])(?:openclaw|cfmind)(?:[/\\]|$)/i;

function sha256File(filePath) {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('hex');
}

function resolveTargetArch(context) {
  if (context?.arch === 3) return 'arm64';
  if (context?.arch === 0) return 'ia32';
  if (context?.arch === 1) return 'x64';
  if (process.arch === 'arm64') return 'arm64';
  if (process.arch === 'ia32') return 'ia32';
  return 'x64';
}

function packagedResourcesRoot(context) {
  if (context.electronPlatformName === 'darwin') {
    return path.join(
      context.appOutDir,
      `${context.packager.appInfo.productFilename}.app`,
      'Contents',
      'Resources',
    );
  }
  return path.join(context.appOutDir, 'resources');
}

function verifySha256(relativeLabel, filePath, expectedSha256) {
  if (!expectedSha256) return;
  if (!fs.existsSync(filePath)) {
    throw new Error(`[PackagedRuntimeVerify] Missing ${relativeLabel}: ${filePath}`);
  }
  const actual = sha256File(filePath);
  if (actual.toLowerCase() !== expectedSha256.trim().toLowerCase()) {
    throw new Error(
      `[PackagedRuntimeVerify] ${relativeLabel} SHA-256 mismatch (expected ${expectedSha256}, got ${actual})`,
    );
  }
}

function verifyPackagedChannelRuntime(context) {
  const projectRoot = context.packager.projectDir;
  const packageJson = JSON.parse(
    fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8'),
  );
  const config = packageJson.channelRuntime;
  const platform = context.electronPlatformName;
  const arch = resolveTargetArch(context);
  const targetId = `${platform === 'win32' ? 'win' : platform === 'darwin' ? 'mac' : 'linux'}-${arch}`;
  const binaryName = platform === 'win32' ? 'cc-connect-sidecar.exe' : 'cc-connect-sidecar';
  const expectedChecksum = config?.runtimeChecksums?.[targetId];
  const assetName = config?.runtimeAssets?.[targetId];
  if (!expectedChecksum || !assetName) {
    throw new Error(
      `[PackagedRuntimeVerify] package.json is missing channelRuntime pin for ${targetId}`,
    );
  }

  const runtimeDir = path.join(packagedResourcesRoot(context), 'channel-runtime');
  const binaryPath = path.join(runtimeDir, binaryName);
  const buildInfoPath = path.join(runtimeDir, 'runtime-build-info.json');
  verifySha256(`channel-runtime ${targetId}`, binaryPath, expectedChecksum);

  if (fs.existsSync(buildInfoPath)) {
    const buildInfo = JSON.parse(fs.readFileSync(buildInfoPath, 'utf8'));
    if (
      buildInfo?.schemaVersion !== 1 ||
      buildInfo?.repo !== config?.repo ||
      buildInfo?.version !== config?.version ||
      buildInfo?.sourceRevision !== config?.sourceRevision ||
      buildInfo?.target !== targetId ||
      buildInfo?.assetName !== assetName ||
      buildInfo?.checksum !== expectedChecksum
    ) {
      throw new Error(
        '[PackagedRuntimeVerify] Packaged channel runtime metadata does not match package.json channelRuntime pin.',
      );
    }
  }
}

function verifyPackagedLlamaCppBundled(context) {
  const edition = (process.env.ZHIYUAN_UPDATE_VARIANT || 'lite').trim().toLowerCase();
  if (edition === 'lite') return;

  const bundledRoot = path.join(packagedResourcesRoot(context), 'llamacpp-bundled');
  const manifestPath = path.join(bundledRoot, 'manifest.json');
  if (!fs.existsSync(manifestPath)) {
    throw new Error(
      `[PackagedRuntimeVerify] Missing packaged llama.cpp manifest for ${edition} edition.`,
    );
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const entries = [
    ['executable', 'sha256'],
    ['vulkanExecutable', 'vulkanSha256'],
    ['cpuFallbackExecutable', 'cpuFallbackSha256'],
  ];
  for (const [executableKey, shaKey] of entries) {
    const relative = manifest[executableKey];
    const expected = manifest[shaKey];
    if (typeof relative !== 'string' || !relative) continue;
    verifySha256(`llamacpp ${executableKey}`, path.join(bundledRoot, relative), expected);
  }
}

function walkPackagedTree(relativeDir, absoluteDir, onEntry) {
  for (const entry of fs.readdirSync(absoluteDir, { withFileTypes: true })) {
    const relativePath = path.join(relativeDir, entry.name);
    const absolutePath = path.join(absoluteDir, entry.name);
    onEntry(relativePath, absolutePath, entry);
    if (entry.isDirectory()) {
      walkPackagedTree(relativePath, absolutePath, onEntry);
    }
  }
}

function verifyNoRetiredRuntimeArtifacts(context) {
  const root = context.appOutDir;
  if (!fs.existsSync(root)) return;
  walkPackagedTree('', root, relativePath => {
    if (RETIRED_RUNTIME_IN_PATH.test(relativePath)) {
      throw new Error(
        `[PackagedRuntimeVerify] Packaged artifact contains retired runtime path: ${relativePath}`,
      );
    }
  });
}

function verifyPackagedDeliverables(context) {
  verifyNoRetiredRuntimeArtifacts(context);
  verifyPackagedChannelRuntime(context);
  verifyPackagedMagpie(context);
  verifyPackagedLlamaCppBundled(context);
}

module.exports = {
  verifyPackagedDeliverables,
  verifyPackagedChannelRuntime,
  verifyPackagedLlamaCppBundled,
  verifyNoRetiredRuntimeArtifacts,
  packagedResourcesRoot,
  sha256File,
};
