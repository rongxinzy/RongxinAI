import { configService } from '../../services/config';
import { cn } from '@shared/lib/utils';
import React, { useEffect, useRef, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';

import { buildSessionTitleFromInput } from '../../../common/sessionTitle';
import {
  CoworkPermissionMode,
  CoworkSessionMode,
  CoworkSessionSource,
} from '../../../shared/cowork/constants';
import { CoworkSessionExpertSource } from '../../../shared/cowork/sessionExperts';
import { agentService } from '../../services/agent';
import { buildChatAgentSystemPrompt } from '../../services/chatExecutionRouter';
import {
  isChatSkillShortcutSelection,
  resolveChatSkillShortcutPermissionMode,
  resolveSkillPlaceholderKey,
} from '../chat/constants';
import { coworkService } from '../../services/cowork';
import { coworkQueueService } from '../../services/coworkQueue';
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
  updateMessageContents,
  updateSessionStatus,
} from '../../store/slices/coworkSlice';
import { clearSelection, selectAction, setActions } from '../../store/slices/quickActionSlice';
import { clearActiveSkills, setActiveSkillIds } from '../../store/slices/skillSlice';
import { WorkMode } from '../../store/workMode/constants';
import {
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
  const startingSessionIdsRef = useRef(new Set<string>());
  const continuingSessionIdsRef = useRef(new Set<string>());
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


  const currentSession = useSelector(selectCurrentSession);
  const taskResume = useTaskResumeContext(currentSession?.id);
  const displayedSessionId = useSelector(selectDisplayedSessionId);
  const workMode = useSelector(selectWorkMode);
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
        // Finish configuration repair before main-process availability checks.
        await configService.init();
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
        // Finish configuration repair before main-process availability checks.
        await configService.init();
        const apiConfig = await coworkService.checkApiConfig();
        if (apiConfig && !apiConfig.hasConfig) {
          onRequestAppSettings?.({
            initialTab: 'model',
            ...buildApiConfigNotice(apiConfig.error),
          });
          startingSessionIdsRef.current.delete(startSessionKey);
          return false;
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

      // Chat sessions stay tagged as chat sessions while every turn executes
      // through the Pi agent runtime.
      const isChatAgentExecution = workMode === WorkMode.Chat;

      const tempSession: CoworkSession = {
        id: tempSessionId,
        title: fallbackTitle,
        claudeSessionId: null,
        status: 'idle',
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

      // Keep the temporary session in the list while the backend creates its
      // persistent Pi session, so attachments and the initial prompt remain
      // visible if startup takes time or fails.
      dispatch(addSession(tempSession));
      // Clear quick action selection after starting session
      dispatch(clearSelection());

      // Engine path: Work and Chat sessions. The engine loads skills natively via
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

      // Chat hides the folder selector, so the engine relies on
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
      const sessionPermissionMode = shouldAutoAllowChatSkill
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
      const { session: startedSession, error: startError } = await coworkService.startSession(
        {
          prompt,
          title: fallbackTitle,
          cwd: currentWorkspacePath || undefined,
          systemPrompt: combinedSystemPrompt,
          // Chat stays tagged as a chat session so it remains in the Chat
          // sidebar list; Work sessions keep the default work mode.
          mode: isChatAgentExecution ? CoworkSessionMode.Chat : CoworkSessionMode.Work,
          activeSkillIds: sessionSkillIds,
          workspaceId: currentWorkspaceId || undefined,
          agentId: currentAgentId,
          expertIds,
          goalMode,
          modelOverride: sessionModelOverride,
          permissionMode: sessionPermissionMode,
          imageAttachments,
          fileAttachments,
        },
        tempSessionId,
      );

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
  ) => {
    if (!currentSession) return;
    if (taskResume.interruption) {
      return taskResume.resume({
        amendment: prompt,
        skillIds: [...activeSkillIds],
        expertIds,
        goalMode,
        imageAttachments: imageAttachments
          ?.filter(
            (image): image is CoworkImageAttachment & { base64Data: string } =>
              typeof image.base64Data === 'string',
          )
          .map(image => ({
            name: image.name,
            mimeType: image.mimeType,
            base64Data: image.base64Data,
          })),
        fileAttachments,
      });
    }
    if (continuingSessionIdsRef.current.has(currentSession.id)) return;

    // Work keeps the prompt editable while Pi is running. Normal input during
    // a live Work turn becomes an ordered Follow-up item; Chat uses Pi's
    // regular continuation path.
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

    // Pi continuation path for Work and Chat sessions.
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
        imageAttachments,
        fileAttachments,
      });
    } finally {
      continuingSessionIdsRef.current.delete(currentSession.id);
    }
  };

  const handleStopSession = async () => {
    if (!currentSession) return;
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
      // 2026/09/16 lixiang  选择快捷操作时保留已输入的 prompt，只聚焦输入框
      window.dispatchEvent(new CustomEvent('cowork:focus-input', { detail: { clear: false } }));
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
      <div data-page-canvas className="flex-1 h-full flex flex-col bg-background">
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
          inlineQuestionPermission={inlineQuestionPermission}
          onRespondToInlineQuestion={onRespondToInlineQuestion}
          inlinePermission={inlinePermission}
          onRespondToInlinePermission={onRespondToInlinePermission}
          resumeTaskId={taskResume.interruption?.taskId}
          resumeDisabled={taskResume.isResuming} // 2026/09/17 lixiang  恢复中禁用继续执行，避免重复点击
          onResumeTask={taskResume.select}
          onCancelTaskResume={taskResume.cancel}
        />
      </div>
    );
  }

  // Home view - no current session
  return (
    <div data-page-canvas className="flex-1 flex flex-col bg-background h-full">
      {/* Header */}
      {homeHeader}

      {/* Main Content */}
      <div className="flex-1 overflow-y-auto min-h-0 relative">
        {/* Spacer. The case gallery is far taller than the viewport, so the brand block
            and the input cannot be centred as one column: centring the column would let
            the gallery drag the input up under the page header as soon as a category is
            open. This spacer holds the input on the visible area's vertical middle
            instead, and the gallery flows straight after the input the way the
            reference homepage does. 15.5rem = brand block (7rem) + hero gap (2.5rem) +
            the input block's sticky top padding (0.5rem) + half the prompt input
            (5.5rem). */}
        <div aria-hidden className="min-h-[max(0px,calc(50%-15.5rem))]" />

        <div className="mx-auto flex w-full max-w-5xl min-w-[320px] flex-col items-center gap-10 px-4">
          {/* Welcome Section and the prompt input share one sticky layer: once the
              cases start scrolling, the brand mark and the input both stay on screen
              instead of sliding away with the list. The layer is opaque and full
              width so the cases pass behind it rather than through it. It sits in the
              same column as the list, which is the box the sticky range is measured
              against, so it holds all the way to the last case. */}
          <div className="sticky top-0 z-10 flex w-full flex-col items-center gap-10 bg-background pt-2 pb-2">
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
                      ? i18nService.t(
                          resolveSkillPlaceholderKey(activeSkillIds) ?? 'chatPlaceholder',
                        )
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
                  onCreateProject={async (dir, name) => {
                    clearUnmanagedWorkingDirectory();
                    const workspace = await workspaceService.createWorkspace(dir, name);
                    if (!workspace) return false;
                    await workspaceService.selectWorkspace(workspace.id);
                    return true;
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
          </div>

          {/* Quick Actions. The category bar is the entry point only: once a category is
              open the cases own the column, so the bar steps aside instead of sitting on
              top of the gallery. The gallery shares the column with the input on purpose:
              that is the box the input's sticky positioning is measured against, so the
              cases can scroll all the way to the end while the input stays in place. */}
          <div
            className="flex w-full flex-col gap-4 pb-8 animate-fade-in-up"
            style={{ animationDelay: '300ms', animationFillMode: 'both' }}
          >
            {!selectedAction && (
              <QuickActionBar actions={quickActions} onActionSelect={handleActionSelect} />
            )}
            {selectedAction && (
              <PromptPanel action={selectedAction} onPromptSelect={handleQuickActionPromptSelect} />
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default CoworkView;
