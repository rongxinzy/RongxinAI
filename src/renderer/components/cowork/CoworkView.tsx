import { cn } from '@shared/lib/utils';
import React, { useEffect, useRef, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';

import { buildSessionTitleFromInput } from '../../../common/sessionTitle';
import {
  CoworkPermissionMode,
  CoworkSessionMode,
  CoworkSessionSource,
} from '../../../shared/cowork/constants';
import { CoworkInterruptionCause } from '../../../shared/cowork/interruption';
import { CoworkSessionExpertSource } from '../../../shared/cowork/sessionExperts';
import {
  ProductionLoopMode,
  type ProductionLoopMode as ProductionLoopModeValue,
} from '../../../shared/productionLoop';
import { agentService } from '../../services/agent';
import { ChatChatTransport } from '../../services/chatChatTransport';
import {
  buildChatAgentSystemPrompt,
  ChatExecution,
  resolveChatExecution,
} from '../../services/chatExecutionRouter';
import {
  isChatSkillShortcutSelection,
  resolveChatSkillShortcutPermissionMode,
  resolveSkillPlaceholderKey,
} from '../chat/constants';
import { coworkService } from '../../services/cowork';
import { coworkQueueService } from '../../services/coworkQueue';
import { DirectChatTurnState } from '../../services/directChatTurnState';
import { i18nService } from '../../services/i18n';
import { normalizeError } from '../../services/errorNormalization';
import { quickActionService } from '../../services/quickAction';
import { RafMessageUpdateBatcher } from '../../services/rafMessageUpdateBatcher';
import { workspaceService } from '../../services/workspace';
import { RootState, store } from '../../store';
import {
  selectCoworkConfig,
  selectCurrentSession,
  selectDisplayedSessionId,
  selectIsStreaming,
} from '../../store/selectors/coworkSelectors';
import { selectWorkMode } from '../../store/selectors/workModeSelectors';
import {
  addMessage,
  addSession,
  clearCurrentSession,
  deleteSession,
  updateMessageContent,
  updateMessageContents,
  updateSessionStatus,
} from '../../store/slices/coworkSlice';
import { clearSelection, selectAction, setActions } from '../../store/slices/quickActionSlice';
import { clearActiveSkills, setActiveSkillIds } from '../../store/slices/skillSlice';
import { WorkMode } from '../../store/workMode/constants';
import {
  CoworkSessionStatusValue,
  type CoworkImageAttachment,
  type CoworkFileAttachment,
  type CoworkPermissionRequest,
  type CoworkPermissionResult,
  type CoworkSession,
} from '../../types/cowork';
import { toAgentModelRef } from '../../utils/agentModelRef';
import { isScratchWorkspacePath } from '../../utils/path';
import { PromptPanel, QuickActionBar } from '../quick-actions';
import type { SettingsOpenOptions } from '../Settings';
import PageHeader from '../PageHeader';
import { useAgentSelectedModel } from './agentModelSelection';
import CoworkPromptInput, { type CoworkPromptInputRef } from './CoworkPromptInput';
import CoworkSessionViewport from './CoworkSessionViewport';
import { mergeDirectChatSnapshotMessages } from './directChatSnapshot';
import SecurityStatusIndicator from './SecurityStatusIndicator';
import {
  quickActionSkillIds,
  shouldClearQuickActionSelection,
} from '../quick-actions/quickActionSelection';
import { useUnmanagedWorkingDirectory } from './useUnmanagedWorkingDirectory';
import { useTaskResumeContext } from './hooks/useTaskResumeContext';

export interface CoworkViewProps {
  onRequestAppSettings?: (options?: SettingsOpenOptions) => void;
  onShowSkills?: () => void;
  onShowConnectors?: () => void;
  isSidebarCollapsed?: boolean;
  onToggleSidebar?: () => void;
  onNewChat?: () => void;
  updateBadge?: React.ReactNode;
  inlineQuestionPermission?: CoworkPermissionRequest | null;
  onRespondToInlineQuestion?: (result: CoworkPermissionResult) => void | Promise<void>;
  inlinePermission?: CoworkPermissionRequest | null;
  onRespondToInlinePermission?: (result: CoworkPermissionResult) => void | Promise<void>;
}

const DirectChatDataChunkType = {
  Context: 'data-context',
  SessionMetrics: 'data-session-metrics',
} as const;

type DirectChatPart =
  | { type: 'text'; text: string }
  | { type: 'file'; mediaType: string; url: string; filename: string };

interface DirectChatContextData {
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  contextWindowTokens: number;
  inputTokens: number;
  outputTokens: number;
  usedTokens: number;
}

interface DirectChatSessionMetrics {
  requestStartedAt: number;
  firstVisibleTextAt?: number;
  completedAt: number;
}

const isDirectChatContextData = (value: unknown): value is DirectChatContextData => {
  if (!value || typeof value !== 'object') return false;
  const data = value as Record<string, unknown>;
  const contextWindowTokens = data.contextWindowTokens;
  const inputTokens = data.inputTokens;
  const outputTokens = data.outputTokens;
  const usedTokens = data.usedTokens;
  const cacheReadTokens = data.cacheReadTokens;
  const cacheWriteTokens = data.cacheWriteTokens;
  if (
    typeof contextWindowTokens !== 'number' ||
    typeof inputTokens !== 'number' ||
    typeof outputTokens !== 'number' ||
    typeof usedTokens !== 'number' ||
    !Number.isFinite(contextWindowTokens) ||
    !Number.isFinite(inputTokens) ||
    !Number.isFinite(outputTokens) ||
    !Number.isFinite(usedTokens)
  ) {
    return false;
  }
  return (
    contextWindowTokens > 0 &&
    inputTokens >= 0 &&
    outputTokens >= 0 &&
    usedTokens >= 0 &&
    (cacheReadTokens === undefined ||
      (typeof cacheReadTokens === 'number' &&
        Number.isFinite(cacheReadTokens) &&
        cacheReadTokens >= 0)) &&
    (cacheWriteTokens === undefined ||
      (typeof cacheWriteTokens === 'number' &&
        Number.isFinite(cacheWriteTokens) &&
        cacheWriteTokens >= 0))
  );
};

const isDirectChatSessionMetrics = (value: unknown): value is DirectChatSessionMetrics => {
  if (!value || typeof value !== 'object') return false;
  const data = value as Record<string, unknown>;
  const start = data.requestStartedAt;
  const first = data.firstVisibleTextAt;
  const end = data.completedAt;
  return (
    typeof start === 'number' &&
    typeof end === 'number' &&
    Number.isFinite(start) &&
    Number.isFinite(end) &&
    end >= start &&
    (first === undefined ||
      (typeof first === 'number' && Number.isFinite(first) && first >= start && first <= end))
  );
};

const CoworkView: React.FC<CoworkViewProps> = ({
  onRequestAppSettings,
  onShowSkills,
  onShowConnectors,
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

  const contentBatcherRef = useRef<RafMessageUpdateBatcher | null>(null);
  if (!contentBatcherRef.current) {
    contentBatcherRef.current = new RafMessageUpdateBatcher(updates => {
      dispatch(updateMessageContents(updates));
    });
  }
  const contentBatcher = contentBatcherRef.current;

  useEffect(() => () => contentBatcher.dispose(), [contentBatcher]);
  const [isInitialized, setIsInitialized] = useState(false);
  // Track in-flight direct-chat operations per session so switching to another
  // chat window does not block submission on a global boolean ref.
  const startingSessionIdsRef = useRef(new Set<string>());
  const continuingSessionIdsRef = useRef(new Set<string>());
  const directChatAbortControllersRef = useRef(new Map<string, AbortController>());
  // Track pending start request so stop can cancel delayed startup.
  const pendingStartRef = useRef<{
    requestId: number;
    cancelled: boolean;
    cancellationAction: 'stop' | 'delete' | null;
  } | null>(null);
  const startRequestIdRef = useRef(0);
  // Ref for CoworkPromptInput
  const promptInputRef = useRef<CoworkPromptInputRef>(null);
  const quickActionActivationRef = useRef<string | null>(null);

  const [localThinkingEnabled, setLocalThinkingEnabled] = useState<boolean | undefined>();

  const currentSession = useSelector(selectCurrentSession);
  const taskResume = useTaskResumeContext(currentSession?.id);
  const displayedSessionId = useSelector(selectDisplayedSessionId);
  const workMode = useSelector(selectWorkMode);
  const directChatModel = useSelector((state: RootState) => state.model.defaultSelectedModel);
  const directChatModelId = directChatModel.id;

  // Clear session when workMode changes and current session mode doesn't match.
  // Sessions without an explicit mode field (legacy) are treated as work mode.
  const prevWorkModeRef = useRef(workMode);
  useEffect(() => {
    if (prevWorkModeRef.current !== workMode) {
      prevWorkModeRef.current = workMode;
      const sessionMode = currentSession?.mode || WorkMode.Work;
      if (sessionMode !== workMode) {
        dispatch(clearCurrentSession());
      }
    }
  }, [workMode, currentSession?.mode, dispatch]);

  const isStreaming = useSelector(selectIsStreaming);
  const config = useSelector(selectCoworkConfig);
  const sessionPermissionMode = currentSession
    ? (config.permissionModeBySession?.[currentSession.id] ?? config.permissionMode)
    : config.permissionMode;

  const activeSkillIds = useSelector((state: RootState) => state.skill.activeSkillIds);
  const skills = useSelector((state: RootState) => state.skill.skills);
  const quickActions = useSelector((state: RootState) => state.quickAction.actions);
  const selectedActionId = useSelector((state: RootState) => state.quickAction.selectedActionId);
  const currentAgentId = useSelector((state: RootState) => state.agent.currentAgentId);
  const agents = useSelector((state: RootState) => state.agent.agents);
  const currentAgent = agents.find(agent => agent.id === currentAgentId);
  const workspaces = useSelector((state: RootState) => state.workspace.workspaces);
  const currentWorkspaceId = useSelector((state: RootState) => state.workspace.currentWorkspaceId);
  const currentWorkspace = workspaces.find(workspace => workspace.id === currentWorkspaceId);
  const defaultConversationWorkspace = workspaces.find(
    workspace => !workspace.isHidden && isScratchWorkspacePath(workspace.path),
  );
  const {
    clearUnmanagedWorkingDirectory,
    selectUnmanagedWorkingDirectory,
    unmanagedWorkingDirectory,
  } = useUnmanagedWorkingDirectory({ currentWorkspaceId });
  const currentSessionWorkingDirectory =
    currentSession?.workspaceId === currentWorkspaceId ? currentSession.cwd : '';
  const activeWorkspacePath =
    currentSessionWorkingDirectory || unmanagedWorkingDirectory || currentWorkspace?.path || '';
  const currentWorkspacePath =
    activeWorkspacePath ||
    (workMode === WorkMode.Work ? defaultConversationWorkspace?.path : config.workingDirectory) ||
    '';
  const currentWorkspaceDisplayName =
    currentWorkspace && !currentWorkspace.isHidden && isScratchWorkspacePath(currentWorkspace.path)
      ? i18nService.t('defaultConversation')
      : currentWorkspace && !currentWorkspace.isHidden
        ? currentWorkspace.name
        : currentWorkspacePath === defaultConversationWorkspace?.path
          ? i18nService.t('defaultConversation')
          : undefined;

  const currentAgentSelectedModel = useAgentSelectedModel(
    currentAgentId,
    currentAgent?.model ?? '',
  );

  // Agent-backed chat sessions (skills attached, or persisted on the session)
  // execute via the agent runtime, so the prompt input must use work-style
  // agent model/control semantics instead of direct-chat ones — otherwise the
  // model selector would bind to the direct-chat default model while the
  // engine actually runs the agent model.
  const isAgentBackedChat =
    workMode === WorkMode.Chat &&
    resolveChatExecution({ activeSkillIds, session: currentSession }) === ChatExecution.Agent;

  const buildApiConfigNotice = (
    error?: string,
  ): { noticeI18nKey: string; noticeExtra?: string } => {
    const key = 'coworkModelSettingsRequired';
    if (!error) {
      return { noticeI18nKey: key };
    }
    const normalizedError = error.trim();
    if (
      normalizedError.startsWith('No enabled provider found for model:') ||
      normalizedError === 'No available model configured in enabled providers.'
    ) {
      return { noticeI18nKey: key };
    }
    return { noticeI18nKey: key, noticeExtra: error };
  };

  useEffect(() => {
    const init = async () => {
      await coworkService.init();
      await agentService.loadAgents();
      // Load quick actions with localization
      try {
        quickActionService.initialize();
        const actions = await quickActionService.getLocalizedActions();
        dispatch(setActions(actions));
      } catch (error) {
        console.error('Failed to load quick actions:', error);
      }
      try {
        const apiConfig = await coworkService.checkApiConfig();
        if (apiConfig && !apiConfig.hasConfig) {
          onRequestAppSettings?.({
            initialTab: 'model',
            ...buildApiConfigNotice(apiConfig.error),
          });
        }
      } catch (error) {
        console.error('Failed to check cowork API config:', error);
      }
      setIsInitialized(true);
    };
    init();

    // Subscribe to language changes to reload quick actions
    const unsubscribe = quickActionService.subscribe(async () => {
      try {
        const actions = await quickActionService.getLocalizedActions();
        dispatch(setActions(actions));
      } catch (error) {
        console.error('Failed to reload quick actions:', error);
      }
    });

    return () => {
      unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dispatch]);

  useEffect(() => {
    if (!isInitialized || !currentWorkspaceId) return;
    void coworkService.loadSessions(undefined, currentWorkspaceId);
  }, [currentWorkspaceId, isInitialized]);

  const handleStartSession = async (
    prompt: string,
    skillPrompt?: string,
    imageAttachments?: CoworkImageAttachment[],
    fileAttachments?: CoworkFileAttachment[],
    expertIds: string[] = [],
    goalMode = false,
    productionLoopMode: ProductionLoopModeValue = ProductionLoopMode.Auto,
  ): Promise<boolean | void> => {
    console.log('[CoworkView] handleStartSession: imageAttachments diagnosis', {
      hasImageAttachments: !!imageAttachments,
      count: imageAttachments?.length ?? 0,
      details:
        imageAttachments?.map(a => ({
          name: a.name,
          mimeType: a.mimeType,
          base64Length: a.base64Data?.length ?? 0,
        })) ?? [],
    });
    // Prevent duplicate submissions for the same session context.
    // Use currentSession.id so a second chat/work window can submit in parallel.
    const startSessionKey = currentSession?.id ?? `new-${workMode}`;
    if (startingSessionIdsRef.current.has(startSessionKey)) return;
    startingSessionIdsRef.current.add(startSessionKey);
    const requestId = ++startRequestIdRef.current;
    pendingStartRef.current = { requestId, cancelled: false, cancellationAction: null };
    const isPendingStartCancelled = () => {
      const pending = pendingStartRef.current;
      return !pending || pending.requestId !== requestId || pending.cancelled;
    };
    const getPendingCancellationAction = () => {
      const pending = pendingStartRef.current;
      if (!pending || pending.requestId !== requestId || !pending.cancelled) {
        return null;
      }
      return pending.cancellationAction;
    };

    try {
      try {
        const apiConfig = await coworkService.checkApiConfig();
        if (apiConfig && !apiConfig.hasConfig) {
          onRequestAppSettings?.({
            initialTab: 'model',
            ...buildApiConfigNotice(apiConfig.error),
          });
          startingSessionIdsRef.current.delete(startSessionKey);
          return;
        }
      } catch (error) {
        console.error('Failed to check cowork API config:', error);
      }

      // Create a temporary session with user message to show immediately
      const tempSessionId = `temp-${Date.now()}`;
      const fallbackTitle = buildSessionTitleFromInput(
        prompt,
        i18nService.t('coworkDefaultSessionTitle'),
      );
      const now = Date.now();

      // Capture active skill IDs before clearing them
      const sessionSkillIds = [...activeSkillIds];

      // Chat sessions with skills attached execute via the agent runtime while
      // staying tagged as chat sessions; plain chat streams directly (direct LLM).
      const isChatAgentExecution =
        workMode === WorkMode.Chat &&
        resolveChatExecution({ activeSkillIds: sessionSkillIds }) === ChatExecution.Agent;

      const tempSession: CoworkSession = {
        id: tempSessionId,
        title: fallbackTitle,
        claudeSessionId: null,
        status: 'running',
        mode: workMode,
        pinned: false,
        createdAt: now,
        updatedAt: now,
        cwd: currentWorkspacePath,
        systemPrompt: '',
        modelOverride: currentAgentSelectedModel ? toAgentModelRef(currentAgentSelectedModel) : '',
        executionMode: config.executionMode || 'local',
        activeSkillIds: sessionSkillIds,
        workspaceId: currentWorkspaceId || '',
        agentId: currentAgentId,
        source: CoworkSessionSource.Manual,
        messages: [
          {
            id: `msg-${now}`,
            type: 'user',
            content: prompt,
            timestamp: now,
            metadata:
              sessionSkillIds.length > 0 ||
              (imageAttachments && imageAttachments.length > 0) ||
              (fileAttachments && fileAttachments.length > 0)
                ? {
                    ...(sessionSkillIds.length > 0 ? { skillIds: sessionSkillIds } : {}),
                    ...(imageAttachments && imageAttachments.length > 0
                      ? { imageAttachments }
                      : {}),
                    ...(fileAttachments && fileAttachments.length > 0 ? { fileAttachments } : {}),
                  }
                : undefined,
          },
        ],
        messagesOffset: 0,
        totalMessages: 1,
      };

      // Direct chat sessions use the temporary session as their UI identity
      // until the direct model stream finishes. Add it to the sidebar now so
      // the user's message is visible in history immediately after submit.
      // Agent-backed chat sessions follow the work flow: the temp session is
      // replaced by the real engine-created session (tagged mode: 'chat').
      if (workMode === WorkMode.Chat && !isChatAgentExecution) {
        dispatch(addSession(tempSession));
      } else {
        // Keep a new Work session in the list while the backend creates its
        // persistent record, so attachments and the initial prompt remain
        // visible if startup takes time or fails.
        dispatch(addSession(tempSession));
      }
      // Clear quick action selection after starting session
      dispatch(clearSelection());

      // Direct chat: stream from the configured LLM via apiService, skip the agent runtime
      if (workMode === WorkMode.Chat && !isChatAgentExecution) {
        const abortController = new AbortController();
        directChatAbortControllersRef.current.set(tempSessionId, abortController);
        const assistantMsgId = `msg-${now}-assistant`;
        const thinkingMsgId = `msg-${now}-thinking`;
        const turnState = new DirectChatTurnState(assistantMsgId, thinkingMsgId);
        let assistantContent = '';
        let assistantMessageAdded = false;
        let directContextData: DirectChatContextData | undefined;
        let directSessionMetrics: DirectChatSessionMetrics | undefined;
        const finishThinking = () => {
          const finished = turnState.finishReasoning();
          if (!finished) return;
          contentBatcher.discard(tempSessionId, finished.message.id);
          if (finished.messageWasAdded) {
            dispatch(
              updateMessageContent({
                sessionId: tempSessionId,
                messageId: finished.message.id,
                content: finished.message.content,
                metadata: finished.message.metadata,
              }),
            );
          }
        };
        let persistTimer: ReturnType<typeof setTimeout> | null = null;
        const buildChatSnapshot = (status: CoworkSession['status']): CoworkSession => {
          const snapshot = store.getState().cowork.currentSession;
          const streamingSnapshot = store.getState().cowork.streamingSessions[tempSessionId];
          const baseSession =
            snapshot?.id === tempSessionId ? snapshot : (streamingSnapshot ?? tempSession);
          const messages = mergeDirectChatSnapshotMessages(
            baseSession.messages,
            turnState.messagesSnapshot,
          );
          return {
            ...baseSession,
            status,
            updatedAt: Date.now(),
            messages,
            totalMessages: messages.length,
          };
        };
        const persistChatSnapshot = (force = false) => {
          const persist = () => {
            persistTimer = null;
            void coworkService
              .saveChatSession(buildChatSnapshot(CoworkSessionStatusValue.Running))
              .catch(error => console.error('[CoworkView] Failed to persist chat session:', error));
          };
          if (force) {
            if (persistTimer) clearTimeout(persistTimer);
            persist();
          } else if (!persistTimer) {
            persistTimer = setTimeout(persist, 250);
          }
        };
        try {
          const created = await coworkService.saveChatSession(tempSession);
          if (!created.success) {
            throw new Error(created.error || 'Failed to create chat session');
          }
          const transport = new ChatChatTransport({
            contextWindowTokens:
              directChatModel.llamaCppRuntimeContextWindow ?? directChatModel.contextWindow,
            modelId: directChatModelId,
            modelProviderKey: directChatModel.providerKey,
            localThinkingEnabled,
          });
          const userParts: DirectChatPart[] = [
            { type: 'text' as const, text: prompt },
            ...(imageAttachments ?? []).map(image => ({
              type: 'file' as const,
              mediaType: image.mimeType,
              url: `data:${image.mimeType};base64,${image.base64Data}`,
              filename: image.name,
            })),
          ];
          const stream = await transport.sendMessages({
            trigger: 'submit-message',
            chatId: tempSessionId,
            messageId: undefined,
            messages: [{ id: `msg-${now}`, role: 'user', parts: userParts }],
            abortSignal: abortController.signal,
          });
          const reader = stream.getReader();
          while (true) {
            const { done, value: chunk } = await reader.read();
            if (done || isPendingStartCancelled()) break;
            if (!chunk) continue;
            switch (chunk.type) {
              case DirectChatDataChunkType.Context:
                if (isDirectChatContextData(chunk.data)) {
                  directContextData = chunk.data;
                }
                break;
              case DirectChatDataChunkType.SessionMetrics:
                if (isDirectChatSessionMetrics(chunk.data)) {
                  directSessionMetrics = chunk.data;
                }
                break;
              case 'text-start':
                {
                  const result = turnState.startAssistant();
                  if (!assistantMessageAdded && result.isNew) {
                    dispatch(
                      addMessage({
                        sessionId: tempSessionId,
                        message: result.message,
                      }),
                    );
                    assistantMessageAdded = true;
                    persistChatSnapshot();
                  }
                }
                break;
              case 'text-delta':
                finishThinking();
                assistantContent += chunk.delta;
                {
                  const result = turnState.appendAssistant(chunk.delta);
                  if (!assistantMessageAdded && result.isNew) {
                    dispatch(
                      addMessage({
                        sessionId: tempSessionId,
                        message: result.message,
                      }),
                    );
                    assistantMessageAdded = true;
                  } else {
                    contentBatcher.enqueue({
                      sessionId: tempSessionId,
                      messageId: assistantMsgId,
                      content: result.message.content,
                      metadata: result.message.metadata,
                    });
                  }
                }
                persistChatSnapshot();
                break;
              case 'reasoning-start':
                {
                  const result = turnState.startReasoning();
                  if (result.isNew) {
                    dispatch(
                      addMessage({
                        sessionId: tempSessionId,
                        message: result.message,
                      }),
                    );
                    turnState.markReasoningMessageAdded();
                    persistChatSnapshot();
                  }
                }
                break;
              case 'reasoning-delta':
                {
                  const result = turnState.appendReasoning(chunk.delta);
                  if (result.isNew) {
                    dispatch(
                      addMessage({
                        sessionId: tempSessionId,
                        message: result.message,
                      }),
                    );
                    turnState.markReasoningMessageAdded();
                  } else {
                    contentBatcher.enqueue({
                      sessionId: tempSessionId,
                      messageId: result.message.id,
                      content: result.message.content,
                      metadata: result.message.metadata,
                    });
                  }
                }
                break;
              case 'reasoning-end':
                finishThinking();
                persistChatSnapshot();
                break;
              case 'tool-input-available':
                finishThinking();
                dispatch(
                  addMessage({
                    sessionId: tempSessionId,
                    message: turnState.addToolUse(
                      chunk.toolCallId,
                      chunk.input && typeof chunk.input === 'object'
                        ? (chunk.input as Record<string, unknown>)
                        : {},
                    ),
                  }),
                );
                persistChatSnapshot();
                break;
              case 'tool-output-available':
                dispatch(
                  addMessage({
                    sessionId: tempSessionId,
                    message: turnState.addToolResult(chunk.toolCallId, chunk.output),
                  }),
                );
                persistChatSnapshot();
                break;
              case 'tool-output-error':
                dispatch(
                  addMessage({
                    sessionId: tempSessionId,
                    message: turnState.addToolResult(chunk.toolCallId, undefined, chunk.errorText),
                  }),
                );
                persistChatSnapshot();
                break;
              case 'error':
                throw new Error(chunk.errorText);
            }
          }
          if (abortController.signal.aborted || isPendingStartCancelled()) {
            contentBatcher.discard(tempSessionId, assistantMsgId);
            finishThinking();
            if (assistantMessageAdded) {
              turnState.updateAssistantMetadata({ isStreaming: false, isFinal: true });
              dispatch(
                updateMessageContent({
                  sessionId: tempSessionId,
                  messageId: assistantMsgId,
                  content: assistantContent,
                  metadata: { isStreaming: false, isFinal: true },
                }),
              );
            }
            dispatch(updateSessionStatus({ sessionId: tempSessionId, status: 'idle' }));
            if (persistTimer) clearTimeout(persistTimer);
            await coworkService.saveChatSession(buildChatSnapshot(CoworkSessionStatusValue.Idle));
            return;
          }
          contentBatcher.discard(tempSessionId, assistantMsgId);
          finishThinking();
          // Finalize message metadata to prevent streaming replay on reload
          if (assistantMessageAdded) {
            const finalMetadata = {
              isStreaming: false,
              isFinal: true,
              isFinalAnswer: true,
              ...(directContextData
                ? {
                    contextUsage: {
                      contextWindowTokens: directContextData.contextWindowTokens,
                      updatedAt: Date.now(),
                      usedTokens: directContextData.usedTokens,
                    },
                    model: directChatModelId,
                    modelProviderKey: directChatModel.providerKey,
                    usage: {
                      inputTokens: directContextData.inputTokens,
                      outputTokens: directContextData.outputTokens,
                      ...(directContextData.cacheReadTokens !== undefined
                        ? { cacheReadTokens: directContextData.cacheReadTokens }
                        : {}),
                      ...(directContextData.cacheWriteTokens !== undefined
                        ? { cacheWriteTokens: directContextData.cacheWriteTokens }
                        : {}),
                      totalTokens: directContextData.usedTokens,
                    },
                  }
                : {}),
              ...(directSessionMetrics ? { metrics: directSessionMetrics } : {}),
            };
            turnState.updateAssistantMetadata(finalMetadata);
            dispatch(
              updateMessageContent({
                sessionId: tempSessionId,
                messageId: assistantMsgId,
                content: assistantContent,
                metadata: finalMetadata,
              }),
            );
          }
          if (persistTimer) clearTimeout(persistTimer);
          const savedSession = buildChatSnapshot(CoworkSessionStatusValue.Completed);
          dispatch(updateSessionStatus({ sessionId: tempSessionId, status: 'completed' }));
          if (store.getState().cowork.currentSessionId === tempSessionId) {
            dispatch(addSession(savedSession));
          }
          await coworkService.saveChatSession(savedSession);
        } catch (error) {
          contentBatcher.discard(tempSessionId, assistantMsgId);
          finishThinking();
          // Finalize the partial answer so the turn does not render as still
          // streaming after the failure.
          if (assistantMessageAdded) {
            turnState.updateAssistantMetadata({ isStreaming: false, isFinal: true });
            dispatch(
              updateMessageContent({
                sessionId: tempSessionId,
                messageId: assistantMsgId,
                content: assistantContent,
                metadata: { isStreaming: false, isFinal: true },
              }),
            );
          }
          dispatch(updateSessionStatus({ sessionId: tempSessionId, status: 'error' }));
          dispatch(
            addMessage({
              sessionId: tempSessionId,
              message: {
                id: `error-${Date.now()}`,
                type: 'system',
                content: i18nService
                  .t('chatErrorMessage')
                  .replace('{error}', error instanceof Error ? error.message : 'Unknown error'),
                timestamp: Date.now(),
              },
            }),
          );
          if (persistTimer) clearTimeout(persistTimer);
          await coworkService
            .saveChatSession(buildChatSnapshot(CoworkSessionStatusValue.Error))
            .catch(saveError =>
              console.error('[CoworkView] Failed to persist failed chat session:', saveError),
            );
        } finally {
          if (persistTimer) clearTimeout(persistTimer);
          if (directChatAbortControllersRef.current.get(tempSessionId) === abortController) {
            directChatAbortControllersRef.current.delete(tempSessionId);
          }
          startingSessionIdsRef.current.delete(startSessionKey);
        }
        return;
      }
      // Engine path: work sessions, and chat sessions with skills attached
      // (agent-backed chat). The engine loads skills natively via
      // skills.load.extraDirs, so skip the auto-routing prompt to avoid
      // injecting Claude SDK tool-calling instructions that confuse non-Claude
      // models (e.g. kimi-k2.5 falls back to text-based tool calls, producing
      // empty tool names and err=true failures).
      const isExpertAgent =
        currentAgent?.source === CoworkSessionExpertSource.Package ||
        currentAgent?.source === CoworkSessionExpertSource.Member;
      const agentSystemPrompt = isExpertAgent ? undefined : currentAgent?.systemPrompt?.trim();
      const baseSystemPrompt = agentSystemPrompt || config.systemPrompt || '';
      // Combine skill prompt with system prompt. Including skillPrompt here is
      // what lets chat-mode skill submissions reach the model (issue #117).
      const combinedSystemPrompt = buildChatAgentSystemPrompt(skillPrompt, baseSystemPrompt);

      // Agent-backed chat hides the folder selector, so the engine relies on
      // the configured default working directory. Bail out early with a toast
      // when no working directory is available at all.
      if (isChatAgentExecution && !currentWorkspacePath) {
        window.dispatchEvent(
          new CustomEvent('app:showToast', {
            detail: i18nService.t('chatAgentWorkingDirectoryRequired'),
          }),
        );
        dispatch(clearCurrentSession());
        return;
      }

      // Start the actual session immediately with fallback title
      const sessionModelOverride = currentAgentSelectedModel
        ? toAgentModelRef(currentAgentSelectedModel)
        : '';
      const shouldAutoAllowChatSkill =
        workMode === WorkMode.Chat &&
        isChatAgentExecution &&
        isChatSkillShortcutSelection(sessionSkillIds);
      const sessionPermissionMode =
        shouldAutoAllowChatSkill
          ? resolveChatSkillShortcutPermissionMode(sessionSkillIds, config.permissionMode)
          : config.permissionMode;
      console.log('[CoworkView] creating session:', {
        modelId: currentAgentSelectedModel?.id,
        providerKey: currentAgentSelectedModel?.providerKey,
        agentId: currentAgentId,
        agentName: currentAgent?.name,
        agentSource: currentAgent?.source,
        agentSystemPrompt: agentSystemPrompt ? `${agentSystemPrompt.slice(0, 80)}...` : '(empty)',
        combinedSystemPrompt: combinedSystemPrompt
          ? `${combinedSystemPrompt.slice(0, 120)}...`
          : '(undefined)',
      });
      const { session: startedSession, error: startError } = await coworkService.startSession({
        prompt,
        title: fallbackTitle,
        cwd: currentWorkspacePath || undefined,
        systemPrompt: combinedSystemPrompt,
        // Agent-backed chat stays tagged as a chat session so it remains in
        // the Chat sidebar list; work sessions keep the default work mode.
        mode: isChatAgentExecution ? CoworkSessionMode.Chat : CoworkSessionMode.Work,
        activeSkillIds: sessionSkillIds,
        workspaceId: currentWorkspaceId || undefined,
        agentId: currentAgentId,
        expertIds,
        goalMode,
        productionLoopMode,
        modelOverride: sessionModelOverride,
        permissionMode: sessionPermissionMode,
        imageAttachments,
        fileAttachments,
      });

      if (!startedSession && startError) {
        // Show the error as a system message in the temp session
        dispatch(
          addMessage({
            sessionId: tempSessionId,
            message: {
              id: `error-${Date.now()}`,
              type: 'system',
              content: i18nService
                .t('coworkErrorSessionStartFailed')
                .replace('{error}', startError),
              timestamp: Date.now(),
            },
          }),
        );
        dispatch(updateSessionStatus({ sessionId: tempSessionId, status: 'error' }));
        return;
      }

      if (startedSession) {
        if (shouldAutoAllowChatSkill) {
          await coworkService.updateConfig({
            permissionModeBySession: {
              ...(store.getState().cowork.config.permissionModeBySession ?? {}),
              [startedSession.id]: CoworkPermissionMode.AllowAll,
            },
          });
        }
        clearUnmanagedWorkingDirectory();
        // coworkService.startSession already selected the real session.
        // Remove only the temporary list entry after that replacement.
        dispatch(deleteSession(tempSessionId));
      }

      // Stop immediately if user cancelled while startup request was in flight.
      if (isPendingStartCancelled() && startedSession) {
        await coworkService.stopSession(startedSession.id);
        if (getPendingCancellationAction() === 'delete') {
          await coworkService.deleteSession(startedSession.id);
        }
      }
    } finally {
      if (pendingStartRef.current?.requestId === requestId) {
        pendingStartRef.current = null;
      }
      startingSessionIdsRef.current.delete(startSessionKey);
    }
  };

  const handleContinueSession = async (
    prompt: string,
    skillPrompt?: string,
    imageAttachments?: CoworkImageAttachment[],
    fileAttachments?: CoworkFileAttachment[],
    expertIds: string[] = [],
    goalMode = false,
    productionLoopMode: ProductionLoopModeValue = ProductionLoopMode.Auto,
  ) => {
    if (!currentSession) return;
    if (taskResume.interruption) {
      return taskResume.resume({
        amendment: prompt,
        skillIds: [...activeSkillIds],
        expertIds,
        goalMode,
        productionLoopMode,
        imageAttachments,
        fileAttachments,
      });
    }
    if (continuingSessionIdsRef.current.has(currentSession.id)) return;

    // Work keeps the prompt editable while Pi is running. Normal input during
    // a live turn becomes an ordered Follow-up item; Chat retains its existing
    // direct/agent multi-turn behavior and never enters this queue.
    if (
      workMode === WorkMode.Work &&
      isStreaming &&
      (currentSession.mode ?? CoworkSessionMode.Work) === CoworkSessionMode.Work
    ) {
      const result = await coworkQueueService.enqueue(
        currentSession.id,
        prompt,
        imageAttachments,
        fileAttachments,
        [...activeSkillIds],
        skillPrompt,
        productionLoopMode,
      );
      if (!result.success) {
        window.dispatchEvent(
          new CustomEvent('app:showToast', {
            detail: {
              message: normalizeError(result.error || i18nService.t('coworkQueueEnqueueFailed')),
              isError: true,
            },
          }),
        );
        return false;
      }
      return true;
    }

    // Direct chat: stream from the configured LLM via apiService. Chat
    // sessions that are agent-backed (skills attached now or persisted on the
    // session) fall through to the engine continue path below.
    if (
      workMode === WorkMode.Chat &&
      resolveChatExecution({ activeSkillIds, session: currentSession }) === ChatExecution.Direct
    ) {
      continuingSessionIdsRef.current.add(currentSession.id);
      const abortController = new AbortController();
      directChatAbortControllersRef.current.set(currentSession.id, abortController);
      const assistantMsgId = `msg-${Date.now()}-assistant`;
      const thinkingMsgId = `msg-${Date.now()}-thinking`;
      const turnState = new DirectChatTurnState(assistantMsgId, thinkingMsgId);
      const userMsgId = `msg-${Date.now()}`;
      const userMessage = {
        id: userMsgId,
        type: 'user' as const,
        content: prompt,
        timestamp: Date.now(),
        ...(imageAttachments?.length || fileAttachments?.length
          ? {
              metadata: {
                ...(imageAttachments?.length ? { imageAttachments } : {}),
                ...(fileAttachments?.length ? { fileAttachments } : {}),
              },
            }
          : {}),
      };
      let assistantContent = '';
      let assistantMessageAdded = false;
      let directContextData: DirectChatContextData | undefined;
      let directSessionMetrics: DirectChatSessionMetrics | undefined;
      const finishThinking = () => {
        const finished = turnState.finishReasoning();
        if (!finished) return;
        contentBatcher.discard(currentSession.id, finished.message.id);
        if (finished.messageWasAdded) {
          dispatch(
            updateMessageContent({
              sessionId: currentSession.id,
              messageId: finished.message.id,
              content: finished.message.content,
              metadata: finished.message.metadata,
            }),
          );
        }
      };
      let persistTimer: ReturnType<typeof setTimeout> | null = null;
      const buildChatSnapshot = (status: CoworkSession['status']): CoworkSession => {
        const snapshot = store.getState().cowork.currentSession;
        const streamingSnapshot = store.getState().cowork.streamingSessions[currentSession.id];
        const baseSession =
          snapshot?.id === currentSession.id ? snapshot : (streamingSnapshot ?? currentSession);
        const messages = mergeDirectChatSnapshotMessages(
          baseSession.messages,
          turnState.messagesSnapshot,
        );
        return {
          ...baseSession,
          status,
          updatedAt: Date.now(),
          messages,
          totalMessages: messages.length,
        };
      };
      const persistChatSnapshot = (force = false) => {
        const persist = () => {
          persistTimer = null;
          void coworkService
            .saveChatSession(buildChatSnapshot(CoworkSessionStatusValue.Running))
            .catch(error => console.error('[CoworkView] Failed to persist chat continue:', error));
        };
        if (force) {
          if (persistTimer) clearTimeout(persistTimer);
          persist();
        } else if (!persistTimer) {
          persistTimer = setTimeout(persist, 250);
        }
      };
      try {
        // Direct Chat does not emit engine stream events. Keep its per-session
        // status in sync with Work so the shared streaming UI remains visible.
        dispatch(
          updateSessionStatus({
            sessionId: currentSession.id,
            status: CoworkSessionStatusValue.Running,
          }),
        );
        // Add user message to session first
        dispatch(
          addMessage({
            sessionId: currentSession.id,
            message: userMessage,
          }),
        );
        const initialSnapshot = store.getState().cowork.currentSession;
        if (initialSnapshot?.id === currentSession.id) {
          await coworkService.saveChatSession(initialSnapshot);
        }

        const transport = new ChatChatTransport({
          contextWindowTokens:
            directChatModel.llamaCppRuntimeContextWindow ?? directChatModel.contextWindow,
          modelId: directChatModelId,
          modelProviderKey: directChatModel.providerKey,
          localThinkingEnabled,
        });
        const stream = await transport.sendMessages({
          trigger: 'submit-message',
          chatId: currentSession.id,
          messageId: undefined,
          messages: (currentSession.messages || [])
            .filter(
              m =>
                m.type === 'user' ||
                (m.type === 'assistant' && !(m.metadata && m.metadata.isThinking === true)),
            )
            .map(m => ({
              id: m.id,
              role: m.type as 'user' | 'assistant',
              parts: [{ type: 'text' as const, text: m.content }] as DirectChatPart[],
            }))
            .concat({
              id: userMsgId,
              role: 'user' as const,
              parts: [
                { type: 'text' as const, text: prompt },
                ...(imageAttachments ?? []).map(image => ({
                  type: 'file' as const,
                  mediaType: image.mimeType,
                  url: `data:${image.mimeType};base64,${image.base64Data}`,
                  filename: image.name,
                })),
              ],
            }),
          abortSignal: abortController.signal,
        });
        const reader = stream.getReader();
        while (true) {
          const { done, value: chunk } = await reader.read();
          if (done) break;
          if (!chunk) continue;
          switch (chunk.type) {
            case DirectChatDataChunkType.Context:
              if (isDirectChatContextData(chunk.data)) {
                directContextData = chunk.data;
              }
              break;
            case DirectChatDataChunkType.SessionMetrics:
              if (isDirectChatSessionMetrics(chunk.data)) {
                directSessionMetrics = chunk.data;
              }
              break;
            case 'text-start':
              {
                const result = turnState.startAssistant();
                if (!assistantMessageAdded && result.isNew) {
                  dispatch(
                    addMessage({
                      sessionId: currentSession.id,
                      message: result.message,
                    }),
                  );
                  assistantMessageAdded = true;
                  persistChatSnapshot();
                }
              }
              break;
            case 'text-delta':
              finishThinking();
              assistantContent += chunk.delta;
              {
                const result = turnState.appendAssistant(chunk.delta);
                if (!assistantMessageAdded && result.isNew) {
                  dispatch(
                    addMessage({
                      sessionId: currentSession.id,
                      message: result.message,
                    }),
                  );
                  assistantMessageAdded = true;
                } else {
                  contentBatcher.enqueue({
                    sessionId: currentSession.id,
                    messageId: assistantMsgId,
                    content: result.message.content,
                    metadata: result.message.metadata,
                  });
                }
              }
              persistChatSnapshot();
              break;
            case 'reasoning-start':
              {
                const result = turnState.startReasoning();
                if (result.isNew) {
                  dispatch(
                    addMessage({
                      sessionId: currentSession.id,
                      message: result.message,
                    }),
                  );
                  turnState.markReasoningMessageAdded();
                  persistChatSnapshot();
                }
              }
              break;
            case 'reasoning-delta':
              {
                const result = turnState.appendReasoning(chunk.delta);
                if (result.isNew) {
                  dispatch(
                    addMessage({
                      sessionId: currentSession.id,
                      message: result.message,
                    }),
                  );
                  turnState.markReasoningMessageAdded();
                } else {
                  contentBatcher.enqueue({
                    sessionId: currentSession.id,
                    messageId: result.message.id,
                    content: result.message.content,
                    metadata: result.message.metadata,
                  });
                }
              }
              break;
            case 'reasoning-end':
              finishThinking();
              persistChatSnapshot();
              break;
            case 'tool-input-available':
              finishThinking();
              dispatch(
                addMessage({
                  sessionId: currentSession.id,
                  message: turnState.addToolUse(
                    chunk.toolCallId,
                    chunk.input && typeof chunk.input === 'object'
                      ? (chunk.input as Record<string, unknown>)
                      : {},
                  ),
                }),
              );
              persistChatSnapshot();
              break;
            case 'tool-output-available':
              dispatch(
                addMessage({
                  sessionId: currentSession.id,
                  message: turnState.addToolResult(chunk.toolCallId, chunk.output),
                }),
              );
              persistChatSnapshot();
              break;
            case 'tool-output-error':
              dispatch(
                addMessage({
                  sessionId: currentSession.id,
                  message: turnState.addToolResult(chunk.toolCallId, undefined, chunk.errorText),
                }),
              );
              persistChatSnapshot();
              break;
            case 'error':
              throw new Error(chunk.errorText);
          }
        }
        contentBatcher.discard(currentSession.id, assistantMsgId);
        finishThinking();
        const finalStatus = abortController.signal.aborted
          ? CoworkSessionStatusValue.Idle
          : CoworkSessionStatusValue.Completed;
        // Finalize message metadata to prevent streaming replay on reload
        if (assistantMessageAdded) {
          const finalMetadata = {
            isStreaming: false,
            isFinal: true,
            ...(finalStatus === CoworkSessionStatusValue.Completed && { isFinalAnswer: true }),
            ...(directContextData
              ? {
                  contextUsage: {
                    contextWindowTokens: directContextData.contextWindowTokens,
                    updatedAt: Date.now(),
                    usedTokens: directContextData.usedTokens,
                  },
                  model: directChatModelId,
                  modelProviderKey: directChatModel.providerKey,
                  usage: {
                    inputTokens: directContextData.inputTokens,
                    outputTokens: directContextData.outputTokens,
                    ...(directContextData.cacheReadTokens !== undefined
                      ? { cacheReadTokens: directContextData.cacheReadTokens }
                      : {}),
                    ...(directContextData.cacheWriteTokens !== undefined
                      ? { cacheWriteTokens: directContextData.cacheWriteTokens }
                      : {}),
                    totalTokens: directContextData.usedTokens,
                  },
                }
              : {}),
            ...(directSessionMetrics ? { metrics: directSessionMetrics } : {}),
          };
          turnState.updateAssistantMetadata(finalMetadata);
          dispatch(
            updateMessageContent({
              sessionId: currentSession.id,
              messageId: assistantMsgId,
              content: assistantContent,
              metadata: finalMetadata,
            }),
          );
        }
        if (persistTimer) clearTimeout(persistTimer);
        dispatch(
          updateSessionStatus({
            sessionId: currentSession.id,
            status: finalStatus,
          }),
        );
        await coworkService.saveChatSession(buildChatSnapshot(finalStatus));
      } catch (error) {
        contentBatcher.discard(currentSession.id, assistantMsgId);
        finishThinking();
        // Finalize the partial answer so the turn does not render as still
        // streaming after the failure.
        if (assistantMessageAdded) {
          turnState.updateAssistantMetadata({ isStreaming: false, isFinal: true });
          dispatch(
            updateMessageContent({
              sessionId: currentSession.id,
              messageId: assistantMsgId,
              content: assistantContent,
              metadata: { isStreaming: false, isFinal: true },
            }),
          );
        }
        dispatch(updateSessionStatus({ sessionId: currentSession.id, status: 'error' }));
        dispatch(
          addMessage({
            sessionId: currentSession.id,
            message: {
              id: `error-${Date.now()}`,
              type: 'system',
              content: i18nService
                .t('chatErrorMessage')
                .replace('{error}', error instanceof Error ? error.message : 'Unknown error'),
              timestamp: Date.now(),
            },
          }),
        );
        if (persistTimer) clearTimeout(persistTimer);
        await coworkService
          .saveChatSession(buildChatSnapshot(CoworkSessionStatusValue.Error))
          .catch(saveError =>
            console.error('[CoworkView] Failed to persist failed chat continuation:', saveError),
          );
      } finally {
        if (persistTimer) clearTimeout(persistTimer);
        if (directChatAbortControllersRef.current.get(currentSession.id) === abortController) {
          directChatAbortControllersRef.current.delete(currentSession.id);
        }
        continuingSessionIdsRef.current.delete(currentSession.id);
      }
      return;
    }

    // Engine path: work sessions and agent-backed chat sessions
    continuingSessionIdsRef.current.add(currentSession.id);
    try {
      const sessionSkillIds = [...activeSkillIds];
      const isExpertAgent =
        currentAgent?.source === CoworkSessionExpertSource.Package ||
        currentAgent?.source === CoworkSessionExpertSource.Member;
      const agentSystemPrompt = isExpertAgent ? undefined : currentAgent?.systemPrompt?.trim();
      const baseSystemPrompt = agentSystemPrompt || config.systemPrompt || '';
      const combinedSystemPrompt = buildChatAgentSystemPrompt(skillPrompt, baseSystemPrompt);

      await coworkService.continueSession({
        sessionId: currentSession.id,
        prompt,
        systemPrompt: currentSession.systemPrompt || combinedSystemPrompt,
        activeSkillIds: sessionSkillIds,
        expertIds,
        permissionMode: sessionPermissionMode,
        goalMode,
        productionLoopMode,
        imageAttachments,
        fileAttachments,
      });
    } finally {
      continuingSessionIdsRef.current.delete(currentSession.id);
    }
  };

  const handleStopSession = async () => {
    if (!currentSession) return;
    // Stop the transport that actually started: a live direct-chat stream is
    // controlled by its per-session AbortController, so check for one first
    // instead of re-deriving the transport from mutable skill state (the user
    // can attach skills mid-stream, which would otherwise misroute the stop
    // to the engine and leave the direct stream running).
    const directChatController = directChatAbortControllersRef.current.get(currentSession.id);
    if (directChatController) {
      const interruptionId = crypto.randomUUID();
      directChatController.abort();
      dispatch(
        addMessage({
          sessionId: currentSession.id,
          message: {
            id: `interruption-${interruptionId}`,
            type: 'system',
            content: '',
            timestamp: Date.now(),
            metadata: {
              interruption: {
                sessionId: currentSession.id,
                interruptionId,
                cause: CoworkInterruptionCause.UserStop,
                taskId: null,
                recoverable: false,
              },
            },
          },
        }),
      );
      dispatch(
        updateSessionStatus({
          sessionId: currentSession.id,
          status: CoworkSessionStatusValue.Idle,
        }),
      );
      return;
    }
    if (currentSession.id.startsWith('temp-') && pendingStartRef.current) {
      pendingStartRef.current.cancelled = true;
      pendingStartRef.current.cancellationAction = 'stop';
    }
    await coworkService.stopSession(currentSession.id);
  };

  // Get selected quick action
  const selectedAction = React.useMemo(() => {
    const explicitlySelected = quickActions.find(action => action.id === selectedActionId);
    if (explicitlySelected) return explicitlySelected;

    // Skills can also be activated from the Chat sidebar or the skill badge.
    // In that path there is no quick-action selection event, so derive the
    // matching case panel from the active skill mapping.
    return quickActions.find(action =>
      quickActionSkillIds(action).every(skillId => activeSkillIds.includes(skillId)),
    );
  }, [activeSkillIds, quickActions, selectedActionId]);

  // Handle quick action button click and activate its complete Skill bundle.
  const handleActionSelect = (actionId: string) => {
    dispatch(selectAction(actionId));
    quickActionActivationRef.current = null;
    const action = quickActions.find(a => a.id === actionId);
    const skillIds = action ? quickActionSkillIds(action) : [];
    const skillsAvailable = skillIds.every(skillId =>
      skills.some(skill => skill.id === skillId && skill.enabled),
    );
    if (action && skillsAvailable) {
      quickActionActivationRef.current = actionId;
      dispatch(setActiveSkillIds(skillIds));
    } else {
      // Do not send a new quick-action prompt with skills left over from a
      // previous action when the requested bundle is unavailable.
      dispatch(clearActiveSkills());
    }
    window.setTimeout(() => {
      window.dispatchEvent(
        new CustomEvent('cowork:focus-input', { detail: { clear: true } }),
      );
    }, 0);
  };

  // Activate a mapped skill once it becomes available, and clear the quick action when
  // the user removes that skill from the input area.
  useEffect(() => {
    if (!selectedActionId) {
      quickActionActivationRef.current = null;
      return;
    }
    const action = quickActions.find(a => a.id === selectedActionId);
    if (!action) return;
    const skillIds = quickActionSkillIds(action);
    const skillsAvailable = skillIds.every(skillId =>
      skills.some(skill => skill.id === skillId && skill.enabled),
    );
    if (!skillsAvailable) return;

    if (quickActionActivationRef.current !== selectedActionId) {
      quickActionActivationRef.current = selectedActionId;
      if (!skillIds.every(skillId => activeSkillIds.includes(skillId))) {
        dispatch(setActiveSkillIds(skillIds));
      }
      return;
    }

    if (shouldClearQuickActionSelection(action, skills, activeSkillIds)) {
      dispatch(clearSelection());
    }
  }, [activeSkillIds, dispatch, quickActions, selectedActionId, skills]);

  // Handle prompt selection from QuickAction
  const handleQuickActionPromptSelect = (prompt: string) => {
    // Fill the prompt into input
    promptInputRef.current?.setValue(prompt);
    promptInputRef.current?.focus();
  };

  useEffect(() => {
    const handleNewSession = () => {
      // Only clear when already on home (no session) — preserve __home__ draft when returning from a session
      const shouldClear = !currentSession;
      dispatch(clearCurrentSession());
      dispatch(clearSelection());
      window.dispatchEvent(
        new CustomEvent('cowork:focus-input', {
          detail: { clear: shouldClear },
        }),
      );
    };
    window.addEventListener('cowork:shortcut:new-session', handleNewSession);
    return () => {
      window.removeEventListener('cowork:shortcut:new-session', handleNewSession);
    };
  }, [dispatch, currentSession]);

  useEffect(() => {
    if (!currentSession || currentSession.status !== 'running') return;

    const runningSessionId = currentSession.id;
    let lastFocusTime = 0;
    const FOCUS_DEBOUNCE_MS = 2000;

    const handleWindowFocus = () => {
      const now = Date.now();
      if (now - lastFocusTime < FOCUS_DEBOUNCE_MS) return;
      lastFocusTime = now;
      void coworkService.loadSession(runningSessionId);
    };

    window.addEventListener('focus', handleWindowFocus);
    return () => {
      window.removeEventListener('focus', handleWindowFocus);
    };
  }, [currentSession]);

  if (!isInitialized) {
    return (
      <div className="flex-1 h-full flex flex-col bg-background">
        <PageHeader />
        <div className="flex-1 flex items-center justify-center">
          <div className="text-muted-foreground">{i18nService.t('loading')}</div>
        </div>
      </div>
    );
  }

  const homeHeader = (
    <PageHeader
      isSidebarCollapsed={isSidebarCollapsed}
      onToggleSidebar={onToggleSidebar}
      onNewChat={onNewChat}
      updateBadge={updateBadge}
      actions={<SecurityStatusIndicator />}
    />
  );

  if (displayedSessionId) {
    return (
      <div className="flex-1 flex flex-col h-full">
        <CoworkSessionViewport
          sessionId={displayedSessionId}
          onManageSkills={() => onShowSkills?.()}
          onManageConnectors={() => onShowConnectors?.()}
          permissionMode={sessionPermissionMode}
          onPermissionModeChange={(mode: CoworkPermissionMode) => {
            if (!currentSession) return;
            void coworkService.updateConfig({
              permissionModeBySession: {
                ...(config.permissionModeBySession ?? {}),
                [currentSession.id]: mode,
              },
            });
          }}
          onContinue={handleContinueSession}
          onStop={handleStopSession}
          isSidebarCollapsed={isSidebarCollapsed}
          onToggleSidebar={onToggleSidebar}
          onNewChat={onNewChat}
          updateBadge={updateBadge}
          workMode={workMode}
          isDirectChat={workMode === WorkMode.Chat && !isAgentBackedChat}
          localThinkingEnabled={localThinkingEnabled}
          onLocalThinkingEnabledChange={setLocalThinkingEnabled}
          inlineQuestionPermission={inlineQuestionPermission}
          onRespondToInlineQuestion={onRespondToInlineQuestion}
          inlinePermission={inlinePermission}
          onRespondToInlinePermission={onRespondToInlinePermission}
          resumeTaskId={taskResume.interruption?.taskId}
          onResumeTask={taskResume.select}
          onCancelTaskResume={taskResume.cancel}
        />
      </div>
    );
  }

  // Home view - no current session
  return (
    <div className="flex-1 flex flex-col bg-background h-full">
      {/* Header */}
      {homeHeader}

      {/* Main Content */}
      <div className="flex-1 overflow-y-auto min-h-0 relative">
        <div className="relative mx-auto flex min-h-full w-full max-w-5xl min-w-[320px] flex-col items-center justify-center gap-10 px-4 py-8">
          {/* Welcome Section - staggered entrance animation */}
          <div className="flex min-h-28 flex-col items-center justify-center gap-5 text-center">
            <img
              src="zhiyuan-logo-light.svg"
              alt="logo"
              className="logo-light h-16 w-auto mx-auto animate-fade-in-up"
            />
            <img
              src="zhiyuan-logo-dark.svg"
              alt="logo"
              className="logo-dark h-16 w-auto mx-auto animate-fade-in-up"
            />
            <p
              className={cn(
                'min-h-5 max-w-md px-2 text-sm text-muted-foreground animate-fade-in-up',
                workMode === WorkMode.Chat && 'invisible',
              )}
              style={{ animationDelay: '120ms', animationFillMode: 'both' }}
            >
              {i18nService.t('coworkHomeSubtitle')}
            </p>
          </div>

          {/* Prompt Input Area - Large version with folder selector */}
          <div
            className="mx-auto flex w-full max-w-3xl flex-col gap-3 animate-fade-in-up"
            style={{ animationDelay: '200ms', animationFillMode: 'both' }}
          >
            <div className="rounded-2xl">
              <CoworkPromptInput
                ref={promptInputRef}
                onSubmit={handleStartSession}
                onStop={handleStopSession}
                isStreaming={isStreaming}
                disabled={false}
                placeholder={
                  workMode === WorkMode.Chat
                    ? i18nService.t(resolveSkillPlaceholderKey(activeSkillIds) ?? 'chatPlaceholder')
                    : i18nService.t('coworkPlaceholder')
                }
                size="large"
                workingDirectory={currentWorkspacePath}
                workingDirectoryName={currentWorkspaceDisplayName}
                onWorkingDirectoryChange={async (dir: string) => {
                  clearUnmanagedWorkingDirectory();
                  const workspace = await workspaceService.ensureWorkspace(dir);
                  if (workspace) await workspaceService.selectWorkspace(workspace.id);
                }}
                onUseNoFolder={async dir => {
                  const selected = await selectUnmanagedWorkingDirectory(dir);
                  if (!selected) {
                    window.dispatchEvent(
                      new CustomEvent('app:showToast', {
                        detail: i18nService.t('projectCreateFailed'),
                      }),
                    );
                  }
                }}
                showFolderSelector={workMode !== WorkMode.Chat && !currentWorkspace?.isHidden}
                showNoFolderAction={!currentWorkspaceId}
                showModelSelector
                isDirectChat={workMode === WorkMode.Chat && !isAgentBackedChat}
                showLocalThinkingToggle={workMode === WorkMode.Chat && !isAgentBackedChat}
                localThinkingEnabled={localThinkingEnabled}
                onLocalThinkingEnabledChange={setLocalThinkingEnabled}
                onManageSkills={() => onShowSkills?.()}
                onManageConnectors={() => onShowConnectors?.()}
                showPermissionModeSelector={workMode !== WorkMode.Chat}
                permissionMode={config.permissionMode}
                onPermissionModeChange={(mode: CoworkPermissionMode) => {
                  void coworkService.updateConfig({ permissionMode: mode });
                }}
              />
            </div>
          </div>

          {/* Quick Actions */}
          <div
            className="mx-auto flex w-full max-w-5xl flex-col gap-4 animate-fade-in-up"
            style={{ animationDelay: '300ms', animationFillMode: 'both' }}
          >
            {selectedAction ? (
              <PromptPanel action={selectedAction} onPromptSelect={handleQuickActionPromptSelect} />
            ) : (
              <QuickActionBar actions={quickActions} onActionSelect={handleActionSelect} />
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default CoworkView;
