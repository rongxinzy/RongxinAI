import { Button } from '@shared/components/ui/button';
import { PanelLeft, Pencil, ShieldCheck } from 'lucide-react';
import React, { useEffect, useRef, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';

import { buildSessionTitleFromInput } from '../../../common/sessionTitle';
import { CoworkSessionExpertSource } from '../../../shared/cowork/sessionExperts';
import { agentService } from '../../services/agent';
import { ChatChatTransport } from '../../services/chatChatTransport';
import { coworkService } from '../../services/cowork';
import { i18nService } from '../../services/i18n';
import { quickActionService } from '../../services/quickAction';
import { workspaceService } from '../../services/workspace';
import { RootState, store } from '../../store';
import {
  selectCoworkConfig,
  selectCurrentSession,
  selectIsStreaming,
} from '../../store/selectors/coworkSelectors';
import { selectWorkMode } from '../../store/selectors/workModeSelectors';
import {
  addMessage,
  addSession,
  clearCurrentSession,
  setCurrentSession,
  setStreaming,
  updateMessageContent,
  updateSessionStatus,
} from '../../store/slices/coworkSlice';
import { clearSelection, selectAction, setActions } from '../../store/slices/quickActionSlice';
import { setActiveSkillIds } from '../../store/slices/skillSlice';
import { WorkMode } from '../../store/workMode/constants';
import type {
  CoworkImageAttachment,
  CoworkSession,
  OpenClawEngineStatus,
} from '../../types/cowork';
import { toOpenClawModelRef } from '../../utils/openclawModelRef';
import { PromptPanel, QuickActionBar } from '../quick-actions';
import type { SettingsOpenOptions } from '../Settings';
import WindowTitleBar from '../window/WindowTitleBar';
import { useAgentSelectedModel } from './agentModelSelection';
import CoworkPromptInput, { type CoworkPromptInputRef } from './CoworkPromptInput';
import CoworkSessionDetail from './CoworkSessionDetail';

export interface CoworkViewProps {
  onRequestAppSettings?: (options?: SettingsOpenOptions) => void;
  onShowSkills?: () => void;
  isSidebarCollapsed?: boolean;
  onToggleSidebar?: () => void;
  onNewChat?: () => void;
  updateBadge?: React.ReactNode;
}

const CoworkView: React.FC<CoworkViewProps> = ({
  onRequestAppSettings,
  onShowSkills,
  isSidebarCollapsed,
  onToggleSidebar,
  onNewChat,
  updateBadge,
}) => {
  const dispatch = useDispatch();

  // ── RAF-batch content buffer ──
  // Chat-mode text-delta/reasoning-delta dispatches are throttled
  // through a Map keyed by messageId. Each key always holds the
  // latest content for that message; a single rAF flushes all keys
  // at most once per frame. This prevents flooding Redux on fast
  // streams (which caused Maximum update depth exceeded crashes).
  const contentBuffer = useRef(new Map<
    string,
    { sessionId: string; messageId: string; content: string; metadata?: Record<string, unknown> }
  >()).current;
  const contentRafRef = useRef<number | null>(null);
  const flushContentBuffer = React.useCallback(() => {
    // Already scheduled — latest content for each messageId is already buffered.
    if (contentRafRef.current !== null) return;
    contentRafRef.current = requestAnimationFrame(() => {
      contentRafRef.current = null;
      const snapshot = Array.from(contentBuffer.values());
      contentBuffer.clear();
      for (const u of snapshot) {
        dispatch(updateMessageContent(u));
      }
    });
  }, [dispatch, contentBuffer]);
  const isMac = window.electron.platform === 'darwin';
  const [isInitialized, setIsInitialized] = useState(false);
  const [openClawStatus, setOpenClawStatus] = useState<OpenClawEngineStatus | null>(null);
  const [isRestartingGateway, setIsRestartingGateway] = useState(false);
  // Track if we're starting/continuing a session to prevent duplicate submissions
  const isStartingRef = useRef(false);
  const isContinuingRef = useRef(false);
  // Track pending start request so stop can cancel delayed startup.
  const pendingStartRef = useRef<{
    requestId: number;
    cancelled: boolean;
    cancellationAction: 'stop' | 'delete' | null;
  } | null>(null);
  const startRequestIdRef = useRef(0);
  // Ref for CoworkPromptInput
  const promptInputRef = useRef<CoworkPromptInputRef>(null);

  const [localThinkingEnabled, setLocalThinkingEnabled] = useState<boolean | undefined>();

  const currentSession = useSelector(selectCurrentSession);
  const workMode = useSelector(selectWorkMode);
  const directChatModelId = useSelector((state: RootState) => state.model.defaultSelectedModel.id);

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
  const currentWorkspacePath = currentWorkspace?.path || config.workingDirectory || '';

  const currentAgentSelectedModel = useAgentSelectedModel(
    currentAgentId,
    currentAgent?.model ?? '',
  );

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

  const resolveEngineStatusText = (status: OpenClawEngineStatus): string => {
    switch (status.phase) {
      case 'not_installed':
        return i18nService.t('coworkOpenClawNotInstalledNotice');
      case 'installing':
        return i18nService.t('coworkOpenClawInstalling');
      case 'ready':
        return i18nService.t('coworkOpenClawReadyNotice');
      case 'starting':
      case 'compiling':
        return status.message || i18nService.t('coworkOpenClawStarting');
      case 'error':
        return i18nService.t('coworkOpenClawError');
      case 'running':
      default:
        return i18nService.t('coworkOpenClawRunning');
    }
  };

  const handleRestartGateway = async () => {
    if (isRestartingGateway) return;
    setIsRestartingGateway(true);
    try {
      await coworkService.restartOpenClawGateway();
    } catch (error) {
      console.error('[CoworkView] Failed to restart gateway:', error);
    } finally {
      setIsRestartingGateway(false);
    }
  };

  useEffect(() => {
    const init = async () => {
      await coworkService.init();
      await agentService.loadAgents();
      const initialEngineStatus = await coworkService.getOpenClawEngineStatus();
      if (initialEngineStatus) {
        setOpenClawStatus(initialEngineStatus);
      }
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

    const unsubscribeOpenClawStatus = coworkService.onOpenClawEngineStatus(status => {
      setOpenClawStatus(status);
    });

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
      unsubscribeOpenClawStatus();
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
    expertIds: string[] = [],
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
    // Prevent duplicate submissions
    if (isStartingRef.current) return;
    isStartingRef.current = true;
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
          isStartingRef.current = false;
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
        modelOverride: currentAgentSelectedModel
          ? toOpenClawModelRef(currentAgentSelectedModel)
          : '',
        executionMode: config.executionMode || 'local',
        activeSkillIds: sessionSkillIds,
        workspaceId: currentWorkspaceId || '',
        agentId: currentAgentId,
        messages: [
          {
            id: `msg-${now}`,
            type: 'user',
            content: prompt,
            timestamp: now,
            metadata:
              sessionSkillIds.length > 0 || (imageAttachments && imageAttachments.length > 0)
                ? {
                    ...(sessionSkillIds.length > 0 ? { skillIds: sessionSkillIds } : {}),
                    ...(imageAttachments && imageAttachments.length > 0
                      ? { imageAttachments }
                      : {}),
                  }
                : undefined,
          },
        ],
        messagesOffset: 0,
        totalMessages: 1,
      };

      // Chat sessions use the temporary session as their UI identity
      // until the direct model stream finishes. Add it to the sidebar now so
      // the user's message is visible in history immediately after submit.
      if (workMode === WorkMode.Chat) {
        dispatch(addSession(tempSession));
      } else {
        // Work sessions are added after the backend creates their real session.
        dispatch(setCurrentSession(tempSession));
      }
      dispatch(setStreaming(true));

      // Clear quick action selection after starting session
      dispatch(clearSelection());

      // Chat mode: direct LLM via apiService, skip PI/OpenClaw
      if (workMode === WorkMode.Chat) {
        const assistantMsgId = `msg-${now}-assistant`;
        const thinkingMsgId = `msg-${now}-thinking`;
        let assistantContent = '';
        let thinkingContent = '';
        let assistantMessageAdded = false;
        let thinkingMessageAdded = false;
        let persistTimer: ReturnType<typeof setTimeout> | null = null;
        const persistChatSnapshot = (force = false) => {
          const persist = () => {
            persistTimer = null;
            const snapshot = store.getState().cowork.currentSession;
            if (snapshot?.id === tempSessionId) {
              void coworkService
                .saveChatSession(snapshot)
                .catch(error => console.error('[CoworkView] Failed to persist chat session:', error));
            }
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
            modelId: directChatModelId,
            localThinkingEnabled,
          });
          const stream = await transport.sendMessages({
            trigger: 'submit-message',
            chatId: tempSessionId,
            messageId: undefined,
            messages: [{ id: `msg-${now}`, role: 'user', parts: [{ type: 'text', text: prompt }] }],
            abortSignal: undefined,
          });
          const reader = stream.getReader();
          while (true) {
            const { done, value: chunk } = await reader.read();
            if (done || isPendingStartCancelled()) break;
            if (!chunk) continue;
            switch (chunk.type) {
              case 'text-start':
                if (!assistantMessageAdded) {
                  dispatch(
                    addMessage({
                      sessionId: tempSessionId,
                      message: {
                        id: assistantMsgId,
                        type: 'assistant',
                        content: '',
                        timestamp: Date.now(),
                        metadata: { isStreaming: true, isFinal: false },
                      },
                    }),
                  );
                  assistantMessageAdded = true;
                  persistChatSnapshot();
                }
                break;
              case 'text-delta':
                assistantContent += chunk.delta;
                if (!assistantMessageAdded) {
                  dispatch(
                    addMessage({
                      sessionId: tempSessionId,
                      message: {
                        id: assistantMsgId,
                        type: 'assistant',
                        content: chunk.delta,
                        timestamp: Date.now(),
                        metadata: { isStreaming: true, isFinal: false },
                      },
                    }),
                  );
                  assistantMessageAdded = true;
                } else {
                  contentBuffer.set(assistantMsgId, {
                    sessionId: tempSessionId,
                    messageId: assistantMsgId,
                    content: assistantContent,
                    metadata: { isStreaming: true, isFinal: false },
                  });
                  flushContentBuffer();
                }
                persistChatSnapshot();
                break;
              case 'reasoning-start':
                if (!thinkingMessageAdded) {
                  dispatch(
                    addMessage({
                      sessionId: tempSessionId,
                      message: {
                        id: thinkingMsgId,
                        type: 'assistant',
                        content: '',
                        timestamp: Date.now(),
                        metadata: { isStreaming: true, isFinal: false, isThinking: true },
                      },
                    }),
                  );
                  thinkingMessageAdded = true;
                  persistChatSnapshot();
                }
                break;
              case 'reasoning-delta':
                thinkingContent += chunk.delta;
                if (!thinkingMessageAdded) {
                  dispatch(
                    addMessage({
                      sessionId: tempSessionId,
                      message: {
                        id: thinkingMsgId,
                        type: 'assistant',
                        content: chunk.delta,
                        timestamp: Date.now(),
                        metadata: { isStreaming: true, isFinal: false, isThinking: true },
                      },
                    }),
                  );
                  thinkingMessageAdded = true;
                } else {
                  contentBuffer.set(thinkingMsgId, {
                    sessionId: tempSessionId,
                    messageId: thinkingMsgId,
                    content: thinkingContent,
                    metadata: { isStreaming: true, isFinal: false, isThinking: true },
                  });
                  flushContentBuffer();
                }
                persistChatSnapshot();
                break;
              case 'error':
                throw new Error(chunk.errorText);
            }
          }
          if (isPendingStartCancelled()) {
            dispatch(updateSessionStatus({ sessionId: tempSessionId, status: 'idle' }));
            persistChatSnapshot(true);
            dispatch(setStreaming(false));
            return;
          }
          // Build the final session with complete messages (user + thinking + assistant)
          // so that addSession does not overwrite currentSession with stale data.
          const finalMessages = [
            { id: `msg-${now}`, type: 'user' as const, content: prompt, timestamp: now },
            ...(thinkingContent
              ? [
                  {
                    id: thinkingMsgId,
                    type: 'assistant' as const,
                    content: thinkingContent,
                    timestamp: Date.now(),
                    metadata: { isStreaming: false, isFinal: true, isThinking: true },
                  },
                ]
              : []),
            ...(assistantContent
              ? [
                  {
                    id: assistantMsgId,
                    type: 'assistant' as const,
                    content: assistantContent,
                    timestamp: Date.now(),
                    metadata: { isStreaming: false, isFinal: true },
                  },
                ]
              : []),
          ];
          const savedSession: CoworkSession = {
            ...tempSession,
            status: 'completed' as const,
            updatedAt: Date.now(),
            messages: finalMessages,
            totalMessages: finalMessages.length,
          };
          dispatch(updateSessionStatus({ sessionId: tempSessionId, status: 'completed' }));
          dispatch(addSession(savedSession));
          // Persist chat session to SQLite via IPC
          persistChatSnapshot(true);
        } catch (error) {
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
          persistChatSnapshot(true);
        } finally {
          if (persistTimer) clearTimeout(persistTimer);
          dispatch(setStreaming(false));
          isStartingRef.current = false;
        }
        return;
      }

      // Work mode: use coworkService (PI/OpenClaw engines)
      // Combine skill prompt with system prompt.
      // OpenClaw loads skills natively via skills.load.extraDirs, so skip the
      // auto-routing prompt to avoid injecting Claude SDK tool-calling instructions
      // that confuse non-Claude models (e.g. kimi-k2.5 falls back to text-based
      // tool calls, producing empty tool names and err=true failures).
      const isExpertAgent =
        currentAgent?.source === CoworkSessionExpertSource.Package ||
        currentAgent?.source === CoworkSessionExpertSource.Member;
      const agentSystemPrompt = isExpertAgent ? undefined : currentAgent?.systemPrompt?.trim();
      const baseSystemPrompt = agentSystemPrompt || config.systemPrompt || '';
      const combinedSystemPrompt =
        [skillPrompt, baseSystemPrompt].filter(p => p?.trim()).join('\n\n') || undefined;

      // Start the actual session immediately with fallback title
      const sessionModelOverride = currentAgentSelectedModel
        ? toOpenClawModelRef(currentAgentSelectedModel)
        : '';
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
        activeSkillIds: sessionSkillIds,
        workspaceId: currentWorkspaceId || undefined,
        agentId: currentAgentId,
        expertIds,
        modelOverride: sessionModelOverride,
        imageAttachments,
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
      isStartingRef.current = false;
    }
  };

  const handleContinueSession = async (
    prompt: string,
    skillPrompt?: string,
    imageAttachments?: CoworkImageAttachment[],
    expertIds: string[] = [],
  ) => {
    if (!currentSession) return;
    if (isContinuingRef.current) return;

    // Chat mode: direct LLM via apiService
    if (workMode === WorkMode.Chat) {
      isContinuingRef.current = true;
      const assistantMsgId = `msg-${Date.now()}-assistant`;
      const thinkingMsgId = `msg-${Date.now()}-thinking`;
      let assistantMessageAdded = false;
      let thinkingMessageAdded = false;
      let persistTimer: ReturnType<typeof setTimeout> | null = null;
      const persistChatSnapshot = (force = false) => {
        const persist = () => {
          persistTimer = null;
          const snapshot = store.getState().cowork.currentSession;
          if (snapshot?.id === currentSession.id) {
            void coworkService
              .saveChatSession(snapshot)
              .catch(error => console.error('[CoworkView] Failed to persist chat continue:', error));
          }
        };
        if (force) {
          if (persistTimer) clearTimeout(persistTimer);
          persist();
        } else if (!persistTimer) {
          persistTimer = setTimeout(persist, 250);
        }
      };
      try {
        // Add user message to session first
        const userMsgId = `msg-${Date.now()}`;
        dispatch(
          addMessage({
            sessionId: currentSession.id,
            message: {
              id: userMsgId,
              type: 'user',
              content: prompt,
              timestamp: Date.now(),
            },
          }),
        );
        const initialSnapshot = store.getState().cowork.currentSession;
        if (initialSnapshot?.id === currentSession.id) {
          await coworkService.saveChatSession(initialSnapshot);
        }

        dispatch(setStreaming(true));
        const transport = new ChatChatTransport({
          modelId: directChatModelId,
          localThinkingEnabled,
        });
        const stream = await transport.sendMessages({
          trigger: 'submit-message',
          chatId: currentSession.id,
          messageId: undefined,
          messages: (currentSession.messages || [])
            .filter(m => m.type === 'user' || m.type === 'assistant')
            .map(m => ({
              id: m.id,
              role: m.type as 'user' | 'assistant',
              parts: [{ type: 'text' as const, text: m.content }],
            }))
            .concat({
              id: userMsgId,
              role: 'user' as const,
              parts: [{ type: 'text' as const, text: prompt }],
            }),
          abortSignal: undefined,
        });
        const reader = stream.getReader();
        let assistantContent = '';
        let thinkingContent = '';
        while (true) {
          const { done, value: chunk } = await reader.read();
          if (done) break;
          if (!chunk) continue;
          switch (chunk.type) {
            case 'text-start':
              if (!assistantMessageAdded) {
                dispatch(
                  addMessage({
                    sessionId: currentSession.id,
                    message: {
                      id: assistantMsgId,
                      type: 'assistant',
                      content: '',
                      timestamp: Date.now(),
                      metadata: { isStreaming: true, isFinal: false },
                    },
                  }),
                );
                assistantMessageAdded = true;
                persistChatSnapshot();
              }
              break;
            case 'text-delta':
              assistantContent += chunk.delta;
              if (!assistantMessageAdded) {
                dispatch(
                  addMessage({
                    sessionId: currentSession.id,
                    message: {
                      id: assistantMsgId,
                      type: 'assistant',
                      content: chunk.delta,
                      timestamp: Date.now(),
                      metadata: { isStreaming: true, isFinal: false },
                    },
                  }),
                );
                assistantMessageAdded = true;
              } else {
                contentBuffer.set(assistantMsgId, {
                  sessionId: currentSession.id,
                  messageId: assistantMsgId,
                  content: assistantContent,
                  metadata: { isStreaming: true, isFinal: false },
                });
                flushContentBuffer();
              }
              persistChatSnapshot();
              break;
            case 'reasoning-start':
              if (!thinkingMessageAdded) {
                dispatch(
                  addMessage({
                    sessionId: currentSession.id,
                    message: {
                      id: thinkingMsgId,
                      type: 'assistant',
                      content: '',
                      timestamp: Date.now(),
                      metadata: { isStreaming: true, isFinal: false, isThinking: true },
                    },
                  }),
                );
                thinkingMessageAdded = true;
                persistChatSnapshot();
              }
              break;
            case 'reasoning-delta':
              thinkingContent += chunk.delta;
              if (!thinkingMessageAdded) {
                dispatch(
                  addMessage({
                    sessionId: currentSession.id,
                    message: {
                      id: thinkingMsgId,
                      type: 'assistant',
                      content: chunk.delta,
                      timestamp: Date.now(),
                      metadata: { isStreaming: true, isFinal: false, isThinking: true },
                    },
                  }),
                );
                thinkingMessageAdded = true;
              } else {
                contentBuffer.set(thinkingMsgId, {
                  sessionId: currentSession.id,
                  messageId: thinkingMsgId,
                  content: thinkingContent,
                  metadata: { isStreaming: true, isFinal: false, isThinking: true },
                });
                flushContentBuffer();
              }
              persistChatSnapshot();
              break;
            case 'error':
              throw new Error(chunk.errorText);
          }
        }
        // Finalize message metadata to prevent streaming replay on reload
        if (assistantMessageAdded) {
          dispatch(
            updateMessageContent({
              sessionId: currentSession.id,
              messageId: assistantMsgId,
              content: assistantContent,
              metadata: { isStreaming: false, isFinal: true },
            }),
          );
        }
        if (thinkingMessageAdded) {
          dispatch(
            updateMessageContent({
              sessionId: currentSession.id,
              messageId: thinkingMsgId,
              content: thinkingContent,
              metadata: { isStreaming: false, isFinal: true, isThinking: true },
            }),
          );
        }
        dispatch(updateSessionStatus({ sessionId: currentSession.id, status: 'completed' }));
        // Persist updated session (with new messages) to SQLite
        persistChatSnapshot(true);
      } catch (error) {
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
        dispatch(updateSessionStatus({ sessionId: currentSession.id, status: 'error' }));
        persistChatSnapshot(true);
      } finally {
        if (persistTimer) clearTimeout(persistTimer);
        dispatch(setStreaming(false));
        isContinuingRef.current = false;
      }
      return;
    }

    // Work mode: use coworkService
    isContinuingRef.current = true;
    try {
      const sessionSkillIds = [...activeSkillIds];
      const isExpertAgent =
        currentAgent?.source === CoworkSessionExpertSource.Package ||
        currentAgent?.source === CoworkSessionExpertSource.Member;
      const agentSystemPrompt = isExpertAgent ? undefined : currentAgent?.systemPrompt?.trim();
      const baseSystemPrompt = agentSystemPrompt || config.systemPrompt || '';
      const combinedSystemPrompt =
        [skillPrompt, baseSystemPrompt].filter(p => p?.trim()).join('\n\n') || undefined;

      await coworkService.continueSession({
        sessionId: currentSession.id,
        prompt,
        systemPrompt: currentSession.systemPrompt || combinedSystemPrompt,
        activeSkillIds: sessionSkillIds.length > 0 ? sessionSkillIds : undefined,
        expertIds,
        imageAttachments,
      });
    } finally {
      isContinuingRef.current = false;
    }
  };

  const handleStopSession = async () => {
    if (!currentSession) return;
    if (workMode === WorkMode.Chat) {
      dispatch(setStreaming(false));
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
    return quickActions.find(action => action.id === selectedActionId);
  }, [quickActions, selectedActionId]);

  // Handle quick action button click: select action + activate skill in one batch
  const handleActionSelect = (actionId: string) => {
    dispatch(selectAction(actionId));
    const action = quickActions.find(a => a.id === actionId);
    if (action) {
      const targetSkill = skills.find(s => s.id === action.skillMapping);
      if (targetSkill) {
        dispatch(setActiveSkillIds([targetSkill.id]));
      }
    }
  };

  // When the mapped skill is deactivated from input area, restore the QuickActionBar
  useEffect(() => {
    if (!selectedActionId) return;
    const action = quickActions.find(a => a.id === selectedActionId);
    if (action) {
      const skillStillActive = activeSkillIds.includes(action.skillMapping);
      if (!skillStillActive) {
        dispatch(clearSelection());
      }
    }
  }, [activeSkillIds, dispatch, quickActions, selectedActionId]);

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
        <div className="draggable flex h-12 items-center justify-end px-4 border-b border-border shrink-0">
          <WindowTitleBar inline />
        </div>
        <div className="flex-1 flex items-center justify-center">
          <div className="text-muted-foreground">{i18nService.t('loading')}</div>
        </div>
      </div>
    );
  }

  const shouldShowEngineStatus = Boolean(openClawStatus && openClawStatus.phase !== 'running');
  const isEngineError = openClawStatus?.phase === 'error';

  const homeHeader = (
    <div className="draggable flex h-12 items-center justify-between px-4 border-b border-border shrink-0">
      <div className="non-draggable h-8 flex items-center">
        {isSidebarCollapsed && (
          <div className={`flex items-center gap-1 mr-2 ${isMac ? 'pl-[68px]' : ''}`}>
            <Button variant="ghost" size="icon" onClick={onToggleSidebar}>
              <PanelLeft className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="icon" onClick={onNewChat}>
              <Pencil className="h-4 w-4" />
            </Button>
            {updateBadge}
          </div>
        )}
      </div>
      <div className="non-draggable flex items-center">
        <div className="flex items-center gap-1.5 mr-2 px-2.5 py-1">
          <ShieldCheck className="h-3.5 w-3.5 text-green-600 dark:text-green-400" />
          <span className="text-xs text-green-600 dark:text-green-400 whitespace-nowrap">
            {i18nService.t('zhiyuanGuardEnabled')}
          </span>
        </div>
        <WindowTitleBar inline />
      </div>
    </div>
  );

  // Engine status banner for error/non-running states (starting overlay is now global in App.tsx)
  const engineStatusBanner =
    shouldShowEngineStatus &&
    openClawStatus &&
    openClawStatus.phase !== 'starting' &&
    openClawStatus.phase !== 'compiling' &&
    openClawStatus.phase !== 'error' ? (
      <div
        className={`shrink-0 flex items-center justify-between px-4 py-2 text-xs ${
          isEngineError
            ? 'bg-red-50 text-red-700 dark:bg-red-950/30 dark:text-red-300'
            : 'bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-300'
        }`}
      >
        <div className="flex items-center gap-2">
          <span>{resolveEngineStatusText(openClawStatus)}</span>
          {typeof openClawStatus.progressPercent === 'number' && (
            <span className="opacity-70">({Math.round(openClawStatus.progressPercent)}%)</span>
          )}
        </div>
        <Button
          variant={isEngineError ? 'destructive' : 'default'}
          size="xs"
          onClick={handleRestartGateway}
          disabled={isRestartingGateway}
        >
          {i18nService.t('coworkOpenClawRestartGateway')}
        </Button>
      </div>
    ) : null;

  // When there's a current session, show the session detail view
  if (currentSession) {
    return (
      <div className="flex-1 flex flex-col h-full">
        {engineStatusBanner}
        <CoworkSessionDetail
          onManageSkills={() => onShowSkills?.()}
          onContinue={handleContinueSession}
          onStop={handleStopSession}
          isSidebarCollapsed={isSidebarCollapsed}
          onToggleSidebar={onToggleSidebar}
          onNewChat={onNewChat}
          updateBadge={updateBadge}
          workMode={workMode}
          isDirectChat={workMode === WorkMode.Chat}
          localThinkingEnabled={localThinkingEnabled}
          onLocalThinkingEnabledChange={setLocalThinkingEnabled}
        />
      </div>
    );
  }

  // Home view - no current session
  return (
    <div className="flex-1 flex flex-col bg-background h-full">
      {/* Engine status banner for error states */}
      {engineStatusBanner}

      {/* Header */}
      {homeHeader}

      {/* Main Content */}
      <div className="flex-1 overflow-y-auto min-h-0 relative">
        <div className="relative max-w-5xl w-full min-w-[320px] mx-auto px-4 pt-[15vh] pb-8 space-y-10">
          {/* Welcome Section - staggered entrance animation */}
          <div className="text-center space-y-5">
            <img src="logo.png" alt="logo" className="h-16 w-auto mx-auto animate-fade-in-up" />
            {workMode === WorkMode.Work && (
              <p
                className="text-sm text-muted-foreground max-w-md mx-auto animate-fade-in-up"
                style={{ animationDelay: '120ms', animationFillMode: 'both' }}
              >
                全面链接本地文件，让生活和工作更智能
              </p>
            )}
          </div>

          {/* Prompt Input Area - Large version with folder selector */}
          <div
            className="max-w-3xl mx-auto w-full space-y-3 animate-fade-in-up"
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
                    ? i18nService.t('chatPlaceholder')
                    : i18nService.t('coworkPlaceholder')
                }
                size="large"
                workingDirectory={currentWorkspacePath}
                onWorkingDirectoryChange={async (dir: string) => {
                  const workspace = await workspaceService.ensureWorkspace(dir);
                  if (workspace) await workspaceService.selectWorkspace(workspace.id);
                }}
                showFolderSelector={workMode !== WorkMode.Chat}
                showModelSelector
                isDirectChat={workMode === WorkMode.Chat}
                showLocalThinkingToggle={workMode === WorkMode.Chat}
                localThinkingEnabled={localThinkingEnabled}
                onLocalThinkingEnabledChange={setLocalThinkingEnabled}
                onManageSkills={() => onShowSkills?.()}
              />
            </div>
          </div>

          {/* Quick Actions */}
          <div
            className="max-w-3xl mx-auto w-full space-y-4 animate-fade-in-up"
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
