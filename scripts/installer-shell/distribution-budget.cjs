'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { MAX_SETUP_BYTES, inspectSetup } = require('./sfx-format.cjs');
const { sha256File } = require('../windows-resource-pack.cjs');
const targets = require('../nsis-offline-components.json');

const MAX_COMPONENT_BYTES = 300 * 1024 * 1024;
const MAX_NON_COMPONENT_BYTES = 220 * 1024 * 1024;
const MAX_NSIS_BYTES = 450 * 1024 * 1024;
const MAX_NSIS_NON_COMPONENT_BYTES = 150 * 1024 * 1024;

function assertBudget(
  installerBytes,
  componentArchiveBytes,
  maximumBytes,
  maximumNonComponentBytes,
  label,
) {
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
  if (installerBytes > maximumBytes) {
    throw new Error(`Final ${label} exceeds the ${maximumBytes / 1024 / 1024} MiB budget`);
  }
  if (nonComponentBytes > maximumNonComponentBytes) {
    throw new Error(
      `Final ${label} non-component bytes exceed the ${maximumNonComponentBytes / 1024 / 1024} MiB budget`,
    );
  }
  return {
    installerBytes,
    componentArchiveBytes,
    nonComponentBytes,
    maxSetupBytes: maximumBytes,
    maxComponentBytes: MAX_COMPONENT_BYTES,
    maxNonComponentBytes: maximumNonComponentBytes,
  };
}

function assertSetupBudget(installerBytes, componentArchiveBytes) {
  return assertBudget(
    installerBytes,
    componentArchiveBytes,
    MAX_SETUP_BYTES,
    MAX_NON_COMPONENT_BYTES,
    'WebView2 installer',
  );
}

function assertNsisBudget(installerBytes, componentArchiveBytes) {
  return assertBudget(
    installerBytes,
    componentArchiveBytes,
    MAX_NSIS_BYTES,
    MAX_NSIS_NON_COMPONENT_BYTES,
    'NSIS updater',
  );
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

function verifyFinalNsisBudget(releaseDir, componentArchiveBytes) {
  const updaters = fs
    .readdirSync(releaseDir, { withFileTypes: true })
    .filter(
      entry =>
        entry.isFile() &&
        /\.exe$/i.test(entry.name) &&
        !/^ZhiYuanAgent-Setup-/i.test(entry.name) &&
        !/Uninstall/i.test(entry.name),
    );
  if (updaters.length !== 1)
    throw new Error(`Expected exactly one NSIS updater; found ${updaters.length}`);
  const updater = path.join(releaseDir, updaters[0].name);
  // electron-builder already completed any required signing before this
  // distribution entry point. Count final bytes without modifying the file.
  return {
    file: updaters[0].name,
    ...assertNsisBudget(fs.statSync(updater).size, componentArchiveBytes),
  };
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
  MAX_NSIS_BYTES,
  MAX_NSIS_NON_COMPONENT_BYTES,
  assertSetupBudget,
  assertNsisBudget,
  readComponentArchiveBytes,
  verifyFinalSetupBudget,
  verifyFinalNsisBudget,
  assertPayloadDeduplication,
};
