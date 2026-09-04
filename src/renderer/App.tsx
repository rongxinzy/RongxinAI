import { Button } from '@shared/components/ui/button';
import { TooltipProvider } from '@shared/components/ui/tooltip';
import { MessageCircle } from 'lucide-react';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';

import { type AppUpdateRuntimeState, AppUpdateStatus } from '../shared/appUpdate/constants';
import {
  ManagedProviderAccessMode,
  type ManagedProviderAccessPolicy,
} from '../shared/managedProviders';
import {
  hasAskUserQuestions,
  isAskUserQuestionPermission,
} from './components/cowork/askUserQuestion';
import type { ExpertTab } from './components/expert/ExpertView';
import type { CodingSidebarSelection } from './components/coding/CodingWorkspaceSidebar';
import type { McpRegistryId } from './components/mcp/constants';
import type { SettingsOpenOptions } from './components/Settings';
import { prefetchFeatureView } from './components/featureViewPrefetch';
import { ParticleBootScreen } from './components/boot/ParticleBootScreen';
import { LazyChunkErrorBoundary } from './components/LazyChunkErrorBoundary';
import Sidebar from './components/Sidebar';
import Toast from './components/Toast';
import AppUpdateBadge from './components/update/AppUpdateBadge';
import WindowTitleBar from './components/window/WindowTitleBar';
import { defaultConfig } from './config';
import { agentService } from './services/agent';
import { apiService } from './services/api';
import {
  collectAvailableModels,
  getManagedProviderAccessPolicy,
  LLAMACPP_RUNNING_MODELS_CHANGED_EVENT,
  notifyLlamaCppRunningModelsChanged,
} from './services/availableModels';
import { configService } from './services/config';
import { coworkService } from './services/cowork';
import { i18nService } from './services/i18n';
import { matchesShortcut } from './services/shortcuts';
import { themeService } from './services/theme';
import { workspaceService } from './services/workspace';
import { RootState, store } from './store';
import {
  selectCurrentSessionId,
  selectPendingPermissionForSession,
} from './store/selectors/coworkSelectors';
import { setDraftPrompt } from './store/slices/coworkSlice';
import { setAvailableModels, setDefaultSelectedModel } from './store/slices/modelSlice';
import { clearSelection } from './store/slices/quickActionSlice';
import { clearActiveSkills, setActiveSkillIds } from './store/slices/skillSlice';
import { WorkMode } from './store/workMode/constants';
import { setWorkMode } from './store/workMode/workModeSlice';
import type { CoworkPermissionResult } from './types/cowork';

/** Used for config + i18n init; longer on Windows where main-process IPC can stall during cold start. */
const INIT_STEP_TIMEOUT_MS_WINDOWS = 24_000;
const INIT_STEP_TIMEOUT_MS_DEFAULT = 16_000;
const DEFAULT_TOAST_DURATION_MS = 2_200;

interface AppToastOptions {
  autoClose?: boolean;
  durationMs?: number;
  isError?: boolean;
  isSuccess?: boolean;
  onClose?: () => void;
}

// Feature areas outside the default cowork view are code-split so they stay
// out of the initial preload graph (see issue #141).
const CoworkView = React.lazy(() =>
  import('./components/cowork').then(module => ({ default: module.CoworkView })),
);
const Settings = React.lazy(() => import('./components/Settings'));
const SkillsView = React.lazy(() =>
  import('./components/skills').then(module => ({ default: module.SkillsView })),
);
const ScheduledTasksView = React.lazy(() =>
  import('./components/scheduledTasks').then(module => ({ default: module.ScheduledTasksView })),
);
const ActivityView = React.lazy(() =>
  import('./components/activity').then(module => ({ default: module.ActivityView })),
);
const McpView = React.lazy(() =>
  import('./components/mcp').then(module => ({ default: module.McpView })),
);
const LocalInferenceView = React.lazy(() =>
  import('./components/localInference').then(module => ({ default: module.LocalInferenceView })),
);
const ExpertView = React.lazy(() => import('./components/expert/ExpertView'));
const CodingWorkbenchView = React.lazy(() =>
  import('./components/coding').then(module => ({ default: module.CodingWorkbenchView })),
);
const TodoView = React.lazy(() => import('./components/todo/TodoView'));

