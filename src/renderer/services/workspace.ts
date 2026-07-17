import type { Workspace } from '../../shared/workspace';
import { WorkspaceDefault } from '../../shared/workspace';
import { store } from '../store';
import { clearCurrentSession } from '../store/slices/coworkSlice';
import {
  setCurrentWorkspaceId,
  setWorkspaceLoading,
  setWorkspaces,
} from '../store/slices/workspaceSlice';
import { localStore } from './store';

const CURRENT_WORKSPACE_KEY = 'workspace.currentId';

type LegacyCompatibleCoworkApi = {
  listWorkspaces?: () => Promise<{ success: boolean; workspaces?: Workspace[] }>;
  ensureWorkspace?: (options: {
    path: string;
    name?: string;
  }) => Promise<{ success: boolean; workspace?: Workspace }>;
  renameWorkspace?: (
    id: string,
    name: string,
  ) => Promise<{ success: boolean; workspace?: Workspace }>;
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

      store.dispatch(setWorkspaces(workspaces));

      const savedId = await localStore.getItem<string>(CURRENT_WORKSPACE_KEY);
      const currentId = workspaces.some(workspace => workspace.id === savedId)
        ? savedId
        : (workspaces[0]?.id ?? null);
      store.dispatch(setCurrentWorkspaceId(currentId));
      if (currentId) await localStore.setItem(CURRENT_WORKSPACE_KEY, currentId);
      return workspaces;
    } finally {
      store.dispatch(setWorkspaceLoading(false));
    }
  }

  async ensureWorkspace(path: string, name?: string): Promise<Workspace | null> {
    const cowork = getCompatibleCoworkApi();
    let workspace: Workspace | undefined;
    if (this.workspaceApiAvailable && typeof cowork?.ensureWorkspace === 'function') {
      try {
        const result = await cowork.ensureWorkspace({ path, name });
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
      { ...workspace, name: name?.trim() || workspace.name },
    ];
    store.dispatch(setWorkspaces(next));
    return next[next.length - 1];
  }

  async selectWorkspace(workspaceId: string): Promise<void> {
    if (!store.getState().workspace.workspaces.some(workspace => workspace.id === workspaceId))
      return;
    if (store.getState().workspace.currentWorkspaceId !== workspaceId) {
      store.dispatch(clearCurrentSession());
    }
    store.dispatch(setCurrentWorkspaceId(workspaceId));
    await localStore.setItem(CURRENT_WORKSPACE_KEY, workspaceId);
  }

  async renameWorkspace(workspaceId: string, name: string): Promise<Workspace | null> {
    const cowork = getCompatibleCoworkApi();
    let workspace: Workspace | undefined;
    if (this.workspaceApiAvailable && typeof cowork?.renameWorkspace === 'function') {
      const result = await cowork.renameWorkspace(workspaceId, name);
      workspace = result.success ? result.workspace : undefined;
    }
    workspace ??= store.getState().workspace.workspaces.find(item => item.id === workspaceId);
    if (!workspace) return null;
    const renamedWorkspace = { ...workspace, name: name.trim(), updatedAt: Date.now() };
    store.dispatch(
      setWorkspaces(
        store
          .getState()
          .workspace.workspaces.map(item =>
            item.id === renamedWorkspace.id ? renamedWorkspace : item,
          ),
      ),
    );
    return renamedWorkspace;
  }
}

export const workspaceService = new WorkspaceService();
