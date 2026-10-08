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

/**
 * Preserve the assisted, visible NSIS handoff. electron-updater owns the
 * verified download, but its default quitAndInstall handoff cannot guarantee
 * that a cancellation relaunches the running application.
 */
export async function installWindowsNsis(exePath: string, targetVersion: string): Promise<void> {
  const stat = await fs.promises.stat(exePath);
  if (stat.size === 0) throw new Error('Update file is empty');

  console.log('[AppUpdate] Windows NSIS install (interactive mode)');
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
    '  [IO.File]::Replace($tmp, $receiptPath, $null)',
    '}',
    'function Log($msg) {',
    "  $ts = Get-Date -Format 'yyyy-MM-dd HH:mm:ss.fff'",
    '  Add-Content -Path $logPath -Value "[$ts] $msg" -Encoding UTF8',
    '}',
    'try {',
    '  [IO.File]::WriteAllText($handoffPath, "started")',
    '  Log "Update script started (appPid=$appPid)"',
    '  $waited = 0',
    '  while ($waited -lt 120) {',
    '    try { Get-Process -Id $appPid -ErrorAction Stop | Out-Null; Start-Sleep -Seconds 1; $waited++ }',
    '    catch { break }',
    '  }',
    '  Log "Launching interactive installer: $installerPath"',
    '  $installer = Start-Process -FilePath $installerPath -Wait -PassThru',
    '  Log "Installer exited with code $($installer.ExitCode)"',
    '  if ($installer.ExitCode -ne 0) { throw "Installer exited with code $($installer.ExitCode)" }',
    '  Write-Receipt "succeeded" $null',
    '  Log "Installer completed; NSIS finish page controls app launch"',
    '} catch {',
    '  Log "ERROR: $($_.Exception.Message)"',
    '  try { Write-Receipt "failed" $_.Exception.Message } catch { Log "Unable to save update result: $($_.Exception.Message)" }',
    '  if (Test-Path $appPath) {',
    '    Start-Process -FilePath $appPath',
    '    Log "Existing app relaunched after installer cancellation or failure"',
    '  }',
    '}',
  ].join('\r\n');

  await fs.promises.writeFile(scriptPath, `\ufeff${script}`, 'utf8');
  const vbs = `CreateObject("WScript.Shell").Run "powershell.exe -ExecutionPolicy Bypass -WindowStyle Hidden -File ""${scriptPath}""", 0, False`;
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
    for (let attempt = 0; attempt < 25; attempt += 1) {
      if (
        await fs.promises.stat(handoffPath).then(
          () => true,
          () => false,
        )
      ) {
        helperStarted = true;
        break;
      }
      await new Promise(resolve => setTimeout(resolve, 200));
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
