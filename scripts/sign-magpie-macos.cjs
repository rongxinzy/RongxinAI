'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { signAsync } = require('@electron/osx-sign');
const { binaryName, sha256File, verifyRuntime } = require('./magpie-runtime.cjs');

const MAC_TARGETS = ['darwin-x64', 'darwin-arm64'];
const MACHO_MAGICS = new Set([
  0xfeedface, 0xcefaedfe, 0xfeedfacf, 0xcffaedfe, 0xcafebabe, 0xbebafeca, 0xcafebabf, 0xbfbafeca,
]);

function listPackagedMacMagpieTargets(root) {
  return MAC_TARGETS.filter(key => fs.existsSync(path.join(root, key)));
}

function isMagpieHelper(filename) {
  return /\/magpie\/darwin-(?:x64|arm64)\/magpie$/.test(filename.split(path.sep).join('/'));
}

function isMachOFile(filePath) {
  let fd;
  try {
    const stat = fs.statSync(filePath);
    if (!stat.isFile() || stat.size < 4) return false;
    fd = fs.openSync(filePath, 'r');
    const buf = Buffer.alloc(4);
    const bytesRead = fs.readSync(fd, buf, 0, 4, 0);
    if (bytesRead < 4) return false;
    return MACHO_MAGICS.has(buf.readUInt32BE(0));
  } catch {
    return false;
  } finally {
    if (fd !== undefined) {
      try {
        fs.closeSync(fd);
      } catch {}
    }
  }
}

/**
 * `@electron/osx-sign` uses `isbinaryfile` to discover files to sign, which
 * matches thousands of non-Mach-O data files under `Contents/Resources`
 * (`.pyc` bytecode, `zoneinfo` timezone data, test `.mat`/`.sav`/`.wav` data,
 * images, fonts, static `.a` archives) and makes a sequential network timestamp
 * request to `timestamp.apple.com` for each one. Only Mach-O binaries and
 * nested bundles inside `Contents/Resources` require individual `codesign`;
 * data files are sealed by the outer `.app` bundle's `CodeResources` signature.
 */
function shouldIgnoreNonMachOResource(appPath, filePath) {
  if (!appPath || !filePath) return false;
  const resolvedApp = path.resolve(appPath);
  const resolvedFile = path.resolve(filePath);
  const resourcesPrefix = `${path.join(resolvedApp, 'Contents', 'Resources')}${path.sep}`;
  if (!resolvedFile.startsWith(resourcesPrefix)) return false;
  if (isMagpieHelper(resolvedFile)) return false;
  try {
    const stat = fs.statSync(resolvedFile);
    if (stat.isDirectory()) return false;
  } catch {
    return false;
  }
  return !isMachOFile(resolvedFile);
}

function optionsForSignedFile(options, filename) {
  const perFile = options.optionsForFile ? options.optionsForFile(filename) : {};
  if (!isMagpieHelper(filename)) return perFile;
  if (perFile.hardenedRuntime === false || options.hardenedRuntime === false) {
    throw new Error('Magpie macOS signing requires the hardened runtime');
  }
  return perFile.hardenedRuntime === true ? perFile : { ...perFile, hardenedRuntime: true };
}

async function signWithRuntimeManifest(options, signer = signAsync) {
  const root = path.join(options.app, 'Contents', 'Resources', 'magpie');
  const packagedTargets = listPackagedMacMagpieTargets(root);
  if (packagedTargets.length === 0) {
    throw new Error(
      'macOS signing expected at least one packaged Magpie helper under Resources/magpie',
    );
  }
  const manifests = new Map(packagedTargets.map(key => [key, verifyRuntime(root, key)]));
  let manifestSealed = false;
  const callerIgnore = Array.isArray(options.ignore)
    ? options.ignore
    : options.ignore
      ? [options.ignore]
      : [];
  await signer({
    ...options,
    ignore: [...callerIgnore, filePath => shouldIgnoreNonMachOResource(options.app, filePath)],
    // Developer ID comes from electron-builder's resolved identity. Hardened
    // runtime is required for notarization; the whole .app, including these
    // helpers, is submitted by the afterSign notarization hook.
    hardenedRuntime: options.hardenedRuntime !== false,
    optionsForFile: filename => {
      // osx-sign signs children first and the outer .app last. Updating this
      // resource after the outer signature would invalidate the app seal.
      if (path.resolve(filename) === path.resolve(options.app)) {
        for (const [key, original] of manifests) {
          const directory = path.join(root, key);
          const binary = path.join(directory, binaryName(key));
          const manifest = {
            ...original,
            sha256: sha256File(binary),
            sizeBytes: fs.statSync(binary).size,
            signing: { platform: 'darwin', format: 'codesign' },
          };
          fs.writeFileSync(
            path.join(directory, 'manifest.json'),
            `${JSON.stringify(manifest, null, 2)}\n`,
          );
          verifyRuntime(root, key, { allowSigned: true });
        }
        manifestSealed = true;
      }
      return optionsForSignedFile(options, filename);
    },
  });
  if (!manifestSealed) throw new Error('macOS signing never sealed the Magpie runtime manifests');
  for (const key of packagedTargets) verifyRuntime(root, key, { allowSigned: true });
}

// electron-builder has already resolved identity, keychain and entitlements.
// Preserve all of those options rather than selecting a new signing identity.
module.exports = options => signWithRuntimeManifest(options);
module.exports.signWithRuntimeManifest = signWithRuntimeManifest;
module.exports.listPackagedMacMagpieTargets = listPackagedMacMagpieTargets;
module.exports.isMachOFile = isMachOFile;
module.exports.shouldIgnoreNonMachOResource = shouldIgnoreNonMachOResource;
