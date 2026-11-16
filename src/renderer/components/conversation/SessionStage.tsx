import React, { useCallback, useMemo } from 'react';
import { useDispatch, useSelector } from 'react-redux';

import type { RootState } from '../../store';
import {
  selectCurrentSession,
  selectCurrentToolActivities,
  selectIsStreaming,
  selectLoadingSessionId,
  selectRemoteManaged,
} from '../../store/selectors/coworkSelectors';
import {
  closePanel,
  EMPTY_ARTIFACTS,
  MIN_PANEL_WIDTH,
  selectIsSessionArtifactPanelOpen,
  selectSessionArtifactLayoutMode,
  selectSessionArtifacts,
} from '../../store/slices/artifactSlice';
import { setActiveSkillIds } from '../../store/slices/skillSlice';
import { PREVIEWABLE_ARTIFACT_TYPES } from '../../types/artifact';
import type {
  CoworkImageAttachment,
  CoworkMessage,
  CoworkMessageMetadata,
  CoworkPermissionRequest,
  CoworkPermissionResult,
} from '../../types/cowork';
import { setPersistentToggleNamespace } from '../cowork/hooks/usePersistentToggle';
import { useSessionHistoryPagination } from '../cowork/hooks/useSessionHistoryPagination';
import type { CoworkPromptInputRef } from '../cowork/promptInput/types';
import { SessionArtifactPanelRegion } from '../cowork/sessionDetail/SessionArtifactPanelRegion';
import { SessionExportDialog } from '../cowork/sessionDetail/SessionExportDialog';
import { useArtifactLinkInterception } from '../cowork/sessionDetail/useArtifactLinkInterception';
import { useArtifactPanelPresentation } from '../cowork/sessionDetail/useArtifactPanelPresentation';
import { useInlineArtifacts } from '../cowork/sessionDetail/useInlineArtifacts';
import { useSessionExport } from '../cowork/sessionDetail/useSessionExport';
import { createSessionTurnsSelector } from './model/projectTurns';
import { ConversationThread } from './thread/ConversationThread';

export interface SessionTranscriptStageProps {
  scrollContainerRef: React.RefObject<HTMLDivElement | null>;
  detailRootRef: React.RefObject<HTMLDivElement | null>;
  promptInputRef: React.RefObject<CoworkPromptInputRef | null>;
  inlineQuestionPermission?: CoworkPermissionRequest | null;
  onRespondToInlineQuestion?: (result: CoworkPermissionResult) => void | Promise<void>;
  inlinePermission?: CoworkPermissionRequest | null;
  onRespondToInlinePermission?: (result: CoworkPermissionResult) => void | Promise<void>;
}

/**
 * Lazy-loaded active transcript pane: projects messages + live tool activities
 * with bounded per-turn memoization and drives the @tanstack/react-virtual Chat scroller.
 */
