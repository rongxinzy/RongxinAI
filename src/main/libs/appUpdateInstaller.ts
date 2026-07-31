import crypto from 'crypto';
import { exec, spawn } from 'child_process';
import { app, session } from 'electron';
import fs from 'fs';
import path from 'path';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';

import { type AppUpdateSource } from '../../shared/appUpdate/constants';

export interface AppUpdateDownloadProgress {
  received: number;
  total: number | undefined;
  percent: number | undefined;
  speed: number | undefined;
}

export interface DownloadedAppUpdate {
  filePath: string;
  sha256: string;
}

let activeDownloadController: AbortController | null = null;

export function cancelActiveDownload(): boolean {
  if (activeDownloadController) {
    console.log('[AppUpdate] Download cancelled by user');
    activeDownloadController.abort('cancelled');
    activeDownloadController = null;
    return true;
  }
  return false;
}

/** Escape a string for safe use as a single-quoted POSIX shell argument. */
function shellEscape(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`;
}

function execAsync(command: string, timeoutMs = 120_000): Promise<string> {
  return new Promise((resolve, reject) => {
    exec(command, { maxBuffer: 10 * 1024 * 1024, timeout: timeoutMs }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(`${error.message}\nstderr: ${stderr}`));
      } else {
        resolve(stdout.trim());
      }
    });
  });
}

/** Minimum interval between progress IPC events (ms). */
const PROGRESS_THROTTLE_MS = 200;

/** Abort download if no data received for this duration (ms). */
const DOWNLOAD_INACTIVITY_TIMEOUT_MS = 60_000;

export async function downloadUpdate(
  url: string,
  source: AppUpdateSource,
  expected: { size: number; sha256: string },
  onProgress: (progress: AppUpdateDownloadProgress) => void,
): Promise<DownloadedAppUpdate> {
  if (activeDownloadController) {
    throw new Error('A download is already in progress');
  }

  console.log(`[AppUpdate] Starting download: ${url}`);

  // Validate URL
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    throw new Error(`Invalid download URL: ${url}`);
  }

  const ext = path.extname(parsedUrl.pathname) || (process.platform === 'darwin' ? '.dmg' : '.exe');
  const updateDir = path.join(app.getPath('userData'), 'updates');
  const ts = Date.now();
  const downloadPath = path.join(updateDir, `zhiyuan-update-${source}-${ts}${ext}.download`);
  const finalPath = path.join(updateDir, `zhiyuan-update-${source}-${ts}${ext}`);

  console.log(`[AppUpdate] Temp path: ${downloadPath}`);
  console.log(`[AppUpdate] Final path: ${finalPath}`);

  const controller = new AbortController();
  activeDownloadController = controller;

  let writeStream: fs.WriteStream | null = null;
  let inactivityTimer: ReturnType<typeof setTimeout> | null = null;

  const clearInactivityTimer = () => {
    if (inactivityTimer) {
      clearTimeout(inactivityTimer);
      inactivityTimer = null;
    }
  };

  const resetInactivityTimer = () => {
    clearInactivityTimer();
    inactivityTimer = setTimeout(() => {
      console.error('[AppUpdate] Download inactivity timeout (60s), aborting');
      controller.abort('timeout');
    }, DOWNLOAD_INACTIVITY_TIMEOUT_MS);
  };

  try {
    const response = await session.defaultSession.fetch(url, {
      signal: controller.signal,
    });

    console.log(`[AppUpdate] HTTP response: ${response.status} ${response.statusText}`);

    if (!response.ok) {
      throw new Error(`Download failed (HTTP ${response.status})`);
    }

    if (!response.body) {
      throw new Error('Response has no body');
    }

    const totalHeader = response.headers.get('content-length');
    const total = totalHeader ? Number(totalHeader) : undefined;
    console.log(`[AppUpdate] Content-Length: ${totalHeader ?? 'unknown'}`);

    let received = 0;
    const hash = crypto.createHash('sha256');
    let lastSpeedTime = Date.now();
    let lastSpeedBytes = 0;
    let currentSpeed: number | undefined = undefined;
    let lastProgressTime = 0;

    const emitProgress = () => {
      onProgress({
        received,
        total: total && Number.isFinite(total) ? total : undefined,
        percent: total && Number.isFinite(total) ? received / total : undefined,
        speed: currentSpeed,
      });
    };

    // Emit initial progress
    emitProgress();

    await fs.promises.mkdir(updateDir, { recursive: true });
    writeStream = fs.createWriteStream(downloadPath);

    const nodeStream = Readable.fromWeb(response.body as any);

    // Start inactivity timer
    resetInactivityTimer();

    nodeStream.on('data', (chunk: Buffer) => {
      received += chunk.length;
      hash.update(chunk);

      // Reset inactivity timer on each chunk
      resetInactivityTimer();

      // Calculate speed with 1-second window
      const now = Date.now();
      const elapsed = now - lastSpeedTime;
      if (elapsed >= 1000) {
        currentSpeed = ((received - lastSpeedBytes) / elapsed) * 1000;
        lastSpeedTime = now;
        lastSpeedBytes = received;
      }

      // Throttle progress events to avoid flooding IPC channel
      if (now - lastProgressTime >= PROGRESS_THROTTLE_MS) {
        lastProgressTime = now;
        emitProgress();
      }
    });

    await pipeline(nodeStream, writeStream);
    writeStream = null;
    clearInactivityTimer();

    // Validate downloaded file
    const stat = await fs.promises.stat(downloadPath);
    console.log(`[AppUpdate] Download complete: ${stat.size} bytes`);

    if (stat.size === 0) {
      throw new Error('Downloaded file is empty');
    }
    if (total && Number.isFinite(total) && stat.size !== total) {
      throw new Error(`Download incomplete: expected ${total} bytes but got ${stat.size}`);
    }
    if (stat.size !== expected.size) {
      throw new Error(`Downloaded size mismatch: expected ${expected.size} bytes but got ${stat.size}`);
    }

    const sha256 = hash.digest('hex');
    if (!crypto.timingSafeEqual(Buffer.from(sha256, 'hex'), Buffer.from(expected.sha256, 'hex'))) {
      throw new Error('Downloaded file checksum verification failed');
    }

    // Rename to final path (atomic on same filesystem)
    await fs.promises.rename(downloadPath, finalPath);
    console.log(`[AppUpdate] File saved to: ${finalPath}`);

    // Emit final 100% progress
    onProgress({
      received,
      total: total && Number.isFinite(total) ? total : received,
      percent: 1,
      speed: currentSpeed,
    });

    return { filePath: finalPath, sha256 };
  } catch (error) {
    clearInactivityTimer();
    console.error('[AppUpdate] Download error:', error);

    // Clean up partial download
    try {
      if (writeStream) {
        writeStream.destroy();
      }
      await fs.promises.unlink(downloadPath).catch(() => {});
    } catch {
      // Ignore cleanup errors
    }

    if (controller.signal.aborted) {
      if (controller.signal.reason === 'timeout') {
        throw new Error('Download timed out: no data received for 60 seconds');
      }
      throw new Error('Download cancelled');
    }
    throw error;
  } finally {
    activeDownloadController = null;
  }
}

export async function installUpdate(filePath: string): Promise<void> {
  console.log(`[AppUpdate] Installing update from: ${filePath}`);
  console.log(`[AppUpdate] Platform: ${process.platform}, Arch: ${process.arch}`);

  // Verify the file exists before attempting install
  try {
    const stat = await fs.promises.stat(filePath);
    console.log(`[AppUpdate] Installer file size: ${stat.size} bytes`);
    if (stat.size === 0) {
      throw new Error('Update file is empty');
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error('Update file not found');
    }
    throw error;
  }

  if (process.platform === 'darwin') {
    return installMacDmg(filePath);
  }
  if (process.platform === 'win32') {
    return installWindowsNsis(filePath);
  }
  if (process.platform === 'linux') {
    return installLinuxPackage(filePath);
  }
  throw new Error('Unsupported platform');
}

async function installLinuxPackage(packagePath: string): Promise<void> {
  const appImagePath = process.env.APPIMAGE;
  const scriptPath = path.join(app.getPath('temp'), `zhiyuan-update-${Date.now()}.sh`);
  const appPid = process.pid;
  const waitForExit = `while kill -0 ${appPid} 2>/dev/null; do sleep 1; done`;

  let script: string;
  if (appImagePath) {
    await fs.promises.access(path.dirname(appImagePath), fs.constants.W_OK);
    const stagedPath = `${appImagePath}.updating`;
    script = [
      '#!/bin/sh',
      'set -eu',
      waitForExit,
      `cp ${shellEscape(packagePath)} ${shellEscape(stagedPath)}`,
      `chmod +x ${shellEscape(stagedPath)}`,
      `mv ${shellEscape(stagedPath)} ${shellEscape(appImagePath)}`,
      `exec ${shellEscape(appImagePath)}`,
      '',
    ].join('\n');
  } else {
    script = [
      '#!/bin/sh',
      'set -eu',
      waitForExit,
      `pkexec /usr/bin/dpkg -i ${shellEscape(packagePath)}`,
      `exec ${shellEscape(process.execPath)}`,
      '',
    ].join('\n');
  }

  await fs.promises.writeFile(scriptPath, script, { mode: 0o700 });
  const launcher = spawn('/bin/sh', [scriptPath], { detached: true, stdio: 'ignore' });
  launcher.unref();
  console.log(`[AppUpdate] Linux installer scheduled via ${scriptPath}`);
  app.quit();
}

async function installMacDmg(dmgPath: string): Promise<void> {
  let mountPoint: string | null = null;

  try {
    // Mount the DMG (timeout 60s)
    console.log('[AppUpdate] Mounting DMG...');
    const mountOutput = await execAsync(
      `hdiutil attach ${shellEscape(dmgPath)} -nobrowse -noautoopen -noverify`,
      60_000,
    );

    // Parse mount point from output (last line, last column)
    const lines = mountOutput.split('\n').filter(l => l.trim());
    const lastLine = lines[lines.length - 1];
    const mountMatch = lastLine?.match(/\t(\/Volumes\/.+)$/);
    if (!mountMatch) {
      throw new Error('Failed to determine mount point from hdiutil output');
    }
    mountPoint = mountMatch[1];
    console.log(`[AppUpdate] Mounted at: ${mountPoint}`);

    // Find .app bundle in mount point
    const entries = await fs.promises.readdir(mountPoint);
    const appBundle = entries.find(e => e.endsWith('.app'));
    if (!appBundle) {
      throw new Error('No .app bundle found in DMG');
    }

    const sourceApp = path.join(mountPoint, appBundle);
    console.log(`[AppUpdate] Source app: ${sourceApp}`);

    // Determine target path: current running app location
    // process.resourcesPath is .app/Contents/Resources, go up 3 levels
    const currentAppPath = path.resolve(process.resourcesPath, '..', '..', '..');
    let targetApp: string;

    if (currentAppPath.endsWith('.app')) {
      targetApp = currentAppPath;
    } else {
      // Fallback to /Applications
      targetApp = `/Applications/${appBundle}`;
    }
    console.log(`[AppUpdate] Target app: ${targetApp}`);

    // Try to copy the .app bundle (use shellEscape to prevent injection)
    try {
      console.log('[AppUpdate] Copying app bundle...');
      await execAsync(
        `rm -rf ${shellEscape(targetApp)} && cp -R ${shellEscape(sourceApp)} ${shellEscape(targetApp)}`,
        300_000,
      );
      console.log('[AppUpdate] Copy succeeded');
    } catch {
      // Permission denied: try with admin privileges via osascript
      console.log('[AppUpdate] Normal copy failed, requesting admin privileges...');
      try {
        // For osascript, escape backslashes and double quotes for the inner shell
        const escapeForInnerShell = (s: string) =>
          s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\$/g, '\\$').replace(/`/g, '\\`');
        const escapedTarget = escapeForInnerShell(targetApp);
        const escapedSource = escapeForInnerShell(sourceApp);
        await execAsync(
          `osascript -e 'do shell script "rm -rf \\"${escapedTarget}\\" && cp -R \\"${escapedSource}\\" \\"${escapedTarget}\\"" with administrator privileges'`,
          300_000,
        );
        console.log('[AppUpdate] Admin copy succeeded');
      } catch (adminError) {
        throw new Error(
          `Installation failed: insufficient permissions. ${adminError instanceof Error ? adminError.message : ''}`,
        );
      }
    }

    // Detach DMG (timeout 30s)
    try {
      await execAsync(`hdiutil detach ${shellEscape(mountPoint)} -force`, 30_000);
    } catch {
      // Best effort
    }
    mountPoint = null;

    // Clean up downloaded DMG
    try {
      await fs.promises.unlink(dmgPath);
    } catch {
      // Best effort
    }

    // Relaunch from the new app location
    const executablePath = path.join(targetApp, 'Contents', 'MacOS');
    const execEntries = await fs.promises.readdir(executablePath);
    const executable = execEntries[0]; // Should be the app executable

    if (executable) {
      console.log(`[AppUpdate] Relaunching: ${path.join(executablePath, executable)}`);
      app.relaunch({ execPath: path.join(executablePath, executable) });
    } else {
      console.log('[AppUpdate] Relaunching (default)');
      app.relaunch();
    }
    app.quit();
  } catch (error) {
    console.error('[AppUpdate] macOS install error:', error);
    // Clean up mount point on error
    if (mountPoint) {
      try {
        await execAsync(`hdiutil detach ${shellEscape(mountPoint)} -force`, 30_000);
      } catch {
        // Best effort
      }
    }
    throw error;
  }
}

