'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { inspectSetup } = require('./sfx-format.cjs');
const { sha256File } = require('../windows-resource-pack.cjs');
const {
  resolveNsisOfflineComponentTargets,
  resolveInferenceEdition,
} = require('../resolve-nsis-offline-components.cjs');

const MiB = 1024 * 1024;

// Release policy, krli 2026-10-19: report sizes for every edition; never block
// delivery on a size ceiling. Component identity, hashes and PE boundaries
// remain mandatory. Reintroducing a budget requires a separate decision.
const MAX_COMPONENT_BYTES = null;
const MAX_NON_COMPONENT_BYTES = null;
const MAX_NSIS_BYTES = null;
const MAX_NSIS_NON_COMPONENT_BYTES = null;
const UNCAPPED_EDITIONS = new Set(['lite', 'cpu', 'cuda']);
const BUNDLED_RUNTIME_EDITIONS = new Set(['cpu', 'cuda']);
const UNCAPPED_BUDGET = {
  maxInstallerBytes: null,
  maxNonComponentBytes: null,
  maxComponentBytes: null,
};

function isUncappedEdition() {
  return true;
}
function bundlesRuntimeComponent(edition = resolveInferenceEdition()) {
  return BUNDLED_RUNTIME_EDITIONS.has(edition);
}
function resolveEditionSetupBudget() {
  return { ...UNCAPPED_BUDGET };
}
function resolveEditionNsisBudget() {
  return { ...UNCAPPED_BUDGET, measured: null };
}

function reportMeasurement(label, data) {
  const line = `[measure] ${label} ${JSON.stringify(data)}`;
  console.log(line);
  if (process.env.GITHUB_STEP_SUMMARY) {
    try {
      fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `\n\`${line}\`\n`);
    } catch {
      /* The log remains authoritative if the summary is unavailable. */
    }
  }
  return line;
}

function assertBudget(installerBytes, componentArchiveBytes, limits) {
  if (
    !Number.isSafeInteger(installerBytes) ||
    !Number.isSafeInteger(componentArchiveBytes) ||
    componentArchiveBytes <= 0 ||
    installerBytes < componentArchiveBytes
  ) {
    throw new Error('Invalid final setup/component byte counts');
  }
  const nonComponentBytes = installerBytes - componentArchiveBytes;
  return {
    installerBytes,
    componentArchiveBytes,
    nonComponentBytes,
    maxSetupBytes: limits.maxInstallerBytes,
    maxComponentBytes: limits.maxComponentBytes,
    maxNonComponentBytes: limits.maxNonComponentBytes,
  };
}

function assertSetupBudget(
  installerBytes,
  componentArchiveBytes,
  edition = resolveInferenceEdition(),
) {
  return {
    edition,
    uncapped: isUncappedEdition(edition),
    ...assertBudget(
      installerBytes,
      componentArchiveBytes,
      resolveEditionSetupBudget(edition),
      'WebView2 installer',
    ),
  };
}

function assertNsisBudget(
  installerBytes,
  componentArchiveBytes,
  edition = resolveInferenceEdition(),
) {
  return {
    edition,
    uncapped: isUncappedEdition(edition),
    ...assertBudget(
      installerBytes,
      componentArchiveBytes,
      resolveEditionNsisBudget(edition),
      'NSIS updater',
    ),
  };
}

function verifyComponentArchive(componentsDir, entry) {
  const archive = path.join(componentsDir, `${entry.key}.7z`);
  const bytes = fs.statSync(archive).size;
  if (
    bytes <= 0 ||
    bytes !== entry.archiveSizeBytes ||
    sha256File(archive) !== entry.archiveSha256
  ) {
    throw new Error(`Final size gate component bytes/hash mismatch: ${entry.key}`);
  }
  return bytes;
}

