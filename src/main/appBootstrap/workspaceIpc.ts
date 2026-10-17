/** Workspace IPC: list/create/update/rename/delete Cowork workspaces. */
import { ipcMain } from 'electron';

import { getCoworkStore, getStore } from './runtimeServices';
import {
  getDefaultConversationWorkspacePath,
  isDefaultConversationWorkspacePath,
} from '../defaultConversationWorkspace';
import fs from 'fs';
import path from 'path';

import { WorkspaceIpc, WorkspaceStoreKey } from '../../shared/workspace';
import {
  getDefaultProjectBaseDir,
  isInternalWorkspacePath,
  getUnmanagedWorkspaceBaseDir,
} from './workspacePaths';
import { forgetCoworkSession, listAllMatchingSessionIds } from './coworkSessionImages';

export const registerWorkspaceIpc = (): void => {
  ipcMain.handle(WorkspaceIpc.List, async () => {
    try {
      const store = getCoworkStore();
      let workspaces = store.listWorkspaces();
      for (const workspace of workspaces) {
        if (isDefaultConversationWorkspacePath(workspace.path)) {
          if (workspace.isHidden) store.setWorkspaceHidden(workspace.id, false);
          continue;
        }
        if (!workspace.isHidden && isInternalWorkspacePath(workspace.path)) {
          store.setWorkspaceHidden(workspace.id, true);
        }
      }
      workspaces = store.listWorkspaces();
      if (getStore().get<boolean>(WorkspaceStoreKey.DefaultConversationInitialized) !== true) {
        const defaultWorkspacePath = getDefaultConversationWorkspacePath();
        await fs.promises.mkdir(defaultWorkspacePath, { recursive: true });
        const defaultWorkspace = store.ensureWorkspace(defaultWorkspacePath);
        store.setWorkspaceHidden(defaultWorkspace.id, false);
        getStore().set(WorkspaceStoreKey.DefaultConversationInitialized, true);
        workspaces = store.listWorkspaces();
      }
      return { success: true, workspaces };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to list workspaces',
      };
    }
  });

  ipcMain.handle(
    WorkspaceIpc.Create,
    async (_event, rawOptions: { path?: string; name?: string }) => {
      try {
        const workspacePath = rawOptions?.path?.trim();
        const workspaceName = rawOptions?.name?.trim();
        if (!workspacePath) return { success: false, error: 'Workspace path is required' };
        if (!workspaceName) return { success: false, error: 'Workspace name is required' };

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
          return { success: false, error: 'Workspace path is not a directory' };

        const workspace = getCoworkStore().createWorkspace(resolvedWorkspacePath, workspaceName);
        return { success: true, workspace };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to create workspace',
        };
      }
    },
  );

  ipcMain.handle(
    WorkspaceIpc.Ensure,
    async (_event, rawOptions: { path?: string; name?: string; isHidden?: boolean }) => {
      try {
        const workspacePath = rawOptions?.path?.trim();
        if (!workspacePath) return { success: false, error: 'Workspace path is required' };
        const workspace = getCoworkStore().ensureWorkspace(
          workspacePath,
          rawOptions.name,
          rawOptions.isHidden === true,
        );
        return { success: true, workspace };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to ensure workspace',
        };
      }
    },
  );

  ipcMain.handle(WorkspaceIpc.Rename, async (_event, id: string, name: string) => {
    try {
      const normalizedName = name.trim();
      if (!normalizedName) return { success: false, error: 'Workspace name is required' };

      const localCoworkStore = getCoworkStore();
      const workspace = localCoworkStore.getWorkspace(id);
      if (!workspace) return { success: false, error: 'Workspace not found' };
      if (isDefaultConversationWorkspacePath(workspace.path)) {
        return { success: false, error: 'The default conversation workspace cannot be renamed' };
      }
      const renamedWorkspace = localCoworkStore.renameWorkspace(id, normalizedName);
      if (!renamedWorkspace) return { success: false, error: 'Workspace not found' };
      return { success: true, workspace: renamedWorkspace };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to rename workspace',
      };
    }
  });

  ipcMain.handle(
    WorkspaceIpc.Update,
    async (
      _event,
      rawOptions: { id?: string; name?: string; primaryPath?: string; folders?: string[] },
    ) => {
      try {
        const id = rawOptions?.id?.trim();
        if (!id) return { success: false, error: 'Workspace id is required' };
        const localCoworkStore = getCoworkStore();
        const workspace = localCoworkStore.getWorkspace(id);
        if (!workspace) return { success: false, error: 'Workspace not found' };

        const requestedName = rawOptions.name?.trim();
        const requestedPath = rawOptions.primaryPath?.trim();
        const pathsEqual = (a: string, b: string): boolean =>
          process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
        // Resolve both sides so trailing separators or relative segments cannot
        // smuggle a duplicate of the primary path into the attached folders.
        const resolvedFolders = rawOptions.folders
          ?.map(folder => folder.trim())
          .filter(Boolean)
          .map(folder => path.resolve(folder));
        const pathChanged =
          !!requestedPath && !pathsEqual(path.resolve(requestedPath), path.resolve(workspace.path));

        if (pathChanged) {
          if (isDefaultConversationWorkspacePath(workspace.path)) {
            return {
              success: false,
              error: 'The default conversation workspace path cannot be changed',
            };
          }
          const resolvedPath = path.resolve(requestedPath!);
          const stat = await fs.promises.stat(resolvedPath).catch((): null => null);
          if (!stat?.isDirectory()) {
            return { success: false, error: 'Workspace path is not a directory' };
          }
          const relocated = localCoworkStore.relocateWorkspace(
            id,
            resolvedPath,
            requestedName || workspace.name,
          );
          if (!relocated) return { success: false, error: 'Workspace not found' };
          if (rawOptions.folders) {
            localCoworkStore.setWorkspaceFolders(
              relocated.id,
              (resolvedFolders ?? []).filter(folder => !pathsEqual(folder, resolvedPath)),
            );
            localCoworkStore.touchWorkspace(relocated.id);
          }
          return { success: true, workspace: localCoworkStore.getWorkspace(relocated.id) };
        }

        if (requestedName && requestedName !== workspace.name) {
          if (isDefaultConversationWorkspacePath(workspace.path)) {
            return {
              success: false,
              error: 'The default conversation workspace cannot be renamed',
            };
          }
          const renamed = localCoworkStore.renameWorkspace(id, requestedName);
          if (!renamed) return { success: false, error: 'Workspace not found' };
        }
        if (rawOptions.folders) {
          localCoworkStore.setWorkspaceFolders(
            id,
            (resolvedFolders ?? []).filter(
              folder => !pathsEqual(folder, path.resolve(workspace.path)),
            ),
          );
          localCoworkStore.touchWorkspace(id);
        }
        return { success: true, workspace: localCoworkStore.getWorkspace(id) };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to update workspace',
        };
      }
    },
  );

  ipcMain.handle(WorkspaceIpc.Delete, async (_event, id: string) => {
    try {
      if (typeof id !== 'string' || !id.trim()) {
        return { success: false, error: 'Workspace id is required' };
      }
      const localCoworkStore = getCoworkStore();
      const workspace = localCoworkStore.getWorkspace(id);
      if (!workspace) return { success: false, error: 'Workspace not found' };
      if (isDefaultConversationWorkspacePath(workspace.path)) {
        return { success: false, error: 'The default conversation workspace cannot be removed' };
      }
      for (const sessionId of listAllMatchingSessionIds({ workspaceId: id })) {
        forgetCoworkSession(sessionId);
      }
      const deletedSessionIds = localCoworkStore.deleteWorkspace(id);
      console.log(
        `[CoworkStore] removed a workspace along with ${deletedSessionIds.length} session(s)`,
      );
      return { success: true, deletedSessionIds };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to remove workspace',
      };
    }
  });
};
