import fs, { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { load as loadYaml } from 'js-yaml';
import { JSDOM } from 'jsdom';
import { expect, test } from 'vitest';
import {
  assertDetachedTransaction,
  assertShellIdentity,
  observeDetachedUpgrade,
  shellChecks,
  shellScreenshots,
} from './windows-shell-evidence.mjs';
import { assertVisibleActions, captureFailurePages } from './windows-shell-interactive.mjs';
import {
  Cdp,
  browserObservation,
  clickObserverExpression,
  snapshotExpression,
} from './windows-shell-browser-evidence.mjs';

const script = readFileSync('scripts/ci/windows-shell-interactive.mjs', 'utf8');
const native = readFileSync('scripts/ci/windows-shell-native.ps1', 'utf8');
const workflow = readFileSync('.github/workflows/windows-installer-pr.yml', 'utf8');

test('waits through a loading document without a body and observes the later real DOM', () => {
  const dom = new JSDOM('<!doctype html><html lang="en"><head></head><body></body></html>', {
    url: 'file:///setup/index.html?shell=1&lang=en',
    runScripts: 'outside-only',
  });
  try {
    const { document } = dom.window;
    Object.defineProperty(dom.window, 'chrome', { value: { webview: {} } });
    expect(document.readyState).toBe('loading');
    document.body.remove();
    expect(document.body).toBeNull();
    expect(dom.window.eval(snapshotExpression)).toEqual({ hosted: false });

    const body = document.createElement('body');
    body.innerHTML =
      '<section class="page active" id="page-hero"><span id="installPath">C:\\安装路径</span></section>';
    document.documentElement.append(body);
    expect(dom.window.eval(snapshotExpression).hosted).toBe(false);
    body.classList.add('shell');
    expect(dom.window.eval(snapshotExpression)).toMatchObject({
      hosted: true,
      page: 'page-hero',
      installPath: 'C:\\安装路径',
      language: 'en',
    });
    expect(script).toContain('snapshot.hosted &&');
    expect(script).toContain("snapshot.page === 'page-hero'");
    expect(script).toContain('snapshot.installPath?.toLowerCase() === installRoot.toLowerCase()');
    expect(script).toContain("language === 'zh' ? 'zh-CN' : 'en'");
  } finally {
    dom.window.close();
  }
});

test('returns not-ready for an absent document element but never suppresses an unrelated DOM error', () => {
  const dom = new JSDOM('<body class="shell"></body>', { runScripts: 'outside-only' });
  try {
    const { document } = dom.window;
    Object.defineProperty(document, 'querySelector', {
      configurable: true,
      value: () => {
        throw new Error('Unexpected DOM failure');
      },
    });
    expect(() => dom.window.eval(snapshotExpression)).toThrow('Unexpected DOM failure');
    document.documentElement.remove();
    expect(dom.window.eval(snapshotExpression)).toEqual({ hosted: false });
  } finally {
    dom.window.close();
  }
});

test.each(['exception', 'disconnect'])(
  'CDP readiness evaluation still rejects a real %s',
  async failure => {
    const socket = new EventTarget();
    Object.assign(socket, {
      send(payload: string) {
        const request = JSON.parse(payload);
        if (failure === 'disconnect') socket.dispatchEvent(new Event('close'));
        else
          socket.dispatchEvent(
            new MessageEvent('message', {
              data: JSON.stringify({
                id: request.id,
                result: { exceptionDetails: { text: 'Unexpected page exception' } },
              }),
            }),
          );
      },
    });
    const cdp = new Cdp(socket);
    await expect(cdp.evaluate(snapshotExpression)).rejects.toThrow(
      failure === 'disconnect' ? 'WebView2 disconnected' : 'Unexpected page exception',
    );
  },
);

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
      {
        steps: Array<{
          id?: string;
          name?: string;
          if?: string;
          run?: string;
          uses?: string;
          shell?: string;
        }>;
      }
    >;
  };
  const { steps } = config.jobs['package-and-install'];
  const independentConditions: Record<string, string> = {
    'node scripts/ci/windows-shell-interactive.mjs':
      "${{ !cancelled() && steps.offline-build.outcome == 'success' && steps.acceptance-ownership.outcome == 'success' }}",
    'node scripts/ci/windows-shell-evidence.mjs':
      "${{ !cancelled() && steps.shell-interaction.outcome == 'success' }}",
    './scripts/ci/windows-shell-uninstall.ps1 -Action verify':
      "${{ !cancelled() && steps.shell-evidence.outcome == 'success' }}",
  };
  expect(steps.find(step => step.id === 'offline-build')?.run).toContain('dist:win:offline');
  expect(steps.find(step => step.id === 'acceptance-ownership')?.run).toContain('-Action prepare');
  expect(steps.find(step => step.id === 'shell-interaction')?.run).toContain(
    'windows-shell-interactive.mjs',
  );
  expect(steps.find(step => step.id === 'shell-evidence')?.run).toContain(
    'windows-shell-evidence.mjs',
  );
  expect(steps.find(step => step.id === 'shell-evidence')?.shell).toBe('pwsh');
  expect(steps.find(step => step.id === 'shell-evidence')?.run).toContain(
    "$app = Join-Path $env:RUNNER_TEMP 'zhiyuan-shell-acceptance/安装路径/知远.exe'",
  );
  let previous = -1;
  for (const command of [
    "'dist:win:offline'",
    '-File scripts/ci/windows-installer-size-smoke.ps1',
    '-File scripts/ci/windows-runtime-smoke.ps1',
    '-File scripts/ci/windows-installer-smoke.ps1',
    './scripts/ci/windows-installer-interactive.ps1',
    'node scripts/ci/windows-shell-interactive.mjs',
    'node scripts/ci/windows-shell-evidence.mjs',
    './scripts/ci/windows-shell-uninstall.ps1 -Action verify',
  ]) {
    const index = steps.findIndex(step => step.run?.includes(command));
    expect(index, command).toBeGreaterThan(previous);
    expect(steps[index].if, command).toBe(independentConditions[command]);
    previous = index;
  }
  expect(workflow).toContain('actions/setup-dotnet@v5');
  expect(workflow).toContain("dotnet-version: '8.0.x'");
  expect(workflow).not.toContain('continue-on-error');
  expect(workflow).toContain('bunx vitest run --maxWorkers=1');
});

