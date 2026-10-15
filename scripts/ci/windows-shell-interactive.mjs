// Acceptance of the exact final self-extracting WebView2 setup, not a preview.
// CDP only observes the rendered page and sends real pointer input. Engine
// completion, installed bytes, native process/window evidence and screenshots
// must all agree before this report can unlock final artifact publication.
import assert from 'node:assert/strict';
import { spawn, execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import {
  mkdir,
  readFile,
  readdir,
  rename,
  writeFile,
  access,
  lstat,
  realpath,
} from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { shellScreenshots, observeDetachedUpgrade } from './windows-shell-evidence.mjs';
import { Cdp, snapshotExpression } from './windows-shell-browser-evidence.mjs';

const execute = promisify(execFile);
const root = fileURLToPath(new URL('../..', import.meta.url));
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const quote = value => `'${value.replaceAll("'", "''")}'`;

export async function sha256(filename) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(filename)) hash.update(chunk);
  return hash.digest('hex');
}

export function assertVisibleActions(snapshot, selectors) {
  assert(snapshot.hosted, 'A real WebView2 host is required');
  assert(snapshot.dpr > 0, 'Real renderer DPI must be recorded');
  for (const selector of selectors) {
    const item = snapshot.actions.find(action => action.selector === selector);
    assert(item?.visible && item.width > 0 && item.height > 0, `Action hidden: ${selector}`);
    assert(
      item.x >= 0 &&
        item.y >= 0 &&
        item.x + item.width <= snapshot.width + 1 &&
        item.y + item.height <= snapshot.height + 1,
      `Action clipped: ${selector}`,
    );
    assert(item.textFits && item.hit, `Action text clipped or obscured: ${selector}`);
  }
  for (const [index, selector] of selectors.entries()) {
    const a = snapshot.actions.find(action => action.selector === selector);
    for (const other of selectors.slice(index + 1)) {
      const b = snapshot.actions.find(action => action.selector === other);
      assert(
        !(
          a.x < b.x + b.width &&
          b.x < a.x + a.width &&
          a.y < b.y + b.height &&
          b.y < a.y + a.height
        ),
        `Actions overlap: ${selector} and ${other}`,
      );
    }
  }
}

async function waitFor(check, label, timeout = 60_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const result = await check();
    if (result) return result;
    await delay(150);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

async function exists(filename) {
  try {
    await access(filename);
    return true;
  } catch {
    return false;
  }
}

async function availablePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}

async function native(action, options = {}) {
  const args = [
    '-NoProfile',
    '-NonInteractive',
    '-File',
    path.join(root, 'scripts/ci/windows-shell-native.ps1'),
    '-Action',
    action,
  ];
  for (const [key, value] of Object.entries(options)) args.push(`-${key}`, String(value));
  const { stdout } = await execute('powershell.exe', args, {
    timeout: 30_000,
    maxBuffer: 2 * 1024 * 1024,
    windowsHide: true,
  });
  return JSON.parse(stdout.replace(/^\uFEFF/, '').trim());
}

export async function captureFailurePages(sessions, save, report) {
  for (const session of sessions) {
    if (!session.cdp || session.child.exitCode !== null) continue;
    try {
      await save(session, `${session.name}-failure`);
    } catch (error) {
      report.failureCaptureErrors ??= [];
      report.failureCaptureErrors.push({ session: session.name, error: String(error) });
    }
  }
}

