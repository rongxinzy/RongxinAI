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
    if (manifest.signing !== undefined) {
      const expectedFormat =
        target.platform === 'win32'
          ? 'authenticode'
          : target.platform === 'darwin'
            ? 'codesign'
            : null;
      if (
        !allowSigned ||
        !expectedFormat ||
        typeof manifest.signing !== 'object' ||
        manifest.signing === null ||
        manifest.signing.platform !== target.platform ||
        manifest.signing.format !== expectedFormat ||
        manifest.sha256 === manifest.buildSha256
      ) {
        throw new Error('Invalid or unexpected Magpie signing metadata');
      }
    }
    if (manifest.sha256 !== manifest.buildSha256 && !manifest.signing) {
      throw new Error('Signed Magpie binary is missing manifest signing metadata');
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
  if (platform === 'darwin') {
    if (arch === 'universal' || arch === 4) {
      return ['darwin-x64', 'darwin-arm64'];
    }
    if (arch === 'x64' || arch === 1) {
      return ['darwin-x64'];
    }
    if (arch === 'arm64' || arch === 3) {
      return ['darwin-arm64'];
    }
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
  // Per-arch macOS .apps ship only their own helper; a universal .app keeps
  // both, so universal merging sees identical resources and never rewrites a
  // pinned binary with lipo (x64ArchFiles). The running Electron process
  // selects its own architecture at startup.
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

// electron-builder runs under pwsh on CI, and Windows PowerShell 5.1 inherits
// PowerShell 7's PSModulePath. It then cannot load its own
// Microsoft.PowerShell.Security module, so the Cert: drive the signing script
// needs does not exist. Let powershell.exe rebuild its default module path.
function windowsPowerShellEnv(env) {
  return Object.fromEntries(
    Object.entries(env).filter(([name]) => name.toLowerCase() !== 'psmodulepath'),
  );
}

function verifyWindowsAuthenticodeSignature(binary, thumbprint, env, spawn = spawnSync) {
  const command = [
    "$ErrorActionPreference = 'Stop'",
    "Import-Module (Join-Path $PSHOME 'Modules\\Microsoft.PowerShell.Security\\Microsoft.PowerShell.Security.psd1') -ErrorAction Stop",
    '$s = Get-AuthenticodeSignature -LiteralPath $env:ZHIYUAN_MAGPIE_BIN',
    'if ($null -eq $s -or $s.Status -ne "Valid" -or $null -eq $s.TimeStamperCertificate -or $null -eq $s.SignerCertificate) {',
    '  throw "Magpie Authenticode signature is invalid: $($s.Status)"',
    '}',
    'if ($s.SignerCertificate.Thumbprint.ToUpperInvariant() -ne $env:ZHIYUAN_EXPECTED_THUMBPRINT) {',
    '  throw "Magpie Authenticode signer thumbprint mismatch"',
    '}',
  ].join('; ');
  const result = spawn('powershell.exe', ['-NoProfile', '-Command', command], {
    stdio: 'inherit',
    windowsHide: true,
    env: {
      ...windowsPowerShellEnv(env),
      ZHIYUAN_MAGPIE_BIN: binary,
      ZHIYUAN_EXPECTED_THUMBPRINT: thumbprint,
    },
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`Magpie Authenticode verification failed with exit code ${result.status}`);
  }
}

function signPackagedWindowsMagpie(context, deps = {}) {
  if (context.electronPlatformName !== 'win32') return;
  const spawn = deps.spawn || spawnSync;
  const env = deps.env || process.env;
  const root = packagedRoot(context);
  const thumbprint = certumThumbprint(env);
  const signingEnabled = /^[0-9A-F]{40}$/.test(thumbprint);
  const maxAttempts = deps.maxAttempts ?? 3;
  const verifySignature =
    deps.verifySignature ||
    (deps.spawn
      ? null
      : (binary, expectedThumbprint) =>
          verifyWindowsAuthenticodeSignature(binary, expectedThumbprint, env, spawn));
  const script = path.join(__dirname, 'runtime-signing', 'sign-runtime.ps1');
  for (const key of contextTargets(context)) {
    const directory = path.join(root, key);
    const binary = path.join(directory, binaryName(key));
    const manifestPath = path.join(directory, 'manifest.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const before = sha256File(binary);
    if (before !== manifest.sha256) {
      throw new Error('Magpie binary changed before Windows signing');
    }
    if (before === manifest.buildSha256) {
      if (!signingEnabled) {
        verifyRuntime(root, key);
        continue;
      }
      // electron-builder.json excludes magpie.exe from electron-builder's Windows
      // sign walk (win.signExts) so the bytes still match the sealed manifest
      // at afterPack. Sign here with the same Certum signtool script the
      // release environment already uses, then reseal the manifest below.
      let result;
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        result = spawn(
          'powershell.exe',
          ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, '-Path', binary],
          { stdio: 'inherit', windowsHide: true, env: windowsPowerShellEnv(env) },
        );
        if (!result.error && result.status === 0) break;
        if (attempt < maxAttempts) {
          console.warn(
            `[magpie-runtime] Windows Authenticode signing attempt ${attempt}/${maxAttempts} failed; retrying...`,
          );
        }
      }
      if (result.error) throw result.error;
      if (result.status !== 0) {
        throw new Error(`Magpie Authenticode signing failed with exit code ${result.status}`);
      }
    } else {
      if (!signingEnabled) {
        throw new Error('Magpie binary changed before Windows signing');
      }
      if (manifest.signing?.platform !== 'win32' || manifest.signing?.format !== 'authenticode') {
        throw new Error('Magpie binary changed before Windows signing without a valid seal');
      }
      if (verifySignature) verifySignature(binary, thumbprint);
      verifyRuntime(root, key, { allowSigned: true });
      continue;
    }
    const sha256 = sha256File(binary);
    if (sha256 === manifest.buildSha256) {
      throw new Error('Windows signing left the Magpie compiler bytes unchanged');
    }
    if (verifySignature) verifySignature(binary, thumbprint);
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
