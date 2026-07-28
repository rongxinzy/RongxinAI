import { Button } from '@shared/components/ui/button';
import { TooltipProvider } from '@shared/components/ui/tooltip';
import { MessageCircle } from 'lucide-react';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';

import { type AppUpdateRuntimeState, AppUpdateStatus } from '../shared/appUpdate/constants';
import { CoworkView } from './components/cowork';
import CoworkPermissionModal from './components/cowork/CoworkPermissionModal';
import CoworkQuestionWizard from './components/cowork/CoworkQuestionWizard';
import {
  hasAskUserQuestions,
  isAskUserQuestionPermission,
} from './components/cowork/askUserQuestion';
import ExpertView from './components/expert/ExpertView';
import { LocalInferenceView } from './components/localInference';
import { McpView } from './components/mcp';
import { ScheduledTasksView } from './components/scheduledTasks';
import Settings, { type SettingsOpenOptions } from './components/Settings';
import Sidebar from './components/Sidebar';
import { SkillsView } from './components/skills';
import Toast from './components/Toast';
import AppUpdateBadge from './components/update/AppUpdateBadge';
import AppUpdateModal from './components/update/AppUpdateModal';
import WindowTitleBar from './components/window/WindowTitleBar';
import { defaultConfig } from './config';
import type { ApiConfig } from './services/api';
import { apiService } from './services/api';
import { authService } from './services/auth';
import {
  collectAvailableModels,
  LLAMACPP_RUNNING_MODELS_CHANGED_EVENT,
} from './services/availableModels';
import { configService } from './services/config';
import { coworkService } from './services/cowork';
import { i18nService } from './services/i18n';
import { matchesShortcut } from './services/shortcuts';
import { themeService } from './services/theme';
import { RootState, store } from './store';
import {
  selectCurrentSessionId,
  selectFirstPendingPermission,
} from './store/selectors/coworkSelectors';
import { setDraftPrompt } from './store/slices/coworkSlice';
import { setAvailableModels, setDefaultSelectedModel } from './store/slices/modelSlice';
import { clearSelection } from './store/slices/quickActionSlice';
import { setActiveSkillIds } from './store/slices/skillSlice';
import { WorkMode } from './store/workMode/constants';
import { setWorkMode } from './store/workMode/workModeSlice';
import type { CoworkPermissionResult } from './types/cowork';

/** Used for config + i18n init; longer on Windows where main-process IPC can stall during cold start. */
const INIT_STEP_TIMEOUT_MS_WINDOWS = 24_000;
const INIT_STEP_TIMEOUT_MS_DEFAULT = 16_000;

