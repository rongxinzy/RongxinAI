import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { promisify } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import { Cdp, snapshotExpression } from './windows-shell-browser-evidence.mjs';
import { sha256 } from './windows-shell-interactive.mjs';
import { deriveProfile } from './verify-installed-python-upgrade.mjs';

const execute = promisify(execFile);
const firstVersion = '2026.11.18-build.1';
const [oldSetup, newSetup, receiptPath, fixtureRoot] = process.argv.slice(2);
assert(
  process.platform === 'win32' && process.env.RUNNER_TEMP,
  'Disposable Windows runner required',
);
assert(
  oldSetup && newSetup && receiptPath && fixtureRoot,
  'Expected two setup packages, receipt and fixture root',
);
const receipt = JSON.parse((await readFile(receiptPath, 'utf8')).replace(/^\uFEFF/, ''));
const evidence = path.resolve('acceptance-diagnostics/python-upgrade');
const installRoot = path.join(fixtureRoot, 'app');
const runtimeRoot = path.join(fixtureRoot, 'r');
const profile = await deriveProfile(fixtureRoot);
const app = path.join(installRoot, receipt.app);
const archive = path.join(path.dirname(app), 'resources', 'app.asar');
assert(receipt.app === path.basename(receipt.app) && receipt.app.endsWith('.exe'));
await mkdir(evidence, { recursive: true });
await mkdir(profile, { recursive: true });

async function waitFor(check, label, timeout) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const value = await check();
    if (value) return value;
    await delay(300);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

async function runInstaller(filename, label, upgrade) {
  const listener = net.createServer();
  await new Promise(resolve => listener.listen(0, '127.0.0.1', resolve));
  const { port } = listener.address();
  await new Promise(resolve => listener.close(resolve));
  const events = path.join(evidence, `${label}-setup.jsonl`);
  const process = spawn(
    filename,
    [
      '--acceptance-debug-port',
      String(port),
      '--events-log',
      events,
      '--install-dir',
      installRoot,
      '--runtime-root',
      runtimeRoot,
      '--app-data-root',
      profile,
      '--skip-registration',
      '--auto-install',
    ],
    { stdio: 'ignore' },
  );
  let spawnError;
  process.on('error', error => {
    spawnError = error;
  });
  let cdp;
  try {
    const done = await waitFor(
      async () => {
        if (spawnError) throw spawnError;
        assert.equal(process.exitCode, null, `${label} setup exited before installation`);
        const current = await readFile(events, 'utf8').catch(error => {
          if (error.code === 'ENOENT') return '';
          throw error;
        });
        const entries = current
          .split(/\r?\n/)
          .filter(Boolean)
          .flatMap(line => {
            try {
              return [JSON.parse(line)];
            } catch {
              return [];
            }
          });
        const failure = entries.find(item => /^(error|webview2-error|ui-error)$/.test(item.type));
        if (failure) throw new Error(`${label} setup failed: ${JSON.stringify(failure)}`);
        return entries.find(item => item.type === 'done');
      },
      `${label} setup engine completion`,
      900_000,
    );
    assert.equal(done.isUpgrade === true, upgrade, `${label} reported unexpected upgrade state`);
    assert.equal(path.resolve(done.launchPath).toLowerCase(), app.toLowerCase());

    const target = await waitFor(
      async () => {
        const targets = await fetch(`http://127.0.0.1:${port}/json/list`, {
          signal: AbortSignal.timeout(1_000),
        })
          .then(result => result.json())
          .catch(() => []);
        return targets.find(
          item =>
            item.type === 'page' && item.url.startsWith('file:') && item.url.includes('shell=1'),
        );
      },
      `${label} setup page`,
      30_000,
    );
    cdp = await Cdp.connect(target.webSocketDebuggerUrl);
    const button = await waitFor(
      async () => {
        const snapshot = await cdp.evaluate(snapshotExpression);
        return (
          snapshot.hosted &&
          snapshot.page === 'page-complete' &&
          snapshot.actions.find(
            item => item.selector === '#btnDone' && item.visible && item.enabled && item.hit,
          )
        );
      },
      `${label} setup finish action`,
      30_000,
    );
    const pointer = {
      x: button.x + button.width / 2,
      y: button.y + button.height / 2,
      button: 'left',
      clickCount: 1,
    };
    await cdp.send('Input.dispatchMouseEvent', { ...pointer, type: 'mousePressed' });
    try {
      await cdp.send('Input.dispatchMouseEvent', { ...pointer, type: 'mouseReleased' });
    } catch (error) {
      await waitFor(() => process.exitCode !== null, 'setup exit after Done', 5_000).catch(() => {
        throw error;
      });
    }
    await waitFor(() => process.exitCode !== null, 'setup exit after Done', 30_000);
    assert.equal(process.exitCode, 0);
    return done;
  } finally {
    cdp?.close();
    if (process.pid && process.exitCode === null) process.kill();
  }
}

async function nodeProbe(phase) {
  await new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ['scripts/ci/verify-installed-python-upgrade.mjs', phase, app, fixtureRoot],
      { stdio: 'inherit' },
    );
    child.once('error', reject);
    child.once('exit', code =>
      code === 0 ? resolve() : reject(new Error(`Python probe ${phase} exited ${code}`)),
    );
  });
}

async function readAuthenticode(filename, expectedSigner) {
  const { stdout } = await execute(
    'pwsh.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      '$s = Get-AuthenticodeSignature -LiteralPath $env:PYTHON_REHEARSAL_SIGNED_FILE; if ($s.Status -ne "Valid" -or !$s.TimeStamperCertificate) { throw ("Invalid timestamped Authenticode signature: " + $s.Status) }; $s.SignerCertificate.Thumbprint',
    ],
    { env: { ...process.env, PYTHON_REHEARSAL_SIGNED_FILE: filename }, timeout: 60_000 },
  );
  assert.equal(stdout.trim(), expectedSigner, `Unexpected signer for ${filename}`);
}

const report = { candidate: receipt, previousVersion: firstVersion, passed: false };
try {
  report.oldSetupSha256 = await sha256(oldSetup);
  assert.equal(
    report.oldSetupSha256,
    '24624e652475c70eb7574c663e280b66543bed5b937685c952fa7260faab30ed',
  );
  assert.equal(await sha256(newSetup), receipt.installerSha256);
  await readAuthenticode(oldSetup, receipt.thumbprint);
  await readAuthenticode(newSetup, receipt.thumbprint);
  report.oldInstall = await runInstaller(oldSetup, 'old', false);
  await readAuthenticode(app, receipt.thumbprint);
  report.oldAsarSha256 = await sha256(archive);
  await nodeProbe('seed');
  report.upgrade = await runInstaller(newSetup, 'upgrade', true);
  await readAuthenticode(app, receipt.thumbprint);
  if (receipt.appSha256) assert.equal(await sha256(app), receipt.appSha256);
  report.newAsarSha256 = await sha256(archive);
  if (receipt.asarSha256) assert.equal(report.newAsarSha256, receipt.asarSha256);
  assert.notEqual(report.newAsarSha256, report.oldAsarSha256);
  await nodeProbe('verify');
  report.passed = true;
} catch (error) {
  report.error = error.stack || String(error);
  throw error;
} finally {
  await writeFile(path.join(evidence, 'report.json'), JSON.stringify(report, null, 2) + '\n');
}
