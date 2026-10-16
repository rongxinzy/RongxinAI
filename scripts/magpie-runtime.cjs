'use strict';

// Build/packaging helpers only. Application startup never downloads a runtime.
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const upstream = require('../resources/magpie/upstream.json');

const TARGETS = Object.freeze({
  'linux-x64': { platform: 'linux', arch: 'x64', goos: 'linux', goarch: 'amd64' },
  'linux-arm64': { platform: 'linux', arch: 'arm64', goos: 'linux', goarch: 'arm64' },
  'darwin-x64': { platform: 'darwin', arch: 'x64', goos: 'darwin', goarch: 'amd64' },
  'darwin-arm64': { platform: 'darwin', arch: 'arm64', goos: 'darwin', goarch: 'arm64' },
  'win32-x64': { platform: 'win32', arch: 'x64', goos: 'windows', goarch: 'amd64' },
  'win32-arm64': { platform: 'win32', arch: 'arm64', goos: 'windows', goarch: 'arm64' },
});

function targetFor(key) {
  if (!Object.hasOwn(TARGETS, key)) throw new Error(`Unsupported Magpie target: ${key}`);
  return TARGETS[key];
}

function binaryName(key) {
  return targetFor(key).platform === 'win32' ? 'magpie.exe' : 'magpie';
}

function sha256File(filename) {
  return crypto.createHash('sha256').update(fs.readFileSync(filename)).digest('hex');
}

function readRegularFile(filename) {
  if (!fs.lstatSync(filename).isFile()) throw new Error(`Expected a regular file: ${filename}`);
  return fs.readFileSync(filename);
}

function verifyRuntime(root, key, { allowSigned = false } = {}) {
  const target = targetFor(key);
  const directory = path.join(root, key);
  let manifest;
  try {
    if (!fs.lstatSync(directory).isDirectory()) throw new Error('Not a directory');
    manifest = JSON.parse(readRegularFile(path.join(directory, 'manifest.json')).toString('utf8'));
    const expectedBinary = binaryName(key);
    const expected = {
      schemaVersion: 1,
      platform: target.platform,
      arch: target.arch,
      binary: expectedBinary,
      version: upstream.version,
    };
    for (const [name, value] of Object.entries(expected)) {
      if (manifest[name] !== value) throw new Error(`Invalid manifest ${name}`);
    }
    if (
      manifest.source?.commit !== upstream.commit ||
      manifest.source?.archiveSha256 !== upstream.archiveSha256 ||
      manifest.source?.tree !== upstream.tree ||
      manifest.toolchain?.version !== upstream.goVersion ||
      manifest.build?.version !== upstream.version ||
      manifest.build?.cgoEnabled !== false ||
      manifest.build?.tags !== 'nogui' ||
      !/^[a-f0-9]{64}$/.test(manifest.sha256) ||
      !/^[a-f0-9]{64}$/.test(manifest.buildSha256)
    ) {
      throw new Error('Manifest does not match the pinned upstream build');
    }
    if (!allowSigned && manifest.sha256 !== manifest.buildSha256) {
      throw new Error('Expected the unmodified compiler output before packaging');
    }
    const binary = readRegularFile(path.join(directory, expectedBinary));
    if (crypto.createHash('sha256').update(binary).digest('hex') !== manifest.sha256) {
      throw new Error('Binary SHA-256 mismatch');
    }
    if (binary.length !== manifest.sizeBytes) throw new Error('Binary size mismatch');
    if (
      manifest.license?.sha256 !== upstream.licenseSha256 ||
      crypto
        .createHash('sha256')
        .update(readRegularFile(path.join(directory, 'LICENSE')))
        .digest('hex') !== upstream.licenseSha256
    ) {
      throw new Error('Upstream MIT license is missing or modified');
    }
    if (
      target.platform !== 'win32' &&
      !(fs.statSync(path.join(directory, expectedBinary)).mode & 0o111)
    ) {
      throw new Error('Binary is not executable');
    }
    return manifest;
  } catch (error) {
    throw new Error(
      `Magpie ${key} is unavailable or invalid: ${error.message}. ` +
        `Run bun run magpie:build -- --target ${key} with the pinned Go toolchain before packaging.`,
      { cause: error },
    );
  }
}

