import fs, { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { load as loadYaml } from 'js-yaml';
import { expect, test } from 'vitest';
import {
  assertDetachedTransaction,
  assertShellIdentity,
  observeDetachedUpgrade,
  shellChecks,
  shellScreenshots,
} from './windows-shell-evidence.mjs';
import { assertVisibleActions } from './windows-shell-interactive.mjs';

const script = readFileSync('scripts/ci/windows-shell-interactive.mjs', 'utf8');
const workflow = readFileSync('.github/workflows/windows-installer-pr.yml', 'utf8');

function identity() {
  const expected = {
    commit: 'commit-a',
    runId: 'run-a',
    installerSha256: 'a'.repeat(64),
    installedExecutable: '/runner/shell-installed/app.exe',
  };
  const report = {
    ...expected,
    kind: 'webview2-shell-interactive-acceptance',
    passed: true,
    checks: Object.fromEntries(shellChecks.map(check => [check, true])),
  };
  return { expected, report };
}

function snapshot() {
  return {
    hosted: true,
    dpr: 1.5,
    width: 860,
    height: 560,
    actions: [
      {
        selector: '#btnDone',
        x: 300,
        y: 400,
        width: 100,
        height: 40,
        visible: true,
        textFits: true,
        hit: true,
      },
      {
        selector: '#btnLaunch',
        x: 420,
        y: 400,
        width: 180,
        height: 40,
        visible: true,
        textFits: true,
        hit: true,
      },
    ],
  };
}

test('accepts only the exact passing shell installer, commit, run and installed app', () => {
  const { report, expected } = identity();
  expect(() => assertShellIdentity(report, expected)).not.toThrow();
  for (const change of [
    { kind: 'nsis-interactive-acceptance' },
    { passed: false },
    { installerSha256: 'b'.repeat(64) },
    { commit: 'other' },
    { runId: 'other' },
    { installedExecutable: '/runner/nsis-installed/app.exe' },
  ]) {
    expect(() => assertShellIdentity({ ...report, ...change }, expected)).toThrow();
  }
  expect(() => assertShellIdentity(report, { ...expected, commit: '' })).toThrow();
  for (const check of shellChecks) {
    const incomplete = identity();
    incomplete.report.checks[check] = false;
    expect(() => assertShellIdentity(incomplete.report, incomplete.expected)).toThrow(
      `Missing shell acceptance check: ${check}`,
    );
    expect(script).toContain(`report.checks.${check} = true`);
  }
});

test('requires a real uncommitted, exact-directory GUID backup for rollback proof', () => {
  const root = '/runner/app';
  const state = { InstallDir: root, BackupDir: `${root}.old.${'a'.repeat(32)}`, Committed: false };
  expect(assertDetachedTransaction(state, root)).toBe(state.BackupDir);
  for (const change of [
    { InstallDir: '/runner/other' },
    { BackupDir: `${root}.old.manual` },
    { BackupDir: '/runner/other.old.' + 'a'.repeat(32) },
    { Committed: true },
  ]) {
    expect(() => assertDetachedTransaction({ ...state, ...change }, root)).toThrow();
  }
  expect(script).toContain('observeDetachedUpgrade(installRoot)');
  expect(script).toContain(
    'Post-detach rollback did not restore the old application and registration',
  );
});

test('observes journal and detached filesystem state rather than an early progress event', async () => {
  const fixture = fs.mkdtempSync(path.join(tmpdir(), 'shell-detach-observer-'));
  try {
    const install = path.join(fixture, 'app');
    const backup = `${install}.old.${'a'.repeat(32)}`;
    expect(await observeDetachedUpgrade(install)).toBeNull();
    fs.writeFileSync(
      `${install}.setup-state.json`,
      JSON.stringify({ InstallDir: install, BackupDir: backup, Committed: false }),
    );
    expect(await observeDetachedUpgrade(install)).toBeNull();
    fs.mkdirSync(path.join(backup, 'resources'), { recursive: true });
    fs.writeFileSync(path.join(backup, '知远.exe'), 'previous executable fixture');
    fs.writeFileSync(path.join(backup, 'resources/app.asar'), 'previous application fixture');
    expect(await observeDetachedUpgrade(install)).toBeNull();
    fs.mkdirSync(install);
    expect(await observeDetachedUpgrade(install)).toBeNull();
    fs.writeFileSync(path.join(install, 'partial-file'), 'extracting');
    const observed = await observeDetachedUpgrade(install);
    expect(observed.transaction.BackupDir).toBe(backup);
    expect(observed.partialFiles).toEqual(['partial-file']);
  } finally {
    fs.rmSync(fixture, { recursive: true, force: true });
  }
});

test('rejects hidden, clipped, obscured, overlapping or unhosted actions', () => {
  const valid = snapshot();
  expect(() => assertVisibleActions(valid, ['#btnDone', '#btnLaunch'])).not.toThrow();
  for (const change of [
    { visible: false },
    { x: -1 },
    { x: 820 },
    { y: 550 },
    { textFits: false },
    { hit: false },
    { width: 0 },
  ]) {
    const invalid = snapshot();
    Object.assign(invalid.actions[0], change);
    expect(() => assertVisibleActions(invalid, ['#btnDone'])).toThrow();
  }
  const overlap = snapshot();
  overlap.actions[1].x = 350;
  expect(() => assertVisibleActions(overlap, ['#btnDone', '#btnLaunch'])).toThrow(
    'Actions overlap',
  );
  expect(() => assertVisibleActions({ ...valid, hosted: false }, ['#btnDone'])).toThrow();
});

test('keeps complete packaging, existing smoke gates and both real UI flows required', () => {
  const config = loadYaml(workflow) as {
    jobs: Record<
      string,
      { steps: Array<{ name?: string; if?: string; run?: string; uses?: string }> }
    >;
  };
  const { steps } = config.jobs['package-and-install'];
  let previous = -1;
  for (const command of [
    "'dist:win:offline'",
    '-File scripts/ci/windows-installer-size-smoke.ps1',
    '-File scripts/ci/windows-runtime-smoke.ps1',
    '-File scripts/ci/windows-installer-smoke.ps1',
    './scripts/ci/windows-installer-interactive.ps1',
    'node scripts/ci/windows-shell-interactive.mjs',
    'node scripts/ci/windows-shell-evidence.mjs',
  ]) {
    const index = steps.findIndex(step => step.run?.includes(command));
    expect(index, command).toBeGreaterThan(previous);
    expect(steps[index].if, command).toBeUndefined();
    previous = index;
  }
  expect(workflow).toContain('actions/setup-dotnet@v5');
  expect(workflow).toContain("dotnet-version: '8.0.x'");
  expect(workflow).not.toContain('continue-on-error');
});

test('drives real visible pointer input and screenshots without synthetic completion', () => {
  for (const marker of [
    "'Input.dispatchMouseEvent'",
    "'Page.captureScreenshot'",
    "'page-complete'",
    "item.type === 'done'",
    "'--acceptance-debug-port'",
    "server.listen(0, '127.0.0.1'",
    "'Install must be license-gated'",
  ])
    expect(script).toContain(marker);
  expect(script).not.toMatch(/['"]--(?:auto-install|capture-preview|payload)['"]/);
  expect(script).not.toMatch(
    /\.evaluate\([^\n]*(?:\.click\(|showPage|hostObjects|handleEngineEvent)/,
  );
  expect(script).not.toContain('page=complete');
  expect(script).not.toContain('freeze=');
  expect(shellScreenshots).toContain('fresh-finish');
  expect(shellScreenshots).toContain('launched-installed-app');
});

test('requires full main-repository components, local inference and actual failure recovery', () => {
  for (const key of [
    'channel-runtime',
    'skills',
    'mcps',
    'portable-git',
    'python',
    'skill-python',
    'uv',
  ])
    expect(script).toContain(`'${key}'`);
  for (const marker of [
    'Main installer acceptance must retain all seven offline components',
    'pending-local-inference-install',
    'Opening/cancelling setup terminated the existing application',
    'Cancelled upgrade did not restore the previous installation',
    'Failed upgrade changed prior installed bytes or registration',
    'Missing WebView2 must not silently install the app',
    'Launch failure must preserve usable completion page',
    'Installation changed existing user-data sentinels',
  ])
    expect(script).toContain(marker);
  expect(script).toContain("await click(recovery, '#btnInstall')");
  expect(script).toContain('await rename(app, heldApp)');
  expect(script).toContain('if (await exists(heldApp)) await rename(heldApp, app)');
  expect(script).not.toMatch(/\b(?:Set-MpPreference|Add-MpPreference|Defender)\b/);
});

test.skipIf(process.platform !== 'win32')('parses the actual native Windows helper', () => {
  const target = path.resolve('scripts/ci/windows-shell-native.ps1').replaceAll("'", "''");
  const command = `$errors = $null; $null = [System.Management.Automation.Language.Parser]::ParseFile('${target}', [ref]$null, [ref]$errors); if ($errors.Count) { throw ($errors | Out-String) }`;
  const result = spawnSync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-Command', command],
    { encoding: 'utf8', timeout: 20_000 },
  );
  expect(result.error, result.stderr).toBeUndefined();
  expect(result.status, result.stderr).toBe(0);
});
