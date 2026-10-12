#!/usr/bin/env node

/*
 * Preview harness for the custom NSIS installer UI. Compiles
 * scripts/installer-ui/preview.nsi with the repository's local makensis
 * (.cache/nsis) — no application payload or electron-builder run needed —
 * and optionally launches the result so the pages can be reviewed.
 *
 *   node scripts/installer-ui/build-preview.cjs [--run]
 *       [--from=progress|finish|uninstall]
 *
 * --from selects the first wizard page for unattended visual review of the
 * later pages (default: the full page flow starting at the hero page).
 * --from=uninstall compiles the uninstaller writer, runs it to emit
 * zy-ui-preview-un.exe, and reviews that (mirroring how electron-builder
 * produces the uninstaller). --run starts the preview, leaves it up for 8
 * seconds and terminates it; a non-zero exit from makensis or a crashed
 * preview fails the script.
 */
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..', '..');
const uiDir = path.join(projectRoot, 'scripts', 'installer-ui');
const makensis = path.join(projectRoot, '.cache', 'nsis', 'makensis.exe');
const licenseSource = path.join(projectRoot, 'LICENSE');
const licenseTarget = path.join(projectRoot, 'build', 'installer-assets', 'license.txt');
const previewExe = path.join(uiDir, 'zy-ui-preview.exe');
const uninstallerExe = path.join(uiDir, 'zy-ui-preview-un.exe');
const runPreview = process.argv.includes('--run');
const fromArg = process.argv.find(arg => arg.startsWith('--from='));
const startPage = fromArg ? fromArg.slice('--from='.length) : '';

function fail(message) {
  console.error(`[installer-ui preview] ${message}`);
  process.exitCode = 1;
}

// The hero page links the bundled license text; make sure it exists even
// when the asset generator has not been run in this checkout.
if (!fs.existsSync(licenseTarget)) {
  fs.mkdirSync(path.dirname(licenseTarget), { recursive: true });
  fs.copyFileSync(licenseSource, licenseTarget);
  console.log('[installer-ui preview] copied LICENSE to build/installer-assets/license.txt');
}

if (!fs.existsSync(makensis)) {
  fail(`makensis not found at ${makensis}`);
  return;
}

// Forward slashes keep the -D values safe from shell/backslash mangling;
// NSIS accepts them in File paths. -INPUTCHARSET/-WX mirror the real
// electron-builder invocation so the preview fails on the same conditions.
const projectDirDefine = projectRoot.replace(/\\/g, '/');
const defines = ['-WX', '-INPUTCHARSET', 'UTF8', `/DPROJECT_DIR=${projectDirDefine}`];
if (startPage && startPage !== 'uninstall') {
  defines.push(`/DZY_PREVIEW_FROM=${startPage}`);
}
if (startPage === 'uninstall') {
  defines.push('/DZY_PREVIEW_UNINSTALLER', '/DBUILD_UNINSTALLER');
}

function compilePreview(extraDefines) {
  const compile = spawnSync(makensis, [...defines, ...extraDefines, 'preview.nsi'], {
    cwd: uiDir,
    encoding: 'utf8',
  });
  process.stdout.write(compile.stdout || '');
  process.stderr.write(compile.stderr || '');
  return compile.status === 0;
}

function launch(exe, seconds) {
  const child = spawnSync('cmd.exe', ['/c', 'start', '', exe], {
    cwd: uiDir,
    stdio: 'ignore',
  });
  if (child.error) {
    fail(`failed to start preview: ${child.error.message}`);
    return false;
  }
  spawnSync('powershell.exe', [
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    `Start-Sleep -Seconds ${seconds}`,
  ]);
  return true;
}

if (startPage === 'uninstall') {
  const writerExe = path.join(uiDir, 'zy-ui-preview-unwriter.exe');
  fs.rmSync(uninstallerExe, { force: true });
  if (!compilePreview([])) {
    fail('makensis (uninstaller writer) failed');
    return;
  }
  if (!fs.existsSync(writerExe)) {
    fail('uninstaller writer was not created');
    return;
  }
  // The writer runs silent: it emits zy-ui-preview-un.exe and quits.
  const write = spawnSync(writerExe, [], { cwd: uiDir, stdio: 'ignore' });
  if (write.error || !fs.existsSync(uninstallerExe)) {
    fail('uninstaller writer did not produce zy-ui-preview-un.exe');
    return;
  }
  console.log(`[installer-ui preview] built ${uninstallerExe}`);
  if (runPreview) {
    // The writer launches the real uninstaller and waits on its lifetime
    // mutex, so the whole tree stays alive for the run duration.
    if (!launch(writerExe, 8)) return;
    spawnSync('taskkill.exe', ['/F', '/IM', 'zy-ui-preview-unwriter.exe'], {
      encoding: 'utf8',
    });
    spawnSync('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      "Get-Process | Where-Object { $_.MainWindowTitle -like '*Installer UI Preview*' } | ForEach-Object { taskkill /F /PID $_.Id 2>&1 | Out-Null }",
    ]);
    console.log('[installer-ui preview] run completed without a crash');
  }
  return;
}

if (!compilePreview([])) {
  fail('makensis exited with code non-zero');
  return;
}
if (!fs.existsSync(previewExe)) {
  fail('makensis reported success but zy-ui-preview.exe was not created');
  return;
}
console.log(`[installer-ui preview] built ${previewExe}`);

if (runPreview) {
  if (!launch(previewExe, 8)) return;
  const kill = spawnSync('taskkill.exe', ['//F', '//IM', 'zy-ui-preview.exe'], {
    encoding: 'utf8',
  });
  console.log(`[installer-ui preview] ${(kill.stdout || '').trim() || 'preview already exited'}`);
  console.log('[installer-ui preview] run completed without a crash');
}
