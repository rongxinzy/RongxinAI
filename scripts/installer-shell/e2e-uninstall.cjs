#!/usr/bin/env node

/*
 * Milestone C uninstall end-to-end: synthetic payload -> SFX install (real
 * registration, isolated roots) -> assert uninstall.exe / registry keys /
 * start-menu shortcut -> run <inst>\uninstall.exe --silent with unknown args
 * -> assert install dir, registry, shortcut, runtime cache and appDataRoot are
 * gone, real system untouched -> capture the confirm + in-progress pages.
 * Repeatable; recursive deletes are path-guarded to this process's mkdtemp
 * root (same safety shape as e2e-sfx.cjs).
 *
 *   node scripts/installer-shell/e2e-uninstall.cjs
 */
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..', '..');
const shellDir = path.join(projectRoot, 'scripts', 'installer-shell');
// realpathSync.native normalizes the legacy 8.3 short name some TEMP vars
// carry (C:\Users\ADMINI~1\...) via GetFinalPathNameByHandle, matching the
// long form the engine writes into registry.
const tempRoot = fs.realpathSync.native(
  fs.mkdtempSync(path.join(os.tmpdir(), 'zy-uninstall-e2e-')),
);
const payloadDir = path.join(tempRoot, 'payload');
const payloadZip = path.join(tempRoot, 'payload.zip');
const sfxExe = path.join(tempRoot, 'ZhiYuanAgent-Setup-sfx-e2e.exe');
const installDir = path.join(tempRoot, 'install');
const runtimeRoot = path.join(tempRoot, 'runtimes');
const appDataRoot = path.join(tempRoot, 'app-data');
const eventsLog = path.join(process.env.TEMP, 'zy-setup-events.jsonl');
const appGuid = '331369f7-5ab3-5702-935d-f3cff6ba8163';
const displayName = '知远智能体 (ZhiYuan Agent)';
const shotDir = path.join(projectRoot, 'docs', 'screenshots', 'installer-shell');

let failed = 0;
function check(ok, name) {
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + name);
  if (!ok) failed++;
}

function run(command, args) {
  const result = spawnSync(command, args, { cwd: projectRoot, encoding: 'utf8' });
  if (result.status !== 0) {
    console.error(result.stdout || '');
    console.error(result.stderr || '');
    throw new Error(`${command} exited with ${result.status}`);
  }
}

function ps(command) {
  return spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], {
    encoding: 'utf8',
  });
}

function sleep(ms) {
  spawnSync('powershell.exe', ['-NoProfile', '-Command', `Start-Sleep -Milliseconds ${ms}`]);
}

