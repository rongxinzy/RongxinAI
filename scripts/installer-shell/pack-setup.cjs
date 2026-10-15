#!/usr/bin/env node

/*
 * Milestone B packer: assembles the payload contract, zips it, and appends it
 * to the WebView2 shell exe, producing the single-file installer.
 *
 *   node scripts/installer-shell/pack-setup.cjs \
 *     --app-dir <应用文件目录> --components-dir <build-tar/windows-components> \
 *     [--out <输出.exe>] [--payload-zip <existing.zip>]
 *
 * --payload-zip skips assembly entirely and appends the given zip (SFX smoke
 * tests on machines without real build artifacts).
 *
 * Container format (appended to the shell exe):
 *   [unsigned shell][payload.zip][alignment][ZYP2 footer][optional certificate]
 * See sfx-format.cjs. The complete container is signed only after assembly.
 */
const { spawnSync } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  appendPayload,
  writeSetupManifest,
  MAX_SETUP_BYTES,
  FOOTER_BYTES,
} = require('./sfx-format.cjs');
const { verifyRetainedHost } = require('./retain-uninstaller.cjs');
const {
  MAX_COMPONENT_BYTES,
  MAX_NON_COMPONENT_BYTES,
  assertSetupBudget,
  assertPayloadDeduplication,
} = require('./distribution-budget.cjs');
const { sha256File } = require('../windows-resource-pack.cjs');

const projectRoot = path.resolve(__dirname, '..', '..');
const shellExe = path.join(
  projectRoot,
  'scripts',
  'installer-shell',
  'out',
  'ZhiYuanSetupShell.exe',
);
const sevenZip = path.join(projectRoot, 'node_modules', '7zip-bin', 'win', 'x64', '7za.exe');
const packageVersion = JSON.parse(
  fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8'),
).version;

function argValue(flag) {
  const index = process.argv.indexOf(flag);
  return index >= 0 && index + 1 < process.argv.length ? process.argv[index + 1] : null;
}

function fail(message) {
  throw new Error(`[pack-setup] ${message}`);
}

const appDir = argValue('--app-dir');
const componentsDir = argValue('--components-dir');
const payloadZipArg = argValue('--payload-zip');
const outArg = argValue('--out');
const uninstallHost =
  argValue('--uninstall-host') || path.join(path.dirname(shellExe), 'ZhiYuanUninstall.exe');

if (!fs.existsSync(shellExe)) {
  fail(`shell exe not found at ${shellExe} — run build-shell.cjs first`);
}

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

let payloadZip;
let componentArchiveBytes = null;
const staging = fs.mkdtempSync(path.join(os.tmpdir(), 'zy-pack-'));

