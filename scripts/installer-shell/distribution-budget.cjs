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
//   NSIS updater:   total 450 MiB, non-component 150 MiB + the Magpie gateway
//                   allowance below (components 300 MiB)
// Never loosen lite to absorb other growth: find and remove the growth instead.
//
// cpu: enforced limits = value MEASURED by CI + an explicit margin. #1117
// shipped cpu/cuda report-only (policy, krli 2026-10-17: never hard-code a
// size limit for an unknown); the measured `[measure]` lines of build run
// 39032801288 (all 7 legs green, main 51b62ed6) now set the cpu limits below.
// Margin rule: ceil(3% of the measured bytes) in whole MiB, per gate.
// Limits change ONLY through a PR that cites a new measured run (run id +
// `[measure]` values) and recomputes measured + margin. Never bump a cpu limit
// by a round number to make a build pass: find the growth first.
//
// cuda is publicly released like the other editions but has NO size limit
// (krli decision for the public cuda release): its llama.cpp CUDA runtime is
// dominated by NVIDIA DLLs we do not control. Its gates still measure and log
// `[measure]` lines. Integrity is never uncapped: every component archive is
// checked against its manifest size and sha256 (readComponentArchiveBytes), and
// the llama.cpp runtime is pinned by sha256 (finalize-llamacpp-cuda-edition.cjs,
// resources/llamacpp-backends/manifest.json).
// ---------------------------------------------------------------------------
const MAX_COMPONENT_BYTES = 300 * MiB;
const MAX_NON_COMPONENT_BYTES = 220 * MiB;
const MAX_NSIS_BYTES = 450 * MiB;
const MAX_NSIS_NON_COMPONENT_BYTES = 150 * MiB;

/** Editions with no size limit (cuda, krli decision for its public release). */
const UNCAPPED_EDITIONS = new Set(['cuda']);

/**
 * Editions that bundle the optional llama.cpp component (`llamacpp-bundled`)
 * on top of the fixed lite component set. Component identity is checked as the
 * fixed required set plus integrity-checked extras for these editions.
 */
const BUNDLED_RUNTIME_EDITIONS = new Set(['cpu', 'cuda']);

function isUncappedEdition(edition = resolveInferenceEdition()) {
  return UNCAPPED_EDITIONS.has(edition);
}

function bundlesRuntimeComponent(edition = resolveInferenceEdition()) {
  return BUNDLED_RUNTIME_EDITIONS.has(edition);
}

function formatMiB(bytes) {
  const mib = bytes / MiB;
  return Number.isInteger(mib) ? String(mib) : mib.toFixed(1);
}

/**
 * Emit one machine-greppable `[measure]` line (and append it to the GitHub job
 * summary when available). Every edition logs its measured bytes.
 */
function reportMeasurement(label, data) {
  const line = `[measure] ${label} ${JSON.stringify(data)}`;
  console.log(line);
  if (process.env.GITHUB_STEP_SUMMARY) {
    try {
      fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `\n\`${line}\`\n`);
    } catch {
      // The summary is best-effort; the log line above is authoritative.
    }
  }
  return line;
}

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

// cpu WebView2 setup, measured in build run 39032801288 (win32-x64-cpu):
//   `[measure] windows-webview2-setup edition=cpu`
//     installerBytes 527,673,448 / componentArchiveBytes 316,397,703 /
//     nonComponentBytes 211,275,745
//   components: the fixed lite set + llamacpp-bundled 27,410,534 B.
const CPU_SETUP_MEASURED = {
  installerBytes: 527_673_448,
  componentArchiveBytes: 316_397_703,
  nonComponentBytes: 211_275_745,
};
// Margins: ceil(3% of measured) in whole MiB.
const CPU_SETUP_MARGIN = {
  installerBytes: 16 * MiB,
  componentArchiveBytes: 10 * MiB,
  nonComponentBytes: 7 * MiB,
};

// cpu NSIS updater, measured in build run 39032801288 (win32-x64-cpu):
//   `[measure] windows-nsis-updater edition=cpu`
//     installerBytes 450,027,196 / componentArchiveBytes 288,987,169 (the fixed
//     lite set: the updater never carries llama.cpp) / nonComponentBytes
//     161,040,027
const CPU_NSIS_MEASURED = {
  installerBytes: 450_027_196,
  componentArchiveBytes: 288_987_169,
  nonComponentBytes: 161_040_027,
};
const CPU_NSIS_MARGIN = {
  installerBytes: 13 * MiB,
  componentArchiveBytes: 9 * MiB,
  nonComponentBytes: 5 * MiB,
};

// Component-only recalibration: release run 39262246003, CPU job 118108760017.
// The pack-setup component counters are exact archive sizes, independent of
// Authenticode. Making Skill Python relocatable added its required stdlib/DLLs:
// skill-python grew from 187,943,479 B (build.7) to 201,219,105 B (build.9).
// All fixed components total 301,923,735 B; llama.cpp adds 27,410,530 B.
// Keep the original total/non-component limits: the measured unsigned setup
// (540,166,608 B) and signed NSIS updater (462,543,176 B) still fit them.
// Only these component baselines use build.9, with the same 3% whole-MiB rule.
const CPU_COMPONENT_MEASURED = {
  setup: 329_334_265,
  nsis: 301_923_735,
};

function measuredComponentLimit(bytes) {
  return bytes + Math.ceil((bytes * 0.03) / MiB) * MiB;
}

