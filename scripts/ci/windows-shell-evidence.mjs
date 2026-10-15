// Final delivery gate: only a genuine shell acceptance report for these exact
// bytes, source commit and CI run can release the shell-installed application.
import assert from 'node:assert/strict';
import { createReadStream } from 'node:fs';
import { readFile, readdir, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import sfx from '../installer-shell/sfx-format.cjs';

export const shellChecks = [
  'fullOfflineComponentSet',
  'localInferenceOption',
  'freshInstall',
  'closeWithoutLaunch',
  'cancelPreservesRunningInstallation',
  'cancelledUpgradePreservesData',
  'detachedUpgradeRollbackPreservesData',
  'unownedBackupDirectoriesPreserved',
  'lockedDirectoryRetry',
  'failurePreservesExistingInstallation',
  'launchFailureRecovery',
  'finishLaunchesInstalledApplication',
  'userDataPreserved',
  'visibleActionsFitActualDpi',
  'chineseAndEnglish',
  'missingWebView2ExplicitFailure',
];
export const shellScreenshots = [
  'missing-webview2',
  'fresh-welcome',
  'fresh-progress',
  'fresh-finish',
  'existing-install-before-cancel',
  'cancelled-upgrade',
  'detached-upgrade-cancelled',
  'recovery-locked-directory',
  'recovery-finish',
  'finish-launch-error',
  'finish-launch-recovered',
  'launched-installed-app',
];

export function assertDetachedTransaction(state, installRoot) {
  assert.equal(
    path.resolve(state.InstallDir).toLowerCase(),
    path.resolve(installRoot).toLowerCase(),
    'Detached transaction belongs to another installation',
  );
  assert.equal(state.Committed, false, 'Cancellation must precede transaction commit');
  const prefix = `${installRoot}.old.`;
  assert(
    typeof state.BackupDir === 'string' &&
      state.BackupDir.toLowerCase().startsWith(prefix.toLowerCase()) &&
      /^[0-9a-f]{32}$/i.test(state.BackupDir.slice(prefix.length)),
    'Detached upgrade must own a precise GUID backup',
  );
  return state.BackupDir;
}

export async function observeDetachedUpgrade(installRoot) {
  const journalPath = `${installRoot}.setup-state.json`;
  let state;
  try {
    state = JSON.parse(await readFile(journalPath, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
  const backup = assertDetachedTransaction(state, installRoot);
  // Both real previous payload files must already be in the detached tree,
  // while extraction has created the new installation directory.
  try {
    const previousExe = await stat(path.join(backup, '知远.exe'));
    const previousAsar = await stat(path.join(backup, 'resources/app.asar'));
    assert(
      previousExe.isFile() &&
        previousExe.size > 0 &&
        previousAsar.isFile() &&
        previousAsar.size > 0,
      'Actual detached app payload is missing',
    );
    const partialFiles = await readdir(installRoot);
    if (partialFiles.length === 0) return null; // Require real extraction output, not just a created directory.
    return {
      observedAt: new Date().toISOString(),
      journalPath,
      transaction: state,
      previousExeBytes: previousExe.size,
      previousAsarBytes: previousAsar.size,
      partialFiles,
    };
  } catch (error) {
    if (error.code === 'ENOENT') return null; // Phase event may precede partial directory creation.
    throw error;
  }
}

export function assertShellIdentity(report, expected) {
  assert.equal(
    report.kind,
    'webview2-shell-interactive-acceptance',
    'NSIS evidence cannot authorize shell delivery',
  );
  assert.equal(report.passed, true, 'Real shell acceptance must pass');
  for (const key of ['commit', 'runId', 'installerSha256']) {
    assert(expected[key], `Missing build identity: ${key}`);
    assert.equal(report[key], expected[key], `Shell evidence identity mismatch: ${key}`);
  }
  for (const check of shellChecks)
    assert.equal(report.checks[check], true, `Missing shell acceptance check: ${check}`);
  assert.equal(
    path.resolve(report.installedExecutable).toLowerCase(),
    path.resolve(expected.installedExecutable).toLowerCase(),
    'Full application smoke must use the shell-installed app',
  );
}

async function sha256(filename) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(filename)) hash.update(chunk);
  return hash.digest('hex');
}

export async function verifyShellEvidence({
  directory,
  installer,
  installedExecutable,
  commit,
  runId,
}) {
  const framing = sfx.inspectSetup(installer);
  const manifest = JSON.parse(await readFile(`${installer}.manifest.json`, 'utf8'));
  for (const key of [
    'kind',
    'format',
    'architecture',
    'installerBytes',
    'shellBytes',
    'payloadBytes',
    'certificateBytes',
    'signed',
  ])
    assert.equal(manifest[key], framing[key], `Final SFX manifest mismatch: ${key}`);
  assert.equal(manifest.sha256, await sha256(installer), 'Final SFX packaging hash mismatch');
  // Authenticode trust is checked separately by the signing workflow. The
  // interactive proof binds these final bytes for both unsigned PR and signed builds.
  assert.equal(typeof manifest.signed, 'boolean', 'Final setup must declare its signing state');
  const report = JSON.parse(await readFile(path.join(directory, 'report.json'), 'utf8'));
  assertShellIdentity(report, {
    commit,
    runId,
    installedExecutable,
    installerSha256: await sha256(installer),
  });
  assertDetachedTransaction(report.detachedUpgrade.transaction, path.dirname(installedExecutable));
  assert.equal(
    await sha256(installedExecutable),
    report.installedAppSha256,
    'Installed app changed after shell acceptance',
  );
  assert.equal(
    await sha256(path.join(path.dirname(installedExecutable), 'resources/app.asar')),
    report.installedAsarSha256,
    'Installed application payload changed after shell acceptance',
  );
  for (const name of shellScreenshots) {
    const filename = `${name}.png`;
    const bytes = await readFile(path.join(directory, filename));
    assert(
      bytes.length > 5000 && bytes.subarray(1, 4).toString() === 'PNG',
      `Missing actual screenshot: ${name}`,
    );
    assert.equal(
      await sha256(path.join(directory, filename)),
      report.screenshots[filename],
      `Screenshot hash mismatch: ${name}`,
    );
    assert(
      (await stat(path.join(directory, `${name}.json`))).size > 0,
      `Missing control evidence: ${name}`,
    );
  }
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const [directory, installer, installedExecutable] = process.argv.slice(2);
  await verifyShellEvidence({
    directory,
    installer,
    installedExecutable,
    commit: process.env.ZHIYUAN_SOURCE_COMMIT || process.env.GITHUB_SHA,
    runId: process.env.GITHUB_RUN_ID,
  });
}
