import { Button } from '@shared/components/ui/button';
import { LayeredTabsContent } from '@shared/components/ui/layered-tabs';
import { Tabs } from '@shared/components/ui/tabs';
import { Globe, PanelLeft, Pencil, Settings2 } from 'lucide-react';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type {
  LlamaCppInstallProgress,
  LlamaCppModel as OllamaModel,
  LlamaCppModelLaunchInput,
  LlamaCppModelPreferences,
  LlamaCppRunningModel as OllamaRunningModel,
  LlamaCppStatusSnapshot as OllamaStatusSnapshot,
} from '../../../shared/llamacpp';
import type { MarketplaceModel, MarketplaceSearchParams } from '../../../shared/marketplace';
import { notifyLlamaCppRunningModelsChanged } from '../../services/availableModels';
import { i18nService } from '../../services/i18n';
import WindowTitleBar from '../window/WindowTitleBar';
import { LocalInferenceToastView } from './components/Common';
import { LocalInferenceAccessSettingsDialog } from './components/LocalInferenceAccessSettingsDialog';
import { LocalInferenceTabSelector } from './components/LocalInferenceTabSelector';
import { ModelContextSettingsModal } from './components/ModelContextSettingsModal';
import { ModelLibrarySettingsModal } from './components/ModelLibrarySettingsModal';
import { ModelLaunchLogSidebar } from './components/ModelLaunchLogSidebar';
import {
  LOCAL_INFERENCE_PROGRESS_DISMISS_MS,
  LOCAL_INFERENCE_TOAST_AUTO_DISMISS_MS,
  LOCAL_INFERENCE_UNLOAD_MIN_BUSY_MS,
  LOCAL_INFERENCE_UNLOAD_SETTLE_POLL_INTERVAL_MS,
  LOCAL_INFERENCE_UNLOAD_SETTLE_TIMEOUT_MS,
} from './constants';
import { useI18nLanguage } from './hooks/useI18nLanguage';
import { useLocalInferenceAccessSettings } from './hooks/useLocalInferenceAccessSettings';
import { useMarketplaceRecommendations } from './hooks/useMarketplaceRecommendations';
import { shouldCloseLaunchLogPanelForModel, useModelLaunchLogs } from './hooks/useModelLaunchLogs';
import { MarketplacePanel } from './panels/MarketplacePanel';
import { ModelsPanel } from './panels/ModelsPanel';
import type {
  InstallProgressState,
  LocalInferenceSessionState,
  LocalInferenceTab,
  LocalInferenceToast,
  LocalInferenceToastKind as LocalInferenceToastKindType,
} from './types';
import { LocalInferenceToastKind } from './types';
import { getLocalInferenceUserFacingErrorMessage } from './utils/errors';
import {
  buildMarketplaceSearchParams,
  getInstallableMarketplaceModels,
  getMarketplacePageSize,
} from './utils/marketplace';
import {
  formatInstallProgressSummary,
  getLocalInferenceProgressDismissMs,
  getLocalInferenceToastAutoDismissMs,
  isInstallTerminalPhase,
  isPullInProgress,
  normalizeInstallProgress,
} from './utils/progress';
import {
  readLocalInferenceSessionState,
  writeLocalInferenceSessionState,
} from './utils/sessionState';

interface LocalInferenceViewProps {
  isSidebarCollapsed?: boolean;
  isVisible?: boolean;
  onToggleSidebar?: () => void;
  onNewChat?: () => void;
  updateBadge?: React.ReactNode;
}

const LlamaCppServiceAction = {
  Ready: 'ready',
  Install: 'install',
  Start: 'start',
  Refresh: 'refresh',
} as const;

type LlamaCppServiceAction = (typeof LlamaCppServiceAction)[keyof typeof LlamaCppServiceAction];

const LOCAL_INFERENCE_TAB_ORDER: LocalInferenceTab[] = ['models', 'marketplace'];

let cachedStatus: OllamaStatusSnapshot | null = null;