test('keeps the independent Unicode installed path strict against ANSI-decoded UTF-8', () => {
  const { report, expected } = identity();
  const installedExecutable = path.resolve('runner/zhiyuan-shell-acceptance/安装路径/知远.exe');
  const actual = { ...report, installedExecutable };
  expect(() => assertShellIdentity(actual, { ...expected, installedExecutable })).not.toThrow();
  expect(() =>
    assertShellIdentity(actual, {
      ...expected,
      installedExecutable: Buffer.from(installedExecutable, 'utf8').toString('latin1'),
    }),
  ).toThrow('Full application smoke must use the shell-installed app');
});

test.skipIf(process.platform !== 'win32')(
  'executes the actual evidence workflow as a BOM-less UTF-8 script with exact Unicode arguments',
  () => {
    const config = loadYaml(workflow) as {
      jobs: { 'package-and-install': { steps: { id?: string; shell?: string; run?: string }[] } };
    };
    const step = config.jobs['package-and-install'].steps.find(
      item => item.id === 'shell-evidence',
    )!;
    const fixture = fs.realpathSync.native(
      fs.mkdtempSync(path.join(tmpdir(), 'shell-evidence-encoding-')),
    );
    const probe = path.join(fixture, 'workflow.ps1');
    const output = path.join(fixture, 'arguments.json');
    const setup = path.join(fixture, 'release/ZhiYuanAgent-Setup-fixture.exe');
    try {
      fs.mkdirSync(path.dirname(setup), { recursive: true });
      fs.writeFileSync(setup, 'argument transport fixture, never executed');
      fs.mkdirSync(path.join(fixture, 'scripts/ci'), { recursive: true });
      fs.writeFileSync(
        path.join(fixture, 'scripts/ci/windows-shell-evidence.mjs'),
        "import fs from 'node:fs'; fs.writeFileSync(process.env.PROBE_OUTPUT, JSON.stringify(process.argv.slice(2)));",
      );
      // Exactly the runner's script encoding and the repository's real run block.
      fs.writeFileSync(probe, "$ErrorActionPreference = 'Stop'\n" + step.run, 'utf8');
      expect(fs.readFileSync(probe).subarray(0, 3).toString('hex')).not.toBe('efbbbf');
      const result = spawnSync(
        `${step.shell}.exe`,
        ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', probe],
        {
          cwd: fixture,
          env: { ...process.env, RUNNER_TEMP: fixture, PROBE_OUTPUT: output },
          encoding: 'utf8',
          timeout: 20_000,
        },
      );
      expect(result.error, result.stderr).toBeUndefined();
      expect(result.status, result.stderr || result.stdout).toBe(0);
      expect(JSON.parse(fs.readFileSync(output, 'utf8'))).toEqual([
        'acceptance-diagnostics/shell-interactive',
        setup,
        path.join(fixture, 'zhiyuan-shell-acceptance/安装路径/知远.exe'),
      ]);
    } finally {
      fs.rmSync(fixture, { recursive: true, force: true });
    }
  },
  25_000,
);

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

