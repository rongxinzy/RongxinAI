import { Button } from '@shared/components/ui/button';
import { PanelLeft, Pencil, ShieldCheck } from 'lucide-react';
import React, { useEffect, useRef,useState } from 'react';
import { useDispatch,useSelector } from 'react-redux';

import { buildSessionTitleFromInput } from '../../../common/sessionTitle';
import { agentService } from '../../services/agent';
import { ChatChatTransport } from '../../services/chatChatTransport';
import { configService } from '../../services/config';
import { coworkService } from '../../services/cowork';
import { i18nService } from '../../services/i18n';
import { quickActionService } from '../../services/quickAction';
import { RootState } from '../../store';
import {
  selectCoworkConfig,
  selectCurrentSession,
  selectIsStreaming,
} from '../../store/selectors/coworkSelectors';
import { addMessage, addSession, clearCurrentSession, setCurrentSession, setStreaming, updateMessageContent, updateSessionStatus } from '../../store/slices/coworkSlice';
import { clearSelection,selectAction, setActions } from '../../store/slices/quickActionSlice';
import { setActiveSkillIds } from '../../store/slices/skillSlice';
import type { CoworkImageAttachment, CoworkSession, OpenClawEngineStatus } from '../../types/cowork';
import { toOpenClawModelRef } from '../../utils/openclawModelRef';
import { PromptPanel,QuickActionBar } from '../quick-actions';
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