async function installWindowsNsis(exePath: string): Promise<void> {
  console.log(`[AppUpdate] Windows NSIS install (silent mode)`);
  console.log(`[AppUpdate]   installer: ${exePath}`);
  console.log(`[AppUpdate]   appPid: ${process.pid}`);

  // We must NOT spawn the installer directly as a child of the app, because
  // the NSIS customInit macro stops the installed app process tree
  // which kills the entire process tree — including child processes.
  //
  // Strategy: use a tiny PowerShell script (launched via hidden VBS) that
  // waits for the app to fully exit, then runs the installer without its
  // wizard. The installer can still request Windows UAC when required.
  const ts = Date.now();
  const tempDir = app.getPath('temp');
  const logPath = path.join(tempDir, `zhiyuan-update-${ts}.log`);
  const scriptPath = path.join(tempDir, `zhiyuan-update-${ts}.ps1`);
  const vbsPath = path.join(tempDir, `zhiyuan-update-${ts}.vbs`);

  console.log(`[AppUpdate] Script log: ${logPath}`);

  const psEscape = (s: string) => s.replace(/'/g, "''");

  const psScript = [
    `$logPath = '${psEscape(logPath)}'`,
    `$appPid = ${process.pid}`,
    `$installerPath = '${psEscape(exePath)}'`,
    `$appPath = '${psEscape(process.execPath)}'`,
    '',
    'function Log($msg) {',
    "    $ts = Get-Date -Format 'yyyy-MM-dd HH:mm:ss.fff'",
    '    Add-Content -Path $logPath -Value "[$ts] $msg" -Encoding UTF8',
    '}',
    '',
    'try {',
    '    Log "Update script started (appPid=$appPid)"',
    '',
    '    # Wait for the app to fully exit (by PID, max 120s)',
    '    $waited = 0',
    '    while ($waited -lt 120) {',
    '        try {',
    '            Get-Process -Id $appPid -ErrorAction Stop | Out-Null',
    '            Start-Sleep -Seconds 1',
    '            $waited++',
    '        } catch {',
    '            break',
    '        }',
    '    }',
    '    Log "App exited after $waited seconds"',
    '',
    '    # Install without showing the NSIS wizard, then start the updated app.',
    '    Log "Launching silent installer: $installerPath"',
    "    $installer = Start-Process -FilePath $installerPath -ArgumentList '/S' -Wait -PassThru",
    '    Log "Installer exited with code $($installer.ExitCode)"',
    '    if ($installer.ExitCode -ne 0) { throw "Installer exited with code $($installer.ExitCode)" }',
    '    if (-not (Test-Path $appPath)) { throw "Updated app executable was not found: $appPath" }',
    '    Start-Process -FilePath $appPath',
    '    Log "Updated app relaunched"',
    '} catch {',
    '    Log "ERROR: $($_.Exception.Message)"',
    '}',
  ].join('\r\n');

  await fs.promises.writeFile(scriptPath, '\ufeff' + psScript, 'utf-8');

  const vbsScript = `CreateObject("WScript.Shell").Run "powershell.exe -ExecutionPolicy Bypass -WindowStyle Hidden -File ""${scriptPath}""", 0, False`;
  await fs.promises.writeFile(vbsPath, vbsScript, 'utf-8');

  console.log('[AppUpdate] Launching installer via wscript.exe...');

  const launcher = spawn('wscript.exe', [vbsPath], {
    detached: true,
    stdio: 'ignore',
  });
  launcher.unref();

  console.log(`[AppUpdate] Launcher PID: ${launcher.pid}, calling app.quit()`);
  app.quit();
}