test('captures live failed sessions before cleanup without replacing the original failure', async () => {
  const sessions = [
    { name: 'unconnected', child: { exitCode: null } },
    { name: 'exited', cdp: {}, child: { exitCode: 1 } },
    { name: 'disconnected', cdp: {}, child: { exitCode: null } },
    { name: 'fresh', cdp: {}, child: { exitCode: null } },
  ];
  const captures: string[] = [];
  const report = {
    passed: false,
    error: 'Original installation error',
    failureCaptureErrors: [],
  };
  await expect(
    captureFailurePages(
      sessions,
      async (session: { name: string }, name: string) => {
        captures.push(name);
        if (session.name === 'disconnected') throw new Error('WebView2 disconnected');
      },
      report,
    ),
  ).resolves.toBeUndefined();
  expect(captures).toEqual(['disconnected-failure', 'fresh-failure']);
  expect(report.passed).toBe(false);
  expect(report.error).toBe('Original installation error');
  expect(report.failureCaptureErrors).toEqual([
    { session: 'disconnected', error: 'Error: WebView2 disconnected' },
  ]);
  expect(script).toContain(
    'report.error = error.stack || String(error);\n    await captureFailurePages(sessions, save, report);\n    throw error;',
  );
  expect(script.indexOf('await captureFailurePages(sessions, save, report)')).toBeLessThan(
    script.indexOf('session.cdp?.close();', script.indexOf('} finally {')),
  );
});

