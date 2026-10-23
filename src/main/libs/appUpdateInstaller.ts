import { spawn } from 'child_process';
import crypto from 'node:crypto';
import { app } from 'electron';
import fs from 'fs';
import path from 'path';

import { AppQuitOrigin, recordAppQuitOrigin } from '../appQuitOrigin';
import {
  appUpdateInstallReceiptPath,
  type AppUpdateInstallReceipt,
  writePendingInstallReceipt,
} from './appUpdateInstallReceipt';

/** How long the app waits for the launcher to confirm it started. */
const HELPER_HANDOFF_TIMEOUT_MS = 5_000;
/** The helper writes its marker right after PowerShell starts; poll finely so quit is not delayed. */
const HELPER_HANDOFF_POLL_MS = 50;

/**
 * Run the verified NSIS updater exactly the way electron-updater would — silent
 * (`/S`) and flagged `--updated` — but keep the handoff in this helper so a
 * failed or cancelled install still brings the application back.
 *
 * A silent assisted install never opens a wizard page, so the only visible
 * installer in the product is the WebView2 shell used for first installs and
 * manual downloads. electron-updater's own quitAndInstall cannot be used here
 * because it neither waits for the installer nor relaunches the app.
 */
export async function installWindowsNsis(exePath: string, targetVersion: string): Promise<void> {
  const stat = await fs.promises.stat(exePath);
  if (stat.size === 0) throw new Error('Update file is empty');

  console.log('[AppUpdate] Windows NSIS install (silent mode)');
  const timestamp = Date.now();
  const tempDir = app.getPath('temp');
  const logPath = path.join(tempDir, `zhiyuan-update-${timestamp}.log`);
  const scriptPath = path.join(tempDir, `zhiyuan-update-${timestamp}.ps1`);
  const vbsPath = path.join(tempDir, `zhiyuan-update-${timestamp}.vbs`);
  const handoffPath = path.join(tempDir, `zhiyuan-update-${timestamp}.started`);
  const receiptPath = appUpdateInstallReceiptPath();
  const attemptId = crypto.randomUUID();
  const psEscape = (value: string) => value.replace(/'/g, "''");

  const script = [
    `$logPath = '${psEscape(logPath)}'`,
    `$appPid = ${process.pid}`,
    `$installerPath = '${psEscape(exePath)}'`,
    `$appPath = '${psEscape(process.execPath)}'`,
    `$receiptPath = '${psEscape(receiptPath)}'`,
    `$handoffPath = '${psEscape(handoffPath)}'`,
    `$attemptId = '${attemptId}'`,
    `$targetVersion = '${psEscape(targetVersion)}'`,
    'function Write-Receipt($status, $detail) {',
    '  $record = @{ schemaVersion = 1; attemptId = $attemptId; targetVersion = $targetVersion; status = $status; detail = $detail; recordedAt = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() }',
    '  $tmp = "$receiptPath.tmp"',
    '  [IO.File]::WriteAllText($tmp, ($record | ConvertTo-Json -Compress), [Text.Encoding]::UTF8)',
    // [NullString]::Value is the only way to pass a real null backup path to
    // .NET from PowerShell; a bare $null binds as an empty string and Replace
    // throws, which used to fail the receipt right after a successful install.
    '  [IO.File]::Replace($tmp, $receiptPath, [NullString]::Value)',
    '}',
    'function Log($msg) {',
    "  $ts = Get-Date -Format 'yyyy-MM-dd HH:mm:ss.fff'",
    '  Add-Content -Path $logPath -Value "[$ts] $msg" -Encoding UTF8',
    '}',
    '$installerExitCode = $null',
    '$failure = $null',
    'try {',
    '  [IO.File]::WriteAllText($handoffPath, "started")',
    '  Log "Update script started (appPid=$appPid)"',
    // Wait-Process blocks until the pid is gone (or the timeout expires) instead
    // of polling once per second, so the installer can start immediately after
    // this process exits.
    '  Wait-Process -Id $appPid -Timeout 120 -ErrorAction SilentlyContinue',
    '  Log "Launching silent installer: $installerPath"',
    // /S --updated is the same invocation electron-updater performs for a
    // background update: no wizard page is shown, and the installer treats the
    // run as an upgrade. --force-run is deliberately not passed: this helper
    // owns the relaunch so success and failure both end with a running app.
    // CreateProcess (UseShellExecute = $false) mirrors electron-updater:
    // ShellExecute would route the freshly downloaded installer through
    // SmartScreen and hold the update behind a prompt.
    '  $installerStart = New-Object System.Diagnostics.ProcessStartInfo',
    '  $installerStart.FileName = $installerPath',
    "  $installerStart.Arguments = '/S --updated'",
    '  $installerStart.WorkingDirectory = (Split-Path -Parent $installerPath)',
    '  $installerStart.UseShellExecute = $false',
    '  $installer = [System.Diagnostics.Process]::Start($installerStart)',
    '  $installer.WaitForExit()',
    '  $installerExitCode = $installer.ExitCode',
    '  Log "Installer exited with code $installerExitCode"',
    '  if ($installerExitCode -ne 0) { throw "Installer exited with code $installerExitCode" }',
    '} catch {',
    '  $failure = $_.Exception.Message',
    '  Log "ERROR: $failure"',
    '}',
    'if ($installerExitCode -eq 0) {',
    '  try { Write-Receipt "succeeded" $null } catch { Log "Unable to save update result: $($_.Exception.Message)" }',
    '} else {',
    '  try { Write-Receipt "failed" $failure } catch { Log "Unable to save update result: $($_.Exception.Message)" }',
    '}',
    // A silent install has no finish page to start the app, so the relaunch
    // happens here in both outcomes: success starts the new version, failure
    // brings the still-installed previous version back instead of leaving the
    // desktop without the app. A receipt write failure after a clean install
    // must not prevent that relaunch.
    'if (Test-Path $appPath) {',
    '  Start-Process -FilePath $appPath',
    '  Log "Application relaunched after installer exit $installerExitCode"',
    '} else {',
    '  Log "Application executable missing after installer exit $installerExitCode"',
    '}',
  ].join('\r\n');

  await fs.promises.writeFile(scriptPath, `\ufeff${script}`, 'utf8');
  // -NoProfile keeps user profile scripts out of the update path: they can take
  // seconds and would run before the handoff marker is written.
  const vbs = `CreateObject("WScript.Shell").Run "powershell.exe -NoProfile -NonInteractive -NoLogo -ExecutionPolicy Bypass -WindowStyle Hidden -File ""${scriptPath}""", 0, False`;
  await fs.promises.writeFile(vbsPath, vbs, 'utf8');
  const pendingReceipt: AppUpdateInstallReceipt = {
    schemaVersion: 1,
    attemptId,
    targetVersion,
    status: 'pending',
    detail: null,
    recordedAt: Date.now(),
  };
  await writePendingInstallReceipt(pendingReceipt);
  let launcherPid: number | undefined;
  try {
    const launcher = spawn('wscript.exe', [vbsPath], { detached: true, stdio: 'ignore' });
    await new Promise<void>((resolve, reject) => {
      launcher.once('spawn', resolve);
      launcher.once('error', reject);
    });
    launcher.unref();
    launcherPid = launcher.pid;
    let helperStarted = false;
    const attempts = Math.ceil(HELPER_HANDOFF_TIMEOUT_MS / HELPER_HANDOFF_POLL_MS);
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      if (
        await fs.promises.stat(handoffPath).then(
          () => true,
          () => false,
        )
      ) {
        helperStarted = true;
        break;
      }
      await new Promise(resolve => setTimeout(resolve, HELPER_HANDOFF_POLL_MS));
    }
    if (!helperStarted) throw new Error('Update installer helper did not start');
  } catch (error) {
    await writePendingInstallReceipt({
      ...pendingReceipt,
      status: 'failed',
      detail: error instanceof Error ? error.message : 'Installer helper failed',
    });
    throw error;
  }
  console.log(`[AppUpdate] Launcher PID: ${launcherPid}, calling app.quit()`);
  recordAppQuitOrigin(AppQuitOrigin.UpdateInstall);
  app.quit();
  // The helper script waits for this PID to exit before starting the
  // installer, and starts it anyway after 120s. App cleanup is bounded by the
  // before-quit deadline, but if anything on the quit path wedges, force the
  // exit here so the handoff never degrades into an installer that races a
  // still-running old process (observed on Windows 10 upgrades).
  const forceExitTimer = setTimeout(() => {
    console.warn('[AppUpdate] App still alive after quit; forcing exit for update install.');
    app.exit(0);
  }, 20_000);
  forceExitTimer.unref();
}
