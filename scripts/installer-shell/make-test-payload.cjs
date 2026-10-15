#!/usr/bin/env node

/*
 * Builds a minimal synthetic installer payload for engine end-to-end
 * verification (docs/2026-10-12-windows-installer-webview2-shell.zh-CN.md).
 *
 *   node scripts/installer-shell/make-test-payload.cjs --out <dir>
 *
 * Layout matches the payload contract:
 *   app.7z (fake app tree) · tools/7za.exe + .sha256 · components/<key>.7z with
 *   .version/.sha256/.sentinel-sha256 · component-manifest.json ·
 *   component-targets.json · scripts/*.ps1 (shared repo sources) ·
 *   uninstall.exe (retained native host) · version.txt
 */
const { spawnSync } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..', '..');
const sevenZip = path.join(projectRoot, 'node_modules', '7zip-bin', 'win', 'x64', '7za.exe');
const targets = JSON.parse(
  fs.readFileSync(path.join(projectRoot, 'scripts', 'nsis-offline-components.json'), 'utf8'),
);

const outIndex = process.argv.indexOf('--out');
const outDir = outIndex >= 0 ? path.resolve(process.argv[outIndex + 1]) : null;
if (!outDir) {
  console.error('usage: node make-test-payload.cjs --out <dir>');
  process.exit(1);
}

function fail(message) {
  console.error(`[test-payload] ${message}`);
  process.exit(1);
}

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function runSevenZip(args, cwd) {
  const run = spawnSync(sevenZip, args, { cwd, encoding: 'utf8' });
  if (run.status !== 0) fail(`7za failed: ${run.stdout}\n${run.stderr}`);
}

const staging = fs.mkdtempSync(path.join(os.tmpdir(), 'zy-payload-'));
fs.rmSync(outDir, { recursive: true, force: true });
for (const dir of ['tools', 'components', 'scripts']) {
  fs.mkdirSync(path.join(outDir, dir), { recursive: true });
}

try {
  // --- fake application tree -> app.7z -----------------------------------
  const appRoot = path.join(staging, 'app-root');
  fs.mkdirSync(path.join(appRoot, 'resources'), { recursive: true });
  fs.writeFileSync(path.join(appRoot, '知远.exe'), 'fake application executable\n');
  fs.writeFileSync(path.join(appRoot, 'resources', 'app.asar'), 'fake asar\n');
  // Harmless placeholder in the same installed location as the real payload.
  fs.copyFileSync(sevenZip, path.join(appRoot, 'resources', 'vc_redist.x64.exe'));
  fs.writeFileSync(path.join(appRoot, 'LICENSE.txt'), 'synthetic payload\n');
  runSevenZip(['a', path.join(outDir, 'app.7z'), '知远.exe', 'resources', 'LICENSE.txt'], appRoot);

  // --- tools --------------------------------------------------------------
  const sevenZipBytes = fs.readFileSync(sevenZip);
  fs.writeFileSync(path.join(outDir, 'tools', '7za.exe'), sevenZipBytes);
  fs.writeFileSync(path.join(outDir, 'tools', '7za.sha256'), sha256(sevenZipBytes));

  // --- components ---------------------------------------------------------
  const manifest = { components: [] };
  for (const component of targets) {
    const compRoot = path.join(staging, 'components', component.key);
    fs.mkdirSync(compRoot, { recursive: true });
    // Each sentinel becomes a small placeholder file inside the archive.
    const sentinelPath = path.join(compRoot, component.sentinel);
    fs.mkdirSync(path.dirname(sentinelPath), { recursive: true });
    const sentinelBody = `synthetic sentinel for ${component.key}\n`;
    fs.writeFileSync(sentinelPath, sentinelBody);

    const archive = path.join(outDir, 'components', `${component.key}.7z`);
    // Archive entries carry the prefix layout (what the validator's safe-path
    // check expects); run 7za from the component root so paths stay relative.
    runSevenZip(['a', archive, component.prefix], compRoot);
    const archiveBytes = fs.readFileSync(archive);
    const contentId = sha256(archiveBytes);
    fs.writeFileSync(path.join(outDir, 'components', `${component.key}.version`), contentId);
    fs.writeFileSync(path.join(outDir, 'components', `${component.key}.sha256`), contentId);
    fs.writeFileSync(
      path.join(outDir, 'components', `${component.key}.sentinel-sha256`),
      sha256(Buffer.from(sentinelBody)),
    );
    manifest.components.push({
      key: component.key,
      prefix: component.prefix,
      contentId,
    });
  }
  fs.writeFileSync(path.join(outDir, 'component-manifest.json'), JSON.stringify(manifest, null, 2));
  fs.copyFileSync(
    path.join(projectRoot, 'scripts', 'nsis-offline-components.json'),
    path.join(outDir, 'component-targets.json'),
  );

  // --- shared scripts (repo-unique sources) --------------------------------
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
      path.join(outDir, 'scripts', script),
    );
  }
  fs.copyFileSync(
    path.join(projectRoot, 'scripts', 'nsis-elevated-actions.ps1'),
    path.join(outDir, 'scripts', 'elevated-actions.ps1'),
  );

  fs.writeFileSync(path.join(outDir, 'version.txt'), '0.0.0-test');
  const uninstallHost = path.join(
    projectRoot,
    'scripts',
    'installer-shell',
    'out',
    'ZhiYuanUninstall.exe',
  );
  if (!fs.existsSync(uninstallHost)) fail('Build the NSIS target before creating the test payload');
  fs.copyFileSync(uninstallHost, path.join(outDir, 'uninstall.exe'));

  console.log(`[test-payload] payload written to ${outDir}`);
} finally {
  fs.rmSync(staging, { recursive: true, force: true });
}
