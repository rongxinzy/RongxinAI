import { TooltipProvider } from '@shared/components/ui/tooltip';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';

import { AppUpdateStatus } from '../shared/appUpdate/constants';
import { ManagedProviderAccessMode } from '../shared/managedProviders';
import { getBranding } from '../shared/branding';
import { InitErrorView } from './app/InitErrorView';
import { MainViewCanvas } from './app/MainViewCanvas';
import { MainView } from './app/constants';
import { useAppBootstrap } from './app/useAppBootstrap';
import { useAppKeyboardShortcuts } from './app/useAppKeyboardShortcuts';
import { useAppUpdateState } from './app/useAppUpdateState';
import { useNetworkStatusForwarder } from './app/useNetworkStatusForwarder';
import {
  hasAskUserQuestions,
  isAskUserQuestionPermission,
} from './components/cowork/askUserQuestion';
import type { ExpertTab } from './components/expert/ExpertView';
import type { CodingSidebarSelection } from './components/coding/CodingWorkspaceSidebar';
import type { McpRegistryId } from './components/mcp/constants';
import type { SettingsOpenOptions } from './components/settings/types';
import { prefetchFeatureView } from './components/featureViewPrefetch';
import { ParticleBootScreen } from './components/boot/ParticleBootScreen';
import Sidebar from './components/Sidebar';
import Toast from './components/Toast';
import AppUpdateBadge from './components/update/AppUpdateBadge';
import WindowTitleBar from './components/window/WindowTitleBar';
import { agentService } from './services/agent';
import {
  refreshMagpieModels,
  LLAMACPP_RUNNING_MODELS_CHANGED_EVENT,
  notifyLlamaCppRunningModelsChanged,
} from './services/availableModels';
import { ZhiyuanModelPoolEvent } from '../shared/modelPool/constants';
import { configService } from './services/config';
import { coworkService } from './services/cowork';
import { i18nService } from './services/i18n';
import { TOAST_DEFAULT_DURATION_MS, TOAST_MAX_DURATION_MS } from './services/errorNormalization';
import {
  resolveToastMessage,
  resolveToastNotification,
  type ToastNotificationDetail,
  type ToastNotificationOptions,
} from './services/toastNotification';
import { workspaceService } from './services/workspace';
import { RootState, store } from './store';
import {
  selectCurrentSessionId,
  selectPendingPermissionForSession,
} from './store/selectors/coworkSelectors';
import { setDraftPrompt } from './store/slices/coworkSlice';
import { clearSelection } from './store/slices/quickActionSlice';
import { clearActiveSkills, setActiveSkillIds } from './store/slices/skillSlice';
import { WorkMode } from './store/workMode/constants';
import { setWorkMode } from './store/workMode/workModeSlice';
import type { CoworkPermissionResult } from './types/cowork';

