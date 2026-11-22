/**
 * Single-instance lock handling: stale Linux instance takeover (AppImage
 * version upgrades) and second-instance exit path.
 */
import { readFile, readlink, stat } from 'node:fs/promises';
import { hostname } from 'node:os';
import { posix as path } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import { app, dialog } from 'electron';

type LinuxLockOwner = {
  pid: number;
  startTime: string;
  executable: string;
  appImage?: string;
};

async function readProcessStartTime(pid: number): Promise<string | null> {
  try {
    const record = await readFile(`/proc/${pid}/stat`, 'utf8');
    // starttime is field 22, after a comm field that may contain parentheses.
    const fields = record
      .slice(record.lastIndexOf(')') + 2)
      .trim()
      .split(/\s+/);
    if (!/^\d+$/.test(fields[19] ?? '')) throw new Error('Invalid Linux process stat');
    return fields[0] === 'Z' || fields[0] === 'X' ? null : fields[19];
  } catch (error) {
    const { code } = error as NodeJS.ErrnoException;
    if (code === 'ENOENT' || code === 'ESRCH') return null;
    throw error;
  }
}

async function findStaleLinuxLockOwner(): Promise<LinuxLockOwner | null> {
  if (process.platform !== 'linux') return null;

  try {
    // Chromium stores the browser process's hostname and PID in this profile's symlink.
    const lockPath = path.join(app.getPath('userData'), 'SingletonLock');
    const lock = await readlink(lockPath);
    const prefix = `${hostname()}-`;
    const pidText = lock.slice(prefix.length);
    if (!lock.startsWith(prefix) || !/^\d+$/.test(pidText)) return null;
    const pid = Number(pidText);
    if (!Number.isSafeInteger(pid) || pid <= 1 || pid === process.pid) return null;

    const proc = `/proc/${pid}`;
    if ((await stat(proc)).uid !== process.geteuid?.()) return null;
    const executable = await readlink(`${proc}/exe`);
    const executablePath = executable.replace(/ \(deleted\)$/, '');
    if (!/^(知远|ZhiYuanAgent)$/i.test(path.basename(executablePath))) return null;

    const environment = (await readFile(`${proc}/environ`, 'utf8')).split('\0');
    const argv = (await readFile(`${proc}/cmdline`, 'utf8')).split('\0');
    if (
      environment.some(entry => entry.startsWith('ELECTRON_RUN_AS_NODE=')) ||
      argv.some(arg => arg.startsWith('--type='))
    ) {
      return null;
    }
    const appImage = environment
      .find(entry => entry.startsWith('APPIMAGE='))
      ?.slice('APPIMAGE='.length);
    if (appImage) {
      const appDir = environment
        .find(entry => entry.startsWith('APPDIR='))
        ?.slice('APPDIR='.length);
      if (
        appImage === process.env.APPIMAGE ||
        !path.isAbsolute(appImage) ||
        !appDir ||
        !path.isAbsolute(appDir) ||
        path.dirname(executablePath) !== path.resolve(appDir)
      ) {
        return null;
      }
    } else if (
      executablePath !== '/opt/知远智能体 (ZhiYuan Agent)/知远' &&
      executablePath !== '/opt/知远/知远' &&
      executablePath !== '/opt/ZhiYuanAgent/ZhiYuanAgent'
    ) {
      return null;
    }

    if ((await readlink(lockPath)) !== lock) return null;
    const startTime = await readProcessStartTime(pid);
    return startTime ? { pid, startTime, executable, appImage } : null;
  } catch {
    return null;
  }
}

async function terminateOwner({ pid, startTime }: LinuxLockOwner): Promise<boolean> {
  try {
    process.kill(pid, 'SIGTERM');
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline) {
      if ((await readProcessStartTime(pid)) !== startTime) return true;
      await delay(200);
    }
    return false;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'ESRCH';
  }
}

/**
 * Runs in the second instance when the single-instance lock was not acquired:
 * focuses the first instance (handled there) or, on Linux, asks the user
 * before taking over a stale older-version instance.
 */
export const handleSecondInstanceExit = (): void => {
  void (async () => {
    try {
      const stale = await findStaleLinuxLockOwner();
      if (!stale) {
        console.warn('[Main] Another ZhiYuanAgent instance is already running; exiting.');
        return;
      }

      const version =
        stale.appImage && path.basename(stale.appImage).match(/-(\d+\.\d+\.\d+)\.AppImage/i);
      const oldLabel = version ? `知远 ${version[1]}` : '旧版本的知远';
      console.warn(
        `[Main] Detected running ${oldLabel} instance (pid ${stale.pid}); asking user before takeover.`,
      );
      await app.whenReady();
      const { response } = await dialog.showMessageBox({
        type: 'question',
        buttons: ['关闭旧版本并启动新版本', '取消'],
        defaultId: 0,
        cancelId: 1,
        title: '检测到旧版本正在运行',
        message: `检测到 ${oldLabel} 正在运行。`,
        detail:
          `当前启动的是知远 ${app.getVersion()}。启动新版本需要先关闭旧版本,` +
          '关闭旧版本将中断其中进行中的任务。是否继续?',
      });
      if (response !== 0) return;

      const current = await findStaleLinuxLockOwner();
      if (
        !current ||
        current.pid !== stale.pid ||
        current.startTime !== stale.startTime ||
        current.executable !== stale.executable ||
        current.appImage !== stale.appImage
      ) {
        console.warn(
          '[Main] The existing instance changed during confirmation; skipping takeover.',
        );
        return;
      }

      if (await terminateOwner(current)) {
        app.relaunch();
      } else {
        console.warn('[Main] Could not confirm the previous instance exited; skipping takeover.');
      }
    } catch (error) {
      console.warn('[Main] Could not confirm instance takeover:', error);
    } finally {
      app.exit(0);
    }
  })();
};