export async function runShellAcceptance() {
  assert.equal(process.platform, 'win32', 'WebView2 acceptance requires Windows');
  assert(
    process.env.RUNNER_TEMP &&
      (process.env.ZHIYUAN_SOURCE_COMMIT || process.env.GITHUB_SHA) &&
      process.env.GITHUB_RUN_ID,
    'Disposable CI runner and build identity required',
  );
  const evidence = path.join(root, 'acceptance-diagnostics/shell-interactive');
  const sandbox = path.join(process.env.RUNNER_TEMP, 'zhiyuan-shell-acceptance');
  const installRoot = path.join(sandbox, '安装路径');
  const appData = path.join(sandbox, 'app-data');
  const runtime = path.join(sandbox, 'runtimes');
  const app = path.join(installRoot, '知远.exe');
  const asar = path.join(installRoot, 'resources/app.asar');
  const heldApp = `${app}.acceptance-held`;
  assert(!(await exists(sandbox)), 'Shell acceptance requires a fresh CI-owned directory');
  await mkdir(evidence, { recursive: true });
  await mkdir(appData, { recursive: true });
  await mkdir(runtime, { recursive: true });
  const installerDir = path.join(root, 'release');
  const installers = (await readdir(installerDir)).filter(name =>
    /^ZhiYuanAgent-Setup-.*\.exe$/i.test(name),
  );
  assert.equal(installers.length, 1, 'Expected one final WebView2 single-file installer');
  const installer = path.join(installerDir, installers[0]);
  const report = {
    kind: 'webview2-shell-interactive-acceptance',
    passed: false,
    commit: process.env.ZHIYUAN_SOURCE_COMMIT || process.env.GITHUB_SHA,
    runId: process.env.GITHUB_RUN_ID,
    installer: installers[0],
    installerSha256: await sha256(installer),
    installedExecutable: app,
    installRoot,
    checks: {},
    pages: [],
    dpiCoverage:
      'Actual native window DPI and renderer devicePixelRatio only; no simulated high-DPI claim',
  };
  const children = [];
  const sessions = [];
  let lock;
  const lockRelease = path.join(sandbox, 'release-lock');
  const manualBackups = [
    `${installRoot}.old.manual-acceptance`,
    `${installRoot}.old.0123456789abcdef0123456789abcdef`,
  ];
  for (const directory of manualBackups) await mkdir(directory);
  const sentinels = [
    path.join(appData, 'history.sqlite'),
    path.join(appData, 'settings.json'),
    path.join(runtime, 'preserved-user-marker'),
    ...manualBackups.map(directory => path.join(directory, 'user-owned-backup-marker')),
  ];
  for (const filename of sentinels)
    await writeFile(filename, `CI preservation sentinel: ${filename}\n`);
  const sentinelHashes = await Promise.all(sentinels.map(sha256));
  const components = JSON.parse(
    await readFile(path.join(root, 'build-tar/windows-components/manifest.json'), 'utf8'),
  ).components;
  assert.deepEqual(
    components.map(component => component.key).sort(),
    ['channel-runtime', 'skills', 'mcps', 'portable-git', 'python', 'skill-python', 'uv'].sort(),
    'Main installer acceptance must retain all seven offline components',
  );
  async function assertDataPreserved() {
    assert.deepEqual(
      await Promise.all(sentinels.map(sha256)),
      sentinelHashes,
      'Installation changed existing user-data sentinels',
    );
  }
  async function events(session) {
    if (!(await exists(session.eventsLog))) return [];
    return (await readFile(session.eventsLog, 'utf8'))
      .split(/\r?\n/)
      .filter(Boolean)
      .flatMap(line => {
        try {
          return [JSON.parse(line)];
        } catch {
          return [];
        } // A writer may be mid-record.
      });
  }
  async function start(name, language = 'zh', extra = []) {
    const port = await availablePort();
    const eventsLog = path.join(evidence, `${name}-events.jsonl`);
    const args = [
      '--acceptance-debug-port',
      String(port),
      '--events-log',
      eventsLog,
      '--install-dir',
      installRoot,
      '--runtime-root',
      runtime,
      '--app-data-root',
      appData,
      '--ui-query',
      `lang=${language}`,
      ...extra,
    ];
    const child = spawn(installer, args, { windowsHide: false, stdio: 'ignore' });
    children.push(child);
    let startupError;
    child.on('error', error => {
      startupError = error;
    });
    const session = { name, child, eventsLog, args, port };
    sessions.push(session);
    if (extra.length) return session;
    const target = await waitFor(async () => {
      if (startupError) throw startupError;
      assert(
        child.exitCode === null,
        `Setup exited before displaying its real UI: ${child.exitCode}`,
      );
      try {
        const response = await fetch(`http://127.0.0.1:${port}/json/list`, {
          signal: AbortSignal.timeout(1000),
        });
        const targets = await response.json();
        return targets.find(
          item =>
            item.type === 'page' && item.url.startsWith('file:') && item.url.includes('shell=1'),
        );
      } catch {
        return false;
      }
    }, 'the real packaged WebView2 page');
    session.cdp = await Cdp.connect(target.webSocketDebuggerUrl);
    await session.cdp.send('Page.enable');
    await session.cdp.send('Runtime.enable');
    await waitFor(async () => {
      const snapshot = await session.cdp.evaluate(snapshotExpression);
      return (
        snapshot.hosted &&
        snapshot.page === 'page-hero' &&
        snapshot.installPath?.toLowerCase() === installRoot.toLowerCase()
      );
    }, 'host-connected welcome page and actual install destination');
    assert.equal(
      (await session.cdp.evaluate(snapshotExpression)).language,
      language === 'zh' ? 'zh-CN' : 'en',
    );
    await session.cdp.observeClicks();
    return session;
  }
  async function save(session, name, selectors = []) {
    const snapshot = await session.cdp.evaluate(snapshotExpression);
    assertVisibleActions(snapshot, selectors);
    const windows = await native('inspect', { TargetProcessId: session.child.pid });
    const actual = windows.windows.find(
      item =>
        item.window.ClassName !== '#32770' && item.window.Width >= 800 && item.window.Height >= 500,
    );
    assert(actual?.window.Dpi > 0, 'Visible native shell window and its real DPI are required');
    const capture = await session.cdp.send('Page.captureScreenshot', {
      format: 'png',
      fromSurface: true,
    });
    const bytes = Buffer.from(capture.data, 'base64');
    assert(
      bytes.length > 5000 && bytes.subarray(1, 4).toString() === 'PNG',
      'Real WebView2 screenshot is missing',
    );
    await writeFile(path.join(evidence, `${name}.png`), bytes);
    const page = {
      name,
      screenshot: `${name}.png`,
      screenshotSha256: createHash('sha256').update(bytes).digest('hex'),
      processId: session.child.pid,
      native: actual.window,
      snapshot,
    };
    report.pages.push(page);
    await writeFile(path.join(evidence, `${name}.json`), JSON.stringify(page, null, 2));
    return snapshot;
  }
  async function click(session, selector) {
    const snapshot = await session.cdp.evaluate(snapshotExpression);
    assertVisibleActions(snapshot, [selector]);
    const target = snapshot.actions.find(item => item.selector === selector);
    assert(target.enabled, `Cannot click disabled action: ${selector}`);
    const position = {
      x: target.x + target.width / 2,
      y: target.y + target.height / 2,
      button: 'left',
      clickCount: 1,
    };
    await session.cdp.send('Input.dispatchMouseEvent', { ...position, type: 'mousePressed' });
    // Closing the real host can disconnect CDP immediately after mouse release.
    try {
      await session.cdp.send('Input.dispatchMouseEvent', { ...position, type: 'mouseReleased' });
    } catch (error) {
      if (!['#btnDone', '#btnCancelHero', '#btnLaunch', '.win-btn.close'].includes(selector))
        throw error;
      await waitFor(
        () => session.child.exitCode !== null,
        'visible action to close the host',
        5_000,
      );
    }
  }
  async function waitExit(session, allowFailure = false) {
    await waitFor(
      () => session.child.exitCode !== null,
      'setup process to exit after visible action',
    );
    if (!allowFailure) assert.equal(session.child.exitCode, 0, 'Setup action failed');
    session.cdp?.close();
  }
  async function begin(session, name, cancelImmediately = false, captureProgress = true) {
    const initial = await save(session, `${name}-welcome`, [
      '#licenseCheck',
      '#btnInstall',
      '#btnCancelHero',
    ]);
    assert.equal(initial.licenseChecked, 'false', 'License must initially be unchecked');
    assert.equal(
      initial.actions.find(item => item.selector === '#btnInstall').enabled,
      false,
      'Install must be license-gated',
    );
    await click(session, '#licenseCheck');
    await waitFor(
      async () =>
        (await session.cdp.evaluate(snapshotExpression)).actions.find(
          item => item.selector === '#btnInstall',
        ).enabled,
      'license-gated install action',
    );
    await click(session, '#btnInstall');
    await waitFor(
      async () => (await session.cdp.evaluate(snapshotExpression)).page === 'page-progress',
      'real install progress',
    );
    if (cancelImmediately) await click(session, '#btnCancelProgress');
    else if (captureProgress) await save(session, `${name}-progress`, ['#btnCancelProgress']);
  }
  async function finish(session, name) {
    // Do not click Next or route the UI. The real engine must complete and the
    // actual UI must transition itself into a usable completion page.
    await waitFor(
      async () => {
        const log = (await events(session)).slice(session.eventStart || 0);
        const failure = log.find(item => item.type === 'error');
        if (failure) throw new Error(`Real install failed: ${JSON.stringify(failure)}`);
        return (
          log.some(item => item.type === 'done') &&
          (await session.cdp.evaluate(snapshotExpression)).page === 'page-complete'
        );
      },
      'automatic real-engine completion page',
      900_000,
    );
    const log = await events(session);
    const done = log.findLast(item => item.type === 'done');
    assert.equal(path.resolve(done.launchPath).toLowerCase(), app.toLowerCase());
    assert.equal(await sha256(app), await sha256(path.join(root, 'release/win-unpacked/知远.exe')));
    assert.equal(
      await sha256(asar),
      await sha256(path.join(root, 'release/win-unpacked/resources/app.asar')),
    );
    await assertDataPreserved();
    for (const component of components) {
      const current = path.join(runtime, component.key, 'current');
      assert((await lstat(current)).isSymbolicLink(), `Missing active junction: ${component.key}`);
      assert.equal(
        (await realpath(current)).toLowerCase(),
        (await realpath(path.join(runtime, component.key, component.contentId))).toLowerCase(),
        `Wrong active component content: ${component.key}`,
      );
      assert(
        await exists(path.join(current, component.sentinel)),
        `Missing sentinel: ${component.key}`,
      );
    }
    assert(await exists(path.join(installRoot, 'resources/memory/engram.exe')));
    assert(
      await exists(path.join(installRoot, 'resources/channel-runtime/cc-connect-sidecar.exe')),
    );
    report.checks.fullOfflineComponentSet = true;
    await save(session, `${name}-finish`, ['#btnDone', '#btnLaunch']);
  }
  async function appWindow() {
    return waitFor(
      async () => {
        const result = await native('app', { AppPath: app, WindowClass: 'Chrome_WidgetWin_1' });
        return result.windows.find(item => item.window.Width > 200 && item.window.Height > 200);
      },
      'the exact shell-installed application window',
      120_000,
    );
  }
  try {
    const absentRuntime = path.join(sandbox, 'empty-webview2-runtime');
    await mkdir(absentRuntime);
    const missing = await start('missing-webview2', 'en', [
      '--webview2-runtime-path',
      absentRuntime,
    ]);
    const dialog = await waitFor(async () => {
      const result = await native('inspect', {
        TargetProcessId: missing.child.pid,
        WindowClass: '#32770',
      });
      return result.windows.find(item =>
        item.controls.some(control => /WebView2/.test(control.Text)),
      );
    }, 'explicit missing-WebView2 native failure prompt');
    assert.match(dialog.controls.map(control => control.Text).join('\n'), /Microsoft|微软/);
    const expectedDialog = {
      TargetProcessId: missing.child.pid,
      WindowClass: '#32770',
      WindowHandle: dialog.window.Handle,
    };
    const missingPage = await native('inspect', {
      ...expectedDialog,
      Screenshot: path.join(evidence, 'missing-webview2.png'),
    });
    await writeFile(
      path.join(evidence, 'missing-webview2.json'),
      JSON.stringify(missingPage, null, 2),
    );
    assert(!(await exists(app)), 'Missing WebView2 must not silently install the app');
    assert(
      !(await events(missing)).some(item => item.type === 'done'),
      'Missing WebView2 cannot claim success',
    );
    await native('inspect', {
      ...expectedDialog,
      ExpectedWindowTitle: 'ZhiYuan Agent Setup',
      AcknowledgeBodyPattern:
        '(?s)Microsoft Edge WebView2 Runtime is required.*https://developer[.]microsoft[.]com/microsoft-edge/webview2/',
    });
    await waitExit(missing, true);
    assert.equal(missing.child.exitCode, 1, 'Missing WebView2 must exit with failure');
    assert(
      (await events(missing)).some(item => item.type === 'webview2-error'),
      'Missing WebView2 must record the actual initialization failure',
    );
    report.checks.missingWebView2ExplicitFailure = true;

    const fresh = await start('fresh');
    assert.equal((await fresh.cdp.evaluate(snapshotExpression)).localInference, false);
    await click(fresh, '.switch');
    assert.equal((await fresh.cdp.evaluate(snapshotExpression)).localInference, true);
    await begin(fresh, 'fresh');
    await finish(fresh, 'fresh');
    assert(
      await exists(path.join(appData, 'pending-local-inference-install')),
      'Selected local inference must be scheduled for the first application launch',
    );
    report.checks.localInferenceOption = true;
    await click(fresh, '#btnDone');
    await waitExit(fresh);
    assert.equal(
      (await native('app', { AppPath: app })).processIds.length,
      0,
      'Done unexpectedly launched the app',
    );
    report.checks.freshInstall = true;
    report.checks.closeWithoutLaunch = true;

    const running = spawn(app, ['--user-data-dir=' + path.join(sandbox, 'app-profile')], {
      stdio: 'ignore',
    });
    children.push(running);
    await appWindow();
    const before = {
      exe: await sha256(app),
      asar: await sha256(asar),
      registration: await native('registration'),
    };
    const cancel = await start('existing-cancel', 'en');
    await save(cancel, 'existing-install-before-cancel', ['#btnCancelHero', '#btnInstall']);
    await click(cancel, '#btnCancelHero');
    await waitExit(cancel);
    assert.equal(
      running.exitCode,
      null,
      'Opening/cancelling setup terminated the existing application',
    );
    assert.deepEqual(
      {
        exe: await sha256(app),
        asar: await sha256(asar),
        registration: await native('registration'),
      },
      before,
      'Cancelling setup changed installed bytes or registration',
    );
    await assertDataPreserved();
    report.checks.cancelPreservesRunningInstallation = true;

    // Cancel through the actual progress action before extraction completes.
    // Waiting for rollback is mandatory; killing setup would evade this test.
    const cancelled = await start('cancelled-upgrade');
    await begin(cancelled, 'cancelled-upgrade', true);
    await waitFor(
      async () =>
        (await events(cancelled)).some(
          item => item.type === 'error' && /cancel/i.test(item.detail || ''),
        ),
      'cancelled upgrade rollback',
      900_000,
    );
    await waitFor(
      async () => (await cancelled.cdp.evaluate(snapshotExpression)).page === 'page-hero',
      'visible cancelled upgrade result',
    );
    await save(cancelled, 'cancelled-upgrade', ['#btnInstall', '.win-btn.close']);
    assert(
      (await cancelled.cdp.evaluate(snapshotExpression)).error,
      'Cancellation must be explained on the real page',
    );
    assert(
      !(await events(cancelled)).some(item => item.type === 'done'),
      'Cancelled upgrade falsely claimed completion',
    );
    assert.deepEqual(
      {
        exe: await sha256(app),
        asar: await sha256(asar),
        registration: await native('registration'),
      },
      before,
      'Cancelled upgrade did not restore the previous installation',
    );
    await assertDataPreserved();
    await click(cancelled, '.win-btn.close');
    await waitExit(cancelled);
    report.checks.cancelledUpgradePreservesData = true;
    report.preservation = { originalInstallation: before, sentinelSha256: sentinelHashes };

    // Observe the actual application-directory transaction before cancellation.
    // Do not spend time on a native screenshot until after the real Cancel,
    // because the archive extraction milestone can be short on fast runners.
    const detached = await start('detached-upgrade');
    await begin(detached, 'detached-upgrade', false, false);
    report.detachedUpgrade = await waitFor(
      async () => {
        const log = await events(detached);
        assert(
          !log.some(item => item.type === 'done' || item.type === 'error'),
          'Upgrade completed/failed before post-detach cancellation could be observed',
        );
        if (!log.some(item => item.type === 'phase' && item.label === '正在解包应用程序'))
          return false;
        const observation = await observeDetachedUpgrade(installRoot);
        return (
          observation && {
            ...observation,
            enginePhase: log.findLast(item => item.type === 'phase'),
          }
        );
      },
      'real uncommitted detach journal and previous application backup',
      900_000,
    );
    await click(detached, '#btnCancelProgress');
    await waitFor(
      async () =>
        (await events(detached)).some(
          item => item.type === 'error' && /cancel/i.test(item.detail || ''),
        ),
      'rollback after application detach',
      900_000,
    );
    await waitFor(
      async () => (await detached.cdp.evaluate(snapshotExpression)).page === 'page-hero',
      'visible post-detach cancelled state',
    );
    await save(detached, 'detached-upgrade-cancelled', ['#btnInstall', '.win-btn.close']);
    assert(
      (await detached.cdp.evaluate(snapshotExpression)).error,
      'Post-detach cancellation must be explained',
    );
    assert(
      !(await exists(report.detachedUpgrade.journalPath)),
      'Cancelled detached upgrade left an unresolved transaction journal',
    );
    assert(
      !(await exists(report.detachedUpgrade.transaction.BackupDir)),
      'Cancelled detached upgrade did not move its exact backup home',
    );
    assert.deepEqual(
      {
        exe: await sha256(app),
        asar: await sha256(asar),
        registration: await native('registration'),
      },
      before,
      'Post-detach rollback did not restore the old application and registration',
    );
    await assertDataPreserved();
    await click(detached, '.win-btn.close');
    await waitExit(detached);
    report.checks.detachedUpgradeRollbackPreservesData = true;

    // A real non-delete-sharing file handle forces the OS rename/detach failure.
    // The prior install and registry must survive, then the visible Retry action
    // must recover using the same embedded payload without a new fake fixture.
    const ready = path.join(sandbox, 'file-locked');
    lock = spawn(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-File',
        path.join(root, 'scripts/ci/windows-shell-native.ps1'),
        '-Action',
        'hold-file',
        '-FilePath',
        asar,
        '-ReadyPath',
        ready,
        '-ReleasePath',
        lockRelease,
      ],
      { windowsHide: true, stdio: 'ignore' },
    );
    children.push(lock);
    await waitFor(() => exists(ready), 'real file-sharing lock');
    const recovery = await start('recovery', 'en');
    await begin(recovery, 'recovery');
    await waitFor(
      async () => (await events(recovery)).some(item => item.type === 'error'),
      'real locked-directory failure',
      900_000,
    );
    await waitFor(
      async () =>
        (await recovery.cdp.evaluate(snapshotExpression)).actions.find(
          item => item.selector === '#btnInstall',
        )?.visible,
      'visible recovery action',
    );
    await save(recovery, 'recovery-locked-directory', ['#btnInstall']);
    assert(
      (await recovery.cdp.evaluate(snapshotExpression)).error,
      'Locked-directory failure must be explained',
    );
    assert.deepEqual(
      {
        exe: await sha256(app),
        asar: await sha256(asar),
        registration: await native('registration'),
      },
      before,
      'Failed upgrade changed prior installed bytes or registration',
    );
    await assertDataPreserved();
    await writeFile(lockRelease, 'release');
    await waitFor(() => lock.exitCode !== null, 'file-sharing lock release');
    assert.equal(lock.exitCode, 0);
    // Keep the original failure evidence, but evaluate completion only after
    // the retry boundary so that the intentional failure cannot mask a new one.
    const retryLog = await readFile(recovery.eventsLog, 'utf8');
    await writeFile(path.join(evidence, 'recovery-first-attempt.jsonl'), retryLog);
    recovery.eventStart = (await events(recovery)).length;
    await waitFor(
      async () => (await recovery.cdp.evaluate(snapshotExpression)).page === 'page-hero',
      'editable welcome page after a recoverable failure',
    );
    if ((await recovery.cdp.evaluate(snapshotExpression)).licenseChecked !== 'true')
      await click(recovery, '#licenseCheck');
    await click(recovery, '#btnInstall');
    await finish(recovery, 'recovery');
    report.checks.lockedDirectoryRetry = true;
    report.checks.failurePreservesExistingInstallation = true;

    await rename(app, heldApp);
    await click(recovery, '#btnLaunch');
    await waitFor(
      async () => (await events(recovery)).some(item => item.type === 'launch-error'),
      'real launch failure event',
    );
    const failedLaunch = await save(recovery, 'finish-launch-error', ['#btnDone', '#btnLaunch']);
    assert.equal(
      failedLaunch.page,
      'page-complete',
      'Launch failure must preserve usable completion page',
    );
    assert.equal(recovery.child.exitCode, null, 'Launch failure closed setup');
    await rename(heldApp, app);
    await save(recovery, 'finish-launch-recovered', ['#btnDone', '#btnLaunch']);
    await click(recovery, '#btnLaunch');
    await appWindow();
    await waitExit(recovery);
    const launched = await native('app', {
      AppPath: app,
      WindowClass: 'Chrome_WidgetWin_1',
      Screenshot: path.join(evidence, 'launched-installed-app.png'),
    });
    await writeFile(
      path.join(evidence, 'launched-installed-app.json'),
      JSON.stringify(launched, null, 2),
    );
    await assertDataPreserved();
    report.checks.launchFailureRecovery = true;
    report.checks.finishLaunchesInstalledApplication = true;
    report.checks.userDataPreserved = true;
    report.checks.unownedBackupDirectoriesPreserved = true;
    report.checks.visibleActionsFitActualDpi = true;
    report.checks.chineseAndEnglish = true;
    report.installedAppSha256 = await sha256(app);
    report.installedAsarSha256 = await sha256(asar);
    report.passed = true;
  } catch (error) {
    report.error = error.stack || String(error);
    await captureFailurePages(sessions, save, report);
    throw error;
  } finally {
    if (await exists(heldApp)) await rename(heldApp, app);
    await writeFile(lockRelease, 'release');
    for (const session of sessions) {
      try {
        if (session.cdp)
          await writeFile(
            path.join(evidence, `${session.name}-browser.json`),
            JSON.stringify(
              {
                processId: session.child.pid,
                events: session.cdp.observations,
                droppedEvents: session.cdp.droppedObservations,
              },
              null,
              2,
            ),
          );
      } catch (error) {
        report.browserDiagnosticsError = String(error);
      }
      session.cdp?.close();
    }
    for (const child of children)
      if (child.exitCode === null && child.pid) {
        // Exact owned PID only; never kill an unrelated user application by name.
        try {
          await execute('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], {
            windowsHide: true,
          });
        } catch {
          /* already exited */
        }
      }
    // The launch-button child may outlive the shell and not be in Node's set.
    // The only permitted cleanup root is this fresh CI-owned installation.
    try {
      await execute(
        'powershell.exe',
        [
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          `$app = ${quote(app)}; Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -and $_.ExecutablePath -ieq $app } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`,
        ],
        { windowsHide: true },
      );
    } catch (error) {
      report.passed = false;
      report.cleanupError = String(error);
    }
    report.screenshots = {};
    for (const name of shellScreenshots) {
      const filename = `${name}.png`;
      if (await exists(path.join(evidence, filename)))
        report.screenshots[filename] = await sha256(path.join(evidence, filename));
    }
    report.finishedAt = new Date().toISOString();
    await writeFile(path.join(evidence, 'report.json'), JSON.stringify(report, null, 2));
  }
  assert(report.passed, report.cleanupError || 'Shell acceptance did not pass');
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  await runShellAcceptance();
}
