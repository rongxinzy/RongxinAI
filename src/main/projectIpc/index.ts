/** Project directory IPC: default base dir, directory creation, scratch dir, random workspaces. */
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

import { appSystemContract } from '../../shared/ipc/appSystemContract';
import { handleIpcContractSubset } from '../ipc/handleIpcContract';

export interface ProjectIpcDeps {
  getDefaultProjectBaseDir: () => string;
  getUnmanagedWorkspaceBaseDir: () => string;
  getDefaultConversationWorkspacePath: () => string;
}

export const registerProjectIpc = (deps: ProjectIpcDeps): void => {
  handleIpcContractSubset(appSystemContract, {
    projectGetDefaultBaseDir: async () => {
      try {
        return { success: true, path: deps.getDefaultProjectBaseDir() };
      } catch (error) {
        return {
          success: false,
          path: null,
          error: error instanceof Error ? error.message : 'Failed to resolve default project path',
        };
      }
    },

    projectCreateDirectory: async (_event, options) => {
      try {
        const name = options.name.trim();
        if (!name || /[\\/:*?"<>|]/.test(name) || name === '.' || name === '..') {
          return {
            success: false,
            path: null,
            code: 'invalid-name' as const,
            error: 'Invalid project name',
          };
        }
        const baseDir = options.baseDir?.trim() || deps.getDefaultProjectBaseDir();
        const targetPath = path.join(baseDir, name);
        if (fs.existsSync(targetPath)) {
          return {
            success: false,
            path: null,
            code: 'already-exists' as const,
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
    },

    projectEnsureScratchDir: async () => {
      try {
        const scratchDir = deps.getDefaultConversationWorkspacePath();
        await fs.promises.mkdir(scratchDir, { recursive: true });
        return { success: true, path: scratchDir };
      } catch (error) {
        return {
          success: false,
          path: null,
          error: error instanceof Error ? error.message : 'Failed to ensure scratch directory',
        };
      }
    },

    projectCreateRandomWorkspace: async () => {
      try {
        const randomWorkspacePath = path.join(
          deps.getUnmanagedWorkspaceBaseDir(),
          crypto.randomUUID(),
        );
        await fs.promises.mkdir(randomWorkspacePath, { recursive: true });
        return { success: true, path: randomWorkspacePath };
      } catch (error) {
        return {
          success: false,
          path: null,
          error: error instanceof Error ? error.message : 'Failed to create random workspace',
        };
      }
    },
  });
};