const App: React.FC = () => {
  const [showSettings, setShowSettings] = useState(false);
  const [settingsOptions, setSettingsOptions] = useState<SettingsOpenOptions>({});
  const [mainView, setMainView] = useState<
    'cowork' | 'skills' | 'scheduledTasks' | 'mcp' | 'localInference' | 'expert'
  >('cowork');
  const [hasMountedLocalInference, setHasMountedLocalInference] = useState(false);
  const [isInitialized, setIsInitialized] = useState(false);
  const [initError, setInitError] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [, forceLanguageRefresh] = useState(0);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [appUpdateState, setAppUpdateState] = useState<AppUpdateRuntimeState>({
    status: AppUpdateStatus.Idle,
    source: null,
    info: null,
    progress: null,
    readyFilePath: null,
    readyFileHash: null,
    errorMessage: null,
  });
  const [showUpdateModal, setShowUpdateModal] = useState(false);
  const [enterpriseConfig, setEnterpriseConfig] = useState<{
    ui?: Record<string, 'hide' | 'disable' | 'readonly'>;
    disableUpdate?: boolean;
  } | null>(null);
  const toastTimerRef = useRef<number | null>(null);
  const hasInitialized = useRef(false);
  const previousUpdateStatusRef = useRef<AppUpdateRuntimeState['status']>(AppUpdateStatus.Idle);
  const shouldInstallReadyUpdateRef = useRef(false);
  const dispatch = useDispatch();
  const defaultSelectedModel = useSelector((state: RootState) => state.model.defaultSelectedModel);
  const currentSessionId = useSelector(selectCurrentSessionId);
  const pendingPermission = useSelector(selectFirstPendingPermission);
  const isWindows = window.electron.platform === 'win32';

  const waitWithTimeout = useCallback(
    async <T,>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> => {
      return await new Promise<T>((resolve, reject) => {
        const timer = window.setTimeout(() => {
          reject(new Error(`${label} timed out after ${timeoutMs}ms`));
        }, timeoutMs);

        promise.then(
          value => {
            window.clearTimeout(timer);
            resolve(value);
          },
          error => {
            window.clearTimeout(timer);
            reject(error);
          },
        );
      });
    },
    [],
  );

  // 初始化应用
  useEffect(() => {
    if (hasInitialized.current) {
      return;
    }
    hasInitialized.current = true;

    const initializeApp = async () => {
      const t0 = performance.now();
      const mark = (label: string) => {
        const elapsed = Math.round(performance.now() - t0);
        const msg = `initializeApp: ${label} (+${elapsed}ms)`;
        console.info(`[App] ${msg}`);
        try {
          window.electron?.log?.fromRenderer?.('info', 'App', msg);
        } catch {
          /* preload may not expose this yet */
        }
      };

      try {
        mark('start');
        document.documentElement.classList.add(`platform-${window.electron.platform}`);

        const initTimeoutMs =
          window.electron.platform === 'win32'
            ? INIT_STEP_TIMEOUT_MS_WINDOWS
            : INIT_STEP_TIMEOUT_MS_DEFAULT;
        mark('configService.init begin');
        await waitWithTimeout(configService.init(), initTimeoutMs, 'configService.init');
        mark('configService.init done');

        const entConfig = await window.electron.enterprise.getConfig();
        setEnterpriseConfig(entConfig);
        mark('enterprise.getConfig done');

        themeService.initialize();
        mark('themeService done');

        mark('i18nService.initialize begin');
        await waitWithTimeout(i18nService.initialize(), initTimeoutMs, 'i18nService.initialize');
        mark('i18nService.initialize done');

        mark('authService.init begin');
        await authService.init();
        mark('authService.init done');

        const config = await configService.getConfig();
        dispatch(setWorkMode(config.workMode ?? WorkMode.Work));
        const apiConfig: ApiConfig = {
          apiKey: config.api.key,
          baseUrl: config.api.baseUrl,
        };
        apiService.setConfig(apiConfig);

        const resolvedModels = await collectAvailableModels(config);
        if (resolvedModels.length > 0) {
          dispatch(setAvailableModels(resolvedModels));
          const allModels = store.getState().model.availableModels;
          const preferredModel =
            allModels.find(
              model =>
                model.id === config.model.defaultModel &&
                (!config.model.defaultModelProvider ||
                  model.providerKey === config.model.defaultModelProvider),
            ) ?? allModels[0];
          dispatch(setDefaultSelectedModel(preferredModel));
        }
        mark('model resolution done');

        setIsInitialized(true);
        mark('shell ready');
      } catch (error) {
        const elapsed = Math.round(performance.now() - t0);
        const msg = error instanceof Error ? error.message : String(error);
        const detail = `initializeApp FAILED after ${elapsed}ms: ${msg}`;
        console.error(`[App] ${detail}`);
        try {
          window.electron?.log?.fromRenderer?.('error', 'App', detail);
        } catch {
          /* best-effort */
        }
        setInitError(i18nService.t('initializationError'));
        setIsInitialized(true);
      }
    };

    void initializeApp();
  }, [dispatch, waitWithTimeout]);

  useEffect(() => {
    if (!isInitialized) {
      return;
    }

    const refreshAvailableModels = async () => {
      const config = configService.getConfig();
      const allModels = await collectAvailableModels(config);
      if (allModels.length > 0) {
        dispatch(setAvailableModels(allModels));
      }
    };

    const handleConfigUpdated = () => {
      void refreshAvailableModels().catch(() => undefined);
    };
    const handleLlamaCppRunningModelsChanged = () => {
      void refreshAvailableModels().catch(() => undefined);
    };

    window.addEventListener('config-updated', handleConfigUpdated);
    window.addEventListener(
      LLAMACPP_RUNNING_MODELS_CHANGED_EVENT,
      handleLlamaCppRunningModelsChanged,
    );
    return () => {
      window.removeEventListener('config-updated', handleConfigUpdated);
      window.removeEventListener(
        LLAMACPP_RUNNING_MODELS_CHANGED_EVENT,
        handleLlamaCppRunningModelsChanged,
      );
    };
  }, [dispatch, isInitialized]);

  useEffect(() => {
    const unsubscribe = i18nService.subscribe(() => {
      forceLanguageRefresh(prev => prev + 1);
    });
    return () => {
      unsubscribe();
    };
  }, []);

  // Listen for Copilot token auto-refresh events from the main process
  useEffect(() => {
    const removeListener = window.electron.githubCopilot.onTokenUpdated(({ token, baseUrl }) => {
      console.log('[App] received Copilot token update from main process');
      const currentConfig = configService.getConfig();
      const copilotProvider = currentConfig.providers?.['github-copilot'];
      if (copilotProvider) {
        void configService.updateConfig({
          providers: {
            ...currentConfig.providers,
            'github-copilot': {
              ...copilotProvider,
              apiKey: token,
              ...(baseUrl ? { baseUrl } : {}),
            },
          },
        } as Partial<typeof currentConfig>);
      }
    });
    return removeListener;
  }, []);

  useEffect(() => {
    if (mainView === 'localInference') {
      setHasMountedLocalInference(true);
    }
  }, [mainView]);

  // Network status monitoring
  useEffect(() => {
    const handleOnline = () => {
      console.log('[Renderer] Network online');
      window.electron.networkStatus.send('online');
    };

    const handleOffline = () => {
      console.log('[Renderer] Network offline');
      window.electron.networkStatus.send('offline');
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  useEffect(() => {
    if (!isInitialized || !defaultSelectedModel?.id) return;
    const config = configService.getConfig();
    if (
      config.model.defaultModel === defaultSelectedModel.id &&
      (config.model.defaultModelProvider ?? '') === (defaultSelectedModel.providerKey ?? '')
    ) {
      return;
    }
    void configService.updateConfig({
      model: {
        ...config.model,
        defaultModel: defaultSelectedModel.id,
        defaultModelProvider: defaultSelectedModel.providerKey,
      },
    });
  }, [isInitialized, defaultSelectedModel?.id, defaultSelectedModel?.providerKey]);

  const handleShowSettings = useCallback((options?: SettingsOpenOptions) => {
    setSettingsOptions({
      initialTab: options?.initialTab,
      notice: options?.notice,
    });
    setShowSettings(true);
  }, []);

  const handleShowSkills = useCallback(() => {
    setMainView('skills');
  }, []);

  const handleShowCowork = useCallback(() => {
    setMainView('cowork');
  }, []);

  const handleShowScheduledTasks = useCallback(() => {
    setMainView('scheduledTasks');
  }, []);

  const handleShowMcp = useCallback(() => {
    setMainView('mcp');
  }, []);

  const handleShowLocalInference = useCallback(() => {
    setMainView('localInference');
  }, []);

  const handleShowExpert = useCallback(() => {
    setMainView('expert');
  }, []);

  const handleToggleSidebar = useCallback(() => {
    setIsSidebarCollapsed(prev => !prev);
  }, []);

  const handleNewChat = useCallback(() => {
    // Only clear when already on home (no session) — preserve __home__ draft when returning from a session
    const shouldClearInput = mainView === 'cowork' && !currentSessionId;
    coworkService.clearSession();
    dispatch(clearSelection());
    setMainView('cowork');
    window.setTimeout(() => {
      window.dispatchEvent(
        new CustomEvent('cowork:focus-input', {
          detail: { clear: shouldClearInput },
        }),
      );
    }, 0);
  }, [dispatch, mainView, currentSessionId]);

  const handleTryMcp = useCallback((prompt?: string) => {
    if (prompt?.trim()) {
      dispatch(setDraftPrompt({ sessionId: '__home__', draft: prompt }));
    }
    dispatch(setWorkMode(WorkMode.Work));
    handleNewChat();
  }, [dispatch, handleNewChat]);

  const handleCreateSkillByChat = useCallback(() => {
    dispatch(setDraftPrompt({ sessionId: '__home__', draft: i18nService.t('skillCreatorPrompt') }));
    coworkService.clearSession();
    dispatch(clearSelection());
    setMainView('cowork');
  }, [dispatch]);

  const handleTrySkill = useCallback(
    (skillId: string) => {
      dispatch(setActiveSkillIds([skillId]));
      dispatch(setWorkMode(WorkMode.Work));
      handleNewChat();
    },
    [dispatch, handleNewChat],
  );

  const showToast = useCallback((message: string, autoClose: boolean = true) => {
    setToastMessage(message);
    if (toastTimerRef.current) {
      window.clearTimeout(toastTimerRef.current);
    }
    if (autoClose) {
      toastTimerRef.current = window.setTimeout(() => {
        setToastMessage(null);
        toastTimerRef.current = null;
      }, 2200);
    } else {
      toastTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    let mounted = true;

    const loadInitialUpdateState = async () => {
      try {
        const state = await window.electron.appUpdate.getState();
        if (mounted) {
          setAppUpdateState(state);
          previousUpdateStatusRef.current = state.status;
        }
      } catch (error) {
        console.error('[App] failed to load initial app update state:', error);
      }
    };

    void loadInitialUpdateState();

    const unsubscribe = window.electron.appUpdate.onStateChanged(state => {
      const previousStatus = previousUpdateStatusRef.current;
      previousUpdateStatusRef.current = state.status;
      setAppUpdateState(state);

      if (state.status === AppUpdateStatus.Ready && previousStatus !== AppUpdateStatus.Ready) {
        if (shouldInstallReadyUpdateRef.current && state.readyFilePath) {
          shouldInstallReadyUpdateRef.current = false;
          void window.electron.appUpdate.installReady().then(installResult => {
            if (!installResult.success) {
              showToast(installResult.error || i18nService.t('updateInstallFailed'));
            }
          });
        }
      }
    });

    return () => {
      mounted = false;
      unsubscribe();
    };
  }, [showToast]);

  const handleShowLogin = useCallback(() => {
    showToast(i18nService.t('featureInDevelopment'));
  }, [showToast]);

  const updateInfo = appUpdateState.info;

  const handleOpenUpdateModal = useCallback(() => {
    if (!updateInfo) return;
    setShowUpdateModal(true);
  }, [updateInfo]);

  const handleConfirmUpdate = useCallback(async () => {
    if (!updateInfo) return;

    if (appUpdateState.readyFilePath) {
      shouldInstallReadyUpdateRef.current = false;
      const installResult = await window.electron.appUpdate.installReady();
      if (!installResult.success) {
        showToast(installResult.error || i18nService.t('updateInstallFailed'));
      }
      return;
    }

    if (
      appUpdateState.status === AppUpdateStatus.Error ||
      appUpdateState.status === AppUpdateStatus.Available
    ) {
      const isManualUrl = updateInfo.manualDownload;
      if (!isManualUrl) {
        shouldInstallReadyUpdateRef.current = appUpdateState.status === AppUpdateStatus.Available;
        const retryResult = await window.electron.appUpdate.retryDownload();
        if (!retryResult.success) {
          shouldInstallReadyUpdateRef.current = false;
          showToast(i18nService.t('updateDownloadFailed'));
        }
        return;
      }
    }

    if (updateInfo.manualDownload) {
      shouldInstallReadyUpdateRef.current = false;
      setShowUpdateModal(false);
      try {
        const result = await window.electron.shell.openExternal(updateInfo.url);
        if (!result.success) {
          showToast(i18nService.t('updateOpenFailed'));
        }
      } catch (error) {
        console.error('Failed to open update url:', error);
        showToast(i18nService.t('updateOpenFailed'));
      }
      return;
    }
  }, [appUpdateState.readyFilePath, appUpdateState.status, showToast, updateInfo]);

  const handleCancelDownload = useCallback(async () => {
    shouldInstallReadyUpdateRef.current = false;
    await window.electron.appUpdate.cancelDownload();
  }, []);

  const handleRetryUpdate = useCallback(async () => {
    if (!updateInfo) return;
    if (updateInfo.manualDownload) {
      shouldInstallReadyUpdateRef.current = false;
      setShowUpdateModal(false);
      await window.electron.shell.openExternal(updateInfo.url);
      return;
    }
    shouldInstallReadyUpdateRef.current = false;
    await window.electron.appUpdate.retryDownload();
  }, [updateInfo]);

  const handlePermissionResponse = useCallback(
    async (result: CoworkPermissionResult) => {
      if (!pendingPermission) return;
      await coworkService.respondToPermission(pendingPermission.requestId, result);
    },
    [pendingPermission],
  );

  const isInlineAskUserQuestion = Boolean(
    pendingPermission &&
    mainView === 'cowork' &&
    pendingPermission.sessionId === currentSessionId &&
    isAskUserQuestionPermission(pendingPermission) &&
    hasAskUserQuestions(pendingPermission),
  );

  const handleCloseSettings = () => {
    setShowSettings(false);
    const config = configService.getConfig();
    apiService.setConfig({
      apiKey: config.api.key,
      baseUrl: config.api.baseUrl,
    });
    void collectAvailableModels(config)
      .then(allModels => {
        if (allModels.length > 0) {
          dispatch(setAvailableModels(allModels));
        }
      })
      .catch(() => undefined);
  };

  const isShortcutInputActive = () => {
    const activeElement = document.activeElement;
    if (!(activeElement instanceof HTMLElement)) return false;
    return activeElement.dataset.shortcutInput === 'true';
  };

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.repeat || isShortcutInputActive()) return;

      const { shortcuts } = configService.getConfig();
      const activeShortcuts = {
        ...defaultConfig.shortcuts,
        ...(shortcuts ?? {}),
      };

      if (matchesShortcut(event, activeShortcuts.newChat)) {
        event.preventDefault();
        handleNewChat();
        return;
      }

      if (matchesShortcut(event, activeShortcuts.search)) {
        event.preventDefault();
        window.dispatchEvent(new CustomEvent('cowork:shortcut:search'));
        return;
      }

      if (matchesShortcut(event, activeShortcuts.settings)) {
        event.preventDefault();
        handleShowSettings();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleShowSettings, handleNewChat]);

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) {
        window.clearTimeout(toastTimerRef.current);
      }
    };
  }, []);

  // Listen for toast events from child components
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ message: string; autoClose?: boolean } | string>).detail;
      if (!detail) return;
      if (typeof detail === 'string') {
        showToast(detail);
      } else {
        showToast(detail.message, detail.autoClose !== false);
      }
    };
    window.addEventListener('app:showToast', handler);
    return () => window.removeEventListener('app:showToast', handler);
  }, [showToast]);

  // Listen for ask-ai events: close settings, navigate to cowork, pre-fill input
  useEffect(() => {
    const handler = (e: Event) => {
      const text = (e as CustomEvent<string>).detail;
      setShowSettings(false);
      setMainView('cowork');
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
      setShowSettings(false);
      setMainView('localInference');
    };
    window.addEventListener('app:show-local-inference', handler);
    return () => window.removeEventListener('app:show-local-inference', handler);
  }, []);

  // 监听托盘菜单打开设置的 IPC 事件
  useEffect(() => {
    const unsubscribe = window.electron.appEvents?.onOpenSettings(() => {
      handleShowSettings();
    });
    return unsubscribe;
  }, [handleShowSettings]);

  // 监听托盘菜单新建任务的 IPC 事件
  useEffect(() => {
    const unsubscribe = window.electron.appEvents?.onNewTask(() => {
      handleNewChat();
    });
    return unsubscribe;
  }, [handleNewChat]);

  // Update system is permanently disabled

  // 根据场景选择使用哪个权限组件
  const permissionModal = useMemo(() => {
    if (!pendingPermission || isInlineAskUserQuestion) return null;

    // 检查是否为 AskUserQuestion 且有多个问题 -> 使用向导式组件
    const isQuestionTool = isAskUserQuestionPermission(pendingPermission);
    if (isQuestionTool && pendingPermission.toolInput) {
      const rawQuestions = (pendingPermission.toolInput as Record<string, unknown>).questions;
      const hasMultipleQuestions = Array.isArray(rawQuestions) && rawQuestions.length > 1;

      if (hasMultipleQuestions) {
        return (
          <CoworkQuestionWizard
            permission={pendingPermission}
            onRespond={handlePermissionResponse}
          />
        );
      }
    }

    // 其他情况使用原有的权限模态框
    return (
      <CoworkPermissionModal permission={pendingPermission} onRespond={handlePermissionResponse} />
    );
  }, [pendingPermission, handlePermissionResponse, isInlineAskUserQuestion]);

  const isOverlayActive = showSettings || showUpdateModal || permissionModal !== null;
  const shouldShowUpdateBadge =
    updateInfo &&
    appUpdateState.status !== AppUpdateStatus.Checking &&
    appUpdateState.status !== AppUpdateStatus.Downloading;
  const updateEntry = shouldShowUpdateBadge ? (
    <AppUpdateBadge
      latestVersion={updateInfo.latestVersion}
      status={appUpdateState.status}
      onClick={handleOpenUpdateModal}
    />
  ) : null;
  const windowsStandaloneTitleBar = isWindows ? (
    <div className="draggable relative h-9 shrink-0 bg-surface-raised">
      <WindowTitleBar isOverlayActive={isOverlayActive} />
    </div>
  ) : null;

  if (!isInitialized) {
    return (
      <div className="h-screen overflow-hidden flex flex-col">
        {windowsStandaloneTitleBar}
        <div className="flex-1 flex items-center justify-center bg-background">
          <div className="flex flex-col items-center space-y-4">
            <div className="w-16 h-16 rounded-full bg-linear-to-br from-primary to-primary-hover flex items-center justify-center shadow-glow-accent animate-pulse">
              <MessageCircle className="h-8 w-8 text-white" />
            </div>
            <div className="w-24 h-1 rounded-full bg-primary/20 overflow-hidden">
              <div className="h-full w-1/2 rounded-full bg-primary animate-shimmer" />
            </div>
            <div className="text-foreground text-xl font-medium">{i18nService.t('loading')}</div>
          </div>
        </div>
      </div>
    );
  }

  if (initError) {
    return (
      <div className="h-screen overflow-hidden flex flex-col">
        {windowsStandaloneTitleBar}
        <div className="flex-1 flex flex-col items-center justify-center bg-background">
          <div className="flex flex-col items-center space-y-6 max-w-md px-6">
            <div className="w-16 h-16 rounded-full bg-red-500 flex items-center justify-center shadow-lg">
              <MessageCircle className="h-8 w-8 text-white" />
            </div>
            <div className="text-foreground text-xl font-medium text-center">{initError}</div>
            <div className="flex items-center gap-3">
              <Button onClick={() => window.electron.appInfo.relaunch()}>
                {i18nService.t('restartApp')}
              </Button>
              <Button variant="outline" onClick={() => handleShowSettings()}>
                {i18nService.t('openSettings')}
              </Button>
            </div>
          </div>
          {showSettings && (
            <Settings
              onClose={handleCloseSettings}
              initialTab={settingsOptions.initialTab}
              notice={settingsOptions.notice}
              enterpriseConfig={enterpriseConfig}
            />
          )}
        </div>
      </div>
    );
  }

  return (
    <TooltipProvider delay={400}>
      <div className="h-screen overflow-hidden flex flex-col bg-surface-raised">
        {toastMessage && <Toast message={toastMessage} onClose={() => setToastMessage(null)} />}
        <div className="flex flex-1 min-h-0 overflow-hidden">
          <Sidebar
            onShowLogin={handleShowLogin}
            onShowSettings={handleShowSettings}
            activeView={mainView}
            onShowSkills={handleShowSkills}
            onShowCowork={handleShowCowork}
            onShowScheduledTasks={handleShowScheduledTasks}
            onShowMcp={handleShowMcp}
            onShowLocalInference={handleShowLocalInference}
            onShowExpert={handleShowExpert}
            onNewChat={handleNewChat}
            isCollapsed={isSidebarCollapsed}
            onToggleCollapse={handleToggleSidebar}
            updateEntry={!isSidebarCollapsed ? updateEntry : null}
            hideLogin={true}
          />
          <div
            className={`flex-1 min-w-0 py-1.5 px-1.5 transition-[padding] duration-200 ease-out`}
          >
            <div className="relative h-full min-h-0 rounded-xl bg-background overflow-hidden contain-[layout_style_paint]">
              {hasMountedLocalInference && (
                <div
                  className={
                    mainView === 'localInference' ? 'h-full min-h-0' : 'hidden h-full min-h-0'
                  }
                >
                  <LocalInferenceView
                    isSidebarCollapsed={isSidebarCollapsed}
                    isVisible={mainView === 'localInference'}
                    onToggleSidebar={handleToggleSidebar}
                    onNewChat={handleNewChat}
                    updateBadge={null}
                  />
                </div>
              )}
              {mainView === 'skills' ? (
                <SkillsView
                  isSidebarCollapsed={isSidebarCollapsed}
                  onToggleSidebar={handleToggleSidebar}
                  onNewChat={handleNewChat}
                  onCreateSkillByChat={handleCreateSkillByChat}
                  onTrySkill={handleTrySkill}
                  updateBadge={null}
                  readOnly={enterpriseConfig?.ui?.skills === 'readonly'}
                />
              ) : mainView === 'scheduledTasks' ? (
                <ScheduledTasksView
                  isSidebarCollapsed={isSidebarCollapsed}
                  onToggleSidebar={handleToggleSidebar}
                  onNewChat={handleNewChat}
                  updateBadge={null}
                />
              ) : mainView === 'mcp' ? (
                <McpView
                  isSidebarCollapsed={isSidebarCollapsed}
                  onToggleSidebar={handleToggleSidebar}
                  onNewChat={handleNewChat}
                  onUseMcp={handleTryMcp}
                  updateBadge={null}
                />
              ) : mainView === 'expert' ? (
                <ExpertView
                  isSidebarCollapsed={isSidebarCollapsed}
                  onToggleSidebar={handleToggleSidebar}
                  onNewChat={handleNewChat}
                  updateBadge={null}
                  readOnly={enterpriseConfig?.ui?.skills === 'readonly'}
                  onCreateSkillByChat={handleCreateSkillByChat}
                  onTrySkill={handleTrySkill}
                  onUseMcp={handleTryMcp}
                />
              ) : mainView === 'localInference' ? null : (
                <CoworkView
                  onRequestAppSettings={handleShowSettings}
                  onShowSkills={handleShowSkills}
                  isSidebarCollapsed={isSidebarCollapsed}
                  onToggleSidebar={handleToggleSidebar}
                  onNewChat={handleNewChat}
                  updateBadge={null}
                  inlineQuestionPermission={isInlineAskUserQuestion ? pendingPermission : null}
                  onRespondToInlineQuestion={handlePermissionResponse}
                />
              )}
            </div>
          </div>
        </div>

        {/* 设置窗口显示在所有主内容之上，但不影响主界面的交互 */}
        {showSettings && (
          <Settings
            onClose={handleCloseSettings}
            initialTab={settingsOptions.initialTab}
            notice={settingsOptions.notice}
            enterpriseConfig={enterpriseConfig}
          />
        )}
        {showUpdateModal && updateInfo && (
          <AppUpdateModal
            updateState={appUpdateState}
            onCancel={() => {
              if (
                appUpdateState.status !== AppUpdateStatus.Downloading &&
                appUpdateState.status !== AppUpdateStatus.Installing
              ) {
                setShowUpdateModal(false);
              }
            }}
            onConfirm={handleConfirmUpdate}
            onCancelDownload={handleCancelDownload}
            onRetry={handleRetryUpdate}
          />
        )}
        {permissionModal}
      </div>
    </TooltipProvider>
  );
};

export default App;
