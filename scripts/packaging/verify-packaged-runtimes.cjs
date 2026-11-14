'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const { verifyPackagedMagpie } = require('../magpie-runtime.cjs');
const { verifyPackagedNodePty } = require('./verify-packaged-native-modules.cjs');
const { retiredRuntimeArtifact } = require('./retired-runtime-policy.cjs');

const retiredRuntimeSegment = ['open', 'claw'].join('');
const retiredMindSegment = ['cf', 'mind'].join('');
const RETIRED_RUNTIME_IN_PATH = new RegExp(
  `(?:^|[/\\\\])\\\\.${retiredRuntimeSegment}(?:[/\\\\]|$)|(?:^|[/\\\\])(?:${retiredRuntimeSegment}|${retiredMindSegment})(?:[/\\\\]|$)`,
  'i',
);

function sha256File(filePath) {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('hex');
}

function resolveTargetArch(context) {
  if (context?.arch === 3) return 'arm64';
  if (context?.arch === 0) return 'ia32';
  if (context?.arch === 1) return 'x64';
  throw new Error(`[PackagedRuntimeVerify] Unknown packaging arch: ${String(context?.arch)}`);
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

function verifyPackagedLlamaCppBundled(context) {
  const edition = (process.env.ZHIYUAN_UPDATE_VARIANT || 'lite').trim().toLowerCase();
  if (edition === 'lite') {
    const bundledRoot = path.join(packagedResourcesRoot(context), 'llamacpp-bundled');
    if (fs.existsSync(bundledRoot)) {
      throw new Error(
        '[PackagedRuntimeVerify] Lite edition must not include packaged llamacpp-bundled resources.',
      );
    }
    return;
  }

  if (context.electronPlatformName === 'win32') {
    const {
      verifyWindowsCompressedLlamaCppBundled,
    } = require('./verify-windows-packaged-components.cjs');
    verifyWindowsCompressedLlamaCppBundled(context);
    return;
  }

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
    if (RETIRED_RUNTIME_IN_PATH.test(relativePath) || retiredRuntimeArtifact(relativePath)) {
      throw new Error(
        `[PackagedRuntimeVerify] Packaged artifact contains retired runtime path: ${relativePath}`,
      );
    }
  });
}

function verifyPackagedDeliverables(context) {
  verifyNoRetiredRuntimeArtifacts(context);
  verifyPackagedMagpie(context);
  verifyPackagedLlamaCppBundled(context);
  verifyPackagedNodePty(context);
}

module.exports = {
  verifyPackagedDeliverables,
  verifyPackagedLlamaCppBundled,
  verifyNoRetiredRuntimeArtifacts,
  packagedResourcesRoot,
  resolveTargetArch,
  sha256File,
};
