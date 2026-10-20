/** Shell IPC: open paths/files in OS, open external URLs and HTML in browser. */
import fs from 'fs';
import os from 'os';
import path from 'path';

import { pathToFileURL } from 'url';

import { shell } from 'electron';

import { normalizeWindowsShellPath } from './shellPathNormalize';
import { isAllowedShellOpenPath, isSensitivePath } from '../shellPathValidation';
import { resolveLocalPathCandidate } from '../localPathResolver';
import { getAllowedShellProbeRoots } from '../dialogIpc';
import { appSystemContract } from '../../shared/ipc/appSystemContract';
import type { CoworkStore } from '../coworkStore';
import { handleIpcContractSubset } from '../ipc/handleIpcContract';

export interface ShellIpcDeps {
  getCoworkStore: () => CoworkStore;
}

export const registerShellIpc = (deps: ShellIpcDeps): void => {
  // Shell handlers - 打开文件/文件夹
  handleIpcContractSubset(appSystemContract, {
    shellOpenPath: async (_event, filePath) => {
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
    },

    shellShowItemInFolder: async (_event, filePath) => {
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
    },

    // 对话内本地路径解析：把渲染进程给出的候选（inline code / 非 http 链接）解析为
    // 允许根目录内真实存在的文件路径；目录与不存在的路径返回 null。
    shellResolveLocalPath: async (_event, candidate, cwd) => {
      try {
        const allowedRoots = getAllowedShellProbeRoots(deps.getCoworkStore);
        const resolved = await resolveLocalPathCandidate(
          typeof candidate === 'string' ? candidate : '',
          typeof cwd === 'string' && cwd ? cwd : undefined,
          allowedRoots,
        );
        return { path: resolved };
      } catch (error) {
        console.error('[ShellIpc] resolve local path failed:', error);
        return { path: null };
      }
    },

    shellOpenExternal: async (_event, url) => {
      try {
        await shell.openExternal(url);
        return { success: true };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
      }
    },

    shellOpenHtmlInBrowser: async (_event, htmlContent) => {
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
    },
  });
};