// Both installer kinds now carry the exact edition component set. Size
// reporting must not accept a missing runtime or silently ignore extras.
function readComponentArchiveBytes(componentsDir, edition = resolveInferenceEdition()) {
  const targets = resolveNsisOfflineComponentTargets(edition);
  const manifest = JSON.parse(fs.readFileSync(path.join(componentsDir, 'manifest.json'), 'utf8'));
  if (!Array.isArray(manifest.components) || manifest.components.length !== targets.length) {
    throw new Error('Final size gate requires every bundled Windows component');
  }
  let total = 0;
  for (const target of targets) {
    const entries = manifest.components.filter(component => component.key === target.key);
    if (entries.length !== 1 || entries[0].prefix !== target.prefix) {
      throw new Error(`Final size gate component identity mismatch: ${target.key}`);
    }
    total += verifyComponentArchive(componentsDir, entries[0]);
  }
  reportMeasurement(`windows-components edition=${edition}`, {
    count: manifest.components.length,
    components: manifest.components.map(({ key, archiveSizeBytes }) => ({ key, archiveSizeBytes })),
    totalArchiveBytes: total,
  });
  return total;
}

function verifyFinalSetupBudget(setup, componentsDir, edition = resolveInferenceEdition()) {
  const final = inspectSetup(setup, {
    maxBytes: resolveEditionSetupBudget(edition).maxInstallerBytes,
  });
  return assertSetupBudget(
    final.installerBytes,
    readComponentArchiveBytes(componentsDir, edition),
    edition,
  );
}

function readNsisUpdaterComponentDeductionBytes(
  componentsDir,
  edition = resolveInferenceEdition(),
) {
  return readComponentArchiveBytes(componentsDir, edition);
}

function verifyFinalNsisBudget(
  releaseDir,
  componentArchiveBytes,
  edition = resolveInferenceEdition(),
) {
  const componentsDir = path.resolve(releaseDir, '..', 'build-tar', 'windows-components');
  const nsisComponentDeduction = fs.existsSync(path.join(componentsDir, 'manifest.json'))
    ? readNsisUpdaterComponentDeductionBytes(componentsDir, edition)
    : componentArchiveBytes;
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
  return {
    file: updaters[0].name,
    componentArchiveBytes: nsisComponentDeduction,
    setupComponentArchiveBytes: componentArchiveBytes,
    ...assertNsisBudget(fs.statSync(updater).size, nsisComponentDeduction, edition),
  };
}

function describeEditionByteBreakdown(edition = resolveInferenceEdition()) {
  const limits = resolveEditionNsisBudget(edition);
  return {
    edition,
    limits: {
      maxInstallerMiB: limits.maxInstallerBytes == null ? null : limits.maxInstallerBytes / MiB,
      maxNonComponentMiB:
        limits.maxNonComponentBytes == null ? null : limits.maxNonComponentBytes / MiB,
      maxComponentMiB: limits.maxComponentBytes == null ? null : limits.maxComponentBytes / MiB,
    },
    measuredReference: limits.measured
      ? {
          installerMiB: limits.measured.installerBytes / MiB,
          componentArchiveMiB: limits.measured.componentArchiveBytes / MiB,
          nonComponentMiB: limits.measured.nonComponentBytes / MiB,
        }
      : null,
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
  MiB,
  MAX_COMPONENT_BYTES,
  MAX_NON_COMPONENT_BYTES,
  MAX_NSIS_BYTES,
  MAX_NSIS_NON_COMPONENT_BYTES,
  UNCAPPED_EDITIONS,
  BUNDLED_RUNTIME_EDITIONS,
  isUncappedEdition,
  bundlesRuntimeComponent,
  reportMeasurement,
  resolveEditionSetupBudget,
  resolveEditionNsisBudget,
  assertSetupBudget,
  assertNsisBudget,
  readComponentArchiveBytes,
  readNsisUpdaterComponentDeductionBytes,
  verifyFinalSetupBudget,
  verifyFinalNsisBudget,
  describeEditionByteBreakdown,
  assertPayloadDeduplication,
};
