#!/usr/bin/env node

/*
 * Milestone A engine end-to-end with isolated state: runs the shell exe with
 * --payload plus overridden runtime/app-data roots and --skip-registration,
 * then asserts the event sequence and the install tree shape. Never touches
 * the real runtime cache, the registry, or the start menu.
 *
 *   node scripts/installer-shell/assert-e2e.cjs
 */
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..', '..');
const exe = path.join(projectRoot, 'scripts', 'installer-shell', 'out', 'ZhiYuanSetupShell.exe');
const payloadDir = path.join(projectRoot, '.cache', 'test-payload');
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'zy-engine-e2e-'));
const installDir = path.join(tempRoot, 'install');
const runtimeRoot = path.join(tempRoot, 'runtimes');
const appDataRoot = path.join(tempRoot, 'app-data');
const eventsLog = path.join(process.env.TEMP, 'zy-setup-events.jsonl');
const realRuntimeRoot = path.join(process.env.LOCALAPPDATA, 'ZhiYuanAgent', 'runtimes');

let failed = 0;
function check(ok, name) {
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + name);
  if (!ok) failed++;
}

// Deletion safety: the only recursive delete in this script is the mkdtemp
// root; refuse anything outside it, and the real-cache rmdir must target
// exactly the known runtime leaf and only when empty.
function safeRmRecursive(target) {
  const resolved = path.resolve(target);
  const root = path.resolve(tempRoot);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    throw new Error(`refusing recursive delete outside the temp root: ${resolved}`);
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
  // Hygiene baseline: an empty real cache (leftover from an older run) is
  // removed so the end assertion can demand the path does not exist.
  safeRmdirRealRuntimeIfEmpty();
  if (fs.existsSync(eventsLog)) fs.rmSync(eventsLog);
  const launch = spawnSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      'Start-Process -FilePath "' +
        exe +
        '" -ArgumentList ' +
        `'--payload','${payloadDir}','--auto-install','--install-dir','${installDir}','--runtime-root','${runtimeRoot}','--app-data-root','${appDataRoot}','--skip-registration'`,
    ],
    { encoding: 'utf8' },
  );
  if (launch.status !== 0) throw new Error('failed to launch shell');

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
    'Get-Process ZhiYuanSetupShell -ErrorAction SilentlyContinue | ForEach-Object { taskkill /F /PID $_.Id 2>&1 | Out-Null }',
  ]);

  const phases = events.filter(e => e.type === 'phase');
  const progress = events.filter(e => e.type === 'progress');
  check(events[events.length - 1]?.type === 'done', 'ends with done');
  check(phases.length >= 9, 'phase count ' + phases.length + ' >= 9');
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
    progress.length > 0 && monotonic,
    'monotonic percent within phase runs (' + progress.length + ' events)',
  );

  const manifest = JSON.parse(
    fs.readFileSync(path.join(payloadDir, 'component-manifest.json'), 'utf8'),
  );
  for (const component of manifest.components) {
    const link = path.join(installDir, 'resources', component.prefix);
    const stat = fs.existsSync(link) ? fs.lstatSync(link) : null;
    const isJunction =
      stat !== null &&
      (stat.isSymbolicLink() || (stat.isDirectory() && (stat.mode & 0o120000) !== 0));
    const complete = path.join(runtimeRoot, component.key, component.contentId, '.complete');
    check(isJunction, 'junction ' + component.prefix);
    check(fs.existsSync(complete), '.complete ' + component.key);
  }
  check(
    fs.existsSync(path.join(installDir, '知远.exe')) &&
      fs.existsSync(path.join(installDir, 'resources', 'uv-win', 'uv.exe')),
    'fake app + sentinels installed',
  );
  const marker = path.join(appDataRoot, 'pending-local-inference-install');
  check(!fs.existsSync(marker), 'pending-inference marker absent (localInference=false)');

  // Zero pollution: the real runtime cache must not exist after the run.
  check(!fs.existsSync(realRuntimeRoot), 'real runtime cache absent after run');
} finally {
  spawnSync('powershell.exe', [
    '-NoProfile',
    '-Command',
    'Get-Process ZhiYuanSetupShell -ErrorAction SilentlyContinue | ForEach-Object { taskkill /F /PID $_.Id 2>&1 | Out-Null }',
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
