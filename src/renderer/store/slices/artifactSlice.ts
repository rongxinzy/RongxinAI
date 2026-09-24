import { createSlice, PayloadAction } from '@reduxjs/toolkit';

import { normalizeFilePathForDedup } from '../../services/artifactParser';
import { ArtifactRole, type Artifact } from '../../types/artifact';
import type { RootState } from '../index';

const DEFAULT_PANEL_WIDTH = 560;
const MIN_PANEL_WIDTH = 180;

export const ArtifactPanelView = {
  Files: 'files',
  Preview: 'preview',
} as const;
export type ArtifactPanelView = (typeof ArtifactPanelView)[keyof typeof ArtifactPanelView];
export type ArtifactActiveTab = 'preview' | 'code';
export const ArtifactLayoutMode = {
  Split: 'split',
  Workspace: 'workspace',
} as const;
export type ArtifactLayoutMode = (typeof ArtifactLayoutMode)[keyof typeof ArtifactLayoutMode];

interface ArtifactSessionViewState {
  selectedArtifactId: string | null;
  isPanelOpen: boolean;
  /** The user closed the panel explicitly in this session; only a newly added
   *  artifact may open it again by itself. */
  panelSuppressed: boolean;
  activeTab: ArtifactActiveTab;
  panelView: ArtifactPanelView;
  layoutMode: ArtifactLayoutMode;
}

interface ArtifactState {
  artifactsBySession: Record<string, Artifact[]>;
  activeProjectionBySession: Record<string, { taskId: string; runId: string | null } | undefined>;
  activeSessionId: string | null;
  viewStateBySession: Record<string, ArtifactSessionViewState>;
  selectedArtifactId: string | null;
  isPanelOpen: boolean;
  panelSuppressed: boolean;
  activeTab: ArtifactActiveTab;
  panelView: ArtifactPanelView;
  panelWidth: number;
  layoutMode: ArtifactLayoutMode;
}

const initialState: ArtifactState = {
  artifactsBySession: {},
  activeProjectionBySession: {},
  activeSessionId: null,
  viewStateBySession: {},
  selectedArtifactId: null,
  isPanelOpen: false,
  panelSuppressed: false,
  activeTab: 'preview',
  panelView: ArtifactPanelView.Files,
  panelWidth: DEFAULT_PANEL_WIDTH,
  layoutMode: ArtifactLayoutMode.Split,
};

const DEFAULT_SESSION_VIEW_STATE: ArtifactSessionViewState = {
  selectedArtifactId: null,
  isPanelOpen: false,
  panelSuppressed: false,
  activeTab: 'preview',
  panelView: ArtifactPanelView.Files,
  layoutMode: ArtifactLayoutMode.Split,
};

function getDefaultSessionViewState(): ArtifactSessionViewState {
  return { ...DEFAULT_SESSION_VIEW_STATE };
}

function saveActiveSessionView(state: ArtifactState) {
  if (!state.activeSessionId) return;

  state.viewStateBySession[state.activeSessionId] = {
    selectedArtifactId: state.selectedArtifactId,
    isPanelOpen: state.isPanelOpen,
    panelSuppressed: state.panelSuppressed,
    activeTab: state.activeTab,
    panelView: state.panelView,
    layoutMode: state.layoutMode,
  };
}

function restoreSessionView(state: ArtifactState, viewState: ArtifactSessionViewState) {
  state.selectedArtifactId = viewState.selectedArtifactId;
  state.isPanelOpen = viewState.isPanelOpen;
  state.panelSuppressed = viewState.panelSuppressed;
  state.activeTab = viewState.activeTab;
  state.panelView = viewState.panelView;
  state.layoutMode = viewState.layoutMode;
}

function mergeArtifact(existing: Artifact, incoming: Artifact): Artifact {
  const declaredArtifact = incoming.declared ? incoming : existing.declared ? existing : null;
  const deliveryAnchorArtifact =
    !incoming.declared && incoming.role === ArtifactRole.Deliverable
      ? incoming
      : !existing.declared && existing.role === ArtifactRole.Deliverable
        ? existing
        : null;
  const merged = {
    ...existing,
    ...incoming,
    ...(declaredArtifact
      ? {
          id: declaredArtifact.id,
          messageId:
            declaredArtifact.role === ArtifactRole.Deliverable && deliveryAnchorArtifact
              ? deliveryAnchorArtifact.messageId
              : declaredArtifact.messageId,
          type: declaredArtifact.type,
          title: declaredArtifact.title,
          fileName: declaredArtifact.fileName,
          filePath: declaredArtifact.filePath,
          source: declaredArtifact.source,
          role: declaredArtifact.role,
          declared: true,
          createdAt: declaredArtifact.createdAt,
        }
      : {}),
    content: incoming.content || existing.content,
    role:
      declaredArtifact?.role ??
      (existing.role === ArtifactRole.Deliverable || incoming.role === ArtifactRole.Deliverable
        ? ArtifactRole.Deliverable
        : ArtifactRole.Intermediate),
  };

  const existingKeys = Object.keys(existing) as (keyof Artifact)[];
  const mergedKeys = Object.keys(merged) as (keyof Artifact)[];
  return existingKeys.length === mergedKeys.length &&
    mergedKeys.every(key => existing[key] === merged[key])
    ? existing
    : merged;
}

