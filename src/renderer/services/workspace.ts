import type { Workspace } from '../../shared/workspace';
import { WorkspaceDefault } from '../../shared/workspace';
import { store } from '../store';
import { isScratchWorkspacePath } from '../utils/path';
import {
  clearCurrentSession,
  clearCurrentSessionForWorkspaceChange,
  deleteSessions as deleteSessionsAction,
} from '../store/slices/coworkSlice';
import {
  setCurrentWorkspaceId,
  setWorkspaceLoading,
  setWorkspaces,
} from '../store/slices/workspaceSlice';
import { localStore } from './store';

const CURRENT_WORKSPACE_KEY = 'workspace.currentId';
const PINNED_WORKSPACES_KEY = 'workspace.pinnedIds';

type SelectWorkspaceOptions = {
  preserveSessionLoading?: boolean;
  persistSelection?: boolean;
};

type LegacyCompatibleCoworkApi = {
  listWorkspaces?: () => Promise<{ success: boolean; workspaces?: Workspace[] }>;
  ensureWorkspace?: (options: {
    path: string;
    name?: string;
    isHidden?: boolean;
  }) => Promise<{ success: boolean; workspace?: Workspace }>;
  renameWorkspace?: (
    id: string,
    name: string,
  ) => Promise<{ success: boolean; workspace?: Workspace }>;
  deleteWorkspace?: (
    id: string,
  ) => Promise<{ success: boolean; deletedSessionIds?: string[]; error?: string }>;
  getConfig?: () => Promise<{ success: boolean; config?: { workingDirectory?: string } }>;
};

const getCompatibleCoworkApi = (): LegacyCompatibleCoworkApi | undefined =>
  window.electron?.cowork as unknown as LegacyCompatibleCoworkApi | undefined;

