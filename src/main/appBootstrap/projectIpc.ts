/** Project directory IPC: default base dir, directory creation, scratch dir, random workspaces. */
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

import { ipcMain } from 'electron';

import { getDefaultProjectBaseDir, getUnmanagedWorkspaceBaseDir } from './workspacePaths';
import { getDefaultConversationWorkspacePath } from '../defaultConversationWorkspace';
import { ProjectCreateDirectorySchema } from '../../shared/ipc/schemas';
import { ProjectIpc } from '../../shared/ipc/channels';

export const registerProjectIpc = (): void => {
  ipcMain.handle(ProjectIpc.GetDefaultBaseDir, async () => {
    try {
      return { success: true, path: getDefaultProjectBaseDir() };
    } catch (error) {
      return {
        success: false,
        path: null,
        error: error instanceof Error ? error.message : 'Failed to resolve default project path',
      };
    }
  });

  ipcMain.handle(ProjectIpc.CreateDirectory, async (_event, rawOptions: unknown) => {
    try {
      const options = ProjectCreateDirectorySchema.input.parse(rawOptions);
      const name = options.name.trim();
      if (!name || /[\\/:*?"<>|]/.test(name) || name === '.' || name === '..') {
        return { success: false, path: null, code: 'invalid-name', error: 'Invalid project name' };
      }
      const baseDir = options.baseDir?.trim() || getDefaultProjectBaseDir();
      const targetPath = path.join(baseDir, name);
      if (fs.existsSync(targetPath)) {
        return {
          success: false,
          path: null,
          code: 'already-exists',
          error: 'A directory with this name already exists',
        };
      }
      await fs.promises.mkdir(targetPath, { recursive: true });
      console.log('[Project] created project directory:', targetPath);
      return { success: true, path: targetPath };
    } catch (error) {
      return {
        success: false,
        path: null,
        error: error instanceof Error ? error.message : 'Failed to create project directory',
      };
    }
  });

  ipcMain.handle(ProjectIpc.EnsureScratchDir, async () => {
    try {
      const scratchDir = getDefaultConversationWorkspacePath();
      await fs.promises.mkdir(scratchDir, { recursive: true });
      return { success: true, path: scratchDir };
    } catch (error) {
      return {
        success: false,
        path: null,
        error: error instanceof Error ? error.message : 'Failed to ensure scratch directory',
      };
    }
  });

  ipcMain.handle(ProjectIpc.CreateRandomWorkspace, async () => {
    try {
      const randomWorkspacePath = path.join(getUnmanagedWorkspaceBaseDir(), crypto.randomUUID());
      await fs.promises.mkdir(randomWorkspacePath, { recursive: true });
      return { success: true, path: randomWorkspacePath };
    } catch (error) {
      return {
        success: false,
        path: null,
        error: error instanceof Error ? error.message : 'Failed to create random workspace',
      };
    }
  });
};