/** A merge only reveals when it completes a live delivery: the artifact became a
 *  declared deliverable, or its previewable content finally arrived. */
function shouldRevealArtifactPanel(previous: Artifact, next: Artifact): boolean {
  // Only deliverables may open the panel by themselves, whatever the caller's
  // event says: a merged code block or an intermediate file never does.
  if (next.role !== ArtifactRole.Deliverable) return false;
  return (
    (previous.role !== ArtifactRole.Deliverable && next.role === ArtifactRole.Deliverable) ||
    (!previous.declared && Boolean(next.declared)) ||
    (!previous.content && Boolean(next.content))
  );
}

/**
 * Whether a freshly detected artifact may open the panel by itself.
 *
 * Automatic opening is a live-delivery signal: the agent must have declared the
 * artifact as a deliverable during a run the user is watching, and the file must
 * be readable. Heuristic candidates, backfilled history, and unreadable paths
 * only appear in the list.
 */
export const shouldRevealLiveArtifact = (
  artifact: Artifact,
  context: { isLiveSession: boolean; previewable: boolean },
): boolean =>
  context.isLiveSession &&
  context.previewable &&
  artifact.declared === true &&
  artifact.role === ArtifactRole.Deliverable;

/** What kind of event asked for the reveal; suppression only mutes promotions. */
const RevealKind = {
  /** The artifact was just added to the session. */
  New: 'new',
  /** An existing artifact grew (content, or a declaration arrived later). */
  Promotion: 'promotion',
} as const;
type RevealKind = (typeof RevealKind)[keyof typeof RevealKind];

function revealArtifactInPanel(
  state: ArtifactState,
  sessionId: string,
  kind: RevealKind,
  fallbackArtifactId: string,
) {
  // Only the artifact view the user is actually looking at may open itself; a
  // background session must not steal the panel.
  if (state.activeSessionId !== sessionId) return;
  // Respect an explicit close: only a newly added artifact opens the panel again,
  // a later merge into an artifact the user already dismissed does not.
  if (kind === RevealKind.Promotion && state.panelSuppressed) return;

  const artifacts = state.artifactsBySession[sessionId] ?? [];
  const deliverables = artifacts.filter(artifact => artifact.role === ArtifactRole.Deliverable);
  const selectedId =
    kind === RevealKind.Promotion
      ? fallbackArtifactId
      : // Newest first: a run may add several deliverables and the last one is the
        // one the user is waiting for.
        (deliverables[deliverables.length - 1]?.id ?? fallbackArtifactId);

  const wasOpen = state.isPanelOpen;
  state.panelSuppressed = false;
  state.selectedArtifactId = selectedId;
  state.isPanelOpen = true;
  // Keep the view the user is already in — a reveal must not pull them out of the
  // code tab or out of a previously chosen panel view.
  if (!wasOpen) {
    state.panelView = ArtifactPanelView.Preview;
    state.activeTab = 'preview';
  }
}

