#!/usr/bin/env node

/*
 * Milestone B SFX end-to-end: synthetic payload -> payload.zip -> append to
 * the shell exe -> run the single file with isolated roots and no
 * registration -> assert self-extraction, event sequence and install tree ->
 * clean up. Repeatable; never touches the real runtime cache, registry, or
 * start menu.
 *
 *   node scripts/installer-shell/e2e-sfx.cjs
 */
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..', '..');
const shellDir = path.join(projectRoot, 'scripts', 'installer-shell');
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'zy-sfx-e2e-'));
const payloadDir = path.join(tempRoot, 'payload');
const payloadZip = path.join(tempRoot, 'payload.zip');
const sfxExe = path.join(tempRoot, 'ZhiYuanAgent-Setup-sfx-e2e.exe');
const installDir = path.join(tempRoot, 'install');
const runtimeRoot = path.join(tempRoot, 'runtimes');
const appDataRoot = path.join(tempRoot, 'app-data');
const eventsLog = path.join(process.env.TEMP, 'zy-setup-events.jsonl');

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

const realRuntimeRoot = path.join(process.env.LOCALAPPDATA, 'ZhiYuanAgent', 'runtimes');

// Deletion safety: recursive deletes are only allowed inside this process's
// own mkdtemp root, and the real-cache rmdir must target exactly the known
// runtime leaf. A path mismatch aborts the run instead of deleting.
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

try {
  // Fresh shell first: this script packs out/ZhiYuanSetupShell.exe, and a
  // stale exe (e.g. predating --runtime-root) would silently ignore the
  // isolation flags and write to the real cache.
  spawnSync('powershell.exe', [
    '-NoProfile',
    '-Command',
    'Get-Process ZhiYuanSetupShell -ErrorAction SilentlyContinue | ForEach-Object { taskkill /F /PID $_.Id 2>&1 | Out-Null }',
  ]);
  run(process.execPath, [path.join(shellDir, 'build-shell.cjs')]);

  // Hygiene baseline: an empty real cache (leftover from an older run) is
  // removed so the end assertion can demand the path does not exist.
  safeRmdirRealRuntimeIfEmpty();
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

  if (fs.existsSync(eventsLog)) fs.rmSync(eventsLog);
  // Machine must be clean before we start: no stray self-extract dirs.
  for (const stale of fs.readdirSync(process.env.TEMP)) {
    if (stale.startsWith('zhiyuan-setup-')) {
      safeRmTempStale(path.join(process.env.TEMP, stale));
    }
  }

  const launched = spawnSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      'Start-Process -FilePath "' +
        sfxExe +
        '" -ArgumentList ' +
        `'--auto-install','--install-dir','${installDir}','--runtime-root','${runtimeRoot}','--app-data-root','${appDataRoot}','--skip-registration'`,
    ],
    { encoding: 'utf8' },
  );
  if (launched.status !== 0) throw new Error('failed to launch SFX exe');

  // Wait for the self-extract phase, then verify the extraction dir mid-run.
  var extractDir = null;
  for (let i = 0; i < 120 && !extractDir; i++) {
    if (fs.existsSync(eventsLog)) {
      for (const line of fs.readFileSync(eventsLog, 'utf8').trim().split(/\r?\n/)) {
        try {
          const evt = JSON.parse(line);
          if (evt.type === 'phase' && evt.detail && evt.detail.includes('zhiyuan-setup-')) {
            extractDir = evt.detail;
          }
        } catch {}
      }
    }
    if (!extractDir)
      spawnSync('powershell.exe', ['-NoProfile', '-Command', 'Start-Sleep -Milliseconds 500']);
  }
  check(extractDir !== null, 'self-extract phase reported its directory');
  check(
    extractDir !== null &&
      fs.existsSync(extractDir) &&
      fs.existsSync(path.join(extractDir, 'app.7z')) &&
      fs.existsSync(path.join(extractDir, 'component-manifest.json')),
    'self-extract dir contains app.7z and manifest mid-run',
  );

  // Wait for completion.
  let events = [];
  for (let i = 0; i < 240; i++) {
    if (fs.existsSync(eventsLog)) {
      events = fs
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
      if (events.some(e => e.type === 'done' || e.type === 'error')) break;
    }
    spawnSync('powershell.exe', ['-NoProfile', '-Command', 'Start-Sleep -Milliseconds 500']);
  }
  spawnSync('powershell.exe', [
    '-NoProfile',
    '-Command',
    "Get-Process | Where-Object { $_.Name -like 'ZhiYuanAgent-Setup-sfx-e2e' } | ForEach-Object { taskkill /F /PID $_.Id 2>&1 | Out-Null }",
  ]);

  const phases = events.filter(e => e.type === 'phase');
  const progress = events.filter(e => e.type === 'progress');
  check(events[events.length - 1]?.type === 'done', 'install completes with done event');
  check(phases.length >= 9, 'phase count ' + phases.length + ' >= 9');
  // Percent is monotonic within a phase run (self-extract and app extraction
  // are separate 0-100 domains separated by phase events).
  let previous = -1;
  let monotonic = true;
  for (const evt of events) {
    if (evt.type === 'phase') {
      previous = -1;
      continue;
    }
    if (evt.type !== 'progress') continue;
    if (evt.percent < previous) monotonic = false;
    previous = evt.percent;
  }
  check(
    progress.length > 0 && monotonic && progress.every(e => e.percent >= 0 && e.percent <= 100),
    'monotonic percent events within phase runs (' + progress.length + ')',
  );

  // Install tree shape under the isolated roots.
  const manifest = JSON.parse(
    fs.readFileSync(path.join(payloadDir, 'component-manifest.json'), 'utf8'),
  );
  let treeOk = true;
  for (const component of manifest.components) {
    const link = path.join(installDir, 'resources', component.prefix);
    const complete = path.join(runtimeRoot, component.key, component.contentId, '.complete');
    if (!fs.existsSync(link) || !fs.existsSync(complete)) treeOk = false;
  }
  check(treeOk, 'all 7 resources junctions + .complete sentinels present');
  check(
    fs.existsSync(path.join(installDir, '知远.exe')) &&
      fs.existsSync(path.join(installDir, 'resources', 'python-win', 'python.exe')),
    'fake app + python sentinel installed',
  );

  // Zero pollution: extraction dir removed, real runtime cache untouched,
  // no registry write happened (skip-registration), no stale temp dirs.
  check(!extractDir || !fs.existsSync(extractDir), 'self-extract dir cleaned on exit');
  check(!fs.existsSync(realRuntimeRoot), 'real runtime cache absent after run');
  const staleLeft = fs.readdirSync(process.env.TEMP).filter(n => n.startsWith('zhiyuan-setup-'));
  check(staleLeft.length === 0, 'no stale zhiyuan-setup-* temp dirs (' + staleLeft.length + ')');
} finally {
  spawnSync('powershell.exe', [
    '-NoProfile',
    '-Command',
    "Get-Process | Where-Object { $_.Name -like 'ZhiYuanAgent-Setup-sfx-e2e' } | ForEach-Object { taskkill /F /PID $_.Id 2>&1 | Out-Null }",
  ]);
  // Best-effort temp cleanup: a file can stay locked briefly after the
  // killed process exits; never let that mask a passed run.
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      safeRmRecursive(tempRoot);
      break;
    } catch {
      spawnSync('powershell.exe', ['-NoProfile', '-Command', 'Start-Sleep -Milliseconds 800']);
    }
  }
}

process.exit(failed ? 1 : 0);
