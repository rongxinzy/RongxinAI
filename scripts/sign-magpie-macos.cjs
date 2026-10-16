'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { signAsync } = require('@electron/osx-sign');
const { binaryName, sha256File, verifyRuntime } = require('./magpie-runtime.cjs');

const MAC_TARGETS = ['darwin-x64', 'darwin-arm64'];

function isMagpieHelper(filename) {
  return /\/magpie\/darwin-(?:x64|arm64)\/magpie$/.test(filename.split(path.sep).join('/'));
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
  const manifests = new Map(MAC_TARGETS.map(key => [key, verifyRuntime(root, key)]));
  let manifestSealed = false;
  await signer({
    ...options,
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
  for (const key of MAC_TARGETS) verifyRuntime(root, key, { allowSigned: true });
}

// electron-builder has already resolved identity, keychain and entitlements.
// Preserve all of those options rather than selecting a new signing identity.
module.exports = options => signWithRuntimeManifest(options);
module.exports.signWithRuntimeManifest = signWithRuntimeManifest;