const CoworkView: React.FC<CoworkViewProps> = ({ onRequestAppSettings, onShowSkills, isSidebarCollapsed, onToggleSidebar, onNewChat, updateBadge }) => {
  const dispatch = useDispatch();
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

  const [workMode, setWorkMode] = useState<'work' | 'chat'>(
    () => configService.getConfig().workMode ?? 'work'
  );

  useEffect(() => {
    const handler = () => setWorkMode(configService.getConfig().workMode ?? 'work');
    window.addEventListener('config-updated', handler);
    return () => window.removeEventListener('config-updated', handler);
  }, []);

  const currentSession = useSelector(selectCurrentSession);

  // Clear session when workMode changes and current session mode doesn't match.
  // Sessions without an explicit mode field (legacy) are treated as work mode.
  const prevWorkModeRef = useRef(workMode);
  useEffect(() => {
    if (prevWorkModeRef.current !== workMode) {
      prevWorkModeRef.current = workMode;
      const sessionMode = currentSession?.mode || 'work';
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
  const currentAgent = agents.find((agent) => agent.id === currentAgentId);
  const currentAgentWorkingDirectory = currentAgent?.workingDirectory?.trim() || config.workingDirectory || '';

  const currentAgentSelectedModel = useAgentSelectedModel(currentAgentId, currentAgent?.model ?? '');

  const buildApiConfigNotice = (error?: string): { noticeI18nKey: string; noticeExtra?: string } => {
    const key = 'coworkModelSettingsRequired';
    if (!error) {
      return { noticeI18nKey: key };
    }
    const normalizedError = error.trim();
    if (
      normalizedError.startsWith('No enabled provider found for model:')
      || normalizedError === 'No available model configured in enabled providers.'
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

  const isOpenClawReadyForSession = (status: OpenClawEngineStatus | null): boolean => {
    if (!status) return false;
    return status.phase === 'running' || status.phase === 'ready';
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

    const unsubscribeOpenClawStatus = coworkService.onOpenClawEngineStatus((status) => {
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

  const handleStartSession = async (prompt: string, skillPrompt?: string, imageAttachments?: CoworkImageAttachment[]): Promise<boolean | void> => {
    console.log('[CoworkView] handleStartSession: imageAttachments diagnosis', {
      hasImageAttachments: !!imageAttachments,
      count: imageAttachments?.length ?? 0,
      details: imageAttachments?.map(a => ({ name: a.name, mimeType: a.mimeType, base64Length: a.base64Data?.length ?? 0 })) ?? [],
    });
    if (workMode !== 'chat' && openClawStatus && !isOpenClawReadyForSession(openClawStatus)) {
      window.dispatchEvent(new CustomEvent('app:showToast', { detail: i18nService.t('coworkErrorEngineNotReady') }));
      return false;
    }
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
        i18nService.t('coworkDefaultSessionTitle')
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
        cwd: currentAgentWorkingDirectory,
        systemPrompt: '',
        modelOverride: currentAgentSelectedModel ? toOpenClawModelRef(currentAgentSelectedModel) : '',
        executionMode: config.executionMode || 'local',
        activeSkillIds: sessionSkillIds,
        agentId: currentAgentId,
        messages: [
          {
            id: `msg-${now}`,
            type: 'user',
            content: prompt,
            timestamp: now,
            metadata: (sessionSkillIds.length > 0 || (imageAttachments && imageAttachments.length > 0))
              ? {
                ...(sessionSkillIds.length > 0 ? { skillIds: sessionSkillIds } : {}),
                ...(imageAttachments && imageAttachments.length > 0 ? { imageAttachments } : {}),
              }
              : undefined,
          },
        ],
        messagesOffset: 0,
        totalMessages: 1,
      };

      // Immediately show the session detail page with user message
      dispatch(setCurrentSession(tempSession));
      dispatch(setStreaming(true));

      // Clear quick action selection after starting session
      dispatch(clearSelection());

      // Chat mode: direct LLM via apiService, skip PI/OpenClaw
      if (workMode === 'chat') {
        const assistantMsgId = `msg-${now}-assistant`;
        const thinkingMsgId = `msg-${now}-thinking`;
        let assistantContent = '';
        let thinkingContent = '';
        let assistantMessageAdded = false;
        let thinkingMessageAdded = false;
        try {
          const transport = new ChatChatTransport(currentAgentSelectedModel?.id);
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
                  dispatch(addMessage({ sessionId: tempSessionId, message: { id: assistantMsgId, type: 'assistant', content: '', timestamp: Date.now(), metadata: { isStreaming: true, isFinal: false } } }));
                  assistantMessageAdded = true;
                }
                break;
              case 'text-delta':
                assistantContent += chunk.delta;
                if (!assistantMessageAdded) {
                  dispatch(addMessage({ sessionId: tempSessionId, message: { id: assistantMsgId, type: 'assistant', content: chunk.delta, timestamp: Date.now(), metadata: { isStreaming: true, isFinal: false } } }));
                  assistantMessageAdded = true;
                } else {
                  dispatch(updateMessageContent({ sessionId: tempSessionId, messageId: assistantMsgId, content: assistantContent, metadata: { isStreaming: true, isFinal: false } }));
                }
                break;
              case 'reasoning-start':
                if (!thinkingMessageAdded) {
                  dispatch(addMessage({ sessionId: tempSessionId, message: { id: thinkingMsgId, type: 'assistant', content: '', timestamp: Date.now(), metadata: { isStreaming: true, isFinal: false, isThinking: true } } }));
                  thinkingMessageAdded = true;
                }
                break;
              case 'reasoning-delta':
                thinkingContent += chunk.delta;
                if (!thinkingMessageAdded) {
                  dispatch(addMessage({ sessionId: tempSessionId, message: { id: thinkingMsgId, type: 'assistant', content: chunk.delta, timestamp: Date.now(), metadata: { isStreaming: true, isFinal: false, isThinking: true } } }));
                  thinkingMessageAdded = true;
                } else {
                  dispatch(updateMessageContent({ sessionId: tempSessionId, messageId: thinkingMsgId, content: thinkingContent, metadata: { isStreaming: true, isFinal: false, isThinking: true } }));
                }
                break;
              case 'error':
                throw new Error(chunk.errorText);
            }
          }
          if (isPendingStartCancelled()) {
            dispatch(updateSessionStatus({ sessionId: tempSessionId, status: 'idle' }));
            dispatch(setStreaming(false));
            return;
          }
          // Build the final session with complete messages (user + thinking + assistant)
          // so that addSession does not overwrite currentSession with stale data.
          const finalMessages = [
            { id: `msg-${now}`, type: 'user' as const, content: prompt, timestamp: now },
            ...(thinkingContent ? [{ id: thinkingMsgId, type: 'assistant' as const, content: thinkingContent, timestamp: Date.now(), metadata: { isStreaming: false, isFinal: true, isThinking: true } }] : []),
            ...(assistantContent ? [{ id: assistantMsgId, type: 'assistant' as const, content: assistantContent, timestamp: Date.now(), metadata: { isStreaming: false, isFinal: true } }] : []),
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
          coworkService.saveChatSession(savedSession).catch(err =>
            console.error('[CoworkView] Failed to persist chat session:', err)
          );
        } catch (error) {
          dispatch(updateSessionStatus({ sessionId: tempSessionId, status: 'error' }));
          dispatch(addMessage({
            sessionId: tempSessionId,
            message: {
              id: `error-${Date.now()}`,
              type: 'system',
              content: i18nService.t('chatErrorMessage').replace('{error}', error instanceof Error ? error.message : 'Unknown error'),
              timestamp: Date.now(),
            },
          }));
        } finally {
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
      const combinedSystemPrompt = [skillPrompt, config.systemPrompt]
        .filter(p => p?.trim())
        .join('\n\n') || undefined;

      // Start the actual session immediately with fallback title
      const sessionModelOverride = currentAgentSelectedModel ? toOpenClawModelRef(currentAgentSelectedModel) : '';
      console.log('[CoworkView] creating session:', { modelId: currentAgentSelectedModel?.id, providerKey: currentAgentSelectedModel?.providerKey, isServerModel: currentAgentSelectedModel?.isServerModel, sessionModelOverride, agentModel: currentAgent?.model });
      const { session: startedSession, error: startError } = await coworkService.startSession({
        prompt,
        title: fallbackTitle,
        cwd: currentAgentWorkingDirectory || undefined,
        systemPrompt: combinedSystemPrompt,
        activeSkillIds: sessionSkillIds,
        agentId: currentAgentId,
        modelOverride: sessionModelOverride,
        imageAttachments,
      });

      if (!startedSession && startError) {
        // Show the error as a system message in the temp session
        dispatch(addMessage({
          sessionId: tempSessionId,
          message: {
            id: `error-${Date.now()}`,
            type: 'system',
            content: i18nService.t('coworkErrorSessionStartFailed').replace('{error}', startError),
            timestamp: Date.now(),
          },
        }));
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

  const handleContinueSession = async (prompt: string, skillPrompt?: string, imageAttachments?: CoworkImageAttachment[]) => {
    if (!currentSession) return;
    if (isContinuingRef.current) return;

    // Chat mode: direct LLM via apiService
    if (workMode === 'chat') {
      isContinuingRef.current = true;
      const assistantMsgId = `msg-${Date.now()}-assistant`;
      const thinkingMsgId = `msg-${Date.now()}-thinking`;
      let assistantMessageAdded = false;
      let thinkingMessageAdded = false;
      try {
        // Add user message to session first
        const userMsgId = `msg-${Date.now()}`;
        dispatch(addMessage({
          sessionId: currentSession.id,
          message: {
            id: userMsgId,
            type: 'user',
            content: prompt,
            timestamp: Date.now(),
          },
        }));

        dispatch(setStreaming(true));
        const transport = new ChatChatTransport(currentAgentSelectedModel?.id);
        const stream = await transport.sendMessages({
          trigger: 'submit-message',
          chatId: currentSession.id,
          messageId: undefined,
          messages: (currentSession.messages || []).filter(m => m.type === 'user' || m.type === 'assistant').map(m => ({
            id: m.id, role: m.type as 'user' | 'assistant', parts: [{ type: 'text' as const, text: m.content }],
          })).concat({ id: userMsgId, role: 'user' as const, parts: [{ type: 'text' as const, text: prompt }] }),
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
                dispatch(addMessage({ sessionId: currentSession.id, message: { id: assistantMsgId, type: 'assistant', content: '', timestamp: Date.now(), metadata: { isStreaming: true, isFinal: false } } }));
                assistantMessageAdded = true;
              }
              break;
            case 'text-delta':
              assistantContent += chunk.delta;
              if (!assistantMessageAdded) {
                dispatch(addMessage({ sessionId: currentSession.id, message: { id: assistantMsgId, type: 'assistant', content: chunk.delta, timestamp: Date.now(), metadata: { isStreaming: true, isFinal: false } } }));
                assistantMessageAdded = true;
              } else {
                dispatch(updateMessageContent({ sessionId: currentSession.id, messageId: assistantMsgId, content: assistantContent, metadata: { isStreaming: true, isFinal: false } }));
              }
              break;
            case 'reasoning-start':
              if (!thinkingMessageAdded) {
                dispatch(addMessage({ sessionId: currentSession.id, message: { id: thinkingMsgId, type: 'assistant', content: '', timestamp: Date.now(), metadata: { isStreaming: true, isFinal: false, isThinking: true } } }));
                thinkingMessageAdded = true;
              }
              break;
            case 'reasoning-delta':
              thinkingContent += chunk.delta;
              if (!thinkingMessageAdded) {
                dispatch(addMessage({ sessionId: currentSession.id, message: { id: thinkingMsgId, type: 'assistant', content: chunk.delta, timestamp: Date.now(), metadata: { isStreaming: true, isFinal: false, isThinking: true } } }));
                thinkingMessageAdded = true;
              } else {
                dispatch(updateMessageContent({ sessionId: currentSession.id, messageId: thinkingMsgId, content: thinkingContent, metadata: { isStreaming: true, isFinal: false, isThinking: true } }));
              }
              break;
            case 'error':
              throw new Error(chunk.errorText);
          }
        }
        dispatch(updateSessionStatus({ sessionId: currentSession.id, status: 'completed' }));
      } catch (error) {
        dispatch(updateSessionStatus({ sessionId: currentSession.id, status: 'error' }));
        dispatch(addMessage({
          sessionId: currentSession.id,
          message: {
            id: `error-${Date.now()}`,
            type: 'system',
            content: i18nService.t('chatErrorMessage').replace('{error}', error instanceof Error ? error.message : 'Unknown error'),
            timestamp: Date.now(),
          },
        }));
        dispatch(updateSessionStatus({ sessionId: currentSession.id, status: 'error' }));
      } finally {
        dispatch(setStreaming(false));
        isContinuingRef.current = false;
      }
      return;
    }

    // Work mode: use coworkService
    if (openClawStatus && !isOpenClawReadyForSession(openClawStatus)) {
      window.dispatchEvent(new CustomEvent('app:showToast', { detail: i18nService.t('coworkErrorEngineNotReady') }));
      return false;
    }

    isContinuingRef.current = true;
    try {
      const sessionSkillIds = [...activeSkillIds];
      const combinedSystemPrompt = [skillPrompt, config.systemPrompt]
        .filter(p => p?.trim())
        .join('\n\n') || undefined;

      await coworkService.continueSession({
        sessionId: currentSession.id,
        prompt,
        systemPrompt: combinedSystemPrompt,
        activeSkillIds: sessionSkillIds.length > 0 ? sessionSkillIds : undefined,
        imageAttachments,
      });
    } finally {
      isContinuingRef.current = false;
    }
  };

  const handleStopSession = async () => {
    if (!currentSession) return;
    if (workMode === 'chat') {
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
      window.dispatchEvent(new CustomEvent('cowork:focus-input', {
        detail: { clear: shouldClear },
      }));
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
          <div className="text-muted-foreground">
            {i18nService.t('loading')}
          </div>
        </div>
      </div>
    );
  }

  const shouldShowEngineStatus = Boolean(openClawStatus && openClawStatus.phase !== 'running');
  const isEngineError = openClawStatus?.phase === 'error';
  const isEngineReady = isOpenClawReadyForSession(openClawStatus);

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
            {i18nService.t('lobsterGuardEnabled')}
          </span>
        </div>
        <WindowTitleBar inline />
      </div>
    </div>
  );

  // Engine status banner for error/non-running states (starting overlay is now global in App.tsx)
  const engineStatusBanner = shouldShowEngineStatus && openClawStatus && openClawStatus.phase !== 'starting' && openClawStatus.phase !== 'compiling' && openClawStatus.phase !== 'error' ? (
    <div className={`shrink-0 flex items-center justify-between px-4 py-2 text-xs ${isEngineError
      ? 'bg-red-50 text-red-700 dark:bg-red-950/30 dark:text-red-300'
      : 'bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-300'
    }`}>
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
            <img src="logo.png" alt="logo" className="w-16 h-16 mx-auto animate-fade-in-up" />
            <h2
              className="text-3xl font-bold tracking-tight text-foreground animate-fade-in-up"
              style={{ animationDelay: '60ms', animationFillMode: 'both' }}
            >
              {i18nService.t('coworkWelcome')}
            </h2>
            <p
              className="text-sm text-muted-foreground max-w-md mx-auto animate-fade-in-up"
              style={{ animationDelay: '120ms', animationFillMode: 'both' }}
            >
              {i18nService.t('coworkDescription')}
            </p>
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
                disabled={workMode === 'chat' ? false : !isEngineReady}
                placeholder={workMode === 'chat' ? i18nService.t('chatPlaceholder') : i18nService.t('coworkPlaceholder')}
                size="large"
                workingDirectory={currentAgentWorkingDirectory}
                onWorkingDirectoryChange={async (dir: string) => {
                  await agentService.updateAgent(currentAgentId, { workingDirectory: dir });
                }}
                showFolderSelector={workMode !== 'chat'}
                showModelSelector
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
              <PromptPanel
                action={selectedAction}
                onPromptSelect={handleQuickActionPromptSelect}
              />
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