export const SessionTranscriptStage: React.FC<SessionTranscriptStageProps> = ({
  scrollContainerRef,
  detailRootRef,
  promptInputRef,
  inlineQuestionPermission,
  onRespondToInlineQuestion,
  inlinePermission,
  onRespondToInlinePermission,
}) => {
  const dispatch = useDispatch();
  const currentSession = useSelector(selectCurrentSession);
  const isStreaming = useSelector(selectIsStreaming);
  const toolActivities = useSelector(selectCurrentToolActivities);
  const remoteManaged = useSelector(selectRemoteManaged);
  const skills = useSelector((state: RootState) => state.skill.skills);

  const sessionId = currentSession?.id;
  const sessionArtifacts = useSelector((state: RootState) =>
    sessionId ? selectSessionArtifacts(state, sessionId) : EMPTY_ARTIFACTS,
  );

  const {
    isExportingImage,
    showExportOptions,
    setShowExportOptions,
    handleExportText,
    handleShareClick,
  } = useSessionExport({ currentSession, scrollContainerRef });

  useInlineArtifacts({ sessionId, messages: currentSession?.messages, isStreaming });
  useArtifactLinkInterception({
    scrollContainerRef,
    sessionId,
    sessionArtifacts,
    cwd: currentSession?.cwd,
  });

  const handleReEdit = useCallback(
    (message: CoworkMessage) => {
      const input = promptInputRef.current;
      if (!input) return;
      if (message.content?.trim()) {
        input.setValue(message.content);
      }
      const imageAttachments = ((message.metadata as CoworkMessageMetadata)?.imageAttachments ??
        []) as CoworkImageAttachment[];
      input.setImageAttachments(imageAttachments);
      const skillIds = (message.metadata as CoworkMessageMetadata)?.skillIds;
      if (skillIds && skillIds.length > 0) {
        dispatch(setActiveSkillIds(skillIds));
      }
      input.focus();
    },
    [dispatch, promptInputRef],
  );

  setPersistentToggleNamespace(currentSession?.id ?? '');

  const markInitialHistoryTailPositioned = useSessionHistoryPagination({
    sessionId,
    messagesOffset: currentSession?.messagesOffset ?? 0,
    rootRef: detailRootRef,
  });

  const selectSessionTurns = useMemo(() => createSessionTurnsSelector(), []);
  const { turns, unmatchedPermission } = useMemo(
    () =>
      selectSessionTurns({
        messages: currentSession?.messages ?? [],
        toolActivities,
        pendingPermission: inlinePermission,
        inlineQuestionPermission,
        artifacts: sessionArtifacts,
        previewableTypes: PREVIEWABLE_ARTIFACT_TYPES,
        isStreaming,
      }),
    [
      currentSession?.messages,
      inlinePermission,
      inlineQuestionPermission,
      isStreaming,
      selectSessionTurns,
      sessionArtifacts,
      toolActivities,
    ],
  );

  if (!currentSession) {
    return null;
  }

  return (
    <>
      <SessionExportDialog
        open={showExportOptions}
        onOpenChange={setShowExportOptions}
        onExportImage={handleShareClick}
        onExportText={handleExportText}
        disabled={isExportingImage}
      />
      <ConversationThread
        sessionId={currentSession.id}
        turns={turns}
        skills={skills}
        cwd={currentSession.cwd}
        isExporting={isExportingImage}
        scrollContainerRef={scrollContainerRef}
        unmatchedPermission={unmatchedPermission}
        onRespondToPermission={onRespondToInlinePermission}
        onRespondToQuestion={onRespondToInlineQuestion}
        onReEdit={remoteManaged ? undefined : handleReEdit}
        onInitialScrollReady={markInitialHistoryTailPositioned}
      />
    </>
  );
};

export interface SessionArtifactSidePaneProps {
  displayedSessionId: string;
  contentRowRef: React.RefObject<HTMLDivElement | null>;
}

/** Lazy-loaded artifact preview/workspace side pane sibling to the unified conversation stage. */
export const SessionArtifactSidePane: React.FC<SessionArtifactSidePaneProps> = ({
  displayedSessionId,
  contentRowRef,
}) => {
  const dispatch = useDispatch();
  const currentSession = useSelector(selectCurrentSession);
  const loadingSessionId = useSelector(selectLoadingSessionId);

  const isSessionSwitching =
    loadingSessionId === displayedSessionId && currentSession?.id !== displayedSessionId;
  const sessionId = currentSession?.id;

  const isPanelOpen = useSelector((state: RootState) =>
    selectIsSessionArtifactPanelOpen(state, sessionId),
  );
  const artifactLayoutMode = useSelector((state: RootState) =>
    selectSessionArtifactLayoutMode(state, sessionId),
  );

  const {
    shouldRenderArtifactPanel,
    isArtifactPanelVisible,
    isArtifactPanelTransitioning,
    previewSessionId,
    artifactPanelMaxWidth,
  } = useArtifactPanelPresentation({ isPanelOpen, sessionId, contentRowRef });

  const previewArtifacts = useSelector((state: RootState) =>
    previewSessionId ? selectSessionArtifacts(state, previewSessionId) : EMPTY_ARTIFACTS,
  );

  if (!currentSession || isSessionSwitching || !shouldRenderArtifactPanel) {
    return null;
  }

  return (
    <SessionArtifactPanelRegion
      sessionId={previewSessionId}
      cwd={currentSession.cwd}
      artifacts={previewArtifacts}
      isOpen={isPanelOpen}
      isVisible={isArtifactPanelVisible}
      isTransitioning={isArtifactPanelTransitioning}
      layoutMode={artifactLayoutMode}
      minPanelWidth={MIN_PANEL_WIDTH}
      maxPanelWidth={artifactPanelMaxWidth}
      onClose={() => dispatch(closePanel())}
    />
  );
};
