/** Project directory IPC: default base dir, scratch dir and random workspaces. */
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

import { appSystemContract } from '../../../shared/ipc/appSystemContract';
import { handleIpcContractSubset } from '../../ipc/handleIpcContract';

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