const App: React.FC = () => {
  const [settingsOptions, setSettingsOptions] = useState<SettingsOpenOptions>({});
  const [initErrorSettingsOpen, setInitErrorSettingsOpen] = useState(false);
  const [mainView, setMainView] = useState<MainView>(MainView.Cowork);
  const [expertInitialTab, setExpertInitialTab] = useState<ExpertTab | undefined>(undefined);
  const [mcpOpenRegistryId, setMcpOpenRegistryId] = useState<McpRegistryId | undefined>();
  const [mcpOpenMarketplace, setMcpOpenMarketplace] = useState(false);
  const [hasMountedLocalInference, setHasMountedLocalInference] = useState(false);
  const [isLocalInferenceDormant, setIsLocalInferenceDormant] = useState(false);
  // 2026/09/21 lixiang  keep-alive 视图隐藏超过该时长后真正卸载以释放内存，
  // 回到视图时重挂载（activeTab 等会话状态经 localStorage 恢复）。
  const LOCAL_INFERENCE_KEEP_ALIVE_IDLE_MS = 10 * 60 * 1000;
  const [localInferenceInstallRequestId, setLocalInferenceInstallRequestId] = useState<string>();
  const [localInferenceRefreshRequestId, setLocalInferenceRefreshRequestId] = useState(0);
  const [bootScreenVisible, setBootScreenVisible] = useState(true);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [isToastError, setIsToastError] = useState(false);
  const [isToastSuccess, setIsToastSuccess] = useState(false);
  const [, forceLanguageRefresh] = useState(0);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [codingSelection, setCodingSelection] = useState<CodingSidebarSelection>({
    workspaceId: null,
    workspaceRoot: '',
    laneId: null,
    draft: null,
  });
  const {
    isInitialized,
    initError,
    enterpriseConfig,
    managedProviderPolicy,
    setManagedProviderPolicy,
  } = useAppBootstrap();
  const appUpdateState = useAppUpdateState();
  const toastTimerRef = useRef<number | null>(null);
  const toastOnCloseRef = useRef<(() => void) | null>(null);
  const appShellRef = useRef<HTMLDivElement>(null);
  const dispatch = useDispatch();
  const currentSessionId = useSelector(selectCurrentSessionId);
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
        setLocalInferenceInstallRequestId(undefined);
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

    window.addEventListener('config-updated', handleConfigUpdated);
    window.addEventListener(
      LLAMACPP_RUNNING_MODELS_CHANGED_EVENT,
      handleLlamaCppRunningModelsChanged,
    );
    window.addEventListener(ZhiyuanModelPoolEvent.AuthChanged, handleLlamaCppRunningModelsChanged);
    const unsubscribeModelBindings = window.electron.llamacpp.onModelBindingsChanged(
      handleLlamaCppModelBindingsChanged,
    );
    const unsubscribeManagedProviders = window.electron.managedProviders.onChanged(
      handleManagedProvidersChanged,
    );
    return () => {
      window.removeEventListener('config-updated', handleConfigUpdated);
      window.removeEventListener(
        LLAMACPP_RUNNING_MODELS_CHANGED_EVENT,
        handleLlamaCppRunningModelsChanged,
      );
      window.removeEventListener(
        ZhiyuanModelPoolEvent.AuthChanged,
        handleLlamaCppRunningModelsChanged,
      );
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

  useEffect(() => {
    if (mainView === MainView.LocalInference) {
      setHasMountedLocalInference(true);
      setIsLocalInferenceDormant(false);
      return;
    }
    // 视图切走后仍保留 keep-alive 渲染一小段时间（快速往返不闪加载态），
    // 超时后置为休眠：卸载组件树、释放 CodeMirror/图标/模型列表等内存；
    // 进行中的运行时安装不依赖本视图存活（进度挂在主进程，重挂载可恢复）。
    if (!hasMountedLocalInference) return;
    const timer = window.setTimeout(() => {
      setIsLocalInferenceDormant(true);
    }, LOCAL_INFERENCE_KEEP_ALIVE_IDLE_MS);
    return () => window.clearTimeout(timer);
  }, [mainView, hasMountedLocalInference, LOCAL_INFERENCE_KEEP_ALIVE_IDLE_MS]);

  useEffect(() => {
    if (!managedProviderPolicy || managedModelsOnly) return;
    let active = true;
    void window.electron.appInfo
      .consumePendingLocalInferenceInstall()
      .then(requestId => {
        if (!active || !requestId) return;
        setLocalInferenceInstallRequestId(requestId);
        setMainView(MainView.LocalInference);
      })
      .catch(error => {
        console.warn('[Renderer] Failed to read local inference installer request:', error);
      });
    return () => {
      active = false;
    };
  }, [managedProviderPolicy, managedModelsOnly]);

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
    handleShowSettings({ initialTab: 'model' });
  }, [handleShowSettings]);

  const handleShowSkills = useCallback(() => {
    setMainView(MainView.Skills);
  }, []);

  const handleShowCowork = useCallback(() => {
    setMainView(MainView.Cowork);
  }, []);

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
    if (managedModelsOnly) return;
    setLocalInferenceRefreshRequestId(current => current + 1);
    setMainView(MainView.LocalInference);
  }, [managedModelsOnly]);

  const handleShowExpert = useCallback(() => {
    setExpertInitialTab(undefined);
    setMainView(MainView.Expert);
  }, []);

  const handleShowCoding = useCallback(() => {
    setMainView(MainView.Coding);
  }, []);

  const handleShowTodo = useCallback(() => {
    setMainView(MainView.Todo);
  }, []);

  const handleToggleSidebar = useCallback(() => {
    setIsSidebarCollapsed(prev => !prev);
  }, []);

  const openNewConversation = useCallback(
    (options?: { clearExperts?: boolean }) => {
      // Only clear when already on home (no session) — preserve __home__ draft when returning from a session
      const shouldClearInput = mainView === MainView.Cowork && !currentSessionId;
      if (currentWorkspaceIsHidden) void workspaceService.clearWorkspaceSelection();
      coworkService.clearSession();
      dispatch(clearSelection());
      setMainView(MainView.Cowork);
      window.setTimeout(() => {
        window.dispatchEvent(
          new CustomEvent('cowork:focus-input', {
            detail: {
              clear: shouldClearInput,
              // New-chat entry clears the prompt expert chip; expert-page entry omits this so #100 can seed.
              clearExperts: options?.clearExperts === true,
            },
          }),
        );
      }, 0);
    },
    [currentSessionId, currentWorkspaceIsHidden, dispatch, mainView],
  );

  const handleNewChat = useCallback(() => {
    dispatch(clearActiveSkills());
    openNewConversation({ clearExperts: true });
  }, [dispatch, openNewConversation]);

  const handleTryMcp = useCallback(
    (prompt?: string) => {
      if (prompt?.trim()) {
        dispatch(setDraftPrompt({ sessionId: '__home__', draft: prompt }));
      }
      dispatch(setWorkMode(WorkMode.Work));
      handleNewChat();
    },
    [dispatch, handleNewChat],
  );

  const handleCreateSkillByChat = useCallback(() => {
    dispatch(setDraftPrompt({ sessionId: '__home__', draft: i18nService.t('skillCreatorPrompt') }));
    handleNewChat();
  }, [dispatch, handleNewChat]);

  const handleTrySkill = useCallback(
    (skillId: string) => {
      const skill = store.getState().skill.skills.find(candidate => candidate.id === skillId);
      if (!skill?.enabled) {
        window.dispatchEvent(
          new CustomEvent('app:showToast', { detail: i18nService.t('chatSkillUnavailable') }),
        );
        return;
      }
      dispatch(setActiveSkillIds([skillId]));
      dispatch(setWorkMode(WorkMode.Work));
      openNewConversation();
    },
    [dispatch, openNewConversation],
  );

  const handleLocalInferenceInstallRequestHandled = useCallback((requestId: string) => {
    setLocalInferenceInstallRequestId(current => (current === requestId ? undefined : current));
  }, []);

  const handleChatWithExpert = useCallback(
    async (agentId: string) => {
      agentService.switchAgent(agentId);
      await coworkService.loadSessions(agentId);
      dispatch(setWorkMode(WorkMode.Work));
      openNewConversation();
    },
    [dispatch, openNewConversation],
  );

  const dismissToast = useCallback(() => {
    if (toastTimerRef.current) {
      window.clearTimeout(toastTimerRef.current);
      toastTimerRef.current = null;
    }
    setToastMessage(null);
    setIsToastError(false);
    setIsToastSuccess(false);
    const onClose = toastOnCloseRef.current;
    toastOnCloseRef.current = null;
    onClose?.();
  }, []);

  const showToast = useCallback(
    (message: string, options: ToastNotificationOptions = {}) => {
      const {
        autoClose = true,
        durationMs = TOAST_DEFAULT_DURATION_MS,
        isError = false,
        isSuccess = false,
        onClose = null,
      } = options;
      setToastMessage(resolveToastMessage(message, options));
      setIsToastError(isError);
      setIsToastSuccess(isSuccess);
      toastOnCloseRef.current = onClose;
      if (toastTimerRef.current) {
        window.clearTimeout(toastTimerRef.current);
      }
      if (autoClose) {
        toastTimerRef.current = window.setTimeout(
          dismissToast,
          Math.min(Math.max(durationMs, 0), TOAST_MAX_DURATION_MS),
        );
      } else {
        toastTimerRef.current = null;
      }
    },
    [dismissToast],
  );

  const updateInfo = appUpdateState.info;

  const handleUpdateAction = useCallback(() => {
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

  useAppKeyboardShortcuts({ onNewChat: handleNewChat, onShowSettings: handleShowSettings });

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) {
        window.clearTimeout(toastTimerRef.current);
      }
      toastOnCloseRef.current = null;
    };
  }, []);

  // Listen for toast events from child components
  useEffect(() => {
    const handler = (e: Event) => {
      const resolved = resolveToastNotification((e as CustomEvent<ToastNotificationDetail>).detail);
      if (!resolved) return;
      showToast(resolved.message, resolved.options);
    };
    window.addEventListener('app:showToast', handler);
    return () => window.removeEventListener('app:showToast', handler);
  }, [showToast]);

  // Listen for ask-ai events: close settings, navigate to cowork, pre-fill input
  useEffect(() => {
    const handler = (e: Event) => {
      const text = (e as CustomEvent<string>).detail;
      setMainView(MainView.Cowork);
      window.setTimeout(() => {
        window.dispatchEvent(
          new CustomEvent('cowork:focus-input', {
            detail: { text },
          }),
        );
      }, 50);
    };
    window.addEventListener('app:ask-ai', handler);
    return () => window.removeEventListener('app:ask-ai', handler);
  }, []);

  useEffect(() => {
    const handler = () => {
      if (managedModelsOnly) return;
      setMainView(MainView.LocalInference);
    };
    window.addEventListener('app:show-local-inference', handler);
    return () => window.removeEventListener('app:show-local-inference', handler);
  }, [managedModelsOnly]);

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

  const shouldShowUpdateBadge =
    updateInfo &&
    (appUpdateState.status === AppUpdateStatus.Ready ||
      appUpdateState.status === AppUpdateStatus.Error ||
      (appUpdateState.status === AppUpdateStatus.Available && updateInfo.manualDownloadOnly));
  const updateEntry = shouldShowUpdateBadge ? (
    <AppUpdateBadge
      latestVersion={updateInfo.latestVersion}
      status={appUpdateState.status}
      onClick={handleUpdateAction}
    />
  ) : null;
  const windowsStandaloneTitleBar = isWindows ? (
    <div className="draggable relative h-9 shrink-0 bg-surface-raised">
      <WindowTitleBar isOverlayActive={false} />
    </div>
  ) : null;

  if (bootScreenVisible) {
    return (
      <div className="h-screen overflow-hidden flex flex-col">
        {windowsStandaloneTitleBar}
        <ParticleBootScreen
          exiting={isInitialized}
          onExitComplete={() => setBootScreenVisible(false)}
        />
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
        settingsOptions={settingsOptions}
        enterpriseConfig={enterpriseConfig}
        appUpdateState={appUpdateState}
        managedModelsOnly={managedModelsOnly}
      />
    );
  }

  return (
    <TooltipProvider delay={400}>
      <div
        ref={appShellRef}
        tabIndex={-1}
        className="h-screen overflow-hidden flex flex-col bg-surface-raised outline-none"
      >
        {toastMessage && (
          <Toast message={toastMessage} isError={isToastError} isSuccess={isToastSuccess} />
        )}
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
            onCodingSelectionChange={setCodingSelection}
            onNewChat={handleNewChat}
            isCollapsed={isSidebarCollapsed}
            onToggleCollapse={handleToggleSidebar}
            updateEntry={!isSidebarCollapsed ? updateEntry : null}
            hideLogin={Boolean(enterpriseConfig) || !getBranding().features.enableCommunityAuth}
            managedModelsOnly={managedModelsOnly}
            onPrefetchView={prefetchFeatureView}
          />
          <MainViewCanvas
            mainView={mainView}
            isSidebarCollapsed={isSidebarCollapsed}
            onToggleSidebar={handleToggleSidebar}
            onNewChat={handleNewChat}
            settingsOptions={settingsOptions}
            onLeaveSettings={handleLeaveSettings}
            onRequestAppSettings={handleShowSettings}
            enterpriseConfig={enterpriseConfig}
            appUpdateState={appUpdateState}
            managedModelsOnly={managedModelsOnly}
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
            onCodingSelectionChange={setCodingSelection}
            hasMountedLocalInference={hasMountedLocalInference}
            isLocalInferenceDormant={isLocalInferenceDormant}
            localInferenceInstallRequestId={localInferenceInstallRequestId}
            localInferenceRefreshRequestId={localInferenceRefreshRequestId}
            onLocalInferenceInstallRequestHandled={handleLocalInferenceInstallRequestHandled}
            onOpenModelSettings={handleOpenLocalModelSettings}
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
