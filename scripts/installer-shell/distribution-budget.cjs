'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { MAX_SETUP_BYTES, inspectSetup } = require('./sfx-format.cjs');
const { sha256File } = require('../windows-resource-pack.cjs');
const {
  resolveNsisOfflineComponentTargets,
  resolveInferenceEdition,
} = require('../resolve-nsis-offline-components.cjs');

const MiB = 1024 * 1024;

// ---------------------------------------------------------------------------
// Windows installer byte budgets, per inference edition.
//
// lite is the product baseline and keeps the ORIGINAL limits unchanged:
//   WebView2 setup: total 500 MiB, components 300 MiB, non-component 220 MiB
//   NSIS updater:   total 450 MiB, non-component 150 MiB (components 300 MiB)
// Never loosen lite to absorb growth: find and remove the growth instead.
//
// cpu = lite + exactly the bundled CPU+Vulkan llama.cpp runtime. On Windows that
// runtime ships only as the eighth offline component of the WebView2 setup
// (llamacpp-bundled.7z); the NSIS updater does not carry it, so cpu NSIS limits
// are identical to lite. The allowance is the measured component archive plus
// an explicit margin, so any other growth in a cpu build still fails the gate.
//
// cuda is a factory-preinstall edition (CUDA 12.4 runtime + cuBLAS is ~1 GiB),
// so it has no size cap. Its integrity is still enforced: the llama.cpp archive
// is pinned by sha256 in resources/llamacpp-backends/manifest.json
// (finalize-llamacpp-cuda-edition.cjs) and every component archive is checked
// against its manifest size and sha256 by readComponentArchiveBytes().
// ---------------------------------------------------------------------------
const MAX_COMPONENT_BYTES = 300 * MiB;
const MAX_NON_COMPONENT_BYTES = 220 * MiB;
const MAX_NSIS_BYTES = 450 * MiB;
const MAX_NSIS_NON_COMPONENT_BYTES = 150 * MiB;

/**
 * llamacpp-bundled.7z for win-x64 cpu (llama.cpp b9244 CPU + Vulkan), measured on
 * CI verify run 39014993557 (job 117345181236): cpu componentArchiveBytes
 * 316_378_462 - lite componentArchiveBytes 288_942_645 = 27_435_817 bytes.
 */
const LLAMACPP_CPU_RUNTIME_COMPONENT_BYTES = 27_435_817;
/** ~7% headroom for llama.cpp build-to-build drift; re-measure when bumping the tag. */
const LLAMACPP_CPU_RUNTIME_MARGIN_BYTES = 2 * MiB;
const LLAMACPP_CPU_RUNTIME_ALLOWANCE_BYTES =
  LLAMACPP_CPU_RUNTIME_COMPONENT_BYTES + LLAMACPP_CPU_RUNTIME_MARGIN_BYTES;

const LITE_SETUP_BUDGET = {
  maxInstallerBytes: MAX_SETUP_BYTES,
  maxNonComponentBytes: MAX_NON_COMPONENT_BYTES,
  maxComponentBytes: MAX_COMPONENT_BYTES,
};
const UNCAPPED_BUDGET = {
  maxInstallerBytes: null,
  maxNonComponentBytes: null,
  maxComponentBytes: null,
};

const EDITION_SETUP_BUDGETS = {
  lite: LITE_SETUP_BUDGET,
  cpu: {
    maxInstallerBytes: MAX_SETUP_BYTES + LLAMACPP_CPU_RUNTIME_ALLOWANCE_BYTES,
    // The runtime is a component archive, so non-component bytes stay at lite.
    maxNonComponentBytes: MAX_NON_COMPONENT_BYTES,
    maxComponentBytes: MAX_COMPONENT_BYTES + LLAMACPP_CPU_RUNTIME_ALLOWANCE_BYTES,
  },
  cuda: UNCAPPED_BUDGET,
};

