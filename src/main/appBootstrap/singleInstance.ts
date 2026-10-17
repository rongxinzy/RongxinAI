/**
 * Single-instance lock handling: stale Linux instance takeover (AppImage
 * version upgrades) and second-instance exit path.
 */
import fs from 'fs';

import { app, dialog } from 'electron';

/**
 * Linux only: 检测单实例锁被哪个"知远"实例持有。
 *
 * 返回 null 表示没有可接管的目标(同版本多开或未检测到),此时由第一实例
 * 的 second-instance 处理唤起已有窗口,本实例直接退出。
 * 返回 { pids, oldLabel } 表示存在"旧版本"实例,需要用户确认后接管。
 *
 * 身份判定:
 *  - AppImage:运行时环境变量 APPIMAGE 指向源文件(文件名含版本号),
 *    与当前进程的 APPIMAGE 不同即视为旧版本
 *  - deb:/opt/知远 下的进程无 APPIMAGE,exe 路径匹配即视为同族;
 *    无法区分版本,统一按"旧实例"提示确认
 */
async function findStaleLinuxInstances(): Promise<{
  pids: number[];
  oldLabel: string;
} | null> {
  if (process.platform !== 'linux') return null;

  const currentAppImage = process.env.APPIMAGE ?? null;
  const familyPattern = /知远|ZhiYuanAgent/i;

  const pids: number[] = [];
  const oldAppImages: string[] = [];
  let entries: string[];
  try {
    entries = fs.readdirSync('/proc');
  } catch {
    return null;
  }
  for (const entry of entries) {
    if (!/^\d+$/.test(entry)) continue;
    const pid = Number(entry);
    if (pid === process.pid) continue;
    try {
      const env = fs.readFileSync(`/proc/${pid}/environ`, 'utf8');
      const appImage = env.match(/APPIMAGE=([^\0]*)/)?.[1] ?? null;
      if (appImage) {
        if (!familyPattern.test(appImage)) continue;
        // 同一版本文件的多开:唤起已有窗口即可,不接管
        if (currentAppImage && appImage === currentAppImage) continue;
        pids.push(pid);
        oldAppImages.push(appImage);
      } else {
        // 非 AppImage:匹配 deb 安装路径 /opt/知远
        const exe = fs.readlinkSync(`/proc/${pid}/exe`);
        if (!/\/opt\/知远/.test(exe)) continue;
        pids.push(pid);
      }
    } catch {
      // 权限不足或进程已退出,跳过
    }
  }
  if (pids.length === 0) return null;

  // 从 AppImage 文件名提取旧版本号,如 知远-1.0.0.AppImage → 1.0.0
  const versionMatch = oldAppImages[0]?.match(/-(\d+\.\d+\.\d+)\.AppImage/i);
  const oldLabel = versionMatch ? `知远 ${versionMatch[1]}` : '旧版本的知远';
  return { pids, oldLabel };
}

/** 终止指定进程并等待退出(最多 5 秒)。 */
async function terminatePids(pids: number[]): Promise<boolean> {
  for (const pid of pids) {
    try {
      process.kill(pid, 'SIGTERM');
    } catch {
      // 已退出或无权,忽略
    }
  }
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const alive = pids.filter(pid => {
      try {
        process.kill(pid, 0);
        return true;
      } catch {
        return false;
      }
    });
    if (alive.length === 0) return true;
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  return false;
}

/**
 * Runs in the second instance when the single-instance lock was not acquired:
 * focuses the first instance (handled there) or, on Linux, asks the user
 * before taking over a stale older-version instance.
 */
export const handleSecondInstanceExit = (): void => {
  void (async () => {
    // 同版本多开:第一实例已通过 second-instance 聚焦窗口,本实例直接退出。
    const stale = await findStaleLinuxInstances();
    if (stale) {
      // 旧版本实例(AppImage 替换):弹窗确认后再接管,避免中断用户正在进行
      // 的会话。确认后终止旧实例并 relaunch,让新进程重新拿锁启动。
      console.warn(
        `[Main] Detected running ${stale.oldLabel} instance (pid ${stale.pids.join(', ')}); asking user before takeover.`,
      );
      try {
        await app.whenReady();
        const currentVersion = app.getVersion();
        const { response } = await dialog.showMessageBox({
          type: 'question',
          buttons: ['关闭旧版本并启动新版本', '取消'],
          defaultId: 0,
          cancelId: 1,
          title: '检测到旧版本正在运行',
          message: `检测到 ${stale.oldLabel} 正在运行。`,
          detail:
            `当前启动的是知远 ${currentVersion}。启动新版本需要先关闭旧版本,` +
            '关闭旧版本将中断其中进行中的任务。是否继续?',
        });
        if (response === 1) {
          app.exit(0);
          return;
        }
      } catch {
        // 无显示环境(如无头 CI):无法确认,直接退出
        app.exit(0);
        return;
      }
      const terminated = await terminatePids(stale.pids);
      if (!terminated) {
        console.warn('[Main] Stale instance did not exit in time; giving up takeover.');
        app.exit(0);
        return;
      }
      app.relaunch();
      app.exit(0);
      return;
    }
    console.warn('[Main] Another ZhiYuanAgent instance is already running; exiting.');
    app.exit(0);
  })();
};
