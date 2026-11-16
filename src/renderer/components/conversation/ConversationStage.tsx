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
import { clearCurrentSession } from '../../store/slices/coworkSlice';
import { clearSelection, selectAction, setActions } from '../../store/slices/quickActionSlice';
import { clearActiveSkills, setActiveSkillIds } from '../../store/slices/skillSlice';
import { WorkMode } from '../../store/workMode/constants';
import type { CoworkPermissionRequest, CoworkPermissionResult } from '../../types/cowork';
import { homeGreetingKey } from '../../utils/homeGreeting';
import { isScratchWorkspacePath } from '../../utils/path';
import PageHeader from '../PageHeader';
import { resolveSkillPlaceholderKey } from '../chat/constants';
import { CoworkSessionColdStartSkeleton } from '../cowork/CoworkSessionLoadingState';
import SecurityStatusIndicator from '../cowork/SecurityStatusIndicator';
import { useAgentSelectedModel } from '../cowork/agentModelSelection';
import { useCoworkSessionActions } from '../cowork/hooks/useCoworkSessionActions';
import type { CoworkPromptInputRef } from '../cowork/promptInput/types';
import { useUnmanagedWorkingDirectory } from '../cowork/useUnmanagedWorkingDirectory';
import { PromptPanel, QuickActionBar } from '../quick-actions';
import {
  quickActionSkillIds,
  shouldClearQuickActionSelection,
} from '../quick-actions/quickActionSelection';
import type { SettingsOpenOptions } from '../settings/types';
import { StageComposer } from './composer/StageComposer';
import { usePersistentComposer } from './composer/usePersistentComposer';
import type { CoworkPromptInputProps } from '../cowork/promptInput/types';

// Keep Streamdown, Shiki, KaTeX, Mermaid and @pierre/diffs out of the cold Home startup bundle.
const loadSessionStage = () => import('./SessionStage');
const sessionStagePromise = loadSessionStage();
const SessionStage = React.lazy(() => sessionStagePromise);

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
  const { rootRef, slotRef, renderComposer } = usePersistentComposer();
  const [isInitialized, setIsInitialized] = useState(false);
  const promptInputRef = useRef<CoworkPromptInputRef>(null);
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
    window.setTimeout(() => {
      window.dispatchEvent(new CustomEvent('cowork:focus-input', { detail: { clear: false } }));
    }, 0);
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

  const sessionFallback = <CoworkSessionColdStartSkeleton composer={<div ref={slotRef} />} />;
  const waitingCold =
    displayedSessionId && loadingSessionId === displayedSessionId && !currentSession;
  return (
    <div ref={rootRef} className="relative flex h-full min-h-0 flex-1 flex-col">
      {displayedSessionId ? (
        <div className="flex h-full min-h-0 flex-1 flex-col bg-background">
          <React.Suspense fallback={sessionFallback}>
            {waitingCold ? (
              sessionFallback
            ) : (
              <SessionStage
                displayedSessionId={displayedSessionId}
                composerSlotRef={slotRef}
                promptInputRef={promptInputRef}
                isSidebarCollapsed={isSidebarCollapsed}
                onToggleSidebar={onToggleSidebar}
                onNewChat={onNewChat}
                updateBadge={updateBadge}
                inlineQuestionPermission={inlineQuestionPermission}
                onRespondToInlineQuestion={onRespondToInlineQuestion}
                inlinePermission={inlinePermission}
                onRespondToInlinePermission={onRespondToInlinePermission}
              />
            )}
          </React.Suspense>
        </div>
      ) : (
        <div data-page-canvas className="flex h-full flex-1 flex-col bg-background">
          <PageHeader
            title={i18nService.t(workMode === WorkMode.Chat ? 'newChat' : 'newTaskTitle')}
            divider={false}
            isSidebarCollapsed={isSidebarCollapsed}
            onToggleSidebar={onToggleSidebar}
            onNewChat={onNewChat}
            updateBadge={updateBadge}
            actions={
              workMode === WorkMode.Chat ? undefined : (
                <SecurityStatusIndicator permissionMode={config.permissionMode} />
              )
            }
          />

          <div className="relative min-h-0 flex-1 overflow-y-auto pb-12">
            <div aria-hidden className="min-h-[max(24px,calc(36%-8rem))]" />

            <div className="mx-auto flex w-full max-w-4xl min-w-0 flex-col items-center gap-8 px-6">
              <div className="theme-home-sticky sticky top-0 z-10 flex w-full flex-col items-center gap-8 py-2">
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

                <div className="mx-auto flex w-full max-w-3xl flex-col gap-3">
                  <div className="min-w-0">
                    <div ref={slotRef} />
                  </div>
                </div>
              </div>

              <div className="flex w-full flex-col gap-4 pb-8">
                {!selectedAction ? (
                  <QuickActionBar actions={quickActions} onActionSelect={handleActionSelect} />
                ) : (
                  <PromptPanel
                    action={selectedAction}
                    onPromptSelect={handleQuickActionPromptSelect}
                  />
                )}
              </div>
            </div>
          </div>
        </div>
      )}
      {renderComposer(
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
        />,
      )}
    </div>
  );
};

export default ConversationStage;