const LocalInferenceView: React.FC<LocalInferenceViewProps> = ({
  isSidebarCollapsed,
  isVisible = true,
  onToggleSidebar,
  onNewChat,
  updateBadge,
}) => {
  const restoredSessionRef = useRef<LocalInferenceSessionState | null>(null);
  if (restoredSessionRef.current === null) {
    restoredSessionRef.current = readLocalInferenceSessionState();
  }
  const restoredSession = restoredSessionRef.current;
  const isMac = window.electron.platform === 'darwin';
  const [activeTab, setActiveTab] = useState<LocalInferenceTab>(
    restoredSession?.activeTab ?? 'models',
  );
  const [tabDirection, setTabDirection] = useState(1);
  const [status, setStatus] = useState<OllamaStatusSnapshot | null>(cachedStatus);
  const [localModels, setLocalModels] = useState<OllamaModel[]>([]);
  const [runningModels, setRunningModels] = useState<OllamaRunningModel[]>([]);
  const [modelsDir, setModelsDir] = useState('');
  const [modelPreferences, setModelPreferences] = useState<LlamaCppModelPreferences>({});
  const [librarySettingsOpen, setLibrarySettingsOpen] = useState(false);
  const [draftModelsDir, setDraftModelsDir] = useState('');
  const [contextModel, setContextModel] = useState<OllamaModel | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingModelName, setLoadingModelName] = useState<string | null>(null);
  const [unloadingModelName, setUnloadingModelName] = useState<string | null>(null);
  const [toast, setToast] = useState<LocalInferenceToast | null>(null);
  const [activePullName, setActivePullName] = useState<string | null>(null);
  const [pullProgress, setPullProgress] = useState<InstallProgressState>({});
  const isRunning = status?.status === 'running';
  const activePullProgress = activePullName ? pullProgress[activePullName] : undefined;
  const pulling = isPullInProgress(activePullProgress);
  const [marketplaceModels, setMarketplaceModels] = useState<MarketplaceModel[]>([]);
  const [marketplaceLoading, setMarketplaceLoading] = useState(false);
  const [marketplaceError, setMarketplaceError] = useState<string | null>(null);
  const [marketplaceQuery, setMarketplaceQuery] = useState('');
  const [marketplaceHasSearched, setMarketplaceHasSearched] = useState(false);
  const [marketplaceToken, setMarketplaceToken] = useState<string | null>(null);
  useI18nLanguage();
  const launchLogs = useModelLaunchLogs();
  const marketplaceSearchRef = useRef<number>(0);
  const loadingModelNameRef = useRef<string | null>(null);
  const marketplaceQueryRef = useRef(marketplaceQuery);
  const marketplaceHasSearchedRef = useRef(marketplaceHasSearched);
  const toastTimerRef = useRef<number | null>(null);
  const installProgressDismissTimersRef = useRef<Record<string, number>>({});
  const installedModelPathMap = useMemo(
    () =>
      new Map(
        localModels
          .filter((model): model is OllamaModel & { path: string } => Boolean(model.path))
          .map(model => [model.path, model.name]),
      ),
    [localModels],
  );

  useEffect(() => {
    void window.electron.marketplace
      .getToken()
      .then(setMarketplaceToken)
      .catch(() => setMarketplaceToken(null));
  }, []);

  const dismissToast = useCallback(() => {
    if (toastTimerRef.current) {
      window.clearTimeout(toastTimerRef.current);
      toastTimerRef.current = null;
    }
    setToast(null);
  }, []);

  const showToast = useCallback(
    (
      message: string,
      kind: LocalInferenceToastKindType = LocalInferenceToastKind.Info,
      autoDismiss = true,
    ) => {
      if (toastTimerRef.current) {
        window.clearTimeout(toastTimerRef.current);
        toastTimerRef.current = null;
      }
      setToast({
        id:
          globalThis.crypto?.randomUUID?.() ??
          `${Date.now()}-${Math.random().toString(16).slice(2)}`,
        kind,
        message,
        autoDismiss,
      });
    },
    [],
  );

  const clearInstallProgressDismissTimer = useCallback((name: string) => {
    const timer = installProgressDismissTimersRef.current[name];
    if (!timer) return;
    window.clearTimeout(timer);
    delete installProgressDismissTimersRef.current[name];
  }, []);

  const scheduleInstallProgressDismiss = useCallback(
    (name: string, phase: LlamaCppInstallProgress['phase']) => {
      clearInstallProgressDismissTimer(name);
      installProgressDismissTimersRef.current[name] = window.setTimeout(() => {
        setPullProgress(current => {
          if (current[name]?.phase !== phase) return current;
          const { [name]: _completedProgress, ...nextProgress } = current;
          return nextProgress;
        });
        delete installProgressDismissTimersRef.current[name];
      }, LOCAL_INFERENCE_PROGRESS_DISMISS_MS);
    },
    [clearInstallProgressDismissTimer],
  );

  const searchMarketplace = useCallback(async (params: MarketplaceSearchParams) => {
    const id = ++marketplaceSearchRef.current;
    setMarketplaceLoading(true);
    setMarketplaceError(null);
    try {
      const result = await window.electron.marketplace.search(params);
      if (id === marketplaceSearchRef.current) {
        setMarketplaceModels(result.models);
        setMarketplaceError(result.warning ?? null);
      }
    } catch (searchError) {
      if (id === marketplaceSearchRef.current) {
        setMarketplaceError(getLocalInferenceUserFacingErrorMessage(searchError));
      }
    } finally {
      if (id === marketplaceSearchRef.current) {
        setMarketplaceLoading(false);
      }
    }
  }, []);

  const handleMarketplaceSearch = useCallback(() => {
    const params = buildMarketplaceSearchParams({
      query: marketplaceQuery,
    });
    if (!params) {
      setMarketplaceHasSearched(false);
      setMarketplaceModels([]);
      setMarketplaceError(null);
      return;
    }
    setMarketplaceHasSearched(true);
    void searchMarketplace(params);
  }, [marketplaceQuery, searchMarketplace]);

  const refreshStatus = useCallback(async () => {
    const nextStatus = await window.electron.llamacpp.status();
    cachedStatus = nextStatus;
    setStatus(nextStatus);
    return nextStatus;
  }, []);

  const refreshLocalModels = useCallback(async () => {
    const models = await window.electron.llamacpp.listLocalModels();
    setLocalModels(models);
    return models;
  }, []);

  const refreshModelsDir = useCallback(async () => {
    const nextModelsDir = await window.electron.llamacpp.modelsDir();
    setModelsDir(nextModelsDir);
    setDraftModelsDir(current => current || nextModelsDir);
    return nextModelsDir;
  }, []);

  const refreshModelPreferences = useCallback(async () => {
    const nextPreferences = await window.electron.llamacpp.getModelPreferences();
    setModelPreferences(nextPreferences);
    return nextPreferences;
  }, []);

  const refreshRunningModels = useCallback(async () => {
    const models = await window.electron.llamacpp.listRunningModels();
    setRunningModels(models);
    return models;
  }, []);

  const waitForUnloadSettle = useCallback(
    async (modelName: string) => {
      const deadline = Date.now() + LOCAL_INFERENCE_UNLOAD_SETTLE_TIMEOUT_MS;
      let latestModels = await refreshRunningModels();
      while (
        latestModels.some(model => model.name === modelName || model.model === modelName) &&
        Date.now() < deadline
      ) {
        await new Promise<void>(resolve => {
          window.setTimeout(resolve, LOCAL_INFERENCE_UNLOAD_SETTLE_POLL_INTERVAL_MS);
        });
        latestModels = await refreshRunningModels();
      }
      return latestModels;
    },
    [refreshRunningModels],
  );

  const handleMarketplaceInstall = useCallback(
    async (model: MarketplaceModel) => {
      if (pulling) {
        showToast(
          i18nService.t('marketplaceInstallAlreadyInProgress'),
          LocalInferenceToastKind.Info,
        );
        return;
      }
      const name = model.repoId;
      clearInstallProgressDismissTimer(name);
      setActivePullName(name);
      setPullProgress(current => ({
        ...current,
        [name]: { phase: 'starting', modelId: model.repoId, modelName: model.repoId },
      }));
      dismissToast();
      try {
        const result = await window.electron.llamacpp.installModel({
          modelId: model.repoId,
          filePath: model.filePath,
          displayName: model.repoId,
        });
        if (!result.success) return;
        await refreshLocalModels();
        setMarketplaceModels(prev =>
          prev.map(m => (m.repoId === name ? { ...m, installed: true } : m)),
        );
        showToast(
          i18nService.t('marketplacePullDone').replace('{name}', name),
          LocalInferenceToastKind.Success,
        );
      } catch (installError) {
        showToast(
          getLocalInferenceUserFacingErrorMessage(installError),
          LocalInferenceToastKind.Error,
        );
      }
    },
    [clearInstallProgressDismissTimer, dismissToast, pulling, refreshLocalModels, showToast],
  );

  const runAction = useCallback(
    async (action: () => Promise<void>) => {
      setLoading(true);
      dismissToast();
      try {
        await action();
      } catch (actionError) {
        showToast(
          getLocalInferenceUserFacingErrorMessage(actionError),
          LocalInferenceToastKind.Error,
        );
      } finally {
        setLoading(false);
      }
    },
    [dismissToast, showToast],
  );
  const handleRestartStatus = useCallback((nextStatus: OllamaStatusSnapshot) => {
    cachedStatus = nextStatus;
    setStatus(nextStatus);
  }, []);

  const {
    accessSettingsOpen,
    draftAllowLanAccess,
    draftPort,
    exampleModelName,
    setDraftPort,
    refreshServiceConfig,
    openAccessSettings,
    closeAccessSettings,
    saveAccessSettings,
    setDraftAllowLanAccess,
  } = useLocalInferenceAccessSettings({
    isRunning,
    localModels,
    runningModels,
    runAction,
    refreshLocalModels,
    onRestartStatus: handleRestartStatus,
    showToast,
  });

  useEffect(() => {
    marketplaceQueryRef.current = marketplaceQuery;
  }, [marketplaceQuery]);

  useEffect(() => {
    marketplaceHasSearchedRef.current = marketplaceHasSearched;
  }, [marketplaceHasSearched]);

  useMarketplaceRecommendations({
    activeTab,
    hasSearched: marketplaceHasSearched,
    query: marketplaceQuery,
    onHasSearchedChange: setMarketplaceHasSearched,
    onSearch: searchMarketplace,
  });

  const sessionSaveTimerRef = useRef<number | null>(null);
  useEffect(() => {
    if (sessionSaveTimerRef.current !== null) {
      window.clearTimeout(sessionSaveTimerRef.current);
    }
    sessionSaveTimerRef.current = window.setTimeout(() => {
      sessionSaveTimerRef.current = null;
      writeLocalInferenceSessionState({
        activeTab,
      });
    }, 500);
    return () => {
      if (sessionSaveTimerRef.current !== null) {
        window.clearTimeout(sessionSaveTimerRef.current);
      }
    };
  }, [activeTab]);

  useEffect(() => {
    if (!toast?.autoDismiss) return;
    toastTimerRef.current = window.setTimeout(() => {
      setToast(current => (current?.id === toast.id ? null : current));
      toastTimerRef.current = null;
    }, LOCAL_INFERENCE_TOAST_AUTO_DISMISS_MS);
    return () => {
      if (toastTimerRef.current) {
        window.clearTimeout(toastTimerRef.current);
        toastTimerRef.current = null;
      }
    };
  }, [toast]);

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) {
        window.clearTimeout(toastTimerRef.current);
      }
      Object.values(installProgressDismissTimersRef.current).forEach(timer => {
        window.clearTimeout(timer);
      });
      installProgressDismissTimersRef.current = {};
    };
  }, []);

  useEffect(() => {
    void runAction(async () => {
      const nextStatus = await refreshStatus();
      await refreshLocalModels();
      await refreshModelsDir();
      await refreshServiceConfig();
      await refreshModelPreferences();
      if (nextStatus.status === 'running') {
        await refreshRunningModels();
      }
    });
  }, [
    refreshLocalModels,
    refreshModelPreferences,
    refreshModelsDir,
    refreshRunningModels,
    refreshServiceConfig,
    refreshStatus,
    runAction,
  ]);

  useEffect(() => {
    const unsubscribers = [
      window.electron.llamacpp.onStatusChanged(nextStatus => {
        cachedStatus = nextStatus;
        setStatus(nextStatus);
        if (nextStatus.status !== 'running') {
          setRunningModels([]);
        }
      }),
      window.electron.llamacpp.onPullProgress(({ name, chunk }) => {
        const progress = normalizeInstallProgress(name, chunk);
        if (!isInstallTerminalPhase(progress.phase)) {
          clearInstallProgressDismissTimer(name);
        }
        setPullProgress(current => ({ ...current, [name]: progress }));
        if (isInstallTerminalPhase(progress.phase)) {
          scheduleInstallProgressDismiss(name, progress.phase);
          void refreshLocalModels().catch(() => undefined);
          if (progress.phase === 'done') {
            const params = buildMarketplaceSearchParams({ query: marketplaceQueryRef.current });
            if (marketplaceHasSearchedRef.current && params) {
              void searchMarketplace(params).catch(() => undefined);
            }
            setMarketplaceModels(prev =>
              prev.map(m => (m.repoId === name ? { ...m, installed: true } : m)),
            );
          }
        }
      }),
    ];
    return () => {
      unsubscribers.forEach(unsubscribe => unsubscribe());
    };
  }, [
    clearInstallProgressDismissTimer,
    refreshLocalModels,
    scheduleInstallProgressDismiss,
    searchMarketplace,
  ]);

  useEffect(() => {
    if (!isRunning) return;
    const timer = window.setInterval(() => {
      void refreshRunningModels().catch(() => undefined);
    }, 5000);
    return () => window.clearInterval(timer);
  }, [isRunning, refreshRunningModels]);

  const handleLoadModel = (model: OllamaModel) => {
    const modelName = model.name;
    if (loadingModelNameRef.current) return;
    loadingModelNameRef.current = modelName;
    setLoadingModelName(modelName);
    launchLogs.beginModelLaunch(modelName, { visible: false });
    void runAction(async () => {
      try {
        const input: LlamaCppModelLaunchInput = {
          model: modelName,
          ...(model.path ? { modelPath: model.path } : {}),
        };
        const result = await window.electron.llamacpp.loadModel(input);
        setRunningModels(result.runningModels);
        launchLogs.markModelLaunchSucceeded();
        notifyLlamaCppRunningModelsChanged();
        if (result.warning) {
          showToast(result.warning, LocalInferenceToastKind.Info);
        }
      } catch (loadError) {
        launchLogs.markModelLaunchFailed();
        throw loadError;
      } finally {
        loadingModelNameRef.current = null;
        setLoadingModelName(current => (current === modelName ? null : current));
      }
    });
  };

  const handleUnload = (modelName: string) => {
    if (shouldBlockModelAction({ modelName, unloadingModelName })) return;
    const unloadStartedAtMs = Date.now();
    setUnloadingModelName(modelName);
    if (shouldCloseLaunchLogPanelForModel(launchLogs.state, modelName)) {
      launchLogs.closePanel();
    }
    void runAction(async () => {
      try {
        const result = await window.electron.llamacpp.unloadModel(modelName);
        let latestRunningModels = result.runningModels;
        setRunningModels(latestRunningModels);
        if (!result.confirmed) {
          latestRunningModels = await waitForUnloadSettle(modelName);
        }
        notifyLlamaCppRunningModelsChanged();
        if (result.warning) {
          const stillVisible = latestRunningModels.some(
            model => model.name === modelName || model.model === modelName,
          );
          if (result.confirmed || stillVisible) {
            showToast(result.warning, LocalInferenceToastKind.Info);
          }
        }
      } finally {
        const remainingBusyMs = getRemainingBusyMs({
          startedAtMs: unloadStartedAtMs,
          nowMs: Date.now(),
          minimumBusyMs: LOCAL_INFERENCE_UNLOAD_MIN_BUSY_MS,
        });
        if (remainingBusyMs > 0) {
          await new Promise<void>(resolve => {
            window.setTimeout(resolve, remainingBusyMs);
          });
        }
        setUnloadingModelName(current => (current === modelName ? null : current));
      }
    });
  };

  const handleDelete = (modelName: string) => {
    if (shouldBlockModelAction({ modelName, unloadingModelName })) return;
    void runAction(async () => {
      await window.electron.llamacpp.deleteModel(modelName);
      await refreshLocalModels();
      await refreshRunningModels();
      await refreshModelPreferences();
      setMarketplaceModels(prev =>
        prev.map(m => {
          const repoName = m.repoId.split('/').pop();
          return repoName === modelName ? { ...m, installed: false } : m;
        }),
      );
      notifyLlamaCppRunningModelsChanged();
    });
  };

  const handleSaveModelsDir = useCallback(
    (targetModelsDir = draftModelsDir) => {
      void runAction(async () => {
        const nextModelsDir = await window.electron.llamacpp.setModelsDir(targetModelsDir);
        setModelsDir(nextModelsDir);
        setDraftModelsDir(nextModelsDir);
        await refreshLocalModels();
        setRunningModels([]);
        const params = buildMarketplaceSearchParams({ query: marketplaceQueryRef.current });
        if (marketplaceHasSearchedRef.current && params) {
          await searchMarketplace(params);
        }
        showToast(
          isRunning
            ? i18nService.t('localInferenceLibrarySavedRestarted')
            : i18nService.t('localInferenceLibrarySaved'),
          LocalInferenceToastKind.Success,
        );
        setLibrarySettingsOpen(false);
      });
    },
    [draftModelsDir, isRunning, refreshLocalModels, runAction, searchMarketplace, showToast],
  );

  const handlePickModelsDir = useCallback(async () => {
    const result = await window.electron.dialog.selectDirectory();
    if (result.success && result.path) {
      setDraftModelsDir(result.path);
      handleSaveModelsDir(result.path);
    }
  }, [handleSaveModelsDir]);

  const handleOpenModelsDir = useCallback(() => {
    if (!modelsDir.trim()) return;
    void window.electron.shell.openPath(modelsDir.trim());
  }, [modelsDir]);

  const handleSaveModelContext = useCallback(
    (modelName: string, ctxSize?: number) => {
      void runAction(async () => {
        const nextPreferences = await window.electron.llamacpp.setModelPreference({
          modelName,
          preference: ctxSize ? { ctxSize } : {},
        });
        setModelPreferences(nextPreferences);
        const runningModel = runningModels.find(
          model => model.name === modelName || model.model === modelName,
        );
        showToast(
          runningModel
            ? i18nService.t('localInferenceContextSavedReloadRequired')
            : i18nService.t('localInferenceContextSaved'),
          LocalInferenceToastKind.Success,
        );
        setContextModel(null);
      });
    },
    [runAction, runningModels, showToast],
  );

  const handleTabChange = (value: string) => {
    const nextTab = value as LocalInferenceTab;
    if (nextTab === activeTab) return;
    setTabDirection(
      LOCAL_INFERENCE_TAB_ORDER.indexOf(nextTab) >=
        LOCAL_INFERENCE_TAB_ORDER.indexOf(activeTab)
        ? 1
        : -1,
    );
    setActiveTab(nextTab);
  };

  return (
    <div className="relative flex h-full flex-1 flex-col bg-background">
      <Tabs
        value={activeTab}
        onValueChange={handleTabChange}
        className="flex h-full min-h-0 flex-1 flex-col gap-0"
      >
      <div className="draggable flex h-12 items-center justify-between px-4 border-b border-border shrink-0">
        <div className="flex items-center space-x-3 h-8">
          {isSidebarCollapsed && (
            <div className={`non-draggable flex items-center gap-1 ${isMac ? 'pl-[68px]' : ''}`}>
              <button
                type="button"
                onClick={onToggleSidebar}
                className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-foreground/70 transition-colors hover:bg-surface-raised hover:text-foreground"
              >
                <PanelLeft className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={onNewChat}
                className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-foreground/70 transition-colors hover:bg-surface-raised hover:text-foreground"
              >
                <Pencil className="h-4 w-4" />
              </button>
              {updateBadge}
            </div>
          )}
          <h1 className="text-lg font-semibold text-foreground">
            {i18nService.t('localInferenceTitle')}
          </h1>
        </div>
        <WindowTitleBar inline />
      </div>
      <LocalInferenceTabSelector activeTab={activeTab} isVisible={isVisible} />
      {toast && (
        <div className="pointer-events-none absolute right-4 top-16 z-30 flex w-[min(24rem,calc(100%-2rem))] justify-end">
          <LocalInferenceToastView toast={toast} onClose={dismissToast} />
        </div>
      )}
        <div className="flex min-h-0 flex-1 overflow-hidden">
        <div className="min-w-0 flex-1 overflow-y-auto scrollbar-gutter-stable">
          <div className="w-full space-y-4 px-6 py-4">
            {activeTab === 'models' ? (
              <div className="flex flex-wrap items-center justify-end gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  data-local-inference-toolbar-button="true"
                  onClick={openAccessSettings}
                >
                  <Globe data-icon="inline-start" />
                  {i18nService.t('localInferenceAccessSettings')}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  data-local-inference-toolbar-button="true"
                  onClick={() => {
                    setDraftModelsDir(modelsDir);
                    setLibrarySettingsOpen(true);
                  }}
                >
                  <Settings2 data-icon="inline-start" />
                  {i18nService.t('localInferenceLibrarySettings')}
                </Button>
              </div>
            ) : null}

            <LayeredTabsContent
              value="models"
              activeValue={activeTab}
              direction={tabDirection}
              className="min-h-0"
              contentClassName="min-h-0"
            >
                <ModelsPanel
                  loading={loading}
                  loadingModelName={loadingModelName}
                  unloadingModelName={unloadingModelName}
                  localModels={localModels}
                  runningModels={runningModels}
                  modelPreferences={modelPreferences}
                  onLoadModel={model => {
                    handleLoadModel(model);
                  }}
                  onUnload={handleUnload}
                  onDelete={handleDelete}
                  onConfigureContext={model => {
                    setContextModel(model);
                  }}
                  onOpenLaunchLog={launchLogs.openPanelForModel}
                  showRegisteredModelsTitle={false}
                  logPanelVisible={launchLogs.state.visible}
                />
            </LayeredTabsContent>
            <LayeredTabsContent
              value="marketplace"
              activeValue={activeTab}
              direction={tabDirection}
              className="min-h-0"
              contentClassName="min-h-0"
            >
              <MarketplacePanel
                loading={loading}
                models={marketplaceModels}
                hasSearched={marketplaceHasSearched}
                marketplaceLoading={marketplaceLoading}
                marketplaceError={marketplaceError}
                query={marketplaceQuery}
                installedModelPathMap={installedModelPathMap}
                installProgress={pullProgress}
                savedToken={marketplaceToken}
                onTokenSaved={setMarketplaceToken}
                onQueryChange={setMarketplaceQuery}
                onSearch={handleMarketplaceSearch}
                onInstall={handleMarketplaceInstall}
              />
            </LayeredTabsContent>
          </div>
        </div>
        <ModelLaunchLogSidebar state={launchLogs.state} onClose={launchLogs.closePanel} />
        </div>
      </Tabs>

      <ModelLibrarySettingsModal
        isOpen={librarySettingsOpen}
        modelsDir={modelsDir}
        draftModelsDir={draftModelsDir}
        saving={loading}
        onClose={() => setLibrarySettingsOpen(false)}
        onChangeModelsDir={setDraftModelsDir}
        onPickDirectory={handlePickModelsDir}
        onOpenDirectory={handleOpenModelsDir}
      />
      <LocalInferenceAccessSettingsDialog
        isOpen={accessSettingsOpen}
        saving={loading}
        allowLanAccess={draftAllowLanAccess}
        willRestartOnSave={isRunning}
        port={draftPort}
        exampleModelName={exampleModelName}
        onAllowLanAccessChange={setDraftAllowLanAccess}
        onPortChange={setDraftPort}
        onClose={closeAccessSettings}
        onSave={saveAccessSettings}
      />
      <ModelContextSettingsModal
        isOpen={Boolean(contextModel)}
        model={contextModel}
        savedContextSize={contextModel ? modelPreferences[contextModel.name]?.ctxSize : undefined}
        runningContextSize={
          contextModel
            ? runningModels.find(
                model => model.name === contextModel.name || model.model === contextModel.name,
              )?.runtime_context_length
            : undefined
        }
        onClose={() => setContextModel(null)}
        onSave={ctxSize => {
          if (!contextModel) return;
          handleSaveModelContext(contextModel.name, ctxSize);
        }}
      />
    </div>
  );
};