function readEvents() {
  if (!fs.existsSync(eventsLog)) return [];
  return fs
    .readFileSync(eventsLog, 'utf8')
    .trim()
    .split(/\r?\n/)
    .map(l => {
      try {
        return JSON.parse(l);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function waitForTerminalEvent(timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let events = [];
  while (Date.now() < deadline) {
    events = readEvents();
    if (events.some(e => e.type === 'done' || e.type === 'error')) return events;
    sleep(500);
  }
  return events;
}

function waitForGone(target, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!fs.existsSync(target)) return true;
    sleep(500);
  }
  return !fs.existsSync(target);
}

function regKeyExists(keyPath) {
  const result = ps(
    `$k = Get-Item -LiteralPath 'HKCU:\\${keyPath}' -ErrorAction SilentlyContinue; ` +
      'if ($k) { "yes" } else { "no" }',
  );
  return (result.stdout || '').trim() === 'yes';
}

function readRegValue(keyPath, name) {
  const result = ps(
    `(Get-ItemProperty -LiteralPath 'HKCU:\\${keyPath}' -ErrorAction SilentlyContinue).${name}`,
  );
  return (result.stdout || '').trim();
}

// Heal leftovers from a previously crashed run of this e2e: a registration
// whose InstallLocation no longer exists on disk is stale junk. A key
// pointing at an existing location means a real install is present and the
// run must not proceed.
function healStaleRegistryBaseline() {
  if (!regKeyExists(uninstallRegKey)) return true;
  const location = readRegValue(uninstallRegKey, 'InstallLocation');
  if (location && fs.existsSync(location)) return false;
  ps(
    `Remove-Item -LiteralPath 'HKCU:\\${uninstallRegKey}' -Recurse -Force -ErrorAction SilentlyContinue; ` +
      `Remove-Item -LiteralPath 'HKCU:\\${installRegKey}' -Recurse -Force -ErrorAction SilentlyContinue`,
  );
  console.log(
    'NOTE  healed stale e2e registry leftovers (InstallLocation missing: ' + location + ')',
  );
  return true;
}

const realRuntimeRoot = path.join(process.env.LOCALAPPDATA, 'ZhiYuanAgent', 'runtimes');
const realAppDataRoot = path.join(process.env.APPDATA, 'ZhiYuanAgent');
const shortcutPath = path.join(
  process.env.APPDATA,
  'Microsoft',
  'Windows',
  'Start Menu',
  'Programs',
  displayName + '.lnk',
);
const installRegKey = 'Software\\' + appGuid;
const uninstallRegKey = 'Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\' + appGuid;

// Deletion safety: recursive deletes are only allowed inside this process's
// own mkdtemp root; the real-cache rmdir must target exactly the known
// runtime/appdata leaves. A path mismatch aborts the run instead of deleting.
function safeRmRecursive(target) {
  const resolved = path.resolve(target);
  const root = path.resolve(tempRoot);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    throw new Error(`refusing recursive delete outside the temp root: ${resolved}`);
  }
  fs.rmSync(resolved, { recursive: true, force: true });
}

function safeRmTempStale(target) {
  const resolved = path.resolve(target);
  const temp = path.resolve(process.env.TEMP);
  if (path.dirname(resolved) !== temp || !path.basename(resolved).startsWith('zhiyuan-setup-')) {
    throw new Error(`refusing recursive delete of non-staging temp dir: ${resolved}`);
  }
  fs.rmSync(resolved, { recursive: true, force: true });
}

function safeRmdirRealRuntimeIfEmpty() {
  if (
    path.resolve(realRuntimeRoot) !==
    path.join(path.resolve(process.env.LOCALAPPDATA), 'ZhiYuanAgent', 'runtimes')
  ) {
    throw new Error(`unexpected real runtime path: ${realRuntimeRoot}`);
  }
  if (fs.existsSync(realRuntimeRoot) && fs.readdirSync(realRuntimeRoot).length === 0) {
    fs.rmdirSync(realRuntimeRoot);
  }
}

function cleanupGuard() {
  // Only touch the real registry/shortcut when they still point inside this
  // run's temp root (i.e. we created them and the uninstaller did not finish).
  const result = ps(
    `$k = Get-ItemProperty -LiteralPath 'HKCU:\\${uninstallRegKey}' -ErrorAction SilentlyContinue; ` +
      `if ($k -and $k.InstallLocation -and $k.InstallLocation.StartsWith('${tempRoot}')) { ` +
      `Remove-Item -LiteralPath 'HKCU:\\${uninstallRegKey}' -Recurse -Force; ` +
      `Remove-Item -LiteralPath 'HKCU:\\${installRegKey}' -Recurse -Force -ErrorAction SilentlyContinue; "cleaned" } else { "left" }`,
  );
  if (fs.existsSync(shortcutPath)) {
    // The baseline asserted the shortcut was absent before we ran, so any
    // copy here is ours.
    try {
      fs.rmSync(shortcutPath);
    } catch {}
  }
  return (result.stdout || '').trim();
}

try {
  spawnSync('powershell.exe', [
    '-NoProfile',
    '-Command',
    'Get-Process ZhiYuanSetupShell -ErrorAction SilentlyContinue | ForEach-Object { taskkill /F /PID $_.Id 2>&1 | Out-Null }',
  ]);
  run(process.execPath, [path.join(shellDir, 'build-shell.cjs')]);

  // Baseline: machine must be clean so end-state assertions are meaningful.
  // The real %APPDATA%\ZhiYuanAgent may legitimately exist on a dev machine
  // (it is the running app's data dir); the e2e must leave it untouched.
  safeRmdirRealRuntimeIfEmpty();
  check(healStaleRegistryBaseline(), 'baseline: no live install registration present');
  check(!regKeyExists(installRegKey), 'baseline: install registry key absent');
  check(!regKeyExists(uninstallRegKey), 'baseline: uninstall registry key absent');
  check(!fs.existsSync(shortcutPath), 'baseline: start-menu shortcut absent');
  check(
    !fs.existsSync(realAppDataRoot) || fs.existsSync(path.join(realAppDataRoot, 'zhiyuan.sqlite')),
    'baseline: real appDataRoot (if present) is a live data dir, left alone',
  );
  const realSqliteMtime = fs.existsSync(path.join(realAppDataRoot, 'zhiyuan.sqlite'))
    ? fs.statSync(path.join(realAppDataRoot, 'zhiyuan.sqlite')).mtimeMs
    : 0;
  for (const stale of fs.readdirSync(process.env.TEMP)) {
    if (stale.startsWith('zhiyuan-setup-')) safeRmTempStale(path.join(process.env.TEMP, stale));
  }

  run(process.execPath, [path.join(shellDir, 'make-test-payload.cjs'), '--out', payloadDir]);
  run('powershell.exe', [
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    `Compress-Archive -Path "${payloadDir}\\*" -DestinationPath "${payloadZip}" -Force`,
  ]);
  run(process.execPath, [
    path.join(shellDir, 'pack-setup.cjs'),
    '--payload-zip',
    payloadZip,
    '--out',
    sfxExe,
  ]);

  // --- install with real registration, isolated roots -----------------------
  if (fs.existsSync(eventsLog)) fs.rmSync(eventsLog);
  let launched = ps(
    'Start-Process -FilePath "' +
      sfxExe +
      '" -ArgumentList ' +
      `'--auto-install','--install-dir','${installDir}','--runtime-root','${runtimeRoot}','--app-data-root','${appDataRoot}'`,
  );
  if (launched.status !== 0) throw new Error('failed to launch SFX installer');
  let events = waitForTerminalEvent(180000);
  spawnSync('powershell.exe', [
    '-NoProfile',
    '-Command',
    "Get-Process | Where-Object { $_.Name -like 'ZhiYuanAgent-Setup-sfx-e2e' } | ForEach-Object { taskkill /F /PID $_.Id 2>&1 | Out-Null }",
  ]);
  check(
    events.some(e => e.type === 'done'),
    'install completes with done event',
  );
  check(
    fs.existsSync(path.join(installDir, 'uninstall.exe')),
    'uninstall.exe shipped next to the app',
  );
  check(
    fs.existsSync(path.join(installDir, 'scripts', 'uninstall-cleanup.ps1')),
    'shared uninstall-cleanup.ps1 staged in the install dir',
  );
  check(regKeyExists(installRegKey), 'install registry key written');
  check(regKeyExists(uninstallRegKey), 'uninstall registry key written');
  const expectedUninstallString = `"${installDir}\\uninstall.exe"`;
  const actualUninstallString = readRegValue(uninstallRegKey, 'UninstallString');
  check(
    actualUninstallString === expectedUninstallString,
    'UninstallString points at uninstall.exe (got ' +
      JSON.stringify(actualUninstallString) +
      ' want ' +
      JSON.stringify(expectedUninstallString) +
      ')',
  );
  const expectedQuietString = `"${installDir}\\uninstall.exe" --silent`;
  const actualQuietString = readRegValue(uninstallRegKey, 'QuietUninstallString');
  check(
    actualQuietString === expectedQuietString,
    'QuietUninstallString is uninstall.exe --silent (got ' +
      JSON.stringify(actualQuietString) +
      ' want ' +
      JSON.stringify(expectedQuietString) +
      ')',
  );
  check(fs.existsSync(shortcutPath), 'start-menu shortcut created');

  // --- silent uninstall: unknown args must be ignored -----------------------
  if (fs.existsSync(eventsLog)) fs.rmSync(eventsLog);
  const uninstallExe = path.join(installDir, 'uninstall.exe');
  const silent = spawnSync(
    uninstallExe,
    [
      '--silent',
      '--runtime-root',
      runtimeRoot,
      '--app-data-root',
      appDataRoot,
      '--install-dir',
      installDir,
      '/S',
      '--updated',
      '--keep-shortcuts',
      '/currentuser',
    ],
    { encoding: 'utf8', timeout: 120000 },
  );
  check(silent.status === 0, 'uninstall.exe --silent exits 0 (got ' + silent.status + ')');
  events = readEvents();
  check(
    events.some(e => e.type === 'done'),
    'uninstall reports done event',
  );
  const phases = events.filter(e => e.type === 'phase').map(e => e.label);
  check(
    phases.some(l => l && l.includes('离线运行环境')),
    'uninstall ran the runtime cleanup phase',
  );

  // The detached rd retry loop finishes once the silent process exits; the
  // runtime cache is renamed to .uninstall.<tick> and reclaimed in the
  // background, so poll for both shapes.
  const detachedGone = () =>
    !fs.existsSync(runtimeRoot) &&
    !fs.readdirSync(path.dirname(runtimeRoot)).some(n => n.startsWith('runtimes.uninstall.'));
  const runtimeDeadline = Date.now() + 60000;
  while (Date.now() < runtimeDeadline && !detachedGone()) sleep(500);
  check(waitForGone(installDir, 60000), 'install directory removed');
  check(detachedGone(), 'runtime cache removed (including detached cache)');
  check(!fs.existsSync(appDataRoot), 'appDataRoot deleted (deleteAppDataOnUninstall semantics)');
  check(!regKeyExists(installRegKey), 'install registry key removed');
  check(!regKeyExists(uninstallRegKey), 'uninstall registry key removed');
  check(!fs.existsSync(shortcutPath), 'start-menu shortcut removed');

  // Zero pollution on the real system; the live app data dir must be byte-identical.
  check(!fs.existsSync(realRuntimeRoot), 'real runtime cache absent after uninstall');
  check(
    realSqliteMtime === 0 ||
      (fs.existsSync(path.join(realAppDataRoot, 'zhiyuan.sqlite')) &&
        fs.statSync(path.join(realAppDataRoot, 'zhiyuan.sqlite')).mtimeMs === realSqliteMtime),
    'real appDataRoot untouched by the isolated uninstall',
  );
  const staleLeft = fs.readdirSync(process.env.TEMP).filter(n => n.startsWith('zhiyuan-setup-'));
  check(staleLeft.length === 0, 'no stale zhiyuan-setup-* temp dirs (' + staleLeft.length + ')');

  // --- UI captures: confirm page + real in-progress page --------------------
  fs.mkdirSync(shotDir, { recursive: true });
  const confirmShot = path.join(shotDir, 'uninstall-confirm.png');
  const progressShot = path.join(shotDir, 'uninstall-progress.png');
  for (const stale of [confirmShot, progressShot]) {
    if (fs.existsSync(stale)) fs.rmSync(stale);
  }
  const shotRoots = path.join(tempRoot, 'shots');
  const shotArgs = [
    '--uninstall',
    '--install-dir',
    path.join(shotRoots, 'inst'),
    '--runtime-root',
    path.join(shotRoots, 'rt'),
    '--app-data-root',
    path.join(shotRoots, 'ad'),
  ];
  launched = ps(
    'Start-Process -FilePath "' +
      sfxExe +
      '" -ArgumentList ' +
      shotArgs.map(a => `'${a}'`).join(',') +
      `,'--capture-preview','${confirmShot}'`,
  );
  if (launched.status !== 0) throw new Error('failed to launch confirm capture');
  for (let i = 0; i < 60 && !fs.existsSync(confirmShot); i++) sleep(500);
  check(fs.existsSync(confirmShot), 'uninstall confirm page captured');

  launched = ps(
    'Start-Process -FilePath "' +
      sfxExe +
      '" -ArgumentList ' +
      shotArgs.map(a => `'${a}'`).join(',') +
      `,'--auto-uninstall','--capture-delay','4500','--capture-preview','${progressShot}'`,
  );
  if (launched.status !== 0) throw new Error('failed to launch progress capture');
  for (let i = 0; i < 90 && !fs.existsSync(progressShot); i++) sleep(500);
  check(fs.existsSync(progressShot), 'uninstall in-progress page captured');
  spawnSync('powershell.exe', [
    '-NoProfile',
    '-Command',
    "Get-Process | Where-Object { $_.Name -like 'ZhiYuanAgent-Setup-sfx-e2e' } | ForEach-Object { taskkill /F /PID $_.Id 2>&1 | Out-Null }",
  ]);
} finally {
  spawnSync('powershell.exe', [
    '-NoProfile',
    '-Command',
    "Get-Process | Where-Object { $_.Name -like 'ZhiYuanAgent-Setup-sfx-e2e' -or $_.Name -eq 'uninstall' } | ForEach-Object { taskkill /F /PID $_.Id 2>&1 | Out-Null }",
  ]);
  const guard = cleanupGuard();
  if (guard === 'cleaned')
    console.log('NOTE  registry cleanup guard removed leftover temp-root keys');
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      safeRmRecursive(tempRoot);
      break;
    } catch {
      sleep(800);
    }
  }
}

process.exit(failed ? 1 : 0);
