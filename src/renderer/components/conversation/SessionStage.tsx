import React, { useCallback, useMemo, useRef } from 'react';
import { useDispatch, useSelector } from 'react-redux';

import { i18nService } from '../../services/i18n';
import type { RootState } from '../../store';
import {
  selectCurrentSession,
  selectCurrentToolActivities,
  selectIsStreaming,
  selectLoadingSessionId,
  selectRemoteManaged,
} from '../../store/selectors/coworkSelectors';
import {
  ArtifactLayoutMode,
  closePanel,
  EMPTY_ARTIFACTS,
  MIN_PANEL_WIDTH,
  selectIsSessionArtifactPanelOpen,
  selectSessionArtifactLayoutMode,
  selectSessionArtifacts,
  togglePanel,
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
import { resolveSessionDisplayTitle } from '../../utils/sessionTitle';
import { CoworkSessionLayout } from '../cowork/CoworkSessionLayout';
import { CoworkConversationLoadingSkeleton } from '../cowork/CoworkSessionLoadingState';
import { CoworkRunStatus } from '../cowork/components/CoworkRunStatus';
import {
  COWORK_COMPOSER_INSET_VALUE,
  useCoworkComposerInset,
} from '../cowork/hooks/useCoworkComposerInset';
import {
  resolveStableSessionKey,
  setPersistentToggleNamespace,
} from '../cowork/hooks/usePersistentToggle';
import { useSessionHistoryPagination } from '../cowork/hooks/useSessionHistoryPagination';
import type { CoworkPromptInputRef } from '../cowork/promptInput/types';
import { SessionArtifactPanelRegion } from '../cowork/sessionDetail/SessionArtifactPanelRegion';
import { SessionExportDialog } from '../cowork/sessionDetail/SessionExportDialog';
import { useArtifactLinkInterception } from '../cowork/sessionDetail/useArtifactLinkInterception';
import { useArtifactPanelPresentation } from '../cowork/sessionDetail/useArtifactPanelPresentation';
import { useInlineArtifacts } from '../cowork/sessionDetail/useInlineArtifacts';
import { useSessionExport } from '../cowork/sessionDetail/useSessionExport';
import { projectSessionToTurns } from './model/projectTurns';
import { ConversationThread } from './thread/ConversationThread';

export interface SessionStageProps {
  displayedSessionId: string;
  composerSlotRef: React.RefCallback<HTMLDivElement>;
  promptInputRef: React.RefObject<CoworkPromptInputRef | null>;
  isSidebarCollapsed?: boolean;
  onToggleSidebar?: () => void;
  onNewChat?: () => void;
  updateBadge?: React.ReactNode;
  inlineQuestionPermission?: CoworkPermissionRequest | null;
  onRespondToInlineQuestion?: (result: CoworkPermissionResult) => void | Promise<void>;
  inlinePermission?: CoworkPermissionRequest | null;
  onRespondToInlinePermission?: (result: CoworkPermissionResult) => void | Promise<void>;
}

/**
 * Lazy-loaded active session canvas: projects messages + live tool activities
 * into ordered Turn/Part structures, connects StickToBottom transcript scrolling
 * and keeps the bottom composer dock clear of the artifact workspace pane.
 */
const SessionStage: React.FC<SessionStageProps> = ({
  displayedSessionId,
  composerSlotRef,
  promptInputRef,
  isSidebarCollapsed,
  onToggleSidebar,
  onNewChat,
  updateBadge,
  inlineQuestionPermission,
  onRespondToInlineQuestion,
  inlinePermission,
  onRespondToInlinePermission,
}) => {
  const dispatch = useDispatch();
  const currentSession = useSelector(selectCurrentSession);
  const loadingSessionId = useSelector(selectLoadingSessionId);
  const isStreaming = useSelector(selectIsStreaming);
  const toolActivities = useSelector(selectCurrentToolActivities);
  const remoteManaged = useSelector(selectRemoteManaged);
  const skills = useSelector((state: RootState) => state.skill.skills);

  const isSessionSwitching =
    loadingSessionId === displayedSessionId && currentSession?.id !== displayedSessionId;

  const detailRootRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const contentRowRef = useRef<HTMLDivElement>(null);
  const composerOverlayRef = useCoworkComposerInset(detailRootRef);

  const sessionId = currentSession?.id;

  const {
    isExportingImage,
    showExportOptions,
    setShowExportOptions,
    handleExportText,
    handleShareClick,
  } = useSessionExport({ currentSession, scrollContainerRef });

  const isPanelOpen = useSelector((state: RootState) =>
    selectIsSessionArtifactPanelOpen(state, sessionId),
  );
  const artifactLayoutMode = useSelector((state: RootState) =>
    selectSessionArtifactLayoutMode(state, sessionId),
  );
  const isArtifactWorkspace = artifactLayoutMode === ArtifactLayoutMode.Workspace;
  const sessionArtifacts = useSelector((state: RootState) =>
    sessionId ? selectSessionArtifacts(state, sessionId) : EMPTY_ARTIFACTS,
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
  const stableSessionKey = resolveStableSessionKey(sessionId);

  const markInitialHistoryTailPositioned = useSessionHistoryPagination({
    sessionId,
    messagesOffset: currentSession?.messagesOffset ?? 0,
    rootRef: detailRootRef,
  });

  const { turns, unmatchedPermission } = useMemo(
    () =>
      projectSessionToTurns({
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
      sessionArtifacts,
      toolActivities,
    ],
  );

  if (!currentSession) {
    return null;
  }

  return (
    <CoworkSessionLayout
      title={
        resolveSessionDisplayTitle(currentSession, i18nService.getLanguage()) ||
        i18nService.t('coworkNewSession')
      }
      sessionId={sessionId}
      isSessionSwitching={isSessionSwitching}
      isSidebarCollapsed={isSidebarCollapsed}
      isArtifactPanelOpen={isPanelOpen}
      onToggleSidebar={onToggleSidebar}
      onNewChat={onNewChat}
      onToggleArtifactPanel={() => dispatch(togglePanel())}
      updateBadge={updateBadge}
      runIndicator={
        isSessionSwitching ? null : (
          <CoworkRunStatus
            key={stableSessionKey}
            sessionId={currentSession.id}
            isStreaming={isStreaming}
          />
        )
      }
    >
      {!isSessionSwitching && (
        <SessionExportDialog
          open={showExportOptions}
          onOpenChange={setShowExportOptions}
          onExportImage={handleShareClick}
          onExportText={handleExportText}
          disabled={isExportingImage}
        />
      )}

      <div ref={contentRowRef} className="flex flex-1 overflow-hidden">
        <div
          ref={detailRootRef}
          data-page-canvas
          className={`relative flex h-full min-w-0 flex-1 flex-col bg-background ${
            !isSessionSwitching && isArtifactWorkspace ? 'hidden' : ''
          }`}
          aria-hidden={!isSessionSwitching && isArtifactWorkspace}
        >
          <div
            className="relative min-h-0 flex-1"
            style={{ paddingBottom: COWORK_COMPOSER_INSET_VALUE }}
          >
            {isSessionSwitching ? (
              <CoworkConversationLoadingSkeleton />
            ) : (
              <ConversationThread
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
            )}
          </div>

          <div
            ref={composerOverlayRef}
            className="pointer-events-none absolute inset-x-0 bottom-0 z-20 px-4"
          >
            <div className="mx-auto w-full max-w-4xl min-w-[320px]">
              <div className="theme-composer-backdrop pointer-events-auto relative min-w-0">
                <div ref={composerSlotRef} />
              </div>
            </div>
          </div>
        </div>

        {!isSessionSwitching && shouldRenderArtifactPanel && (
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
        )}
      </div>
    </CoworkSessionLayout>
  );
};

export default SessionStage;