function getModelCardBusyState(input: {
  modelName: string;
  loadingModelName: string | null;
  unloadingModelName: string | null;
  globalLoading: boolean;
}): { cardBusy: boolean; buttonsDisabled: boolean } {
  const cardBusy = Boolean(
    input.loadingModelName === input.modelName || input.unloadingModelName === input.modelName,
  );
  const anotherModelLoading = Boolean(
    input.loadingModelName && input.loadingModelName !== input.modelName,
  );
  return {
    cardBusy,
    buttonsDisabled: input.globalLoading || cardBusy || anotherModelLoading,
  };
}

function shouldBlockModelAction(input: {
  modelName: string;
  unloadingModelName: string | null;
}): boolean {
  return Boolean(input.unloadingModelName && input.unloadingModelName === input.modelName);
}

function getRemainingBusyMs(input: {
  startedAtMs: number;
  nowMs: number;
  minimumBusyMs: number;
}): number {
  return Math.max(0, input.minimumBusyMs - Math.max(0, input.nowMs - input.startedAtMs));
}

function resolveLlamaCppServiceAction(
  snapshot: Pick<OllamaStatusSnapshot, 'status'> | null | undefined,
): LlamaCppServiceAction {
  switch (snapshot?.status) {
    case 'running':
      return LlamaCppServiceAction.Ready;
    case 'not-installed':
      return LlamaCppServiceAction.Install;
    case 'installed':
    case 'stopped':
      return LlamaCppServiceAction.Start;
    default:
      return LlamaCppServiceAction.Refresh;
  }
}

