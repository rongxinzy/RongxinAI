import type { Workspace } from '../../shared/workspace';
import { store } from '../store';
import { clearCurrentSession } from '../store/slices/coworkSlice';
import { setCurrentWorkspaceId, setWorkspaceLoading, setWorkspaces } from '../store/slices/workspaceSlice';
import { localStore } from './store';

const CURRENT_WORKSPACE_KEY = 'workspace.currentId';

class WorkspaceService {
  async loadWorkspaces(): Promise<Workspace[]> {
    store.dispatch(setWorkspaceLoading(true));
    try {
      const result = await window.electron?.cowork?.listWorkspaces();
      const workspaces = result?.success ? result.workspaces ?? [] : [];
      store.dispatch(setWorkspaces(workspaces));

      const savedId = await localStore.getItem<string>(CURRENT_WORKSPACE_KEY);
      const currentId = workspaces.some((workspace) => workspace.id === savedId)
        ? savedId
        : workspaces[0]?.id ?? null;
      store.dispatch(setCurrentWorkspaceId(currentId));
      if (currentId) await localStore.setItem(CURRENT_WORKSPACE_KEY, currentId);
      return workspaces;
    } finally {
      store.dispatch(setWorkspaceLoading(false));
    }
  }

  async ensureWorkspace(path: string, name?: string): Promise<Workspace | null> {
    const result = await window.electron?.cowork?.ensureWorkspace({ path, name });
    if (!result?.success || !result.workspace) return null;
    const current = store.getState().workspace.workspaces;
    const next = [...current.filter((workspace) => workspace.id !== result.workspace!.id), result.workspace];
    store.dispatch(setWorkspaces(next));
    return result.workspace;
  }

  async selectWorkspace(workspaceId: string): Promise<void> {
    if (!store.getState().workspace.workspaces.some((workspace) => workspace.id === workspaceId)) return;
    if (store.getState().workspace.currentWorkspaceId !== workspaceId) {
      store.dispatch(clearCurrentSession());
    }
    store.dispatch(setCurrentWorkspaceId(workspaceId));
    await localStore.setItem(CURRENT_WORKSPACE_KEY, workspaceId);
  }

  async renameWorkspace(workspaceId: string, name: string): Promise<Workspace | null> {
    const result = await window.electron?.cowork?.renameWorkspace(workspaceId, name);
    if (!result?.success || !result.workspace) return null;
    store.dispatch(setWorkspaces(
      store.getState().workspace.workspaces.map((workspace) => (
        workspace.id === result.workspace!.id ? result.workspace! : workspace
      )),
    ));
    return result.workspace;
  }
}

export const workspaceService = new WorkspaceService();