function contextTargets(context) {
  // electron-builder's Arch enum. Do not substitute the build host's architecture.
  const arch =
    typeof context.arch === 'string'
      ? context.arch
      : { 1: 'x64', 3: 'arm64', 4: 'universal' }[context.arch];
  const platform = context.electronPlatformName;
  if (platform === 'darwin' && ['x64', 'arm64', 'universal'].includes(arch)) {
    return ['darwin-x64', 'darwin-arm64'];
  }
  const key = `${platform}-${arch}`;
  targetFor(key);
  return [key];
}

function configureMagpieResources(context) {
  const root = path.join(context.packager.projectDir, 'resources', 'magpie');
  const targets = contextTargets(context);
  for (const key of targets) verifyRuntime(root, key);
  const config = context.packager.config;
  // All macOS .apps keep both helpers, so universal merging sees identical
  // resources and never rewrites a pinned binary with lipo. The running
  // Electron process selects its own architecture at startup.
  const resources = (config.extraResources || []).filter(resource => {
    return !(typeof resource === 'object' && /^magpie(?:\/|$)/.test(resource.to || ''));
  });
  config.extraResources = [
    ...resources,
    { from: 'resources/magpie/upstream.json', to: 'magpie/upstream.json' },
    ...targets.map(key => ({
      from: `resources/magpie/${key}`,
      to: `magpie/${key}`,
      filter: [binaryName(key), 'manifest.json', 'LICENSE'],
    })),
  ];
}

function packagedRoot(context) {
  return context.electronPlatformName === 'darwin'
    ? path.join(
        context.appOutDir,
        `${context.packager.appInfo.productFilename}.app`,
        'Contents',
        'Resources',
        'magpie',
      )
    : path.join(context.appOutDir, 'resources', 'magpie');
}

function verifyPackagedMagpie(context) {
  const root = packagedRoot(context);
  for (const key of contextTargets(context)) verifyRuntime(root, key, { allowSigned: true });
}

function certumThumbprint(env) {
  return (env.CERTUM_CERT_THUMBPRINT || '').replace(/[^0-9a-f]/gi, '').toUpperCase();
}

function signPackagedWindowsMagpie(context, deps = {}) {
  if (context.electronPlatformName !== 'win32') return;
  const spawn = deps.spawn || spawnSync;
  const env = deps.env || process.env;
  const root = packagedRoot(context);
  const signingEnabled = /^[0-9A-F]{40}$/.test(certumThumbprint(env));
  const script = path.join(__dirname, 'runtime-signing', 'sign-runtime.ps1');
  for (const key of contextTargets(context)) {
    const directory = path.join(root, key);
    const binary = path.join(directory, binaryName(key));
    const manifestPath = path.join(directory, 'manifest.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const before = sha256File(binary);
    if (before === manifest.sha256 && before === manifest.buildSha256) {
      if (!signingEnabled) {
        verifyRuntime(root, key);
        continue;
      }
      // extraResources live outside electron-builder's Windows sign walk
      // (app.asar.unpacked and swiftshader). Sign with the same Certum
      // signtool script the release environment already uses.
      const result = spawn(
        'powershell.exe',
        ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, '-Path', binary],
        { stdio: 'inherit', windowsHide: true, env },
      );
      if (result.error) throw result.error;
      if (result.status !== 0) {
        throw new Error(`Magpie Authenticode signing failed with exit code ${result.status}`);
      }
    } else if (!signingEnabled) {
      throw new Error('Magpie binary changed before Windows signing');
    }
    const sha256 = sha256File(binary);
    if (sha256 === manifest.buildSha256) {
      throw new Error('Windows signing left the Magpie compiler bytes unchanged');
    }
    const signed = {
      ...manifest,
      sha256,
      sizeBytes: fs.statSync(binary).size,
      signing: { platform: 'win32', format: 'authenticode' },
    };
    fs.writeFileSync(manifestPath, `${JSON.stringify(signed, null, 2)}\n`);
    verifyRuntime(root, key, { allowSigned: true });
  }
}

module.exports = {
  TARGETS,
  upstream,
  targetFor,
  binaryName,
  sha256File,
  verifyRuntime,
  contextTargets,
  configureMagpieResources,
  verifyPackagedMagpie,
  signPackagedWindowsMagpie,
};
