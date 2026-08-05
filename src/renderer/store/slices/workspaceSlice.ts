import { createSlice, PayloadAction } from '@reduxjs/toolkit';

import type { Workspace } from '../../../shared/workspace';

interface WorkspaceState {
  workspaces: Workspace[];
  currentWorkspaceId: string | null;
  loading: boolean;
}

const initialState: WorkspaceState = {
  workspaces: [],
  currentWorkspaceId: null,
  loading: false,
};

const workspaceSlice = createSlice({
  name: 'workspace',
  initialState,
  reducers: {
    setWorkspaces(state, action: PayloadAction<Workspace[]>) {
      state.workspaces = action.payload;
      if (
        state.currentWorkspaceId &&
        !action.payload.some(workspace => workspace.id === state.currentWorkspaceId)
      ) {
        state.currentWorkspaceId = action.payload.find(workspace => !workspace.isHidden)?.id ?? null;
      }
    },
    setCurrentWorkspaceId(state, action: PayloadAction<string | null>) {
      state.currentWorkspaceId = action.payload;
    },
    setWorkspaceLoading(state, action: PayloadAction<boolean>) {
      state.loading = action.payload;
    },
  },
});

export const { setWorkspaces, setCurrentWorkspaceId, setWorkspaceLoading } = workspaceSlice.actions;
export default workspaceSlice.reducer;
