'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { MAX_SETUP_BYTES, inspectSetup } = require('./sfx-format.cjs');
const { sha256File } = require('../windows-resource-pack.cjs');
const targets = require('../nsis-offline-components.json');

const MAX_COMPONENT_BYTES = 300 * 1024 * 1024;
const MAX_NON_COMPONENT_BYTES = 220 * 1024 * 1024;

function assertSetupBudget(installerBytes, componentArchiveBytes) {
  if (
    !Number.isSafeInteger(installerBytes) ||
    !Number.isSafeInteger(componentArchiveBytes) ||
    componentArchiveBytes <= 0 ||
    installerBytes < componentArchiveBytes
  ) {
    throw new Error('Invalid final setup/component byte counts');
  }
  const nonComponentBytes = installerBytes - componentArchiveBytes;
  if (componentArchiveBytes > MAX_COMPONENT_BYTES) {
    throw new Error('Component archives exceed the unchanged 300 MiB budget');
  }
  if (installerBytes > MAX_SETUP_BYTES) {
    throw new Error('Final setup exceeds the 500 MiB WebView2 installer budget');
  }
  if (nonComponentBytes > MAX_NON_COMPONENT_BYTES) {
    throw new Error('Final setup non-component bytes exceed the 220 MiB WebView2 budget');
  }
  return {
    installerBytes,
    componentArchiveBytes,
    nonComponentBytes,
    maxSetupBytes: MAX_SETUP_BYTES,
    maxComponentBytes: MAX_COMPONENT_BYTES,
    maxNonComponentBytes: MAX_NON_COMPONENT_BYTES,
  };
}

function readComponentArchiveBytes(componentsDir) {
  const manifest = JSON.parse(fs.readFileSync(path.join(componentsDir, 'manifest.json'), 'utf8'));
  if (!Array.isArray(manifest.components) || manifest.components.length !== targets.length) {
    throw new Error('Final size gate requires all seven component archives');
  }
  let total = 0;
  for (const target of targets) {
    const entries = manifest.components.filter(component => component.key === target.key);
    if (entries.length !== 1 || entries[0].prefix !== target.prefix) {
      throw new Error(`Final size gate component identity mismatch: ${target.key}`);
    }
    const archive = path.join(componentsDir, `${target.key}.7z`);
    const bytes = fs.statSync(archive).size;
    if (
      bytes <= 0 ||
      bytes !== entries[0].archiveSizeBytes ||
      sha256File(archive) !== entries[0].archiveSha256
    ) {
      throw new Error(`Final size gate component bytes/hash mismatch: ${target.key}`);
    }
    total += bytes;
  }
  return total;
}

function verifyFinalSetupBudget(setup, componentsDir) {
  // inspectSetup reads the actual signed file size, including its certificate
  // table. Neither a pre-signing manifest nor inflated component metadata can
  // make a too-large final installer pass this gate.
  const final = inspectSetup(setup);
  return assertSetupBudget(final.installerBytes, readComponentArchiveBytes(componentsDir));
}

function assertPayloadDeduplication(payloadDir, retainedHost) {
  if (fs.existsSync(path.join(payloadDir, 'vc_redist.x64.exe'))) {
    throw new Error('Duplicate VC++ redistributable: use the copy already inside app.7z');
  }
  const allowed = new Set([
    'app.7z',
    'tools',
    'components',
    'scripts',
    'component-manifest.json',
    'component-targets.json',
    'version.txt',
    'uninstall.exe',
  ]);
  for (const entry of fs.readdirSync(payloadDir)) {
    if (!allowed.has(entry)) throw new Error(`Unexpected duplicate payload content: ${entry}`);
  }
  if (sha256File(path.join(payloadDir, 'uninstall.exe')) !== sha256File(retainedHost)) {
    throw new Error(
      'Payload must retain the native NSIS uninstaller, never a duplicate .NET shell',
    );
  }
}

module.exports = {
  MAX_COMPONENT_BYTES,
  MAX_NON_COMPONENT_BYTES,
  assertSetupBudget,
  readComponentArchiveBytes,
  verifyFinalSetupBudget,
  assertPayloadDeduplication,
};