const artifactSlice = createSlice({
  name: 'artifact',
  initialState,
  reducers: {
    activateSessionArtifactView(state, action: PayloadAction<string | null>) {
      const sessionId = action.payload;
      if (state.activeSessionId === sessionId) return;

      saveActiveSessionView(state);
      state.activeSessionId = sessionId;
      restoreSessionView(
        state,
        sessionId
          ? (state.viewStateBySession[sessionId] ?? getDefaultSessionViewState())
          : getDefaultSessionViewState(),
      );
    },

    setSessionArtifacts(
      state,
      action: PayloadAction<{ sessionId: string; artifacts: Artifact[] }>,
    ) {
      state.artifactsBySession[action.payload.sessionId] = action.payload.artifacts;
    },

    /**
     * `reveal` means the caller certifies this event as a delivery worth showing
     * (cowork: `shouldRevealLiveArtifact`). The slice does not re-derive that
     * policy, so every surface states its own: cowork only reveals live declared
     * deliverables, the coding page keeps revealing its own stream artifacts.
     */
    addArtifact(
      state,
      action: PayloadAction<{ sessionId: string; artifact: Artifact; reveal?: boolean }>,
    ) {
      const { sessionId, artifact, reveal = false } = action.payload;
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
        const merged = mergeArtifact(old, projectedArtifact);
        if (merged !== old) {
          state.artifactsBySession[sessionId][existing] = merged;
          if (reveal && shouldRevealArtifactPanel(old, merged)) {
            revealArtifactInPanel(state, sessionId, RevealKind.Promotion, merged.id);
          }
        }
        return;
      }

      // Deduplicate by filePath: if another artifact with same filePath already exists, update it
      if (projectedArtifact.filePath) {
        const normalizedPath = normalizeFilePathForDedup(projectedArtifact.filePath);
        const dupIndex = state.artifactsBySession[sessionId].findIndex(
          a => a.filePath && normalizeFilePathForDedup(a.filePath) === normalizedPath,
        );
        if (dupIndex >= 0) {
          const old = state.artifactsBySession[sessionId][dupIndex];
          const merged = mergeArtifact(old, projectedArtifact);
          if (merged !== old) {
            state.artifactsBySession[sessionId][dupIndex] = merged;
            if (reveal && shouldRevealArtifactPanel(old, merged)) {
              revealArtifactInPanel(state, sessionId, RevealKind.Promotion, merged.id);
            }
          }
          return;
        }
      }

      state.artifactsBySession[sessionId].push(projectedArtifact);
      if (reveal && projectedArtifact.role === ArtifactRole.Deliverable) {
        revealArtifactInPanel(state, sessionId, RevealKind.New, projectedArtifact.id);
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
        state.panelSuppressed = false;
        state.panelView = ArtifactPanelView.Preview;
        state.isPanelOpen = true;
        state.activeTab = 'preview';
      }
    },

    togglePanel(state) {
      state.isPanelOpen = !state.isPanelOpen;
      if (!state.isPanelOpen) {
        state.layoutMode = ArtifactLayoutMode.Split;
        state.panelSuppressed = true;
        return;
      }

      state.panelSuppressed = false;
      // 2026/09/17 lixiang  打开面板且仅有一个交付物时，直接进入该文件预览
      if (!state.activeSessionId) return;
      const deliverables = (state.artifactsBySession[state.activeSessionId] ?? []).filter(
        artifact => artifact.role === ArtifactRole.Deliverable,
      );
      if (deliverables.length === 1) {
        state.selectedArtifactId = deliverables[deliverables.length - 1].id;
        state.panelView = ArtifactPanelView.Preview;
        state.activeTab = 'preview';
      }
    },

    closePanel(state) {
      state.isPanelOpen = false;
      state.panelSuppressed = true;
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
      const sessionId = action.payload;
      delete state.artifactsBySession[sessionId];
      delete state.activeProjectionBySession[sessionId];
      delete state.viewStateBySession[sessionId];
      if (state.activeSessionId === sessionId) {
        restoreSessionView(state, getDefaultSessionViewState());
      }
    },
  },
});

export const {
  activateSessionArtifactView,
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
  const activeSessionId = state.artifact.activeSessionId;
  if (activeSessionId) {
    return (
      state.artifact.artifactsBySession[activeSessionId]?.find(artifact => artifact.id === id) ??
      null
    );
  }
  for (const artifacts of Object.values(state.artifact.artifactsBySession)) {
    const found = artifacts.find(a => a.id === id);
    if (found) return found;
  }
  return null;
};

export const selectSessionSelectedArtifact = (
  state: RootState,
  sessionId: string | null,
): Artifact | null => {
  if (!sessionId) return null;
  const selectedArtifactId =
    state.artifact.activeSessionId === sessionId
      ? state.artifact.selectedArtifactId
      : state.artifact.viewStateBySession[sessionId]?.selectedArtifactId;
  if (!selectedArtifactId) return null;
  return (
    state.artifact.artifactsBySession[sessionId]?.find(
      artifact => artifact.id === selectedArtifactId,
    ) ?? null
  );
};

export const selectIsPanelOpen = (state: RootState): boolean => state.artifact.isPanelOpen;
const selectSessionViewState = (state: RootState, sessionId: string | undefined) => {
  if (!sessionId) return DEFAULT_SESSION_VIEW_STATE;
  if (state.artifact.activeSessionId === sessionId) {
    return state.artifact;
  }
  return state.artifact.viewStateBySession[sessionId] ?? DEFAULT_SESSION_VIEW_STATE;
};
export const selectIsSessionArtifactPanelOpen = (state: RootState, sessionId: string | undefined) =>
  selectSessionViewState(state, sessionId).isPanelOpen;
export const selectSessionArtifactLayoutMode = (state: RootState, sessionId: string | undefined) =>
  selectSessionViewState(state, sessionId).layoutMode;
export const selectPanelWidth = (state: RootState): number => state.artifact.panelWidth;
export const selectPanelView = (state: RootState): ArtifactPanelView => state.artifact.panelView;
export const selectActiveTab = (state: RootState): ArtifactActiveTab => state.artifact.activeTab;
export const selectArtifactLayoutMode = (state: RootState): ArtifactLayoutMode =>
  state.artifact.layoutMode;

export { DEFAULT_PANEL_WIDTH, MIN_PANEL_WIDTH };

export default artifactSlice.reducer;
