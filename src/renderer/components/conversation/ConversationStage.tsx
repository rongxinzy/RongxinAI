import { cn } from '@shared/lib/utils';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';

import { agentService } from '../../services/agent';
import { coworkService } from '../../services/cowork';
import { i18nService } from '../../services/i18n';
import { quickActionService } from '../../services/quickAction';
import { showAppErrorToast } from '../../services/toastNotification';
import { workspaceService } from '../../services/workspace';
import type { RootState } from '../../store';
import {
  selectCoworkConfig,
  selectCurrentSession,
  selectDisplayedSessionId,
  selectIsStreaming,
  selectLoadingSessionId,
} from '../../store/selectors/coworkSelectors';
import { selectWorkMode } from '../../store/selectors/workModeSelectors';
import { clearCurrentSession, requestPromptFocus } from '../../store/slices/coworkSlice';
import {
  ArtifactLayoutMode,
  selectIsSessionArtifactPanelOpen,
  selectSessionArtifactLayoutMode,
  togglePanel,
} from '../../store/slices/artifactSlice';
import { clearSelection, selectAction, setActions } from '../../store/slices/quickActionSlice';
import { clearActiveSkills, setActiveSkillIds } from '../../store/slices/skillSlice';
import { WorkMode } from '../../store/workMode/constants';
import type { CoworkPermissionRequest, CoworkPermissionResult } from '../../types/cowork';
import { homeGreetingKey } from '../../utils/homeGreeting';
import { isScratchWorkspacePath } from '../../utils/path';
import { resolveSessionDisplayTitle } from '../../utils/sessionTitle';
import { resolveSkillPlaceholderKey } from '../chat/constants';
import { CoworkSessionLayout } from '../cowork/CoworkSessionLayout';
import { CoworkConversationLoadingSkeleton } from '../cowork/CoworkSessionLoadingState';
import SecurityStatusIndicator from '../cowork/SecurityStatusIndicator';
import { useAgentSelectedModel } from '../cowork/agentModelSelection';
import { CoworkRunStatus } from '../cowork/components/CoworkRunStatus';
import { useCoworkSessionActions } from '../cowork/hooks/useCoworkSessionActions';
import { PromptDraftKey } from '../cowork/promptInput/constants';
import type { CoworkPromptInputProps, CoworkPromptInputRef } from '../cowork/promptInput/types';
import { useUnmanagedWorkingDirectory } from '../cowork/useUnmanagedWorkingDirectory';
import { PromptPanel, QuickActionBar } from '../quick-actions';
import {
  quickActionSkillIds,
  shouldClearQuickActionSelection,
} from '../quick-actions/quickActionSelection';
import type { SettingsOpenOptions } from '../settings/types';
import { StageComposer } from './composer/StageComposer';

// Keep Streamdown, Shiki, KaTeX, Mermaid and @pierre/diffs out of the cold Home startup bundle.
let sessionStagePromise: Promise<typeof import('./SessionStage')> | null = null;
const loadSessionStage = () => {
  sessionStagePromise ??= import('./SessionStage');
  return sessionStagePromise;
};
const SessionTranscriptStage = React.lazy(() =>
  loadSessionStage().then(module => ({ default: module.SessionTranscriptStage })),
);
const SessionArtifactSidePane = React.lazy(() =>
  loadSessionStage().then(module => ({ default: module.SessionArtifactSidePane })),
);

