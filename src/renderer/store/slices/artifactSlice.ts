import { createSlice, PayloadAction } from '@reduxjs/toolkit';

import { normalizeFilePathForDedup } from '../../services/artifactParser';
import { ArtifactRole, type Artifact } from '../../types/artifact';
import type { RootState } from '../index';

const DEFAULT_PANEL_WIDTH = 560;
const MIN_PANEL_WIDTH = 180;

export type ArtifactPanelView = 'files' | 'preview';
export type ArtifactActiveTab = 'preview' | 'code';
export const ArtifactLayoutMode = {
  Split: 'split',
  Workspace: 'workspace',
} as const;
export type ArtifactLayoutMode = (typeof ArtifactLayoutMode)[keyof typeof ArtifactLayoutMode];

interface ArtifactState {
  artifactsBySession: Record<string, Artifact[]>;
  activeProjectionBySession: Record<string, { taskId: string; runId: string | null } | undefined>;
  selectedArtifactId: string | null;
  isPanelOpen: boolean;
  activeTab: ArtifactActiveTab;
  panelView: ArtifactPanelView;
  panelWidth: number;
  layoutMode: ArtifactLayoutMode;
}

const initialState: ArtifactState = {
  artifactsBySession: {},
  activeProjectionBySession: {},
  selectedArtifactId: null,
  isPanelOpen: false,
  activeTab: 'preview',
  panelView: 'files',
  panelWidth: DEFAULT_PANEL_WIDTH,
  layoutMode: ArtifactLayoutMode.Split,
};

function mergeArtifact(existing: Artifact, incoming: Artifact): Artifact {
  return {
    ...existing,
    ...incoming,
    content: incoming.content || existing.content,
    role:
      existing.role === ArtifactRole.Deliverable || incoming.role === ArtifactRole.Deliverable
        ? ArtifactRole.Deliverable
        : ArtifactRole.Intermediate,
  };
}

const artifactSlice = createSlice({
  name: 'artifact',
  initialState,
  reducers: {
    setSessionArtifacts(
      state,
      action: PayloadAction<{ sessionId: string; artifacts: Artifact[] }>,
    ) {
      state.artifactsBySession[action.payload.sessionId] = action.payload.artifacts;
    },

    addArtifact(state, action: PayloadAction<{ sessionId: string; artifact: Artifact }>) {
      const { sessionId, artifact } = action.payload;
      const projection = state.activeProjectionBySession[sessionId];
      const projectedArtifact =
        projection?.runId && !artifact.taskId && !artifact.runId
          ? { ...artifact, taskId: projection.taskId, runId: projection.runId }
          : artifact;
      if (!state.artifactsBySession[sessionId]) {
        state.artifactsBySession[sessionId] = [];
      }
      const existing = state.artifactsBySession[sessionId].findIndex(
        candidate => candidate.id === projectedArtifact.id,
      );
      if (existing >= 0) {
        const old = state.artifactsBySession[sessionId][existing];
        state.artifactsBySession[sessionId][existing] = mergeArtifact(old, projectedArtifact);
      } else {
        // Deduplicate by filePath: if another artifact with same filePath already exists, update it
        if (projectedArtifact.filePath) {
          const normalizedPath = normalizeFilePathForDedup(projectedArtifact.filePath);
          const dupIndex = state.artifactsBySession[sessionId].findIndex(
            a => a.filePath && normalizeFilePathForDedup(a.filePath) === normalizedPath,
          );
          if (dupIndex >= 0) {
            const old = state.artifactsBySession[sessionId][dupIndex];
            state.artifactsBySession[sessionId][dupIndex] = mergeArtifact(old, projectedArtifact);
            return;
          }
        }
        state.artifactsBySession[sessionId].push(projectedArtifact);
      }
    },

    setActiveArtifactProjection(
      state,
      action: PayloadAction<{
        sessionId: string;
        taskId: string | null;
        runId: string | null;
      }>,
    ) {
      const { sessionId, taskId, runId } = action.payload;
      state.activeProjectionBySession[sessionId] = taskId ? { taskId, runId } : undefined;
    },

    selectArtifact(state, action: PayloadAction<string | null>) {
      state.selectedArtifactId = action.payload;
      if (action.payload) {
        state.panelView = 'preview';
        state.isPanelOpen = true;
        state.activeTab = 'preview';
      }
    },

    togglePanel(state) {
      state.isPanelOpen = !state.isPanelOpen;
      if (!state.isPanelOpen) {
        state.layoutMode = ArtifactLayoutMode.Split;
      }
    },

    closePanel(state) {
      state.isPanelOpen = false;
      state.layoutMode = ArtifactLayoutMode.Split;
    },

    setActiveTab(state, action: PayloadAction<ArtifactActiveTab>) {
      state.activeTab = action.payload;
    },

    setPanelView(state, action: PayloadAction<ArtifactPanelView>) {
      state.panelView = action.payload;
    },

    setPanelWidth(state, action: PayloadAction<number>) {
      state.panelWidth = Math.max(MIN_PANEL_WIDTH, action.payload);
    },

    setArtifactLayoutMode(state, action: PayloadAction<ArtifactLayoutMode>) {
      state.layoutMode = action.payload;
    },

    clearSessionArtifacts(state, action: PayloadAction<string>) {
      delete state.artifactsBySession[action.payload];
      delete state.activeProjectionBySession[action.payload];
      state.selectedArtifactId = null;
      state.layoutMode = ArtifactLayoutMode.Split;
    },
  },
});

export const {
  setSessionArtifacts,
  addArtifact,
  setActiveArtifactProjection,
  selectArtifact,
  togglePanel,
  closePanel,
  setActiveTab,
  setPanelView,
  setPanelWidth,
  setArtifactLayoutMode,
  clearSessionArtifacts,
} = artifactSlice.actions;

export const EMPTY_ARTIFACTS: Artifact[] = [];

export const selectSessionArtifacts = (state: RootState, sessionId: string): Artifact[] =>
  state.artifact.artifactsBySession[sessionId] ?? EMPTY_ARTIFACTS;

export const selectTaskRunArtifacts = (
  state: RootState,
  sessionId: string,
  taskId: string,
  runId?: string,
): Artifact[] =>
  (state.artifact.artifactsBySession[sessionId] ?? EMPTY_ARTIFACTS).filter(
    artifact => artifact.taskId === taskId && (!runId || artifact.runId === runId),
  );

export const selectSelectedArtifact = (state: RootState): Artifact | null => {
  const id = state.artifact.selectedArtifactId;
  if (!id) return null;
  for (const artifacts of Object.values(state.artifact.artifactsBySession)) {
    const found = artifacts.find(a => a.id === id);
    if (found) return found;
  }
  return null;
};

export const selectIsPanelOpen = (state: RootState): boolean => state.artifact.isPanelOpen;
export const selectPanelWidth = (state: RootState): number => state.artifact.panelWidth;
export const selectPanelView = (state: RootState): ArtifactPanelView => state.artifact.panelView;
export const selectActiveTab = (state: RootState): ArtifactActiveTab => state.artifact.activeTab;
export const selectArtifactLayoutMode = (state: RootState): ArtifactLayoutMode =>
  state.artifact.layoutMode;

export { DEFAULT_PANEL_WIDTH, MIN_PANEL_WIDTH };

export default artifactSlice.reducer;