const createLegacyWorkspace = (workspacePath: string): Workspace => {
  const normalizedPath = workspacePath.trim();
  const segments = normalizedPath.split(/[\\/]/).filter(Boolean);
  return {
    id: WorkspaceDefault.Main,
    name: segments[segments.length - 1] || normalizedPath,
    path: normalizedPath,
    isHidden: false,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
};

class WorkspaceService {
  private workspaceApiAvailable = false;

  isWorkspaceApiAvailable(): boolean {
    return this.workspaceApiAvailable;
  }

  async loadWorkspaces(): Promise<Workspace[]> {
    store.dispatch(setWorkspaceLoading(true));
    try {
      const cowork = getCompatibleCoworkApi();
      let workspaces: Workspace[] = [];
      if (typeof cowork?.listWorkspaces === 'function') {
        try {
          const result = await cowork.listWorkspaces();
          this.workspaceApiAvailable = result.success;
          workspaces = result.success ? (result.workspaces ?? []) : [];
        } catch (error) {
          this.workspaceApiAvailable = false;
          console.warn(
            '[WorkspaceService] Workspace IPC is unavailable, using legacy session fallback:',
            error,
          );
        }
      }

      if (!this.workspaceApiAvailable) {
        try {
          const config = await cowork?.getConfig?.();
          const configuredPath = config?.success ? config.config?.workingDirectory?.trim() : '';
          if (configuredPath) workspaces = [createLegacyWorkspace(configuredPath)];
        } catch (error) {
          console.warn('[WorkspaceService] Failed to load legacy workspace configuration:', error);
        }
      }

      const pinnedIds = (await localStore.getItem<string[]>(PINNED_WORKSPACES_KEY)) ?? [];
      const pinnedSet = new Set(pinnedIds);
      workspaces = workspaces
        .map(workspace => ({ ...workspace, pinned: pinnedSet.has(workspace.id) }))
        .sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)));
      store.dispatch(setWorkspaces(workspaces));

      const savedId = await localStore.getItem<string>(CURRENT_WORKSPACE_KEY);
      const currentId = workspaces.some(workspace => workspace.id === savedId && !workspace.isHidden)
        ? savedId
        : (workspaces.find(workspace => !workspace.isHidden && isScratchWorkspacePath(workspace.path))
            ?.id ??
          workspaces.find(workspace => !workspace.isHidden)?.id ??
          null);
      store.dispatch(setCurrentWorkspaceId(currentId));
      if (currentId) await localStore.setItem(CURRENT_WORKSPACE_KEY, currentId);
      return workspaces;
    } finally {
      store.dispatch(setWorkspaceLoading(false));
    }
  }

  async refreshWorkspaces(): Promise<void> {
    if (!this.workspaceApiAvailable) return;

    const cowork = getCompatibleCoworkApi();
    if (typeof cowork?.listWorkspaces !== 'function') return;

    try {
      const result = await cowork.listWorkspaces();
      if (!result.success) return;
      const pinnedIds = (await localStore.getItem<string[]>(PINNED_WORKSPACES_KEY)) ?? [];
      const pinnedSet = new Set(pinnedIds);
      const workspaces = (result.workspaces ?? [])
        .map(workspace => ({ ...workspace, pinned: pinnedSet.has(workspace.id) }))
        .sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)));
      store.dispatch(setWorkspaces(workspaces));
    } catch (error) {
      this.workspaceApiAvailable = false;
      console.warn('[WorkspaceService] Failed to refresh workspaces:', error);
    }
  }

  async toggleWorkspacePin(workspaceId: string, pinned: boolean): Promise<void> {
    const workspaces = store.getState().workspace.workspaces;
    if (!workspaces.some(workspace => workspace.id === workspaceId)) return;
    const currentIds = (await localStore.getItem<string[]>(PINNED_WORKSPACES_KEY)) ?? [];
    const nextIds = pinned
      ? [...currentIds.filter(id => id !== workspaceId), workspaceId]
      : currentIds.filter(id => id !== workspaceId);
    await localStore.setItem(PINNED_WORKSPACES_KEY, nextIds);
    store.dispatch(
      setWorkspaces(
        workspaces
          .map(workspace => ({ ...workspace, pinned: nextIds.includes(workspace.id) }))
          .sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned))),
      ),
    );
  }

  promoteWorkspace(workspaceId: string): void {
    const workspaces = store.getState().workspace.workspaces;
    const workspace = workspaces.find(item => item.id === workspaceId);
    if (!workspace) return;

    store.dispatch(
      setWorkspaces([
        { ...workspace, updatedAt: Date.now() },
        ...workspaces.filter(item => item.id !== workspaceId),
      ]),
    );
  }

  async ensureWorkspace(
    path: string,
    name?: string,
    options: { isHidden?: boolean } = {},
  ): Promise<Workspace | null> {
    const cowork = getCompatibleCoworkApi();
    let workspace: Workspace | undefined;
    if (this.workspaceApiAvailable && typeof cowork?.ensureWorkspace === 'function') {
      try {
        const result = await cowork.ensureWorkspace({ path, name, isHidden: options.isHidden });
        workspace = result.success ? result.workspace : undefined;
      } catch (error) {
        this.workspaceApiAvailable = false;
        console.warn(
          '[WorkspaceService] Failed to create Workspace through IPC, using local fallback:',
          error,
        );
      }
    }
    workspace ??= createLegacyWorkspace(path);
    const current = store.getState().workspace.workspaces;
    const next = [
      ...current.filter(item => item.id !== workspace!.id),
      {
        ...workspace,
        name: name?.trim() || workspace.name,
        isHidden: options.isHidden ?? workspace.isHidden,
      },
    ];
    store.dispatch(setWorkspaces(next));
    return next[next.length - 1];
  }

  async selectWorkspace(
    workspaceId: string,
    { preserveSessionLoading = false, persistSelection = true }: SelectWorkspaceOptions = {},
  ): Promise<void> {
    if (!store.getState().workspace.workspaces.some(workspace => workspace.id === workspaceId))
      return;
    if (store.getState().workspace.currentWorkspaceId !== workspaceId) {
      store.dispatch(
        preserveSessionLoading ? clearCurrentSessionForWorkspaceChange() : clearCurrentSession(),
      );
    }
    store.dispatch(setCurrentWorkspaceId(workspaceId));
    if (persistSelection) await localStore.setItem(CURRENT_WORKSPACE_KEY, workspaceId);
  }

  async clearWorkspaceSelection(): Promise<void> {
    store.dispatch(setCurrentWorkspaceId(null));
    await localStore.removeItem(CURRENT_WORKSPACE_KEY);
  }

  async renameWorkspace(workspaceId: string, name: string): Promise<Workspace | null> {
    const cowork = getCompatibleCoworkApi();
    if (!this.workspaceApiAvailable || typeof cowork?.renameWorkspace !== 'function') return null;

    const result = await cowork.renameWorkspace(workspaceId, name);
    const renamedWorkspace = result.success ? result.workspace : undefined;
    if (!renamedWorkspace) return null;

    const { currentWorkspaceId, workspaces } = store.getState().workspace;
    const originalIndex = workspaces.findIndex(item => item.id === workspaceId);
    const workspacesWithoutRenamed = workspaces.filter(
      item => item.id !== workspaceId && item.id !== renamedWorkspace.id,
    );
    const insertionIndex =
      originalIndex < 0
        ? workspacesWithoutRenamed.length
        : workspaces
            .slice(0, originalIndex)
            .filter(item => item.id !== renamedWorkspace.id).length;
    const nextWorkspaces = [
      ...workspacesWithoutRenamed.slice(0, insertionIndex),
      renamedWorkspace,
      ...workspacesWithoutRenamed.slice(insertionIndex),
    ];

    if (currentWorkspaceId === workspaceId) {
      // Keep the replacement ID selected before replacing the list so no
      // workspace switch runs and the open session remains intact.
      store.dispatch(setCurrentWorkspaceId(renamedWorkspace.id));
      await localStore.setItem(CURRENT_WORKSPACE_KEY, renamedWorkspace.id);
    }
    store.dispatch(setWorkspaces(nextWorkspaces));
    return renamedWorkspace;
  }

  /**
   * Removes a workspace from the app together with its session records.
   * Files on disk are never touched. When the removed workspace was the
   * current selection, the selection and open session are cleared back to
   * home (mirroring the mode-switch clear).
   */
  async deleteWorkspace(workspaceId: string): Promise<boolean> {
    const cowork = getCompatibleCoworkApi();
    if (!this.workspaceApiAvailable || typeof cowork?.deleteWorkspace !== 'function') {
      return false;
    }
    const result = await cowork.deleteWorkspace(workspaceId);
    if (!result.success) {
      console.error('Failed to remove workspace:', result.error);
      return false;
    }

    const deletedSessionIds = result.deletedSessionIds ?? [];
    if (deletedSessionIds.length > 0) {
      store.dispatch(deleteSessionsAction(deletedSessionIds));
    }

    const wasCurrent = store.getState().workspace.currentWorkspaceId === workspaceId;
    store.dispatch(
      setWorkspaces(
        store.getState().workspace.workspaces.filter(item => item.id !== workspaceId),
      ),
    );
    if (wasCurrent) {
      // setWorkspaces auto-selects the next workspace when the current one
      // disappears; override back to no selection (home) instead.
      store.dispatch(clearCurrentSession());
      store.dispatch(setCurrentWorkspaceId(null));
      await localStore.removeItem(CURRENT_WORKSPACE_KEY);
    }
    return true;
  }
}

export const workspaceService = new WorkspaceService();