export interface ConversationStageProps {
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

/**
 * Unified Cowork/Chat stage: renders the Quiet Studio home view with quick-action
 * starters when no session is selected, and switches seamlessly into the lazy
 * `SessionStage` transcript surface once a conversation begins or loads.
 */
const ConversationStage: React.FC<ConversationStageProps> = ({
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
  const [isInitialized, setIsInitialized] = useState(false);
  const promptInputRef = useRef<CoworkPromptInputRef>(null);
  const detailRootRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const contentRowRef = useRef<HTMLDivElement>(null);
  const quickActionActivationRef = useRef<string | null>(null);

  const currentSession = useSelector(selectCurrentSession);
  const displayedSessionId = useSelector(selectDisplayedSessionId);
  const loadingSessionId = useSelector(selectLoadingSessionId);
  const workMode = useSelector(selectWorkMode);
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
  const defaultConversationWorkspace = workspaces.find(
    workspace => !workspace.isHidden && isScratchWorkspacePath(workspace.path),
  );

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

  const sessionPermissionMode = currentSession
    ? (config.permissionModeBySession?.[currentSession.id] ?? config.permissionMode)
    : config.permissionMode;

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

  const { handleStartSession, handleContinueSession, handleStopSession } = useCoworkSessionActions({
    currentSession,
    workMode,
    currentAgent,
    currentAgentId,
    currentAgentSelectedModel,
    currentWorkspacePath,
    currentWorkspaceId,
    activeSkillIds,
    isStreaming,
    config,
    sessionPermissionMode,
    clearUnmanagedWorkingDirectory,
    onRequestAppSettings,
  });

  useEffect(() => {
    const init = async () => {
      await coworkService.init();
      await agentService.loadAgents();
      try {
        quickActionService.initialize();
        const actions = await quickActionService.getLocalizedActions();
        dispatch(setActions(actions));
      } catch (error) {
        console.error('Failed to load quick actions:', error);
      }
      setIsInitialized(true);
    };
    void init();

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

  const selectedAction = useMemo(() => {
    const explicitlySelected = quickActions.find(action => action.id === selectedActionId);
    if (explicitlySelected) return explicitlySelected;
    return quickActions.find(action =>
      quickActionSkillIds(action).every(skillId => activeSkillIds.includes(skillId)),
    );
  }, [activeSkillIds, quickActions, selectedActionId]);

  const handleActionSelect = (actionId: string) => {
    dispatch(selectAction(actionId));
    quickActionActivationRef.current = null;
    const action = quickActions.find(item => item.id === actionId);
    const skillIds = action ? quickActionSkillIds(action) : [];
    const skillsAvailable = skillIds.every(skillId =>
      skills.some(skill => skill.id === skillId && skill.enabled),
    );
    if (action && skillsAvailable) {
      quickActionActivationRef.current = actionId;
      dispatch(setActiveSkillIds(skillIds));
    } else {
      dispatch(clearActiveSkills());
    }
    dispatch(requestPromptFocus({ draftKey: PromptDraftKey.Home, clear: false }));
  };

  useEffect(() => {
    if (!selectedActionId) {
      quickActionActivationRef.current = null;
      return;
    }
    const action = quickActions.find(item => item.id === selectedActionId);
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

  const handleQuickActionPromptSelect = (prompt: string) => {
    promptInputRef.current?.setValue(prompt);
    promptInputRef.current?.focus();
  };

  useEffect(() => {
    const handleNewSession = () => {
      const shouldClear = !displayedSessionId;
      dispatch(clearCurrentSession());
      dispatch(clearSelection());
      dispatch(requestPromptFocus({ draftKey: PromptDraftKey.Home, clear: shouldClear }));
    };
    window.addEventListener('cowork:shortcut:new-session', handleNewSession);
    return () => {
      window.removeEventListener('cowork:shortcut:new-session', handleNewSession);
    };
  }, [dispatch, displayedSessionId]);

  useEffect(() => {
    if (!currentSession || !isStreaming) return;
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
  }, [currentSession, isStreaming]);

  const homeComposerProps: CoworkPromptInputProps = {
    onSubmit: handleStartSession,
    onStop: handleStopSession,
    isStreaming,
    disabled: false,
    placeholder: i18nService.t(
      workMode === WorkMode.Chat
        ? (resolveSkillPlaceholderKey(activeSkillIds) ?? 'chatPlaceholder')
        : 'coworkPlaceholder',
    ),
    size: 'large',
    workingDirectory: currentWorkspacePath,
    workingDirectoryName: currentWorkspaceDisplayName,
    onWorkingDirectoryChange: async dir => {
      clearUnmanagedWorkingDirectory();
      const workspace = await workspaceService.ensureWorkspace(dir);
      if (workspace) await workspaceService.selectWorkspace(workspace.id);
    },
    onCreateProject: async (dir, name) => {
      clearUnmanagedWorkingDirectory();
      const workspace = await workspaceService.createWorkspace(dir, name);
      if (!workspace) return false;
      await workspaceService.selectWorkspace(workspace.id);
      return true;
    },
    onUseNoFolder: async dir => {
      if (!(await selectUnmanagedWorkingDirectory(dir)))
        showAppErrorToast(i18nService.t('projectCreateFailed'));
    },
    showFolderSelector: workMode !== WorkMode.Chat && !currentWorkspace?.isHidden,
    showNoFolderAction: !currentWorkspaceId,
    showModelSelector: true,
    onManageModels: onRequestAppSettings
      ? () => onRequestAppSettings({ initialTab: 'models' })
      : undefined,
    onManageSkills: () => onShowSkills?.(),
    onManageConnectors: () => onShowConnectors?.(),
    showPermissionModeSelector: workMode !== WorkMode.Chat,
    permissionMode: config.permissionMode,
    onPermissionModeChange: mode => {
      void coworkService.updateConfig({ permissionMode: mode });
    },
  };

  const isPanelOpen = useSelector((state: RootState) =>
    selectIsSessionArtifactPanelOpen(state, currentSession?.id),
  );
  const artifactLayoutMode = useSelector((state: RootState) =>
    selectSessionArtifactLayoutMode(state, currentSession?.id),
  );
  const isHome = !displayedSessionId;
  const isWaitingSession =
    !isHome &&
    ((loadingSessionId === displayedSessionId && currentSession?.id !== displayedSessionId) ||
      !currentSession);
  const isArtifactWorkspace = artifactLayoutMode === ArtifactLayoutMode.Workspace;
  const isTranscriptHidden = !isHome && !isWaitingSession && isArtifactWorkspace;
  const sessionTitle = currentSession
    ? resolveSessionDisplayTitle(currentSession, i18nService.getLanguage()) ||
      i18nService.t('coworkNewSession')
    : i18nService.t('coworkNewSession');

  return (
    <CoworkSessionLayout
      mode={isHome ? 'home' : 'session'}
      divider={!isHome}
      homeActions={
        workMode === WorkMode.Chat ? undefined : (
          <SecurityStatusIndicator permissionMode={config.permissionMode} />
        )
      }
      title={
        isHome
          ? i18nService.t(workMode === WorkMode.Chat ? 'newChat' : 'newTaskTitle')
          : sessionTitle
      }
      sessionId={currentSession?.id}
      isSessionSwitching={isWaitingSession}
      isSidebarCollapsed={isSidebarCollapsed}
      isArtifactPanelOpen={isPanelOpen}
      onToggleSidebar={onToggleSidebar}
      onNewChat={onNewChat}
      onToggleArtifactPanel={() => dispatch(togglePanel())}
      updateBadge={updateBadge}
      runIndicator={
        isWaitingSession || !currentSession ? null : (
          <CoworkRunStatus
            key={currentSession.id}
            sessionId={currentSession.id}
            isStreaming={isStreaming}
          />
        )
      }
    >
      <div ref={contentRowRef} className="flex flex-1 overflow-hidden">
        <div
          ref={detailRootRef}
          data-page-canvas
          className={cn(
            'relative flex h-full min-w-0 flex-1 flex-col bg-background',
            isHome ? 'overflow-y-auto pb-12' : 'overflow-hidden',
            isTranscriptHidden && 'hidden',
          )}
          aria-hidden={isTranscriptHidden || undefined}
        >
          {isHome ? (
            <div className="w-full shrink-0">
              <div aria-hidden className="min-h-[max(24px,calc(36vh-9.5rem))]" />
              <div className="mx-auto flex w-full max-w-4xl min-w-0 flex-col items-center px-6 pb-8 pt-2">
                <div className="flex flex-col items-center justify-center gap-3 text-center">
                  <h1 className="theme-home-greeting max-w-2xl text-balance">
                    {i18nService.t(homeGreetingKey())}
                  </h1>
                  <p
                    className={cn(
                      'theme-home-caption max-w-md px-2 text-pretty',
                      workMode === WorkMode.Chat && 'invisible',
                    )}
                  >
                    {i18nService.t('coworkHomeSubtitle')}
                  </p>
                </div>
              </div>
            </div>
          ) : (
            <div className="relative min-h-0 flex-1">
              {isWaitingSession ? (
                <CoworkConversationLoadingSkeleton />
              ) : (
                <React.Suspense fallback={<CoworkConversationLoadingSkeleton />}>
                  <SessionTranscriptStage
                    scrollContainerRef={scrollContainerRef}
                    promptInputRef={promptInputRef}
                    inlineQuestionPermission={inlineQuestionPermission}
                    onRespondToInlineQuestion={onRespondToInlineQuestion}
                    inlinePermission={inlinePermission}
                    onRespondToInlinePermission={onRespondToInlinePermission}
                  />
                </React.Suspense>
              )}
            </div>
          )}

          {/* Single persistent StageComposer anchored at a stable React child index */}
          <div
            className={cn(
              'shrink-0',
              isHome
                ? 'mx-auto w-full max-w-[calc(48rem+3rem)] px-6'
                : 'mx-auto w-full max-w-[calc(56rem+2rem)] min-w-[320px] px-4',
            )}
          >
            <div className={isHome ? 'min-w-0' : 'theme-composer-backdrop relative min-w-0'}>
              <StageComposer
                homeProps={homeComposerProps}
                inputRef={promptInputRef}
                displayedSessionId={displayedSessionId}
                onContinue={handleContinueSession}
                sessionPermissionMode={sessionPermissionMode}
                onSessionPermissionModeChange={mode => {
                  if (!currentSession) return;
                  void coworkService.updateConfig({
                    permissionModeBySession: {
                      ...(config.permissionModeBySession ?? {}),
                      [currentSession.id]: mode,
                    },
                  });
                }}
                awaitingQuestion={Boolean(inlineQuestionPermission && onRespondToInlineQuestion)}
                awaitingPermission={Boolean(inlinePermission)}
              />
            </div>
          </div>

          {isHome ? (
            <div className="mx-auto mt-8 flex w-full max-w-4xl shrink-0 flex-col gap-4 px-6 pb-8">
              {!selectedAction ? (
                <QuickActionBar actions={quickActions} onActionSelect={handleActionSelect} />
              ) : (
                <PromptPanel
                  action={selectedAction}
                  onPromptSelect={handleQuickActionPromptSelect}
                />
              )}
            </div>
          ) : null}
        </div>

        {!isHome && !isWaitingSession && displayedSessionId ? (
          <React.Suspense fallback={null}>
            <SessionArtifactSidePane
              displayedSessionId={displayedSessionId}
              contentRowRef={contentRowRef}
            />
          </React.Suspense>
        ) : null}
      </div>
    </CoworkSessionLayout>
  );
};

export default ConversationStage;