try {
  if (payloadZipArg) {
    payloadZip = path.resolve(payloadZipArg);
    if (!fs.existsSync(payloadZip)) fail(`--payload-zip not found: ${payloadZip}`);
    console.log(`[pack-setup] using existing payload zip ${payloadZip}`);
  } else {
    if (!appDir || !fs.existsSync(appDir)) {
      fail('--app-dir <应用文件目录> is required (real build output) and must exist');
    }
    if (!componentsDir || !fs.existsSync(componentsDir)) {
      fail('--components-dir <build-tar/windows-components> is required and must exist');
    }
    const installedVcRedist = path.join(appDir, 'resources', 'vc_redist.x64.exe');
    if (!fs.existsSync(installedVcRedist)) fail('app resources must contain vc_redist.x64.exe');
    verifyRetainedHost(projectRoot, uninstallHost);
    const payloadDir = path.join(staging, 'payload');
    for (const dir of ['tools', 'components', 'scripts']) {
      fs.mkdirSync(path.join(payloadDir, dir), { recursive: true });
    }

    // Application archive.
    const appArchive = path.join(payloadDir, 'app.7z');
    const pack = spawnSync(path.resolve(sevenZip), ['a', appArchive, '.', '-mx=9', '-x!*.map'], {
      cwd: path.resolve(appDir),
      encoding: 'utf8',
    });
    if (pack.status !== 0) fail(`7za failed packing app dir:\n${pack.stdout}\n${pack.stderr}`);
    console.log(
      `[pack-setup] app.7z: ${fs.statSync(appArchive).size} bytes (includes VC++ redistributable)`,
    );

    // Tools.
    const sevenZipBytes = fs.readFileSync(sevenZip);
    fs.writeFileSync(path.join(payloadDir, 'tools', '7za.exe'), sevenZipBytes);
    fs.writeFileSync(path.join(payloadDir, 'tools', '7za.sha256'), sha256(sevenZipBytes));

    // Components: build-tar layout is <key>.7z/.version/.sha256/.sentinel-sha256;
    // the payload contract keeps the same <key> naming (the engine renames to
    // component-<key>.* when staging for the shared validator).
    const manifestPath = path.join(componentsDir, 'manifest.json');
    if (!fs.existsSync(manifestPath)) fail(`component manifest missing: ${manifestPath}`);
    const targets = JSON.parse(
      fs.readFileSync(path.join(projectRoot, 'scripts', 'nsis-offline-components.json'), 'utf8'),
    );
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    if (!Array.isArray(manifest.components) || manifest.components.length !== targets.length) {
      fail('component manifest must contain every bundled Windows component');
    }
    componentArchiveBytes = 0;
    for (const target of targets) {
      const matches = manifest.components.filter(component => component.key === target.key);
      if (matches.length !== 1 || matches[0].prefix !== target.prefix) {
        fail(`component manifest mismatch: ${target.key}`);
      }
      const component = matches[0];
      const archive = path.join(componentsDir, `${target.key}.7z`);
      console.log(`[pack-setup] component ${target.key}: ${fs.statSync(archive).size} bytes`);
      if (
        sha256File(archive) !== component.archiveSha256 ||
        fs.statSync(archive).size !== component.archiveSizeBytes
      ) {
        fail(`component archive integrity mismatch: ${target.key}`);
      }
      componentArchiveBytes += component.archiveSizeBytes;
      for (const [suffix, expected] of [
        ['version', component.contentId],
        ['sha256', component.archiveSha256],
        ['sentinel-sha256', component.sentinelSha256],
      ]) {
        const file = path.join(componentsDir, `${target.key}.${suffix}`);
        if (!/^[a-f0-9]{64}$/.test(expected) || fs.readFileSync(file, 'utf8').trim() !== expected) {
          fail(`component integrity sidecar mismatch: ${target.key}.${suffix}`);
        }
      }
      for (const suffix of ['7z', 'version', 'sha256', 'sentinel-sha256']) {
        const file = `${target.key}.${suffix}`;
        fs.copyFileSync(path.join(componentsDir, file), path.join(payloadDir, 'components', file));
      }
    }

    fs.copyFileSync(manifestPath, path.join(payloadDir, 'component-manifest.json'));
    fs.copyFileSync(
      path.join(projectRoot, 'scripts', 'nsis-offline-components.json'),
      path.join(payloadDir, 'component-targets.json'),
    );
    for (const script of [
      'validate-offline-components.ps1',
      'recover-component-switch.ps1',
      'activate-components.ps1',
      'link-runtime-junctions.ps1',
      'cleanup-after-install.ps1',
      'uninstall-cleanup.ps1',
    ]) {
      fs.copyFileSync(
        path.join(projectRoot, 'scripts', 'installer', script),
        path.join(payloadDir, 'scripts', script),
      );
    }
    fs.copyFileSync(
      path.join(projectRoot, 'scripts', 'nsis-elevated-actions.ps1'),
      path.join(payloadDir, 'scripts', 'elevated-actions.ps1'),
    );
    // The engine runs the original redistributable from the extracted app's
    // resources directory. A second root-level copy wasted ~18 MiB per setup.
    fs.writeFileSync(path.join(payloadDir, 'version.txt'), packageVersion);
    // Preserve the native uninstaller already signed by electron-builder.
    // It has no duplicate self-contained .NET runtime and is never re-signed.
    fs.copyFileSync(uninstallHost, path.join(payloadDir, 'uninstall.exe'));
    console.log(`[pack-setup] native uninstall.exe: ${fs.statSync(uninstallHost).size} bytes`);
    assertPayloadDeduplication(payloadDir, uninstallHost);

    // Zip the payload directory.
    payloadZip = path.join(staging, 'payload.zip');
    const zip = spawnSync(sevenZip, ['a', '-tzip', '-mx=9', payloadZip, '.'], {
      cwd: payloadDir,
      encoding: 'utf8',
    });
    if (zip.status !== 0) fail(`payload ZIP failed:\n${zip.stdout}\n${zip.stderr}`);
    console.log(`[pack-setup] assembled payload (${fs.statSync(payloadZip).size} bytes)`);
  }

  const shellBytes = fs.statSync(shellExe).size;
  const payloadBytes = fs.statSync(payloadZip).size;
  const alignmentBytes = (8 - ((shellBytes + payloadBytes + FOOTER_BYTES) % 8)) % 8;
  const unsignedSetupBytes = shellBytes + payloadBytes + alignmentBytes + FOOTER_BYTES;
  const config = JSON.parse(
    fs.readFileSync(path.join(projectRoot, 'electron-builder.json'), 'utf8'),
  );
  const updater = path.join(
    projectRoot,
    'release',
    `${config.productName}-Setup-${packageVersion}.exe`,
  );
  const nsisUpdaterBytes = fs.existsSync(updater) ? fs.statSync(updater).size : null;
  const sizeReport = {
    shellBytes,
    payloadBytes,
    footerBytes: FOOTER_BYTES,
    alignmentBytes,
    unsignedSetupBytes,
    componentArchiveBytes,
    nonComponentBytes:
      componentArchiveBytes === null ? null : unsignedSetupBytes - componentArchiveBytes,
    nsisUpdaterBytes,
    nsisNonComponentBytes:
      componentArchiveBytes === null || nsisUpdaterBytes === null
        ? null
        : nsisUpdaterBytes - componentArchiveBytes,
    maxSetupBytes: MAX_SETUP_BYTES,
    maxComponentBytes: MAX_COMPONENT_BYTES,
    maxNonComponentBytes: MAX_NON_COMPONENT_BYTES,
    remainingSigningBytes: MAX_SETUP_BYTES - unsignedSetupBytes,
    // Existing NSIS gate values are reported for comparison, never increased.
    legacyBudgetSource: 'scripts/ci/windows-installer-size-smoke.ps1',
    legacyInstallerCeilingBytes: 450 * 1024 * 1024,
    legacyComponentCeilingBytes: 300 * 1024 * 1024,
    legacyNonComponentCeilingBytes: 150 * 1024 * 1024,
  };
  console.log(`[pack-setup] budget ${JSON.stringify(sizeReport)}`);
  fs.writeFileSync(
    path.join(path.dirname(shellExe), 'setup-size.json'),
    `${JSON.stringify(sizeReport, null, 2)}\n`,
  );
  if (componentArchiveBytes !== null) assertSetupBudget(unsignedSetupBytes, componentArchiveBytes);
  const outPath = path.resolve(outArg || `ZhiYuanAgent-Setup-${packageVersion}.exe`);
  appendPayload(shellExe, payloadZip, outPath);
  const report = writeSetupManifest(outPath, packageVersion);
  console.log(`[pack-setup] wrote ${outPath} (${report.installerBytes} bytes, ${report.sha256})`);
} finally {
  fs.rmSync(staging, { recursive: true, force: true });
}
