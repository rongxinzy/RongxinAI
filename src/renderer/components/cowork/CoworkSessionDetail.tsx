import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from '@shared/components/ai-elements/conversation';
import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import { useDispatch, useSelector } from 'react-redux';

import { CoworkSessionMode, type CoworkPermissionMode } from '../../../shared/cowork/constants';
import type { CoworkSessionInterruption } from '../../../shared/cowork/interruption';

import { i18nService } from '../../services/i18n';
import { RootState } from '../../store';
import {
  selectCurrentMessagesLength,
  selectCurrentSession,
  selectCurrentToolActivities,
  selectIsStreaming,
  selectRemoteManaged,
} from '../../store/selectors/coworkSelectors';
import { resolveSessionDisplayTitle } from '../../utils/sessionTitle';
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
  CoworkFileAttachment,
  CoworkMessage,
  CoworkMessageMetadata,
  CoworkPermissionRequest,
  CoworkPermissionResult,
} from '../../types/cowork';
import { TurnBlock } from './components/TurnBlock';
import { UserBubble } from './components/UserBubble';
import {
  VirtualizedTurnList,
  type VirtualizedTurnListHandle,
} from './components/VirtualizedTurnList';
import CoworkPromptInput, { type CoworkPromptInputRef } from './CoworkPromptInput';
import { CoworkConversationLoadingSkeleton } from './CoworkSessionLoadingState';
import { CoworkSessionLayout } from './CoworkSessionLayout';
import PendingMessageQueue from './PendingMessageQueue';
import {
  buildConversationTurns,
  buildDisplayItems,
  hasActiveTurnStreamingContent,
} from './helpers/messageGrouping';
import { resolveLocalFilePath } from './helpers/pathUtils';
import { findToolGroupForPermission } from './helpers/toolPermissionMatch';
import { useStableConversationTurns } from './helpers/useStableConversationTurns';
import { useTurnArtifacts } from './helpers/useTurnArtifacts';
import { usePersistedArtifactSeed } from './helpers/usePersistedArtifactSeed';
import { resolveStableSessionKey, setPersistentToggleNamespace } from './hooks/usePersistentToggle';
import { useSessionHistoryPagination } from './hooks/useSessionHistoryPagination';
import { useRecoverableWorkbenchTaskId } from './hooks/useRecoverableWorkbenchTaskId';
import {
  COWORK_COMPOSER_INSET_VALUE,
  useCoworkComposerInset,
} from './hooks/useCoworkComposerInset';
import AskUserQuestionCard from './AskUserQuestionCard';
import { WorkbenchTaskAcceptanceCard } from './WorkbenchTaskAcceptanceCard';
import CoworkPermissionModal from './CoworkPermissionModal';
import { CoworkRunStatus } from './components/CoworkRunStatus';
import { SessionArtifactPanelRegion } from './sessionDetail/SessionArtifactPanelRegion';
import { SessionExportDialog } from './sessionDetail/SessionExportDialog';
import { useArtifactLinkInterception } from './sessionDetail/useArtifactLinkInterception';
import { useArtifactPanelPresentation } from './sessionDetail/useArtifactPanelPresentation';
import { useSessionArtifactDetection } from './sessionDetail/useSessionArtifactDetection';
import { useSessionExport } from './sessionDetail/useSessionExport';

