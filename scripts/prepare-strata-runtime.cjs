'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const { VENDOR_ROOT, readPinnedManifest } = require('./download-strata-runtime.cjs');
const { resolveInferenceEdition } = require('./resolve-nsis-offline-components.cjs');

function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function shouldStageStrata(edition = resolveInferenceEdition(), platform = process.platform) {
  return edition === 'cuda' && platform === 'win32';
}

function copyTree(sourceRoot, targetRoot) {
  fs.rmSync(targetRoot, { recursive: true, force: true });
  fs.cpSync(sourceRoot, targetRoot, { recursive: true });
}

function main() {
  const edition = resolveInferenceEdition();
  if (!shouldStageStrata(edition)) {
    console.log(`[prepare-strata-runtime] Skipping Strata bundle for edition=${edition}.`);
    return;
  }

  if (
    !fs.existsSync(path.join(VENDOR_ROOT, 'control', 'serve', 'server.py')) ||
    !fs.existsSync(path.join(VENDOR_ROOT, 'components', 'engine'))
  ) {
    const download = spawnSync(process.execPath, ['scripts/download-strata-runtime.cjs'], {
      cwd: ROOT,
      stdio: 'inherit',
      env: { ...process.env, ZHIYUAN_STRATA_RUNTIME_DOWNLOAD: '1' },
    });
    if (download.status !== 0) {
      throw new Error('[prepare-strata-runtime] Strata runtime download failed.');
    }
  }

  const pinned = readPinnedManifest();
  const targetRoot = path.join(ROOT, 'resources', 'strata-bundled');
  copyTree(path.join(VENDOR_ROOT, 'control'), path.join(targetRoot, 'runtime'));
  copyTree(path.join(VENDOR_ROOT, 'components'), path.join(targetRoot, 'components'));

  const pythonExe = path.join(targetRoot, 'runtime', 'python', 'python.exe');
  const qwenEntry = path.join(
    targetRoot,
    'components',
    'engine',
    pinned.engineQwen.installFolder,
    'strata.exe',
  );
  const dsv41Entry = path.join(
    targetRoot,
    'components',
    'engine-dsv41',
    pinned.engineDsv41.installFolder,
    'strata-dsv41.exe',
  );
  for (const [label, filePath] of [
    ['python', pythonExe],
    ['strata.exe', qwenEntry],
    ['strata-dsv41.exe', dsv41Entry],
  ]) {
    if (!fs.existsSync(filePath)) {
      throw new Error(`[prepare-strata-runtime] Missing bundled Strata ${label}: ${filePath}`);
    }
  }

  const manifest = {
    schemaVersion: 1,
    releaseTag: pinned.releaseTag,
    defaultPort: pinned.defaultPort ?? 8096,
    runtimeRoot: 'runtime',
    componentsRoot: 'components',
    pythonExecutable: 'runtime/python/python.exe',
    engineQwenFolder: path.posix.join('components/engine', pinned.engineQwen.installFolder),
    engineDsv41Folder: path.posix.join('components/engine-dsv41', pinned.engineDsv41.installFolder),
    sha256: {
      python: sha256File(pythonExe),
      strata: sha256File(qwenEntry),
      strataDsv41: sha256File(dsv41Entry),
    },
    attribution:
      'Strata inference engine (MIT) — https://github.com/Niko1221/Strata — bundled for Windows CUDA edition only.',
  };
  fs.writeFileSync(
    path.join(targetRoot, 'manifest.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  console.log(
    `[prepare-strata-runtime] Staged Strata dual-engine bundle (${manifest.sha256.strata.slice(0, 12)}…).`,
  );
}

if (require.main === module) {
  main();
}

module.exports = { shouldStageStrata, main };
