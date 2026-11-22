import { TooltipProvider } from '@shared/components/ui/tooltip';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';

import { ManagedProviderAccessMode } from '../shared/managedProviders';
import { getBranding } from '../shared/branding';
import type { CodingWorkspaceSummary } from '../shared/codingAgent';
import { buildCodingSessionDraftSelection } from './components/coding/codingSessionDraft';
import { shouldSkipPreviewBoot } from './browserMock/previewQuery';
import { InitErrorView } from './app/InitErrorView';
import { MainViewCanvas } from './app/MainViewCanvas';
import { MainView } from './app/constants';
import { useAppBootstrap } from './app/useAppBootstrap';
import { useAppKeyboardShortcuts } from './app/useAppKeyboardShortcuts';
import { useNetworkStatusForwarder } from './app/useNetworkStatusForwarder';
import { useDesktopPetNavigation } from './app/useDesktopPetNavigation';
import { useCompanionNavigation } from './app/companionNavigation';
import {
  InferenceEdition,
  isLocalInferenceEnabledForEdition,
  normalizeInferenceEdition,
} from '../shared/inferenceEdition';
import {
  hasAskUserQuestions,
  isAskUserQuestionPermission,
} from './components/cowork/askUserQuestion';
import type { ExpertTab } from './components/expert/ExpertView';
import { PromptDraftKey } from './components/cowork/promptInput/constants';
import type {
  CodingSidebarSelection,
  CodingWorkspaceSidebarHandle,
} from './components/coding/CodingWorkspaceSidebar';
import type { McpRegistryId } from './components/mcp/constants';
import type { SettingsOpenOptions } from './components/settings/types';
import { prefetchFeatureView } from './components/featureViewPrefetch';
import { CompanionWelcomeScreen } from './components/boot/CompanionWelcomeScreen';
import { useAppToastDisplay } from './app/useAppToastDisplay';
import { useLocalInferenceVisibility } from './app/useLocalInferenceVisibility';
import Sidebar from './components/Sidebar';
import AppUpdateSidebarEntry from './components/update/AppUpdateSidebarEntry';
import WindowTitleBar from './components/window/WindowTitleBar';
import { agentService } from './services/agent';
import {
  refreshMagpieModels,
  notifyLlamaCppRunningModelsChanged,
  subscribeLlamaCppRunningModelsChanged,
} from './services/availableModels';
import { configService } from './services/config';
import { coworkService } from './services/cowork';
import { i18nService } from './services/i18n';
import { showAppErrorToast, showAppToast } from './services/toastNotification';
import { workspaceService } from './services/workspace';
import { RootState, store } from './store';
import {
  selectCurrentSessionId,
  selectDisplayedSessionId,
  selectPendingPermissionForSession,
} from './store/selectors/coworkSelectors';
import { requestPromptFocus, setDraftPrompt } from './store/slices/coworkSlice';
import { clearSelection } from './store/slices/quickActionSlice';
import { clearActiveSkills, setActiveSkillIds } from './store/slices/skillSlice';
import { WorkMode } from './store/workMode/constants';
import { setWorkMode } from './store/workMode/workModeSlice';
import type { CoworkPermissionResult } from './types/cowork';