interface CoworkSessionDetailProps {
  displayedSessionId?: string;
  isSessionSwitching?: boolean;
  onManageSkills?: () => void;
  onManageConnectors?: () => void;
  permissionMode?: CoworkPermissionMode;
  onPermissionModeChange?: (mode: CoworkPermissionMode) => void;
  onContinue: (
    prompt: string,
    imageAttachments?: CoworkImageAttachment[],
    fileAttachments?: CoworkFileAttachment[],
    expertIds?: string[],
    goalMode?: boolean,
  ) => boolean | void | Promise<boolean | void>;
  onStop: () => void;
  isSidebarCollapsed?: boolean;
  onToggleSidebar?: () => void;
  onNewChat?: () => void;
  updateBadge?: React.ReactNode;
  workMode?: 'work' | 'chat';
  inlineQuestionPermission?: CoworkPermissionRequest | null;
  onRespondToInlineQuestion?: (result: CoworkPermissionResult) => void | Promise<void>;
  inlinePermission?: CoworkPermissionRequest | null;
  onRespondToInlinePermission?: (result: CoworkPermissionResult) => void | Promise<void>;
  resumeTaskId?: string | null;
  // 父级传入恢复中禁用；本组件再叠加 isStreaming
  resumeDisabled?: boolean;
  onResumeTask?: (interruption: CoworkSessionInterruption) => void;
  onCancelTaskResume?: () => void;
}