export const __test__getMarketplacePageSize = (viewportHeight?: number, viewportWidth?: number) =>
  getMarketplacePageSize(viewportHeight, viewportWidth);
export const __test__buildMarketplaceSearchParams = (
  input: Parameters<typeof buildMarketplaceSearchParams>[0],
) => buildMarketplaceSearchParams(input);
export const __test__getInstallableMarketplaceModels = (
  models: MarketplaceModel[],
  installedModelPathMap: Map<string, string>,
) => getInstallableMarketplaceModels(models, installedModelPathMap);
export const __test__getModelCardBusyState = (input: {
  modelName: string;
  loadingModelName: string | null;
  unloadingModelName: string | null;
  globalLoading: boolean;
}) => getModelCardBusyState(input);
export const __test__shouldBlockModelAction = (input: {
  modelName: string;
  unloadingModelName: string | null;
}) => shouldBlockModelAction(input);
export const __test__getRemainingBusyMs = (input: {
  startedAtMs: number;
  nowMs: number;
  minimumBusyMs: number;
}) => getRemainingBusyMs(input);
export const __test__resolveLlamaCppServiceAction = (
  snapshot: Pick<OllamaStatusSnapshot, 'status'> | null | undefined,
) => resolveLlamaCppServiceAction(snapshot);
export const __test__isInstallTerminalPhase = (phase: LlamaCppInstallProgress['phase']) =>
  isInstallTerminalPhase(phase);
export const __test__getLocalInferenceToastAutoDismissMs = () =>
  getLocalInferenceToastAutoDismissMs();
export const __test__getLocalInferenceProgressDismissMs = () =>
  getLocalInferenceProgressDismissMs();
export const __test__formatInstallProgressSummary = (
  progress: Parameters<typeof formatInstallProgressSummary>[0],
) => formatInstallProgressSummary(progress);

export default LocalInferenceView;