const App: React.FC = () => {
  const [settingsOptions, setSettingsOptions] = useState<SettingsOpenOptions>({});
  const [initErrorSettingsOpen, setInitErrorSettingsOpen] = useState(false);
  const [mainView, setMainView] = useState<MainView>(MainView.Cowork);
  useCompanionNavigation(setMainView);
  const [expertInitialTab, setExpertInitialTab] = useState<ExpertTab | undefined>(undefined);
  const [mcpOpenRegistryId, setMcpOpenRegistryId] = useState<McpRegistryId | undefined>();
  const [mcpOpenMarketplace, setMcpOpenMarketplace] = useState(false);
  const { hasMountedLocalInference, isLocalInferenceDormant } =
    useLocalInferenceVisibility(mainView);
  const [localInferenceRefreshRequestId, setLocalInferenceRefreshRequestId] = useState(0);
  const [bootScreenVisible, setBootScreenVisible] = useState(
    () => !(import.meta.env.DEV && shouldSkipPreviewBoot()),
  );
  const toast = useAppToastDisplay();
  const [, forceLanguageRefresh] = useState(0);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [codingAgentManagerOpen, setCodingAgentManagerOpen] = useState(false);
  const codingWorkspaceSidebarRef = useRef<CodingWorkspaceSidebarHandle>(null);
  const [{ selection: codingSelection, setupWorkspace }, setCodingNavigation] = useState<{
    selection: CodingSidebarSelection;
    setupWorkspace: CodingWorkspaceSummary | null;
  }>({
    selection: { workspaceId: null, workspaceRoot: '', laneId: null, draft: null },
    setupWorkspace: null,
  });
  const {
    isInitialized,
    initError,
    enterpriseConfig,
    managedProviderPolicy,
    setManagedProviderPolicy,
  } = useAppBootstrap();
  const appShellRef = useRef<HTMLDivElement>(null);
  const dispatch = useDispatch();
  const currentSessionId = useSelector(selectCurrentSessionId);
  const modelServiceState = useSelector((state: RootState) => state.model.serviceState);
  const lastNotifiedGatewayFailureRef = useRef(false);
  const currentWorkspaceIsHidden = useSelector((state: RootState) => {
    const currentWorkspaceId = state.workspace.currentWorkspaceId;
    return state.workspace.workspaces.some(
      workspace => workspace.id === currentWorkspaceId && workspace.isHidden,
    );
  });
  const pendingPermission = useSelector((state: RootState) =>
    selectPendingPermissionForSession(state, currentSessionId),
  );
  const isWindows = window.electron.platform === 'win32';
  const managedModelsOnly = managedProviderPolicy?.mode === ManagedProviderAccessMode.Exclusive;
  const [inferenceEdition, setInferenceEdition] = useState<InferenceEdition>(InferenceEdition.Lite);
  useEffect(() => {
    void window.electron.appInfo
      .getInferenceEdition()
      .then(value => setInferenceEdition(normalizeInferenceEdition(value)));
  }, []);
  const localInferenceEnabled = isLocalInferenceEnabledForEdition(inferenceEdition);

  useEffect(() => {
    if (!isInitialized || initError) return;

    // Electron may restore focus to the first button when the window opens.
    // Keep the initial focus on the app shell so toolbar buttons do not appear
    // focused until the user interacts with the interface.
    const frame = window.requestAnimationFrame(() => {
      appShellRef.current?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [initError, isInitialized]);

  useEffect(() => {
    if (!isInitialized || initError || bootScreenVisible) return;
    if (modelServiceState === 'failed') {
      if (!lastNotifiedGatewayFailureRef.current) {
        lastNotifiedGatewayFailureRef.current = true;
        showAppErrorToast(i18nService.t('coworkErrorGatewayStartFailed'));
      }
      return;
    }
    lastNotifiedGatewayFailureRef.current = false;
  }, [bootScreenVisible, initError, isInitialized, modelServiceState]);

  const availableModelsRefreshRequestIdRef = useRef(0);

  const refreshAvailableModels = useCallback(async () => {
    const requestId = ++availableModelsRefreshRequestIdRef.current;
    try {
      const [, policy] = await Promise.all([
        refreshMagpieModels(),
        window.electron.managedProviders.policy(),
      ]);
      if (requestId !== availableModelsRefreshRequestIdRef.current) return;
      setManagedProviderPolicy(policy);
      if (policy.mode === ManagedProviderAccessMode.Exclusive) {
        setMainView(currentView =>
          currentView === MainView.LocalInference ? MainView.Cowork : currentView,
        );
      }
    } catch (error) {
      console.error('[App] failed to refresh available models:', error);
    }
  }, [setManagedProviderPolicy]);

  useEffect(() => {
    if (!isInitialized) {
      return;
    }

    const handleConfigUpdated = () => {
      void refreshAvailableModels();
    };
    const handleLlamaCppRunningModelsChanged = () => {
      void refreshAvailableModels();
    };
    const handleLlamaCppModelBindingsChanged = () => {
      // Reload first so existing settings listeners receive the authoritative model configuration.
      void configService
        .reload()
        .then(() => notifyLlamaCppRunningModelsChanged())
        .catch(error => {
          console.error('[App] failed to reload config after model bindings changed:', error);
        });
    };
    const handleManagedProvidersChanged = () => {
      void refreshAvailableModels();
    };

    const unsubscribeConfig = configService.subscribe(handleConfigUpdated);
    const unsubscribeRunningModels = subscribeLlamaCppRunningModelsChanged(
      handleLlamaCppRunningModelsChanged,
    );
    const unsubscribeModelBindings = window.electron.llamacpp.onModelBindingsChanged(
      handleLlamaCppModelBindingsChanged,
    );
    const unsubscribeManagedProviders = window.electron.managedProviders.onChanged(
      handleManagedProvidersChanged,
    );
    return () => {
      unsubscribeConfig();
      unsubscribeRunningModels();
      unsubscribeModelBindings();
      unsubscribeManagedProviders();
    };
  }, [isInitialized, refreshAvailableModels]);

  useEffect(() => {
    const unsubscribe = i18nService.subscribe(() => {
      forceLanguageRefresh(prev => prev + 1);
    });
    return () => {
      unsubscribe();
    };
  }, []);

  useNetworkStatusForwarder();

  const handleShowSettings = useCallback((options?: SettingsOpenOptions) => {
    setSettingsOptions({
      initialTab: options?.initialTab,
      initialProvider: options?.initialProvider,
      notice: options?.notice,
    });
    setMainView(MainView.Settings);
  }, []);

  const handleOpenLocalModelSettings = useCallback(() => {
    handleShowSettings({ initialTab: 'models' });
  }, [handleShowSettings]);

  const handleShowSkills = useCallback(() => {
    setMainView(MainView.Skills);
  }, []);

  const handleShowCowork = useCallback(() => {
    setMainView(MainView.Cowork);
  }, []);
  useDesktopPetNavigation(
    isInitialized && !initError && !bootScreenVisible,
    mainView,
    currentSessionId,
    handleShowCowork,
  );

  const handleShowScheduledTasks = useCallback(() => {
    setMainView(MainView.ScheduledTasks);
  }, []);

  const handleShowActivity = useCallback(() => {
    setMainView(MainView.Activity);
  }, []);

  const handleShowMcp = useCallback((registryId?: McpRegistryId) => {
    setMcpOpenRegistryId(registryId);
    setMcpOpenMarketplace(false);
    setMainView(MainView.Mcp);
  }, []);

  const handleShowMcpMarketplace = useCallback(() => {
    setMcpOpenRegistryId(undefined);
    setMcpOpenMarketplace(true);
    setMainView(MainView.Mcp);
  }, []);

  const handleShowLocalInference = useCallback(() => {
    if (managedModelsOnly || !localInferenceEnabled) return;
    setLocalInferenceRefreshRequestId(current => current + 1);
    setMainView(MainView.LocalInference);
  }, [localInferenceEnabled, managedModelsOnly]);

  const handleShowExpert = useCallback(() => {
    setExpertInitialTab(undefined);
    setMainView(MainView.Expert);
  }, []);

  const handleShowCoding = useCallback(() => {
    setMainView(MainView.Coding);
  }, []);

  const changeCodingSelection = useCallback(
    (update: React.SetStateAction<CodingSidebarSelection>) => {
      setCodingNavigation(current => {
        const selection = typeof update === 'function' ? update(current.selection) : update;
        const previous = current.selection;
        const changed =
          selection.workspaceRoot !== previous.workspaceRoot ||
          selection.laneId !== previous.laneId ||
          selection.draft?.id !== previous.draft?.id;
        return { selection, setupWorkspace: changed ? null : current.setupWorkspace };
      });
    },
    [],
  );

  const closeCodingSessionSetup = useCallback(() => {
    setCodingNavigation(current =>
      current.setupWorkspace ? { ...current, setupWorkspace: null } : current,
    );
  }, []);

  const openCodingSession = useCallback((workspace: CodingWorkspaceSummary, profileId?: string) => {
    if (profileId) {
      setCodingNavigation({
        selection: buildCodingSessionDraftSelection(workspace, profileId),
        setupWorkspace: null,
      });
    } else {
      setCodingNavigation(current => ({ ...current, setupWorkspace: workspace }));
    }
  }, []);

  const handleOpenCodingAgentManager = useCallback(() => {
    setCodingAgentManagerOpen(true);
  }, []);

  const handleOpenCreateCodingWorkspace = useCallback(() => {
    codingWorkspaceSidebarRef.current?.openCreateWorkspace();
  }, []);

  useEffect(() => {
    if (mainView !== MainView.Coding) setCodingAgentManagerOpen(false);
  }, [mainView]);

  useEffect(() => {
    if (mainView !== MainView.Coding && setupWorkspace) closeCodingSessionSetup();
  }, [closeCodingSessionSetup, mainView, setupWorkspace]);

  const handleShowTodo = useCallback(() => {
    setMainView(MainView.Todo);
  }, []);

  const handleToggleSidebar = useCallback(() => {
    setIsSidebarCollapsed(prev => !prev);
  }, []);

  const openNewConversation = useCallback(
    (options?: { clearExperts?: boolean }) => {
      // Only clear when already on home (no session) — preserve __home__ draft when returning from a session
      const shouldClearInput =
        mainView === MainView.Cowork && !selectDisplayedSessionId(store.getState());
      if (currentWorkspaceIsHidden) void workspaceService.clearWorkspaceSelection();
      coworkService.clearSession();
      dispatch(clearSelection());
      setMainView(MainView.Cowork);
      dispatch(
        requestPromptFocus({
          draftKey: PromptDraftKey.Home,
          clear: shouldClearInput,
          clearExperts: options?.clearExperts === true,
        }),
      );
    },
    [currentWorkspaceIsHidden, dispatch, mainView],
  );

  const handleNewChat = useCallback(() => {
    dispatch(clearActiveSkills());
    openNewConversation({ clearExperts: true });
  }, [dispatch, openNewConversation]);

  const handleTryMcp = useCallback(
    (prompt?: string) => {
      if (prompt?.trim()) {
        dispatch(setDraftPrompt({ sessionId: PromptDraftKey.Home, draft: prompt }));
      }
      dispatch(setWorkMode(WorkMode.Work));
      handleNewChat();
    },
    [dispatch, handleNewChat],
  );

  const handleCreateSkillByChat = useCallback(() => {
    dispatch(
      setDraftPrompt({
        sessionId: PromptDraftKey.Home,
        draft: i18nService.t('skillCreatorPrompt'),
      }),
    );
    handleNewChat();
  }, [dispatch, handleNewChat]);

  const handleTrySkill = useCallback(
    (skillId: string) => {
      const skill = store.getState().skill.skills.find(candidate => candidate.id === skillId);
      if (!skill?.enabled) {
        showAppToast(i18nService.t('chatSkillUnavailable'));
        return;
      }
      dispatch(setActiveSkillIds([skillId]));
      dispatch(setWorkMode(WorkMode.Work));
      openNewConversation();
    },
    [dispatch, openNewConversation],
  );

  const handleChatWithExpert = useCallback(
    async (agentId: string) => {
      agentService.switchAgent(agentId);
      await coworkService.loadSessions(agentId);
      dispatch(setWorkMode(WorkMode.Work));
      openNewConversation();
    },
    [dispatch, openNewConversation],
  );

  const handleOpenAbout = useCallback(() => {
    handleShowSettings({ initialTab: 'about' });
  }, [handleShowSettings]);

  const handlePermissionResponse = useCallback(
    async (result: CoworkPermissionResult) => {
      if (!pendingPermission) return;
      await coworkService.respondToPermission(pendingPermission.requestId, result);
    },
    [pendingPermission],
  );

  const isInlineAskUserQuestion = Boolean(
    pendingPermission &&
    mainView === MainView.Cowork &&
    pendingPermission.sessionId === currentSessionId &&
    isAskUserQuestionPermission(pendingPermission) &&
    hasAskUserQuestions(pendingPermission),
  );

  const handleLeaveSettings = useCallback(() => {
    setMainView(MainView.Cowork);
  }, []);

  const previousMainViewRef = useRef(mainView);
  useEffect(() => {
    const previousView = previousMainViewRef.current;
    previousMainViewRef.current = mainView;
    if (previousView !== MainView.Settings || mainView === MainView.Settings) return;
    void refreshAvailableModels();
  }, [mainView, refreshAvailableModels]);

  const handleOpenSearch = useCallback(() => setSearchOpen(true), []);
  useAppKeyboardShortcuts({
    onNewChat: handleNewChat,
    onSearch: isInitialized && !initError && !bootScreenVisible ? handleOpenSearch : undefined,
    onShowSettings: handleShowSettings,
  });

  const handleAskAi = useCallback(
    (text: string) => {
      const draftKey = selectDisplayedSessionId(store.getState()) ?? PromptDraftKey.Home;
      setMainView(MainView.Cowork);
      dispatch(requestPromptFocus({ draftKey, text }));
    },
    [dispatch],
  );

  // 鐩戝惉鎵樼洏鑿滃崟鎵撳紑璁剧疆鐨?IPC 浜嬩欢
  useEffect(() => {
    const unsubscribe = window.electron.appEvents?.onOpenSettings(() => {
      handleShowSettings();
    });
    return unsubscribe;
  }, [handleShowSettings]);

  // 鐩戝惉鎵樼洏鑿滃崟鏂板缓浠诲姟鐨?IPC 浜嬩欢
  useEffect(() => {
    const unsubscribe = window.electron.appEvents?.onNewTask(() => {
      handleNewChat();
    });
    return unsubscribe;
  }, [handleNewChat]);

  const updateEntry = (
    <AppUpdateSidebarEntry collapsed={isSidebarCollapsed} onOpenAbout={handleOpenAbout} />
  );
  const windowsStandaloneTitleBar = isWindows ? (
    <div className="draggable relative h-9 shrink-0 bg-surface-raised">
      <WindowTitleBar isOverlayActive={false} />
    </div>
  ) : null;

  if (bootScreenVisible) {
    return (
      <div className="h-screen overflow-hidden flex flex-col">
        {windowsStandaloneTitleBar}
        <CompanionWelcomeScreen
          exiting={isInitialized}
          failed={Boolean(initError)}
          onExitComplete={() => setBootScreenVisible(false)}
        />
      </div>
    );
  }

  if (!isInitialized) {
    return (
      <div className="h-screen overflow-hidden flex flex-col bg-surface">
        {windowsStandaloneTitleBar}
      </div>
    );
  }

  if (initError) {
    return (
      <InitErrorView
        initError={initError}
        titleBar={windowsStandaloneTitleBar}
        isSettingsOpen={initErrorSettingsOpen}
        onOpenSettings={() => setInitErrorSettingsOpen(true)}
        onCloseSettings={() => setInitErrorSettingsOpen(false)}
        onAskAi={handleAskAi}
        settingsOptions={settingsOptions}
        enterpriseConfig={enterpriseConfig}
        managedModelsOnly={managedModelsOnly}
        inferenceEdition={inferenceEdition}
      />
    );
  }

  return (
    <TooltipProvider delay={400}>
      <div
        ref={appShellRef}
        tabIndex={-1}
        className="h-screen overflow-hidden flex flex-col bg-surface outline-none"
      >
        {toast}
        <div className="flex flex-1 min-h-0 overflow-hidden">
          <Sidebar
            onShowSettings={handleShowSettings}
            activeView={mainView}
            onShowSkills={handleShowSkills}
            onShowCowork={handleShowCowork}
            onShowScheduledTasks={handleShowScheduledTasks}
            onShowActivity={handleShowActivity}
            onShowMcp={handleShowMcp}
            onShowLocalInference={handleShowLocalInference}
            onShowExpert={handleShowExpert}
            onShowCoding={handleShowCoding}
            onShowTodo={handleShowTodo}
            codingSelection={codingSelection}
            onCodingSelectionChange={changeCodingSelection}
            onCreateCodingSession={openCodingSession}
            onOpenCodingAgentManager={handleOpenCodingAgentManager}
            codingWorkspaceSidebarRef={codingWorkspaceSidebarRef}
            onNewChat={handleNewChat}
            searchOpen={searchOpen}
            onSearchOpenChange={setSearchOpen}
            isCollapsed={isSidebarCollapsed}
            onToggleCollapse={handleToggleSidebar}
            updateEntry={updateEntry}
            hideLogin={Boolean(enterpriseConfig) || !getBranding().features.enableCommunityAuth}
            managedModelsOnly={managedModelsOnly}
            inferenceEdition={inferenceEdition}
            onPrefetchView={prefetchFeatureView}
          />
          <MainViewCanvas
            mainView={mainView}
            isSidebarCollapsed={isSidebarCollapsed}
            onToggleSidebar={handleToggleSidebar}
            onNewChat={handleNewChat}
            settingsOptions={settingsOptions}
            onLeaveSettings={handleLeaveSettings}
            onAskAi={handleAskAi}
            onRequestAppSettings={handleShowSettings}
            enterpriseConfig={enterpriseConfig}
            managedModelsOnly={managedModelsOnly}
            inferenceEdition={inferenceEdition}
            localInferenceEnabled={localInferenceEnabled}
            onShowSkills={handleShowSkills}
            onCreateSkillByChat={handleCreateSkillByChat}
            onTrySkill={handleTrySkill}
            onChatWithExpert={handleChatWithExpert}
            expertInitialTab={expertInitialTab}
            onUseMcp={handleTryMcp}
            onShowConnectors={handleShowMcpMarketplace}
            mcpOpenRegistryId={mcpOpenRegistryId}
            mcpOpenMarketplace={mcpOpenMarketplace}
            onShowScheduledTasks={handleShowScheduledTasks}
            codingSelection={codingSelection}
            onCodingSelectionChange={changeCodingSelection}
            codingSessionSetupWorkspace={setupWorkspace}
            onCloseCodingSessionSetup={closeCodingSessionSetup}
            codingAgentManagerOpen={codingAgentManagerOpen}
            onCodingAgentManagerOpenChange={setCodingAgentManagerOpen}
            onOpenCreateCodingWorkspace={handleOpenCreateCodingWorkspace}
            hasMountedLocalInference={hasMountedLocalInference}
            isLocalInferenceDormant={isLocalInferenceDormant}
            localInferenceRefreshRequestId={localInferenceRefreshRequestId}
            onOpenModelSettings={handleOpenLocalModelSettings}
            onOpenLocalModels={handleShowLocalInference}
            currentSessionId={currentSessionId}
            pendingPermission={pendingPermission}
            isInlineAskUserQuestion={isInlineAskUserQuestion}
            onRespondToPermission={handlePermissionResponse}
          />
        </div>
      </div>
    </TooltipProvider>
  );
};

export default App;