const LITE_NSIS_BUDGET = {
  maxInstallerBytes: MAX_NSIS_BYTES,
  maxNonComponentBytes: MAX_NSIS_NON_COMPONENT_BYTES,
  maxComponentBytes: MAX_COMPONENT_BYTES,
};

/** lite NSIS updater measured on main #988 (072068ff), before the Magpie gateway shipped. */
const LITE_NSIS_MEASURED = {
  installerBytes: 439_171_500,
  componentArchiveBytes: 288_626_662,
  nonComponentBytes: 150_544_838,
};

const EDITION_NSIS_BUDGETS = {
  lite: { ...LITE_NSIS_BUDGET, measured: LITE_NSIS_MEASURED },
  // The NSIS updater never contains llama.cpp, so cpu is held to lite exactly.
  cpu: { ...LITE_NSIS_BUDGET, measured: LITE_NSIS_MEASURED },
  cuda: { ...UNCAPPED_BUDGET, measured: null },
};

function resolveEditionSetupBudget(edition = resolveInferenceEdition()) {
  return EDITION_SETUP_BUDGETS[edition] || EDITION_SETUP_BUDGETS.lite;
}

function resolveEditionNsisBudget(edition = resolveInferenceEdition()) {
  return EDITION_NSIS_BUDGETS[edition] || EDITION_NSIS_BUDGETS.lite;
}

function assertBudget(installerBytes, componentArchiveBytes, limits, label) {
  if (
    !Number.isSafeInteger(installerBytes) ||
    !Number.isSafeInteger(componentArchiveBytes) ||
    componentArchiveBytes <= 0 ||
    installerBytes < componentArchiveBytes
  ) {
    throw new Error('Invalid final setup/component byte counts');
  }
  const nonComponentBytes = installerBytes - componentArchiveBytes;
  if (limits.maxComponentBytes != null && componentArchiveBytes > limits.maxComponentBytes) {
    throw new Error(
      `Component archives exceed the ${limits.maxComponentBytes / MiB} MiB budget for ${label}`,
    );
  }
  if (limits.maxInstallerBytes != null && installerBytes > limits.maxInstallerBytes) {
    throw new Error(`Final ${label} exceeds the ${limits.maxInstallerBytes / MiB} MiB budget`);
  }
  if (limits.maxNonComponentBytes != null && nonComponentBytes > limits.maxNonComponentBytes) {
    throw new Error(
      `Final ${label} non-component bytes exceed the ${limits.maxNonComponentBytes / MiB} MiB budget`,
    );
  }
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
  const limits = resolveEditionNsisBudget(edition);
  if (limits.maxInstallerBytes == null) {
    return {
      installerBytes,
      componentArchiveBytes,
      nonComponentBytes: installerBytes - componentArchiveBytes,
      maxSetupBytes: null,
      maxComponentBytes: null,
      maxNonComponentBytes: null,
      skipped: true,
      edition,
    };
  }
  return {
    edition,
    ...assertBudget(installerBytes, componentArchiveBytes, limits, 'NSIS updater'),
  };
}

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

function readNsisUpdaterComponentDeductionBytes(componentsDir) {
  return readComponentArchiveBytes(componentsDir, 'lite');
}

function verifyFinalNsisBudget(
  releaseDir,
  componentArchiveBytes,
  edition = resolveInferenceEdition(),
) {
  const limits = resolveEditionNsisBudget(edition);
  if (limits.maxInstallerBytes == null) {
    return { edition, skipped: true, componentArchiveBytes };
  }
  const componentsDir = path.resolve(releaseDir, '..', 'build-tar', 'windows-components');
  const nsisComponentDeduction = fs.existsSync(path.join(componentsDir, 'manifest.json'))
    ? readNsisUpdaterComponentDeductionBytes(componentsDir)
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
  LLAMACPP_CPU_RUNTIME_COMPONENT_BYTES,
  LLAMACPP_CPU_RUNTIME_MARGIN_BYTES,
  LLAMACPP_CPU_RUNTIME_ALLOWANCE_BYTES,
  EDITION_SETUP_BUDGETS,
  EDITION_NSIS_BUDGETS,
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
