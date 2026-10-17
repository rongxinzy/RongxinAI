/** App icon resolution, Windows window icon and dev-mode taskbar branding. */
import fs from 'fs';
import path from 'path';

import { app, shell, type BrowserWindow } from 'electron';

import { runtimeAppName, WINDOWS_TASKBAR_APP_USER_MODEL_ID } from './appEnv';

export const PRELOAD_PATH = app.isPackaged
  ? path.join(__dirname, 'preload.js')
  : path.join(__dirname, '../dist-electron/preload.js');

// 获取应用图标路径（与安装包/桌面快捷方式保持一致，不复用系统托盘图标）
export const getAppIconPath = (): string | undefined => {
  if (process.platform !== 'win32' && process.platform !== 'linux') return undefined;
  if (app.isPackaged) {
    const packagedIconName = process.platform === 'win32' ? 'icon.ico' : 'icon.png';
    return path.join(process.resourcesPath, 'app-icons', packagedIconName);
  }

  // 2026/09/21 lixiang  开发态优先用 ico：任务栏按 Windows Shell 取图标，png 常仍显示 Electron 原子图。
  if (process.platform === 'win32') {
    const icoPath = path.join(__dirname, '..', 'build', 'icons', 'win', 'icon.ico');
    if (fs.existsSync(icoPath)) return icoPath;
    const pngPath = path.join(__dirname, '..', 'build', 'icons', 'png', '256x256.png');
    if (fs.existsSync(pngPath)) return pngPath;
    return undefined;
  }
  return path.join(__dirname, '..', 'build', 'icons', 'png', '256x256.png');
};

export const applyWindowsWindowIcon = (window: BrowserWindow): void => {
  if (process.platform !== 'win32') return;
  const iconPath = getAppIconPath();
  if (!iconPath || !fs.existsSync(iconPath)) {
    console.warn('[Main] Windows app icon file is missing:', iconPath);
    return;
  }
  // Prefer path string — Electron updates both window and taskbar icons from it.
  window.setIcon(iconPath);
  console.log('[Main] Applied Windows window icon:', iconPath);
};

/**
 * Windows 任务栏：开发态必须有一条「相同 AUMID + 知远 .ico」的开始菜单快捷方式。
 * 文件名只用 ASCII，避免控制台/文件系统编码把「知远 (开发).lnk」写成乱码后对不上。
 */
export const ensureWindowsTaskbarBrand = (): void => {
  if (process.platform !== 'win32' || app.isPackaged) return;
  const iconPath = path.join(__dirname, '..', 'build', 'icons', 'win', 'icon.ico');
  if (!fs.existsSync(iconPath)) {
    console.warn('[Main] 知远 logo 不存在，无法绑定任务栏图标:', iconPath);
    return;
  }
  const programsDir = path.join(
    app.getPath('appData'),
    'Microsoft',
    'Windows',
    'Start Menu',
    'Programs',
  );
  fs.mkdirSync(programsDir, { recursive: true });
  const shortcutPath = path.join(programsDir, 'ZhiYuan-Dev.lnk');
  try {
    // 清掉历史上编码损坏的中文快捷方式名，避免 Shell 继续命中坏缓存。
    for (const name of fs.readdirSync(programsDir)) {
      if (!name.endsWith('.lnk')) continue;
      if (name === 'ZhiYuan-Dev.lnk') continue;
      if (name.includes('开发') || name.includes('知远') || /ZhiYuan|zhiyuan/i.test(name)) {
        try {
          fs.unlinkSync(path.join(programsDir, name));
        } catch {
          /* ignore */
        }
      }
    }
    // create：文件不存在时 replace 会失败且不抛错，快捷方式实际没写上，任务栏继续用原子图标缓存。
    const wrote = shell.writeShortcutLink(shortcutPath, 'create', {
      target: process.execPath,
      args: process.argv.slice(1).join(' '),
      cwd: process.cwd(),
      appUserModelId: WINDOWS_TASKBAR_APP_USER_MODEL_ID,
      icon: iconPath,
      iconIndex: 0,
      description: runtimeAppName,
    });
    if (!wrote || !fs.existsSync(shortcutPath)) {
      console.warn('[Main] Failed to write Windows taskbar brand shortcut:', shortcutPath);
      return;
    }
    console.log('[Main] Windows taskbar brand shortcut ready:', shortcutPath, iconPath);
  } catch (error) {
    console.warn('[Main] Failed to write Windows taskbar brand shortcut:', error);
  }
};