const CoworkSessionDetail: React.FC<CoworkSessionDetailProps> = ({
  displayedSessionId,
  isSessionSwitching = false,
  onManageSkills,
  onManageConnectors,
  permissionMode,
  onPermissionModeChange,
  onContinue,
  onStop,
  isSidebarCollapsed,
  onToggleSidebar,
  onNewChat,
  updateBadge,
  workMode = 'work',
  inlineQuestionPermission,
  onRespondToInlineQuestion,
  inlinePermission,
  onRespondToInlinePermission,
  resumeTaskId,
  resumeDisabled = false,
  onResumeTask,
  onCancelTaskResume,
}) => {
  const dispatch = useDispatch();
  const currentSession = useSelector(selectCurrentSession);
  const isStreaming = useSelector(selectIsStreaming);
  const toolActivities = useSelector(selectCurrentToolActivities);
  const remoteManaged = useSelector(selectRemoteManaged);
  const messagesLength = useSelector(selectCurrentMessagesLength);
  const skills = useSelector((state: RootState) => state.skill.skills);
  const detailRootRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const promptInputRef = useRef<CoworkPromptInputRef>(null);
  const composerOverlayRef = useCoworkComposerInset(detailRootRef);

  const sessionId = currentSession?.id;
  const recoverableTaskId = useRecoverableWorkbenchTaskId(sessionId);

  const handleResumeTask = useCallback(
    (interruption: CoworkSessionInterruption) => {
      // 点击继续执行只嵌入输入框并聚焦，不直接开跑
      onResumeTask?.(interruption);
      requestAnimationFrame(() => promptInputRef.current?.focus());
    },
    [onResumeTask],
  );

  const virtualizedTurnListRef = useRef<VirtualizedTurnListHandle>(null);

  // ─── Export ─────────────────────────────────────────────────────────
  const {
    isExportingImage,
    showExportOptions,
    setShowExportOptions,
    handleExportText,
    handleShareClick,
  } = useSessionExport({ currentSession, scrollContainerRef });

  // ─── Artifact panel ─────────────────────────────────────────────────
  const isPanelOpen = useSelector((state: RootState) =>
    selectIsSessionArtifactPanelOpen(state, sessionId),
  );
  const artifactLayoutMode = useSelector((state: RootState) =>
    selectSessionArtifactLayoutMode(state, sessionId),
  );
  const isArtifactWorkspace = artifactLayoutMode === ArtifactLayoutMode.Workspace;
  const contentRowRef = useRef<HTMLDivElement>(null);
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

  useSessionArtifactDetection({ sessionId, currentSession, isStreaming, messagesLength });
  useArtifactLinkInterception({
    scrollContainerRef,
    sessionId,
    sessionArtifacts,
    cwd: currentSession?.cwd,
  });

  const pendingArtifacts = usePersistedArtifactSeed(
    sessionId,
    currentSession?.artifacts,
    currentSession?.cwd,
    sessionArtifacts,
  );

  // lastMessageContent and messagesLength are now sourced from memoized
  // selectors (selectLastMessageContent / selectCurrentMessagesLength)
  // so there is no need to derive them from currentSession here.

  const resolveSessionLocalFilePath = useCallback(
    (href: string, text: string) => resolveLocalFilePath(href, text, currentSession?.cwd),
    [currentSession?.cwd],
  );

  const mapDisplayText = useCallback((value: string): string => {
    return value;
  }, []);

  const handleReEdit = useCallback(
    (message: CoworkMessage) => {
      const ref = promptInputRef.current;
      if (!ref) return;
      // Set text content
      if (message.content?.trim()) {
        ref.setValue(message.content);
      }
      // Restore image attachments (always call to clear previous attachments)
      const imageAttachments = ((message.metadata as CoworkMessageMetadata)?.imageAttachments ??
        []) as CoworkImageAttachment[];
      ref.setImageAttachments(imageAttachments);
      // Restore active skills
      const skillIds = (message.metadata as CoworkMessageMetadata)?.skillIds;
      if (skillIds && skillIds.length > 0) {
        dispatch(setActiveSkillIds(skillIds));
      }
      // Focus the input
      ref.focus();
    },
    [dispatch],
  );

  // Scope persisted collapsible state to this session. Rendered sessions are
  // shown one at a time, so a render-time namespace assignment is safe.
  setPersistentToggleNamespace(currentSession?.id ?? '');
  const stableSessionKey = resolveStableSessionKey(sessionId);

  const messages = currentSession?.messages;
  const isAwaitingInlineQuestion = Boolean(inlineQuestionPermission && onRespondToInlineQuestion);
  const displayItems = useMemo(() => (messages ? buildDisplayItems(messages) : []), [messages]);
  const rawTurns = useMemo(() => buildConversationTurns(displayItems), [displayItems]);
  // Stabilize turn object identity so completed turns do not re-render on
  // every streaming token (issue #141).
  const turns = useStableConversationTurns(rawTurns, stableSessionKey);
  // 末轮已有匹配工具卡片时，授权按钮画在卡片里，不再单独渲染白底授权卡
  const lastTurnItems = turns[turns.length - 1]?.assistantItems;
  const hasInlineToolPermissionCard = Boolean(
    inlinePermission &&
    lastTurnItems &&
    findToolGroupForPermission(lastTurnItems, inlinePermission),
  );
  const turnArtifactsMap = useTurnArtifacts(
    turns,
    sessionArtifacts,
    PREVIEWABLE_ARTIFACT_TYPES,
    currentSession?.cwd,
  );
  const pendingTurnArtifactsMap = useTurnArtifacts(
    turns,
    pendingArtifacts,
    PREVIEWABLE_ARTIFACT_TYPES,
    currentSession?.cwd,
  );

  const markInitialHistoryTailPositioned = useSessionHistoryPagination({
    sessionId,
    messagesOffset: currentSession?.messagesOffset ?? 0,
    rootRef: detailRootRef,
  });

  // Automatically ensure interactive prompt/permission cards stay in view
  useEffect(() => {
    if (inlineQuestionPermission || (inlinePermission && !hasInlineToolPermissionCard)) {
      const scrollElement = scrollContainerRef.current?.closest(
        '.cowork-conversation-scroll',
      ) as HTMLElement | null;
      if (scrollElement) {
        requestAnimationFrame(() => {
          scrollElement.scrollTo({ top: scrollElement.scrollHeight, behavior: 'smooth' });
        });
      }
    }
  }, [inlineQuestionPermission, inlinePermission, hasInlineToolPermissionCard]);

  const effectiveTurns = useMemo(() => {
    if (turns.length === 0 && isStreaming) {
      return [{ id: 'streaming-only', userMessage: null, assistantItems: [] }];
    }
    return turns;
  }, [turns, isStreaming]);

  // StickToBottom (Conversation) handles auto-scroll during streaming

  if (!currentSession) {
    return null;
  }

  const hideDefaultAssistantHeader = currentSession.mode === CoworkSessionMode.Chat;

  const renderConversationTurns = () => {
    if (effectiveTurns.length === 0) {
      return null;
    }

    const renderTurn = (turn: (typeof effectiveTurns)[number], index: number) => {
      if (!turn) return null;
      const isStreamingOnly = turn.id === 'streaming-only';
      const isLastTurn = index === effectiveTurns.length - 1;
      const hasActiveToolActivity = isStreaming && isLastTurn && toolActivities.length > 0;
      const showTypingIndicator =
        isStreaming &&
        isLastTurn &&
        (isStreamingOnly
          ? toolActivities.length === 0
          : !hasActiveTurnStreamingContent(turn, toolActivities, inlinePermission));
      const showAssistantBlock =
        isStreamingOnly ||
        turn.assistantItems.length > 0 ||
        showTypingIndicator ||
        hasActiveToolActivity;

      const turnArtifacts = turnArtifactsMap.get(turn.id) ?? [];

      return (
        <div key={turn.id} data-turn-index={index}>
          {turn.userMessage && (
            <div data-export-role="user-message">
              <UserBubble
                message={turn.userMessage}
                skills={skills}
                onReEdit={remoteManaged ? undefined : handleReEdit}
              />
            </div>
          )}
          {showAssistantBlock && (
            <div data-export-role="assistant-block">
              <TurnBlock
                turn={turn}
                artifacts={turnArtifacts}
                pendingArtifacts={pendingTurnArtifactsMap.get(turn.id)}
                resolveLocalFilePath={resolveSessionLocalFilePath}
                mapDisplayText={mapDisplayText}
                showTypingIndicator={showTypingIndicator}
                toolActivities={isLastTurn ? toolActivities : undefined}
                showCopyButtons={!isStreaming || !isLastTurn}
                isTurnComplete={!isStreaming || !isLastTurn}
                recoverableTaskId={recoverableTaskId}
                resumeTaskId={resumeTaskId}
                // 流式或恢复中禁用继续执行按钮
                resumeDisabled={resumeDisabled || isStreaming}
                onResumeTask={onResumeTask ? handleResumeTask : undefined}
                hideDefaultAssistantHeader={hideDefaultAssistantHeader}
                // 仅末轮需要工具授权，避免历史轮次误挂授权按钮
                pendingPermission={isLastTurn ? inlinePermission : null}
                onRespondToPermission={isLastTurn ? onRespondToInlinePermission : undefined}
                expandToolResults={isExportingImage}
                // 验收卡放在末轮复制按钮上方（issue #805）
                beforeCopySlot={
                  isLastTurn && sessionId ? (
                    <WorkbenchTaskAcceptanceCard sessionId={sessionId} />
                  ) : null
                }
              />
            </div>
          )}
        </div>
      );
    };

    return (
      <VirtualizedTurnList
        key={stableSessionKey}
        ref={virtualizedTurnListRef}
        turns={effectiveTurns}
        onInitialTailPositioned={markInitialHistoryTailPositioned}
        renderTurn={renderTurn}
        renderAll={isExportingImage}
      />
    );
  };

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
      {/* Export Options Dialog */}
      {!isSessionSwitching && (
        <SessionExportDialog
          open={showExportOptions}
          onOpenChange={setShowExportOptions}
          onExportImage={handleShareClick}
          onExportText={handleExportText}
          disabled={isExportingImage}
        />
      )}

      {/* Content row: chat + artifact panel */}
      <div ref={contentRowRef} className="flex-1 flex overflow-hidden">
        <div
          ref={detailRootRef}
          data-page-canvas
          className={`relative min-w-0 flex-1 flex flex-col bg-background h-full ${
            !isSessionSwitching && isArtifactWorkspace ? 'hidden' : ''
          }`}
          aria-hidden={!isSessionSwitching && isArtifactWorkspace}
        >
          {/* 流式时也用 instant，避免 smooth 跟随时动画叠加造成抖动 */}
          {/* 输入框绝对定位且与对话区平级，对话区 flex:1 会被挡住；用 paddingBottom 把可视区收在输入框上方 */}
          <div
            className="relative flex-1 min-h-0"
            style={{ paddingBottom: COWORK_COMPOSER_INSET_VALUE }}
          >
            {isSessionSwitching ? (
              <CoworkConversationLoadingSkeleton />
            ) : (
              <Conversation className="h-full" initial="instant" resize="instant">
                <ConversationContent
                  className="pt-3"
                  observeContentResize={false}
                  reverse={false}
                  scrollClassName="cowork-conversation-scroll"
                >
                  <div ref={scrollContainerRef}>
                    {renderConversationTurns()}
                    {inlineQuestionPermission && onRespondToInlineQuestion && (
                      <div className="px-3 pt-3">
                        <div className="mx-auto w-full max-w-6xl min-w-[320px] pl-4">
                          <AskUserQuestionCard
                            permission={inlineQuestionPermission}
                            onRespond={onRespondToInlineQuestion}
                          />
                        </div>
                      </div>
                    )}
                    {/* 对不上工具卡片时才在对话流里兜底展示独立授权卡 */}
                    {inlinePermission &&
                      onRespondToInlinePermission &&
                      !hasInlineToolPermissionCard && (
                        <div className="px-3 pt-3">
                          <div className="mx-auto w-full max-w-6xl min-w-[320px] pl-4">
                            <CoworkPermissionModal
                              permission={inlinePermission}
                              onRespond={onRespondToInlinePermission}
                            />
                          </div>
                        </div>
                      )}
                  </div>
                </ConversationContent>
                <ConversationScrollButton />
              </Conversation>
            )}
          </div>

          {/* Input Area */}
          <div
            ref={composerOverlayRef}
            className="pointer-events-none absolute inset-x-0 bottom-0 z-20 px-4"
          >
            <div className="mx-auto w-full max-w-6xl min-w-[320px] pl-4">
              <div className="pointer-events-auto relative min-w-0 rounded-t-3xl bg-background pb-4">
                <CoworkPromptInput
                  ref={promptInputRef}
                  topAccessory={
                    isSessionSwitching ? null : (
                      <>
                        {workMode === CoworkSessionMode.Work && currentSession?.id && (
                          <PendingMessageQueue
                            sessionId={currentSession.id}
                            isStreaming={isStreaming}
                          />
                        )}
                      </>
                    )
                  }
                  onSubmit={onContinue}
                  onStop={onStop}
                  isStreaming={isSessionSwitching ? false : isStreaming}
                  placeholder={i18nService.t(
                    !isSessionSwitching && remoteManaged
                      ? 'coworkRemoteManagedPlaceholder'
                      : workMode === 'chat'
                        ? 'chatPlaceholder'
                        : 'coworkContinuePlaceholder',
                  )}
                  disabled={
                    !isSessionSwitching &&
                    (remoteManaged || isAwaitingInlineQuestion || Boolean(inlinePermission))
                  }
                  sessionContextPending={isSessionSwitching}
                  size="large"
                  remoteManaged={!isSessionSwitching && remoteManaged}
                  onManageSkills={!isSessionSwitching && remoteManaged ? undefined : onManageSkills}
                  onManageConnectors={
                    !isSessionSwitching && remoteManaged ? undefined : onManageConnectors
                  }
                  showPermissionModeSelector={workMode === 'work'}
                  permissionMode={permissionMode}
                  onPermissionModeChange={onPermissionModeChange}
                  showModelSelector={true}
                  resumeTaskActive={Boolean(resumeTaskId)}
                  onCancelTaskResume={onCancelTaskResume}
                  sessionId={displayedSessionId ?? currentSession?.id}
                />
                <p className="text-center text-xs text-muted-foreground mt-2 select-none">
                  {i18nService.t('aiGeneratedDisclaimer')}
                </p>
              </div>
            </div>
          </div>
        </div>
        {!isSessionSwitching && shouldRenderArtifactPanel && (
          <SessionArtifactPanelRegion
            sessionId={previewSessionId}
            cwd={currentSession?.cwd}
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

export default CoworkSessionDetail;