test('observes clicks without changing the DOM, cancelling events or invoking an action', () => {
  const dom = new JSDOM('<button id="btnDone">Close</button>', { runScripts: 'outside-only' });
  try {
    const observed: unknown[] = [];
    Object.defineProperty(dom.window, '__zhiyuanAcceptanceObservedClick', {
      value: (payload: string) => observed.push(JSON.parse(payload)),
    });
    const before = dom.window.document.documentElement.outerHTML;
    let handled = 0;
    dom.window.document.querySelector('button')!.addEventListener('click', event => {
      expect(event.defaultPrevented).toBe(false);
      handled++;
    });
    dom.window.eval(clickObserverExpression);
    expect(handled).toBe(0);
    expect(observed).toEqual([]);
    dom.window.document.querySelector('button')!.dispatchEvent(
      new dom.window.MouseEvent('click', {
        bubbles: true,
        cancelable: true,
        clientX: 353,
        clientY: 389,
      }),
    );
    expect(handled).toBe(1);
    expect(observed).toEqual([
      expect.objectContaining({
        isTrusted: false,
        targetId: 'btnDone',
        actionId: 'btnDone',
        x: 353,
        y: 389,
        defaultPrevented: false,
      }),
    ]);
    expect(dom.window.document.documentElement.outerHTML).toBe(before);
    expect(clickObserverExpression).toContain('{ capture: true, passive: true }');
    expect(clickObserverExpression).not.toMatch(
      /\.click\(|dispatchEvent|preventDefault|stopPropagation/,
    );
  } finally {
    dom.window.close();
  }
});

test('retains real CDP exception and click metadata per session with a bounded event buffer', () => {
  const socket = new EventTarget();
  const cdp = new Cdp(socket);
  const exception = {
    method: 'Runtime.exceptionThrown',
    params: {
      exceptionDetails: {
        text: 'Uncaught',
        exception: { description: 'TypeError: close failed' },
      },
    },
  };
  socket.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(exception) }));
  expect(cdp.observations[0]).toMatchObject({
    kind: 'exception',
    details: exception.params.exceptionDetails,
  });
  const click = {
    method: 'Runtime.bindingCalled',
    params: {
      name: '__zhiyuanAcceptanceObservedClick',
      payload: '{"isTrusted":true,"actionId":"btnDone"}',
    },
  };
  expect(browserObservation(click)).toEqual({
    kind: 'click',
    details: { isTrusted: true, actionId: 'btnDone' },
  });
  expect(
    browserObservation({ ...click, params: { ...click.params, name: 'unrelated' } }),
  ).toBeNull();
  for (let index = 0; index < 501; index++)
    socket.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(click) }));
  expect(cdp.observations).toHaveLength(500);
  expect(cdp.droppedObservations).toBe(2);
  expect(script).toContain("session.cdp.send('Runtime.enable')");
  expect(script).toContain('await session.cdp.observeClicks()');
  expect(script).toContain('`${session.name}-browser.json`');
  expect(script).toContain('events: session.cdp.observations');
  expect(script).toContain('processId: session.child.pid');
});

test('acknowledges the exact missing-runtime dialog by semantic OK instead of a numeric control ID', () => {
  expect(native).not.toContain('ClickControlId');
  expect(script).not.toContain('ClickControlId');
  expect(script).toContain('WindowHandle: dialog.window.Handle');
  expect(script).toContain("ExpectedWindowTitle: 'ZhiYuan Agent Setup'");
  expect(script).toContain(
    'Microsoft Edge WebView2 Runtime is required.*https://developer[.]microsoft[.]com/microsoft-edge/webview2/',
  );
  expect(native).toContain('$_.Handle -eq $WindowHandle');
  expect(native).toContain("$WindowClass -ne '#32770'");
  expect(native).toContain('$TargetProcessId -le 0');
  expect(native).toContain('$windows.Count -ne 1');
  expect(native).toContain('InstallerUi]::ClickDialogAcknowledgement(');
  expect(native).toContain(
    '$window.Handle, $TargetProcessId, $ExpectedWindowTitle, $AcknowledgeBodyPattern, 0)',
  );
  const capture = script.indexOf("Screenshot: path.join(evidence, 'missing-webview2.png')");
  const acknowledge = script.indexOf('AcknowledgeBodyPattern:');
  const exit = script.indexOf('await waitExit(missing, true)');
  expect(capture).toBeGreaterThan(0);
  expect(acknowledge).toBeGreaterThan(capture);
  expect(exit).toBeGreaterThan(acknowledge);
  expect(script.indexOf("const fresh = await start('fresh')")).toBeGreaterThan(exit);
  expect(script).toContain('assert.equal(missing.child.exitCode, 1');
  expect(script).toContain("item.type === 'webview2-error'");
});

test.skipIf(process.platform !== 'win32')(
  'clicks real Win32 OK dialogs with either control ID and rejects unrelated or changed dialogs',
  () => {
    const result = spawnSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        path.resolve('scripts/ci/windows-installer-dialog-regression.ps1'),
      ],
      { encoding: 'utf8', timeout: 60_000 },
    );
    expect(result.error, result.stderr).toBeUndefined();
    expect(result.status, result.stderr || result.stdout).toBe(0);
    expect(result.stdout).toContain('PASS: real modal OK dialogs with control IDs 1 and 2');
  },
  65_000,
);