function measuredLimits(measured, margin) {
  return {
    maxInstallerBytes: measured.installerBytes + margin.installerBytes,
    maxNonComponentBytes: measured.nonComponentBytes + margin.nonComponentBytes,
    maxComponentBytes: measured.componentArchiveBytes + margin.componentArchiveBytes,
  };
}

const CPU_SETUP_BUDGET = {
  ...measuredLimits(CPU_SETUP_MEASURED, CPU_SETUP_MARGIN),
  maxComponentBytes: measuredComponentLimit(CPU_COMPONENT_MEASURED.setup),
};

const EDITION_SETUP_BUDGETS = {
  lite: LITE_SETUP_BUDGET,
  cpu: CPU_SETUP_BUDGET,
  cuda: UNCAPPED_BUDGET,
};

// Magpie gateway allowance (#1021 made Magpie the model execution path; #1122
// builds and ships its pinned binary in every edition). It lives in the NSIS
// app payload, so it is non-component bytes. Measured: resources/magpie/
// win32-x64/magpie.exe 47,214,592 B (already -trimpath -ldflags "-s -w"),
// 7z -mx=9 compressed 12,334,542 B; plus an explicit 1 MiB margin.
// This allowance exists solely for the Magpie gateway. Do not raise it, or the
// 150 MiB base, for anything else: find and remove other growth instead.
// The WebView2 non-component gate (220 MiB) still fits (211.3 MB measured), so
// it is not given this allowance.
const MAGPIE_GATEWAY_COMPRESSED_BYTES = 12_334_542;
const MAGPIE_GATEWAY_MARGIN_BYTES = 1 * MiB;
const MAGPIE_GATEWAY_NSIS_ALLOWANCE_BYTES =
  MAGPIE_GATEWAY_COMPRESSED_BYTES + MAGPIE_GATEWAY_MARGIN_BYTES;

const LITE_NSIS_BUDGET = {
  maxInstallerBytes: MAX_NSIS_BYTES,
  maxNonComponentBytes: MAX_NSIS_NON_COMPONENT_BYTES + MAGPIE_GATEWAY_NSIS_ALLOWANCE_BYTES,
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
  cpu: {
    ...measuredLimits(CPU_NSIS_MEASURED, CPU_NSIS_MARGIN),
    maxComponentBytes: measuredComponentLimit(CPU_COMPONENT_MEASURED.nsis),
    measured: CPU_NSIS_MEASURED,
  },
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
      `Component archives exceed the ${formatMiB(limits.maxComponentBytes)} MiB budget for ${label}`,
    );
  }
  if (limits.maxInstallerBytes != null && installerBytes > limits.maxInstallerBytes) {
    throw new Error(`Final ${label} exceeds the ${formatMiB(limits.maxInstallerBytes)} MiB budget`);
  }
  if (limits.maxNonComponentBytes != null && nonComponentBytes > limits.maxNonComponentBytes) {
    throw new Error(
      `Final ${label} non-component bytes exceed the ${formatMiB(limits.maxNonComponentBytes)} MiB budget`,
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

// Sums the component archives the final installer carries, verifying each one's
// manifest size and sha256 (integrity, always enforced).
// lite: the manifest must hold exactly the fixed lite component set (original
// gate). Editions bundling llama.cpp (cpu/cuda): the fixed lite set must still
// be present (an install without them is broken), and every additional
// component (llamacpp-bundled) is integrity-checked, counted and reported.
function readComponentArchiveBytes(
  componentsDir,
  edition = resolveInferenceEdition(),
  { allowExtraComponents = false } = {},
) {
  const bundled = bundlesRuntimeComponent(edition);
  const targets = resolveNsisOfflineComponentTargets(bundled ? 'lite' : edition);
  const allowExtra = allowExtraComponents || bundled;
  const manifest = JSON.parse(fs.readFileSync(path.join(componentsDir, 'manifest.json'), 'utf8'));
  if (
    !Array.isArray(manifest.components) ||
    (allowExtra
      ? manifest.components.length < targets.length
      : manifest.components.length !== targets.length)
  ) {
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
  if (bundled && !allowExtraComponents) {
    const known = new Set(targets.map(target => target.key));
    const extras = manifest.components.filter(component => !known.has(component.key));
    for (const entry of extras) total += verifyComponentArchive(componentsDir, entry);
    reportMeasurement(`windows-components edition=${edition}`, {
      count: manifest.components.length,
      components: manifest.components.map(component => ({
        key: component.key,
        archiveSizeBytes: component.archiveSizeBytes,
      })),
      totalArchiveBytes: total,
    });
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

// The NSIS updater carries only the fixed lite components (nsis-installer.nsh
// uses scripts/nsis-offline-components.json), never the llama.cpp component,
// so cpu/cuda manifests legitimately list extra entries.
function readNsisUpdaterComponentDeductionBytes(componentsDir) {
  return readComponentArchiveBytes(componentsDir, 'lite', { allowExtraComponents: true });
}

function verifyFinalNsisBudget(
  releaseDir,
  componentArchiveBytes,
  edition = resolveInferenceEdition(),
) {
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
  UNCAPPED_EDITIONS,
  BUNDLED_RUNTIME_EDITIONS,
  isUncappedEdition,
  bundlesRuntimeComponent,
  CPU_SETUP_MEASURED,
  CPU_SETUP_MARGIN,
  CPU_NSIS_MEASURED,
  CPU_NSIS_MARGIN,
  CPU_COMPONENT_MEASURED,
  reportMeasurement,
  MAGPIE_GATEWAY_COMPRESSED_BYTES,
  MAGPIE_GATEWAY_MARGIN_BYTES,
  MAGPIE_GATEWAY_NSIS_ALLOWANCE_BYTES,
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
