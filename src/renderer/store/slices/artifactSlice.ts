import { createSlice, PayloadAction } from '@reduxjs/toolkit';

import { normalizeFilePathForDedup } from '../../services/artifactParser';
import { ArtifactRole, type Artifact } from '../../types/artifact';
import type { RootState } from '../index';

const DEFAULT_PANEL_WIDTH = 560;
const MIN_PANEL_WIDTH = 180;
const MAX_PANEL_WIDTH = 1000;

export type ArtifactPanelView = 'files' | 'preview';
export type ArtifactActiveTab = 'preview' | 'code';

interface ArtifactState {
  artifactsBySession: Record<string, Artifact[]>;
  selectedArtifactId: string | null;
  isPanelOpen: boolean;
  activeTab: ArtifactActiveTab;
  panelView: ArtifactPanelView;
  panelWidth: number;
}

const initialState: ArtifactState = {
  artifactsBySession: {},
  selectedArtifactId: null,
  isPanelOpen: false,
  activeTab: 'preview',
  panelView: 'files',
  panelWidth: DEFAULT_PANEL_WIDTH,
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
      if (!state.artifactsBySession[sessionId]) {
        state.artifactsBySession[sessionId] = [];
      }
      const existing = state.artifactsBySession[sessionId].findIndex(a => a.id === artifact.id);
      if (existing >= 0) {
        const old = state.artifactsBySession[sessionId][existing];
        state.artifactsBySession[sessionId][existing] = mergeArtifact(old, artifact);
      } else {
        // Deduplicate by filePath: if another artifact with same filePath already exists, update it
        if (artifact.filePath) {
          const normalizedPath = normalizeFilePathForDedup(artifact.filePath);
          const dupIndex = state.artifactsBySession[sessionId].findIndex(
            a => a.filePath && normalizeFilePathForDedup(a.filePath) === normalizedPath,
          );
          if (dupIndex >= 0) {
            const old = state.artifactsBySession[sessionId][dupIndex];
            state.artifactsBySession[sessionId][dupIndex] = mergeArtifact(old, artifact);
            return;
          }
        }
        state.artifactsBySession[sessionId].push(artifact);
      }
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
    },

    closePanel(state) {
      state.isPanelOpen = false;
    },

    setActiveTab(state, action: PayloadAction<ArtifactActiveTab>) {
      state.activeTab = action.payload;
    },

    setPanelView(state, action: PayloadAction<ArtifactPanelView>) {
      state.panelView = action.payload;
    },

    setPanelWidth(state, action: PayloadAction<number>) {
      state.panelWidth = Math.max(MIN_PANEL_WIDTH, Math.min(MAX_PANEL_WIDTH, action.payload));
    },

    clearSessionArtifacts(state, action: PayloadAction<string>) {
      delete state.artifactsBySession[action.payload];
      state.selectedArtifactId = null;
    },
  },
});

export const {
  setSessionArtifacts,
  addArtifact,
  selectArtifact,
  togglePanel,
  closePanel,
  setActiveTab,
  setPanelView,
  setPanelWidth,
  clearSessionArtifacts,
} = artifactSlice.actions;

export const EMPTY_ARTIFACTS: Artifact[] = [];

export const selectSessionArtifacts = (state: RootState, sessionId: string): Artifact[] =>
  state.artifact.artifactsBySession[sessionId] ?? EMPTY_ARTIFACTS;

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

export { DEFAULT_PANEL_WIDTH, MAX_PANEL_WIDTH, MIN_PANEL_WIDTH };

export default artifactSlice.reducer;
