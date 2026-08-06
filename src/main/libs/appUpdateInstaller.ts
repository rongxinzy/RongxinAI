import { spawn } from 'child_process';
import { app } from 'electron';
import fs from 'fs';
import path from 'path';

/**
 * Preserve the assisted, visible NSIS handoff. electron-updater owns the
 * verified download, but its default quitAndInstall handoff cannot guarantee
 * that a cancellation relaunches the running application.
 */
export async function installWindowsNsis(exePath: string): Promise<void> {
  const stat = await fs.promises.stat(exePath);
  if (stat.size === 0) throw new Error('Update file is empty');

  console.log('[AppUpdate] Windows NSIS install (interactive mode)');
  const timestamp = Date.now();
  const tempDir = app.getPath('temp');
  const logPath = path.join(tempDir, `zhiyuan-update-${timestamp}.log`);
  const scriptPath = path.join(tempDir, `zhiyuan-update-${timestamp}.ps1`);
  const vbsPath = path.join(tempDir, `zhiyuan-update-${timestamp}.vbs`);
  const psEscape = (value: string) => value.replace(/'/g, "''");

  const script = [
    `$logPath = '${psEscape(logPath)}'`,
    `$appPid = ${process.pid}`,
    `$installerPath = '${psEscape(exePath)}'`,
    `$appPath = '${psEscape(process.execPath)}'`,
    'function Log($msg) {',
    "  $ts = Get-Date -Format 'yyyy-MM-dd HH:mm:ss.fff'",
    '  Add-Content -Path $logPath -Value "[$ts] $msg" -Encoding UTF8',
    '}',
    'try {',
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
    '  Log "Installer completed; NSIS finish page controls app launch"',
    '} catch {',
    '  Log "ERROR: $($_.Exception.Message)"',
    '  if (Test-Path $appPath) {',
    '    Start-Process -FilePath $appPath',
    '    Log "Existing app relaunched after installer cancellation or failure"',
    '  }',
    '}',
  ].join('\r\n');

  await fs.promises.writeFile(scriptPath, `\ufeff${script}`, 'utf8');
  const vbs = `CreateObject("WScript.Shell").Run "powershell.exe -ExecutionPolicy Bypass -WindowStyle Hidden -File ""${scriptPath}""", 0, False`;
  await fs.promises.writeFile(vbsPath, vbs, 'utf8');
  const launcher = spawn('wscript.exe', [vbsPath], { detached: true, stdio: 'ignore' });
  launcher.unref();
  console.log(`[AppUpdate] Launcher PID: ${launcher.pid}, calling app.quit()`);
  app.quit();
}