/**
 * Full-area fallback shown while a lazily loaded feature chunk downloads.
 * Content-shaped skeleton blocks with a soft staggered pulse communicate
 * "view is loading" and keep the layout stable when the real view mounts.
 */
const lazyViewFallback = (
  <div className="flex h-full min-h-0 flex-col gap-4 p-6">
    <div className="h-9 w-48 animate-pulse rounded-lg bg-muted/40" />
    <div className="flex flex-1 flex-col gap-3">
      <div className="h-28 animate-pulse rounded-xl bg-muted/30" />
      <div className="h-28 animate-pulse rounded-xl bg-muted/30 [animation-delay:150ms]" />
      <div className="h-28 animate-pulse rounded-xl bg-muted/30 [animation-delay:300ms]" />
    </div>
  </div>
);

const App: React.FC = () => {
  const [showSettings, setShowSettings] = useState(false);
  const [settingsOptions, setSettingsOptions] = useState<SettingsOpenOptions>({});
  const [mainView, setMainView] = useState<
    | 'cowork'
    | 'skills'
    | 'scheduledTasks'
    | 'activity'
    | 'mcp'
    | 'localInference'
    | 'expert'
    | 'coding'
    | 'todo'
  >('cowork');
  const [expertInitialTab, setExpertInitialTab] = useState<ExpertTab | undefined>(undefined);
  const [mcpOpenRegistryId, setMcpOpenRegistryId] = useState<McpRegistryId | undefined>();
  const [mcpOpenMarketplace, setMcpOpenMarketplace] = useState(false);
  const [hasMountedLocalInference, setHasMountedLocalInference] = useState(false);
  const [localInferenceInstallRequestId, setLocalInferenceInstallRequestId] = useState<string>();
  const [isInitialized, setIsInitialized] = useState(false);
  const [bootScreenVisible, setBootScreenVisible] = useState(true);
  const [initError, setInitError] = useState<string | null>(null);
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
  const [appUpdateState, setAppUpdateState] = useState<AppUpdateRuntimeState>({
    status: AppUpdateStatus.Idle,
    source: null,
    info: null,
    progress: null,
    readyFilePath: null,
    readyFileHash: null,
    errorMessage: null,
    lastCheckedAt: null,
  });
  const [enterpriseConfig, setEnterpriseConfig] = useState<{
    ui?: Record<string, 'hide' | 'disable' | 'readonly'>;
    disableUpdate?: boolean;
  } | null>(null);
  const [managedProviderPolicy, setManagedProviderPolicy] =
    useState<ManagedProviderAccessPolicy | null>(null);
  const toastTimerRef = useRef<number | null>(null);
  const toastOnCloseRef = useRef<(() => void) | null>(null);
  const hasInitialized = useRef(false);
  const appShellRef = useRef<HTMLDivElement>(null);
  const dispatch = useDispatch();
  const defaultSelectedModel = useSelector((state: RootState) => state.model.defaultSelectedModel);
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

        const config = configService.getConfig();
        apiService.setConfig({
          apiKey: config.api.key,
          baseUrl: config.api.baseUrl,
        });

        themeService.initialize();
        mark('themeService done');

        // Enterprise and i18n only depend on config initialization.
        mark('enterprise/i18n init begin');
        const [entConfig, , providerPolicy] = await Promise.all([
          window.electron.enterprise.getConfig(),
          waitWithTimeout(i18nService.initialize(), initTimeoutMs, 'i18nService.initialize'),
          getManagedProviderAccessPolicy(),
        ]);
        setEnterpriseConfig(entConfig);
        setManagedProviderPolicy(providerPolicy);
        mark('enterprise/i18n init done');

        dispatch(setWorkMode(config.workMode ?? WorkMode.Work));

        const resolvedModels = await collectAvailableModels(config);
        dispatch(setAvailableModels(resolvedModels));
        if (resolvedModels.length > 0) {
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
    if (!isInitialized) {
      return;
    }

    const refreshAvailableModels = async () => {
      const [config, policy] = await Promise.all([
        configService.reload(),
        getManagedProviderAccessPolicy(),
      ]);
      setManagedProviderPolicy(policy);
      if (policy.mode === ManagedProviderAccessMode.Exclusive) {
        setLocalInferenceInstallRequestId(undefined);
        setMainView(currentView => (currentView === 'localInference' ? 'cowork' : currentView));
      }
      const allModels = await collectAvailableModels(config);
      dispatch(setAvailableModels(allModels));
    };

    const handleConfigUpdated = () => {
      const config = configService.getConfig();
      apiService.setConfig({
        apiKey: config.api.key,
        baseUrl: config.api.baseUrl,
      });
      void refreshAvailableModels().catch(() => undefined);
    };
    const handleLlamaCppRunningModelsChanged = () => {
      void refreshAvailableModels().catch(() => undefined);
    };
    const handleLlamaCppModelBindingsChanged = () => {
      // Reload first so existing settings listeners receive the authoritative model configuration.
      void configService
        .reload()
        .then(() => notifyLlamaCppRunningModelsChanged())
        .catch(() => undefined);
    };

    window.addEventListener('config-updated', handleConfigUpdated);
    window.addEventListener(
      LLAMACPP_RUNNING_MODELS_CHANGED_EVENT,
      handleLlamaCppRunningModelsChanged,
    );
    const unsubscribeModelBindings = window.electron.llamacpp.onModelBindingsChanged(
      handleLlamaCppModelBindingsChanged,
    );
    return () => {
      window.removeEventListener('config-updated', handleConfigUpdated);
      window.removeEventListener(
        LLAMACPP_RUNNING_MODELS_CHANGED_EVENT,
        handleLlamaCppRunningModelsChanged,
      );
      unsubscribeModelBindings();
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

  useEffect(() => {
    if (!managedProviderPolicy || managedModelsOnly) return;
    let active = true;
    void window.electron.appInfo
      .consumePendingLocalInferenceInstall()
      .then(requestId => {
        if (!active || !requestId) return;
        setShowSettings(false);
        setLocalInferenceInstallRequestId(requestId);
        setMainView('localInference');
      })
      .catch(error => {
        console.warn('[Renderer] Failed to read local inference installer request:', error);
      });
    return () => {
      active = false;
    };
  }, [managedProviderPolicy, managedModelsOnly]);

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

  const handleShowActivity = useCallback(() => {
    setMainView('activity');
  }, []);

  const handleShowMcp = useCallback((registryId?: McpRegistryId) => {
    setMcpOpenRegistryId(registryId);
    setMcpOpenMarketplace(false);
    setMainView('mcp');
  }, []);

  const handleShowMcpMarketplace = useCallback(() => {
    setMcpOpenRegistryId(undefined);
    setMcpOpenMarketplace(true);
    setMainView('mcp');
  }, []);

  const handleShowLocalInference = useCallback(() => {
    if (managedModelsOnly) return;
    setMainView('localInference');
  }, [managedModelsOnly]);

  const handleShowExpert = useCallback(() => {
    setExpertInitialTab(undefined);
    setMainView('expert');
  }, []);

  const handleShowCoding = useCallback(() => {
    setMainView('coding');
  }, []);

  const handleShowTodo = useCallback(() => {
    setMainView('todo');
  }, []);

  const handleToggleSidebar = useCallback(() => {
    setIsSidebarCollapsed(prev => !prev);
  }, []);

  const openNewConversation = useCallback(() => {
    // Only clear when already on home (no session) — preserve __home__ draft when returning from a session
    const shouldClearInput = mainView === 'cowork' && !currentSessionId;
    if (currentWorkspaceIsHidden) void workspaceService.clearWorkspaceSelection();
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
  }, [currentSessionId, currentWorkspaceIsHidden, dispatch, mainView]);

  const handleNewChat = useCallback(() => {
    dispatch(clearActiveSkills());
    openNewConversation();
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
    (message: string, options: AppToastOptions = {}) => {
      const {
        autoClose = true,
        durationMs = DEFAULT_TOAST_DURATION_MS,
        isError = false,
        isSuccess = false,
        onClose = null,
      } = options;
      setToastMessage(message);
      setIsToastError(isError);
      setIsToastSuccess(isSuccess);
      toastOnCloseRef.current = onClose;
      if (toastTimerRef.current) {
        window.clearTimeout(toastTimerRef.current);
      }
      if (autoClose) {
        toastTimerRef.current = window.setTimeout(dismissToast, durationMs);
      } else {
        toastTimerRef.current = null;
      }
    },
    [dismissToast],
  );

  useEffect(() => {
    let mounted = true;

    const loadInitialUpdateState = async () => {
      try {
        const state = await window.electron.appUpdate.getState();
        if (mounted) {
          setAppUpdateState(state);
        }
      } catch (error) {
        console.error('[App] failed to load initial app update state:', error);
      }
    };

    void loadInitialUpdateState();

    const unsubscribe = window.electron.appUpdate.onStateChanged(state => {
      setAppUpdateState(state);
    });

    return () => {
      mounted = false;
      unsubscribe();
    };
  }, [showToast]);

  const updateInfo = appUpdateState.info;

  const handleUpdateAction = useCallback(async () => {
    if (appUpdateState.status === AppUpdateStatus.Ready && appUpdateState.readyFilePath) {
      const installResult = await window.electron.appUpdate.installReady();
      if (!installResult.success) {
        showToast(installResult.error || i18nService.t('updateInstallFailed'));
      }
      return;
    }
    if (appUpdateState.status === AppUpdateStatus.Error) {
      await window.electron.appUpdate.retryDownload();
      return;
    }
    if (
      appUpdateState.status === AppUpdateStatus.Available &&
      appUpdateState.info?.manualDownloadOnly
    ) {
      await window.electron.appUpdate.retryDownload();
    }
  }, [
    appUpdateState.info?.manualDownloadOnly,
    appUpdateState.readyFilePath,
    appUpdateState.status,
    showToast,
  ]);

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
        dispatch(setAvailableModels(allModels));
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
      toastOnCloseRef.current = null;
    };
  }, []);

  // Listen for toast events from child components
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<({ message: string } & AppToastOptions) | string>).detail;
      if (!detail) return;
      if (typeof detail === 'string') {
        showToast(detail);
      } else {
        showToast(detail.message, detail);
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
      if (managedModelsOnly) return;
      setShowSettings(false);
      setMainView('localInference');
    };
    window.addEventListener('app:show-local-inference', handler);
    return () => window.removeEventListener('app:show-local-inference', handler);
  }, [managedModelsOnly]);

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

  const isOverlayActive = showSettings;
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
      <WindowTitleBar isOverlayActive={isOverlayActive} />
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
      <div className="h-screen overflow-hidden flex flex-col">
        {windowsStandaloneTitleBar}
        <div className="flex-1 flex flex-col items-center justify-center bg-background">
          <div className="flex flex-col items-center space-y-6 max-w-md px-6">
            <div className="w-16 h-16 rounded-full bg-destructive flex items-center justify-center shadow-lg">
              <MessageCircle className="h-8 w-8 text-destructive-foreground" />
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
            <LazyChunkErrorBoundary>
              <React.Suspense fallback={null}>
                <Settings
                  onClose={handleCloseSettings}
                  initialTab={settingsOptions.initialTab}
                  notice={settingsOptions.notice}
                  enterpriseConfig={enterpriseConfig}
                  appUpdateState={appUpdateState}
                  managedModelsOnly={managedModelsOnly}
                />
              </React.Suspense>
            </LazyChunkErrorBoundary>
          )}
        </div>
      </div>
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
          <Toast
            message={toastMessage}
            isError={isToastError}
            isSuccess={isToastSuccess}
            onClose={dismissToast}
          />
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
            hideLogin={false}
            managedModelsOnly={managedModelsOnly}
            onPrefetchView={prefetchFeatureView}
          />
          <div
            className={`flex-1 min-w-0 py-1.5 px-1.5 transition-[padding] duration-200 ease-out`}
          >
            <div className="relative h-full min-h-0 rounded-xl bg-background overflow-hidden contain-[layout_style_paint]">
              {hasMountedLocalInference && !managedModelsOnly && (
                <div
                  className={
                    mainView === 'localInference' ? 'h-full min-h-0' : 'hidden h-full min-h-0'
                  }
                >
                  {/* Dedicated boundary so another view's lazy chunk loading never unmounts this keep-alive view. */}
                  <LazyChunkErrorBoundary resetKey={mainView}>
                    <React.Suspense fallback={null}>
                      <LocalInferenceView
                        installRequestId={localInferenceInstallRequestId}
                        onInstallRequestHandled={handleLocalInferenceInstallRequestHandled}
                        isSidebarCollapsed={isSidebarCollapsed}
                        isVisible={mainView === 'localInference'}
                        onToggleSidebar={handleToggleSidebar}
                        onNewChat={handleNewChat}
                        onOpenModelSettings={() => handleShowSettings({ initialTab: 'model' })}
                        updateBadge={null}
                      />
                    </React.Suspense>
                  </LazyChunkErrorBoundary>
                </div>
              )}
              <LazyChunkErrorBoundary resetKey={mainView}>
                <React.Suspense fallback={lazyViewFallback}>
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
                  ) : mainView === 'activity' ? (
                    <ActivityView
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
                      openRegistryId={mcpOpenRegistryId}
                      openMarketplace={mcpOpenMarketplace}
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
                      onChatWithExpert={handleChatWithExpert}
                      onUseMcp={handleTryMcp}
                      initialTab={expertInitialTab}
                    />
                  ) : mainView === 'coding' ? (
                    <CodingWorkbenchView
                      workspaceRoot={codingSelection.workspaceRoot}
                      selectedLaneId={codingSelection.laneId}
                      draftSession={codingSelection.draft}
                      onSessionDraftCreated={setCodingSelection}
                      onSessionCreated={laneId =>
                        setCodingSelection(current => ({ ...current, laneId, draft: null }))
                      }
                      onLaneSelected={laneId =>
                        setCodingSelection(current => ({ ...current, laneId, draft: null }))
                      }
                      isSidebarCollapsed={isSidebarCollapsed}
                      onToggleSidebar={handleToggleSidebar}
                    />
                  ) : mainView === 'todo' ? (
                    <TodoView
                      isSidebarCollapsed={isSidebarCollapsed}
                      onToggleSidebar={handleToggleSidebar}
                      onNewChat={handleNewChat}
                      updateBadge={null}
                    />
                  ) : mainView === 'localInference' ? null : (
                    <CoworkView
                      onRequestAppSettings={handleShowSettings}
                      onShowSkills={handleShowSkills}
                      onShowConnectors={handleShowMcpMarketplace}
                      isSidebarCollapsed={isSidebarCollapsed}
                      onToggleSidebar={handleToggleSidebar}
                      onNewChat={handleNewChat}
                      updateBadge={null}
                      inlineQuestionPermission={isInlineAskUserQuestion ? pendingPermission : null}
                      onRespondToInlineQuestion={handlePermissionResponse}
                      inlinePermission={
                        pendingPermission &&
                        mainView === 'cowork' &&
                        pendingPermission.sessionId === currentSessionId &&
                        !isInlineAskUserQuestion
                          ? pendingPermission
                          : null
                      }
                      onRespondToInlinePermission={handlePermissionResponse}
                    />
                  )}
                </React.Suspense>
              </LazyChunkErrorBoundary>
            </div>
          </div>
        </div>

        {/* 设置窗口显示在所有主内容之上，但不影响主界面的交互 */}
        {showSettings && (
          <LazyChunkErrorBoundary>
            <React.Suspense fallback={null}>
              <Settings
                onClose={handleCloseSettings}
                initialTab={settingsOptions.initialTab}
                notice={settingsOptions.notice}
                enterpriseConfig={enterpriseConfig}
                appUpdateState={appUpdateState}
                managedModelsOnly={managedModelsOnly}
              />
            </React.Suspense>
          </LazyChunkErrorBoundary>
        )}
      </div>
    </TooltipProvider>
  );
};

export default App;
