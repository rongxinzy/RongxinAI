/** Shell IPC: open paths/files in OS, open external URLs and HTML in browser. */
import fs from 'fs';
import os from 'os';
import path from 'path';

import { pathToFileURL } from 'url';

import { ipcMain, shell } from 'electron';

import { isDev } from './appEnv';
import { normalizeWindowsShellPath } from './shellPathNormalize';
import {
  isAllowedShellOpenPath,
  isAllowedShellProbePath,
  isSensitivePath,
} from '../shellPathValidation';
import { getAllowedShellProbeRoots } from './dialogIpc';
import { ShellIpc } from '../../shared/ipc/channels';

export const registerShellIpc = (): void => {
  // Shell handlers - 打开文件/文件夹
  ipcMain.handle(ShellIpc.OpenPath, async (_event, filePath: string) => {
    try {
      const normalizedPath = normalizeWindowsShellPath(filePath);
      const validation = isAllowedShellOpenPath(normalizedPath);
      if (!validation.allowed) {
        return { success: false, error: validation.reason ?? 'Access denied' };
      }
      const result = await shell.openPath(normalizedPath);
      if (result) {
        // 如果返回非空字符串，表示打开失败
        return { success: false, error: result };
      }
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  ipcMain.handle(ShellIpc.ShowItemInFolder, async (_event, filePath: string) => {
    try {
      const normalizedPath = normalizeWindowsShellPath(filePath);
      if (isSensitivePath(normalizedPath)) {
        return { success: false, error: 'Access to sensitive system paths is blocked' };
      }
      shell.showItemInFolder(normalizedPath);
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  // 供对话内本地路径高亮：仅当处于受允许的安全根目录且磁盘上存在对应文件时返回 exists: true
  ipcMain.handle(ShellIpc.PathExists, async (_event, filePath: string) => {
    try {
      if (typeof filePath !== 'string' || !filePath.trim()) {
        return { success: true, exists: false };
      }
      const normalizedPath = normalizeWindowsShellPath(filePath);
      const allowedRoots = getAllowedShellProbeRoots();
      if (!isAllowedShellProbePath(normalizedPath, allowedRoots)) {
        return { success: true, exists: false };
      }
      return { success: true, exists: fs.existsSync(normalizedPath) };
    } catch (error) {
      return {
        success: false,
        exists: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  });

  ipcMain.handle('shell:openExternal', async (_event, url: string) => {
    try {
      await shell.openExternal(url);
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  ipcMain.handle('shell:openHtmlInBrowser', async (_event, htmlContent: string) => {
    try {
      const tmpDir = path.join(os.tmpdir(), 'zhiyuan-preview');
      fs.mkdirSync(tmpDir, { recursive: true });
      const tmpFile = path.join(tmpDir, `preview-${Date.now()}.html`);
      fs.writeFileSync(tmpFile, htmlContent, 'utf-8');
      if (process.platform === 'win32') {
        const result = await shell.openPath(tmpFile);
        if (result) return { success: false, error: result };
      } else {
        await shell.openExternal(pathToFileURL(tmpFile).href);
      }
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });
};
