/** Workspace IPC: list/create/update/rename/delete Cowork workspaces. */
import { getCoworkStore, getStore } from './runtimeServices';
import {
  getDefaultConversationWorkspacePath,
  isDefaultConversationWorkspacePath,
} from '../defaultConversationWorkspace';
import fs from 'fs';
import path from 'path';

import { WorkspaceStoreKey } from '../../shared/workspace';
import { getDefaultProjectBaseDir, isInternalWorkspacePath } from './workspacePaths';
import { handleIpcContract } from '../ipc/handleIpcContract';
import { getPiRuntimeAdapter } from './sessionServices';
import { workspaceContract } from '../../shared/ipc/coworkContract';

export const registerWorkspaceIpc = (
  deleteWorkspaceWithSessions: (workspaceId: string) => Promise<string[] | null>,
): void => {
  handleIpcContract(workspaceContract, {
    listWorkspaces: async () => {
      try {
        const workspaceStore = getCoworkStore().workspaces;
        let workspaces = workspaceStore.listWorkspaces();
        for (const workspace of workspaces) {
          if (isDefaultConversationWorkspacePath(workspace.path)) {
            if (workspace.isHidden) workspaceStore.setWorkspaceHidden(workspace.id, false);
            continue;
          }
          if (!workspace.isHidden && isInternalWorkspacePath(workspace.path)) {
            workspaceStore.setWorkspaceHidden(workspace.id, true);
          }
        }
        workspaces = workspaceStore.listWorkspaces();
        if (getStore().get<boolean>(WorkspaceStoreKey.DefaultConversationInitialized) !== true) {
          const defaultWorkspacePath = getDefaultConversationWorkspacePath();
          await fs.promises.mkdir(defaultWorkspacePath, { recursive: true });
          const defaultWorkspace = workspaceStore.ensureWorkspace(defaultWorkspacePath);
          workspaceStore.setWorkspaceHidden(defaultWorkspace.id, false);
          getStore().set(WorkspaceStoreKey.DefaultConversationInitialized, true);
          workspaces = workspaceStore.listWorkspaces();
        }
        return { success: true as const, workspaces };
      } catch (error) {
        return {
          success: false as const,
          error: error instanceof Error ? error.message : 'Failed to list workspaces',
        };
      }
    },

    createWorkspace: async (_event, options) => {
      try {
        const workspacePath = options.path.trim();
        const workspaceName = options.name.trim();
        if (!workspacePath) return { success: false as const, error: 'Workspace path is required' };
        if (!workspaceName) return { success: false as const, error: 'Workspace name is required' };

        const defaultWorkspacePath = getDefaultProjectBaseDir();
        const resolvedWorkspacePath = path.resolve(workspacePath);
        const resolvedDefaultPath = path.resolve(defaultWorkspacePath);
        const isDefaultWorkspacePath =
          process.platform === 'win32'
            ? resolvedWorkspacePath.toLowerCase() === resolvedDefaultPath.toLowerCase()
            : resolvedWorkspacePath === resolvedDefaultPath;
        if (isDefaultWorkspacePath) {
          await fs.promises.mkdir(resolvedWorkspacePath, { recursive: true });
        }
        const stat = await fs.promises.stat(resolvedWorkspacePath);
        if (!stat.isDirectory())
          return { success: false as const, error: 'Workspace path is not a directory' };

        const workspace = getCoworkStore().workspaces.createWorkspace(
          resolvedWorkspacePath,
          workspaceName,
        );
        return { success: true as const, workspace };
      } catch (error) {
        return {
          success: false as const,
          error: error instanceof Error ? error.message : 'Failed to create workspace',
        };
      }
    },

    ensureWorkspace: async (_event, options) => {
      try {
        const workspacePath = options.path.trim();
        if (!workspacePath) return { success: false as const, error: 'Workspace path is required' };
        const workspace = getCoworkStore().workspaces.ensureWorkspace(
          workspacePath,
          options.name,
          options.isHidden === true,
        );
        return { success: true as const, workspace };
      } catch (error) {
        return {
          success: false as const,
          error: error instanceof Error ? error.message : 'Failed to ensure workspace',
        };
      }
    },

    updateWorkspace: async (_event, options) => {
      try {
        const id = options.id.trim();
        if (!id) return { success: false as const, error: 'Workspace id is required' };
        const localCoworkStore = getCoworkStore();
        const workspaceStore = localCoworkStore.workspaces;
        const workspace = workspaceStore.getWorkspace(id);
        if (!workspace) return { success: false as const, error: 'Workspace not found' };

        const requestedName = options.name?.trim();
        const requestedPath = options.primaryPath?.trim();
        const pathsEqual = (a: string, b: string): boolean =>
          process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
        // Resolve both sides so trailing separators or relative segments cannot
        // smuggle a duplicate of the primary path into the attached folders.
        const resolvedFolders = options.folders
          ?.map(folder => folder.trim())
          .filter(Boolean)
          .map(folder => path.resolve(folder));
        const pathChanged =
          !!requestedPath && !pathsEqual(path.resolve(requestedPath), path.resolve(workspace.path));

        if (pathChanged) {
          if (isDefaultConversationWorkspacePath(workspace.path)) {
            return {
              success: false as const,
              error: 'The default conversation workspace path cannot be changed',
            };
          }
          const resolvedPath = path.resolve(requestedPath!);
          const stat = await fs.promises.stat(resolvedPath).catch((): null => null);
          if (!stat?.isDirectory()) {
            return { success: false as const, error: 'Workspace path is not a directory' };
          }
          const relocated = workspaceStore.relocateWorkspace(
            id,
            resolvedPath,
            requestedName || workspace.name,
            getPiRuntimeAdapter().getRunningSessionIds(),
          );
          if (!relocated) return { success: false as const, error: 'Workspace not found' };
          if (options.folders) {
            workspaceStore.setWorkspaceFolders(
              relocated.id,
              (resolvedFolders ?? []).filter(folder => !pathsEqual(folder, resolvedPath)),
            );
            workspaceStore.touchWorkspace(relocated.id);
          }
          return {
            success: true as const,
            workspace: workspaceStore.getWorkspace(relocated.id),
          };
        }

        if (requestedName && requestedName !== workspace.name) {
          if (isDefaultConversationWorkspacePath(workspace.path)) {
            return {
              success: false as const,
              error: 'The default conversation workspace cannot be renamed',
            };
          }
          const renamed = workspaceStore.renameWorkspace(id, requestedName);
          if (!renamed) return { success: false as const, error: 'Workspace not found' };
        }
        if (options.folders) {
          workspaceStore.setWorkspaceFolders(
            id,
            (resolvedFolders ?? []).filter(
              folder => !pathsEqual(folder, path.resolve(workspace.path)),
            ),
          );
          workspaceStore.touchWorkspace(id);
        }
        return { success: true as const, workspace: workspaceStore.getWorkspace(id) };
      } catch (error) {
        return {
          success: false as const,
          error: error instanceof Error ? error.message : 'Failed to update workspace',
        };
      }
    },

    deleteWorkspace: async (_event, id) => {
      try {
        const workspaceStore = getCoworkStore().workspaces;
        const workspace = workspaceStore.getWorkspace(id);
        if (!workspace) return { success: false as const, error: 'Workspace not found' };
        if (isDefaultConversationWorkspacePath(workspace.path)) {
          return {
            success: false as const,
            error: 'The default conversation workspace cannot be removed',
          };
        }
        const deletedSessionIds = await deleteWorkspaceWithSessions(id);
        if (!deletedSessionIds) return { success: false as const, error: 'Workspace not found' };
        console.log(
          `[CoworkStore] removed a workspace along with ${deletedSessionIds.length} session(s)`,
        );
        return { success: true as const, deletedSessionIds };
      } catch (error) {
        return {
          success: false as const,
          error: error instanceof Error ? error.message : 'Failed to remove workspace',
        };
      }
    },
  });
};
