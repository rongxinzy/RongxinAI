import { LayeredTabsContent } from '@shared/components/ui/layered-tabs';
import { Tabs } from '@shared/components/ui/tabs';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type {
  LlamaCppModel as OllamaModel,
  LlamaCppRunningModel as OllamaRunningModel,
  LlamaCppStatusSnapshot as OllamaStatusSnapshot,
} from '../../../shared/llamacpp';
import { withMarketplaceScore } from '../../../shared/marketplace/scoring';
import { i18nService } from '../../services/i18n';
import {
  showAppErrorToast,
  showAppInfoToast,
  showAppSuccessToast,
} from '../../services/toastNotification';
import PageHeader from '../PageHeader';
import { PageTabs } from '@shared/components/ui/page-tabs';
import { LocalInferenceAccessSettingsDialog } from './components/LocalInferenceAccessSettingsDialog';
import { LocalInferenceMemorySettingsDialog } from './components/LocalInferenceMemorySettingsDialog';
import { LocalInferenceSettingsMenu } from './components/LocalInferenceSettingsMenu';
import { ModelInspectorSidebar, ModelInspectorTab } from './components/ModelInspectorSidebar';
import { ModelStartedDialog } from './components/ModelStartedDialog';
import { MarketplaceDownloadSidebar } from './components/MarketplaceDownloadSidebar';
import { ModelLibrarySettingsModal } from './components/ModelLibrarySettingsModal';
import { RuntimeInstallCard } from './components/RuntimeInstallCard';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@shared/components/ui/dialog';
import { useI18nLanguage } from './hooks/useI18nLanguage';
import { useLocalInferenceAccessSettings } from './hooks/useLocalInferenceAccessSettings';
import { useLocalInferenceMemorySettings } from './hooks/useLocalInferenceMemorySettings';
import { useLocalModelActions } from './hooks/useLocalModelActions';
import { useMarketplaceHardware } from './hooks/useMarketplaceHardware';
import { useMarketplaceInstall } from './hooks/useMarketplaceInstall';
import { useMarketplaceRecommendations } from './hooks/useMarketplaceRecommendations';
import { useMarketplaceSearch } from './hooks/useMarketplaceSearch';
import { useModelPreferences } from './hooks/useModelPreferences';
import { useRuntimeInstallBackgroundNotifications } from './hooks/useRuntimeInstallBackgroundNotifications';
import { useRuntimeInstallProgress } from './hooks/useRuntimeInstallProgress';
import { MarketplacePanel } from './panels/MarketplacePanel';
import { ModelsPanel } from './panels/ModelsPanel';
import {
  LocalInferenceToastKind,
  type LocalInferenceToastKind as LocalInferenceToastKindType,
  type LocalInferenceSessionState,
  type LocalInferenceTab,
} from './types';
import {
  filterMarketplaceModelsForDevice,
  filterMarketplaceModelsForRecommendation,
  buildMarketplaceSearchParams,
} from './utils/marketplace';
import { getRemainingBusyMs, shouldBlockModelAction } from './utils/modelActions';
import { getLocalInferenceUserFacingErrorMessage } from './utils/errors';
import {
  isSuccessfulMarketplaceInstallProgress,
  normalizeInstallProgress,
  isInstallTerminalPhase,
} from './utils/progress';
import {
  readLocalInferenceSessionState,
  writeLocalInferenceSessionState,
} from './utils/sessionState';
import { sameRunningModelSnapshot } from './utils/runningModels';

interface LocalInferenceViewProps {
  installRequestId?: string;
  onInstallRequestHandled?: (requestId: string) => void;
  refreshRequestId?: number;
  isSidebarCollapsed?: boolean;
  isVisible?: boolean;
  onToggleSidebar?: () => void;
  onNewChat?: () => void;
  onOpenModelSettings?: () => void;
  updateBadge?: React.ReactNode;
}

const LOCAL_INFERENCE_TAB_ORDER: LocalInferenceTab[] = ['models', 'marketplace'];

let cachedStatus: OllamaStatusSnapshot | null = null;

const LocalInferenceView: React.FC<LocalInferenceViewProps> = ({
  installRequestId,
  onInstallRequestHandled,
  refreshRequestId,
  isSidebarCollapsed,
  isVisible = true,
  onToggleSidebar,
  onNewChat,
  onOpenModelSettings,
  updateBadge,
}) => {
  const restoredSessionRef = useRef<LocalInferenceSessionState | null>(null);
  if (restoredSessionRef.current === null) {
    restoredSessionRef.current = readLocalInferenceSessionState();
  }
  const restoredSession = restoredSessionRef.current;
  const [activeTab, setActiveTab] = useState<LocalInferenceTab>(
    restoredSession?.activeTab ?? 'models',
  );
  const [runtimeSettingsOpen, setRuntimeSettingsOpen] = useState(Boolean(installRequestId));
  useEffect(() => {
    if (installRequestId) {
      setActiveTab('models');
      setRuntimeSettingsOpen(true);
    }
  }, [installRequestId]);
  const [tabDirection, setTabDirection] = useState(1);
  const [status, setStatus] = useState<OllamaStatusSnapshot | null>(cachedStatus);
  const [localModels, setLocalModels] = useState<OllamaModel[]>([]);
  const [runningModels, setRunningModels] = useState<OllamaRunningModel[]>([]);
  const [modelsDir, setModelsDir] = useState('');
  const [librarySettingsOpen, setLibrarySettingsOpen] = useState(false);
  const [draftModelsDir, setDraftModelsDir] = useState('');
  const [inspectorModel, setInspectorModel] = useState<OllamaModel | null>(null);
  const [inspectorInitialTab, setInspectorInitialTab] = useState<ModelInspectorTab>(
    ModelInspectorTab.Overview,
  );
  const [loading, setLoading] = useState(false);
  const isRunning = status?.status === 'running';
  const contentViewportRef = useRef<HTMLDivElement>(null);
  useI18nLanguage();
  const runtimeInstallProgress = useRuntimeInstallProgress();
  const { notifyBackgroundContinuation } = useRuntimeInstallBackgroundNotifications({
    isVisible,
    snapshot: runtimeInstallProgress.snapshot,
    refresh: runtimeInstallProgress.refresh,
  });
  const installedModelPathMap = useMemo(
    () =>
      new Map(
        localModels
          .filter((model): model is OllamaModel & { path: string } => Boolean(model.path))
          .map(model => [model.path, model.name]),
      ),
    [localModels],
  );
  const { hardware: marketplaceHardware, hardwareChecked: marketplaceHardwareChecked } =
    useMarketplaceHardware();
  const {
    marketplaceModels,
    marketplaceLoading,
    marketplaceError,
    marketplaceHasSearched,
    marketplaceTotalCount,
    marketplaceHasNextPage,
    marketplaceSearchParams,
    marketplaceQueryRef,
    marketplaceHasSearchedRef,
    setMarketplaceHasSearched,
    searchMarketplace,
    clearMarketplaceState,
    handleMarketplaceSearch,
    handleMarketplaceQueryChange,
    markMarketplaceInstalled,
    markMarketplaceUninstalled,
  } = useMarketplaceSearch();

  const showToast = useCallback(
    (message: string, kind: LocalInferenceToastKindType = LocalInferenceToastKind.Info) => {
      if (kind === LocalInferenceToastKind.Error) {
        showAppErrorToast(message);
      } else if (kind === LocalInferenceToastKind.Success) {
        showAppSuccessToast(message);
      } else {
        showAppInfoToast(message);
      }
    },
    [],
  );

  const { modelPreferences, refreshModelPreferences, saveModelPreferences } = useModelPreferences({
    runningModels,
    setLoading,
    showToast,
  });

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

  const refreshRunningModels = useCallback(async () => {
    const models = await window.electron.llamacpp.listRunningModels();
    // Polling rebuilds this array every tick; keep the previous reference when
    // nothing visible changed so memoized model cards skip re-rendering.
    setRunningModels(current => (sameRunningModelSnapshot(current, models) ? current : models));
    return models;
  }, []);

  const runAction = useCallback(
    async (action: () => Promise<void>) => {
      setLoading(true);
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
    [showToast],
  );

  const {
    pulling,
    activePullName,
    setPullProgress,
    clearInstallProgressDismissTimer,
    scheduleInstallProgressDismiss,
    handleMarketplaceInstall,
    openMarketplaceDownloadPanel,
    marketplaceDownloadModel,
    marketplaceDownloadPanelProgress,
    marketplaceDownloadPanelVisible,
    setMarketplaceDownloadPanelVisible,
  } = useMarketplaceInstall({
    showToast,
    refreshLocalModels,
    markMarketplaceInstalled,
  });

  const {
    loadingModelName,
    cancellingModelLoad,
    unloadingModelName,
    startedModelName,
    setStartedModelName,
    handleLoadModel,
    handleCancelModelLoad,
    handleUnload,
    handleDelete,
  } = useLocalModelActions({
    runAction,
    showToast,
    setRunningModels,
    refreshRunningModels,
    refreshLocalModels,
    refreshModelPreferences,
    markMarketplaceUninstalled,
  });

  const visibleMarketplaceModels = useMemo(() => {
    const scored = marketplaceModels.map(model =>
      withMarketplaceScore(model, {
        hardware: marketplaceHardware,
        task: marketplaceSearchParams.task,
      }),
    );
    const isRecommendationBrowse =
      marketplaceSearchParams.featuredOnly || marketplaceSearchParams.fit === 'recommended';
    const filtered =
      marketplaceSearchParams.fit === 'all'
        ? scored
        : isRecommendationBrowse
          ? filterMarketplaceModelsForRecommendation(scored)
          : filterMarketplaceModelsForDevice(
              scored,
              marketplaceSearchParams.fit,
              marketplaceSearchParams.minStars,
            );
    return filtered;
  }, [marketplaceHardware, marketplaceModels, marketplaceSearchParams]);

  const handleRestartStatus = useCallback((nextStatus: OllamaStatusSnapshot) => {
    cachedStatus = nextStatus;
    setStatus(nextStatus);
  }, []);

  const handleRuntimeSettingsOpenChange = useCallback(
    (open: boolean) => {
      if (!open) void notifyBackgroundContinuation();
      setRuntimeSettingsOpen(open);
    },
    [notifyBackgroundContinuation],
  );

  const {
    serviceConfig,
    accessSettingsOpen,
    draftAllowLanAccess,
    draftKeepRunningOnAppQuit,
    draftPort,
    draftLanToken,
    exampleModelName,
    setDraftKeepRunningOnAppQuit,
    setDraftPort,
    refreshServiceConfig,
    openAccessSettings,
    closeAccessSettings,
    saveAccessSettings,
    setDraftAllowLanAccess,
    regenerateLanToken,
  } = useLocalInferenceAccessSettings({
    isRunning,
    localModels,
    runningModels,
    runAction,
    refreshLocalModels,
    onRestartStatus: handleRestartStatus,
    showToast,
  });
  const {
    memorySettingsOpen,
    draftMemoryPolicy,
    draftMemoryBudgetPercent,
    systemMemorySnapshot,
    setDraftMemoryPolicy,
    setDraftMemoryBudgetPercent,
    openMemorySettings,
    closeMemorySettings,
    saveMemorySettings,
  } = useLocalInferenceMemorySettings({ runAction, showToast });

  useMarketplaceRecommendations({
    activeTab,
    hasSearched: marketplaceHasSearched,
    query: marketplaceQueryRef.current,
    onHasSearchedChange: setMarketplaceHasSearched,
    onSearch: searchMarketplace,
  });

  useEffect(() => {
    if (activeTab === 'marketplace') return;
    clearMarketplaceState();
  }, [activeTab, clearMarketplaceState]);

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
    if (!isVisible) return;
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
    isVisible,
    refreshRequestId,
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
          void refreshLocalModels()
            .then(localModels => {
              if (
                progress.phase === 'done' &&
                !isSuccessfulMarketplaceInstallProgress(progress, localModels)
              ) {
                setPullProgress(current => ({
                  ...current,
                  [name]: {
                    ...progress,
                    phase: 'failed',
                    error: i18nService.t('marketplaceInstallFailed'),
                  },
                }));
                return;
              }
              if (progress.phase === 'done') {
                const params = buildMarketplaceSearchParams({ query: marketplaceQueryRef.current });
                if (marketplaceHasSearchedRef.current && params) {
                  void searchMarketplace(params).catch(() => undefined);
                }
                markMarketplaceInstalled(name);
              }
            })
            .catch(() => undefined);
        }
      }),
    ];
    return () => {
      unsubscribers.forEach(unsubscribe => unsubscribe());
    };
  }, [
    clearInstallProgressDismissTimer,
    markMarketplaceInstalled,
    marketplaceHasSearchedRef,
    marketplaceQueryRef,
    refreshLocalModels,
    scheduleInstallProgressDismiss,
    searchMarketplace,
    setPullProgress,
  ]);

  useEffect(() => {
    if (!isRunning) return;
    const timer = window.setInterval(() => {
      void refreshRunningModels().catch(() => undefined);
    }, 5000);
    return () => window.clearInterval(timer);
  }, [isRunning, refreshRunningModels]);

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
    [
      draftModelsDir,
      isRunning,
      marketplaceHasSearchedRef,
      marketplaceQueryRef,
      refreshLocalModels,
      runAction,
      searchMarketplace,
      showToast,
    ],
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

  const handleSaveModelInspectorPreferences = useCallback(
    async (
      modelName: string,
      input: Parameters<typeof saveModelPreferences>[1],
    ): Promise<boolean> => saveModelPreferences(modelName, input),
    [saveModelPreferences],
  );

  const handleTabChange = useCallback(
    (value: string) => {
      const nextTab = value as LocalInferenceTab;
      if (nextTab === activeTab) return;
      setInspectorModel(null);
      setTabDirection(
        LOCAL_INFERENCE_TAB_ORDER.indexOf(nextTab) >= LOCAL_INFERENCE_TAB_ORDER.indexOf(activeTab)
          ? 1
          : -1,
      );
      setActiveTab(nextTab);
    },
    [activeTab],
  );

  return (
    <div data-page-canvas className="relative flex h-full flex-1 flex-col bg-background">
      <Tabs
        value={activeTab}
        onValueChange={handleTabChange}
        className="flex h-full min-h-0 flex-1 flex-col gap-0"
      >
        <PageHeader
          title={i18nService.t('localInferenceTitle')}
          isSidebarCollapsed={isSidebarCollapsed}
          onToggleSidebar={onToggleSidebar}
          onNewChat={onNewChat}
          updateBadge={updateBadge}
          actions={
            <LocalInferenceSettingsMenu
              onOpenRuntimeSettings={() => setRuntimeSettingsOpen(true)}
              onOpenAccessSettings={openAccessSettings}
              onOpenMemorySettings={openMemorySettings}
              onOpenLibrarySettings={() => {
                setDraftModelsDir(modelsDir);
                setLibrarySettingsOpen(true);
              }}
            />
          }
          tabs={
            <PageTabs
              bare
              value={activeTab}
              items={[
                { value: 'models' as const, label: i18nService.t('localInferenceTabModels') },
                {
                  value: 'marketplace' as const,
                  label: i18nService.t('localInferenceTabMarketplace'),
                },
              ]}
            />
          }
        />
        <div className="relative flex min-h-0 flex-1 overflow-hidden">
          <div
            ref={contentViewportRef}
            className={
              activeTab === 'marketplace'
                ? 'min-w-0 flex-1 overflow-hidden [overflow-anchor:none]'
                : 'min-w-0 flex-1 overflow-y-auto scrollbar-gutter-stable [overflow-anchor:none]'
            }
          >
            <div
              className={
                activeTab === 'marketplace'
                  ? 'mx-auto flex h-full min-h-0 w-full max-w-5xl flex-col gap-4 px-4 py-4 sm:px-6'
                  : 'mx-auto w-full max-w-5xl space-y-4 px-4 py-4 sm:px-6'
              }
            >
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
                  cancellingModelLoad={cancellingModelLoad}
                  unloadingModelName={unloadingModelName}
                  localModels={localModels}
                  runningModels={runningModels}
                  modelPreferences={modelPreferences}
                  onLoadModel={handleLoadModel}
                  onCancelModelLoad={handleCancelModelLoad}
                  onUnload={handleUnload}
                  onDelete={handleDelete}
                  onOpenInspector={model => {
                    setInspectorInitialTab(ModelInspectorTab.Overview);
                    setInspectorModel(model);
                  }}
                  onOpenMarketplace={() => handleTabChange('marketplace')}
                  onOpenLaunchLog={model => {
                    setInspectorModel(model);
                    setInspectorInitialTab(ModelInspectorTab.Logs);
                  }}
                  showRegisteredModelsTitle={false}
                />
              </LayeredTabsContent>
              <LayeredTabsContent
                keepMounted={false}
                value="marketplace"
                activeValue={activeTab}
                direction={tabDirection}
                className="flex min-h-0 flex-1 flex-col"
                contentClassName="flex min-h-0 flex-1 flex-col"
              >
                <MarketplacePanel
                  loading={loading}
                  models={visibleMarketplaceModels}
                  hasSearched={marketplaceHasSearched}
                  marketplaceLoading={marketplaceLoading}
                  marketplaceError={marketplaceError}
                  totalCount={marketplaceTotalCount}
                  hasNextPage={marketplaceHasNextPage}
                  initialQuery={marketplaceQueryRef.current}
                  installedModelPathMap={installedModelPathMap}
                  hardwareSummary={marketplaceHardware}
                  hardwareSummaryReady={marketplaceHardwareChecked}
                  activeDownloadModelId={pulling ? (activePullName ?? undefined) : undefined}
                  onQueryChange={handleMarketplaceQueryChange}
                  onSearch={handleMarketplaceSearch}
                  onInstall={handleMarketplaceInstall}
                  onOpenDownloadPanel={openMarketplaceDownloadPanel}
                />
              </LayeredTabsContent>
            </div>
          </div>
          {activeTab === 'marketplace' ? (
            <MarketplaceDownloadSidebar
              visible={marketplaceDownloadPanelVisible && marketplaceDownloadModel !== null}
              model={marketplaceDownloadModel}
              progress={marketplaceDownloadPanelProgress}
              onClose={() => setMarketplaceDownloadPanelVisible(false)}
              onCancel={modelId => void window.electron.llamacpp.cancelInstall(modelId)}
            />
          ) : null}
          <ModelInspectorSidebar
            open={inspectorModel !== null}
            model={inspectorModel}
            initialTab={inspectorInitialTab}
            runningModel={
              inspectorModel
                ? runningModels.find(
                    model =>
                      model.name === inspectorModel.name || model.model === inspectorModel.name,
                  )
                : undefined
            }
            preference={inspectorModel ? modelPreferences[inspectorModel.name] : undefined}
            serviceConfig={serviceConfig}
            onOpenChange={nextOpen => {
              if (!nextOpen) {
                setInspectorModel(null);
                setInspectorInitialTab(ModelInspectorTab.Overview);
              }
            }}
            onValidationError={message => showToast(message, LocalInferenceToastKind.Error)}
            onSavePreferences={input => {
              if (!inspectorModel) return Promise.resolve(false);
              return handleSaveModelInspectorPreferences(inspectorModel.name, input);
            }}
          />
        </div>
      </Tabs>

      <ModelStartedDialog
        startedModelName={startedModelName}
        onClose={() => setStartedModelName(null)}
        onOpenModelSettings={() => onOpenModelSettings?.()}
      />

      <Dialog open={runtimeSettingsOpen} onOpenChange={handleRuntimeSettingsOpenChange}>
        <DialogContent className="w-[min(48rem,calc(100%-2rem))] max-h-[85vh] gap-4 overflow-y-auto sm:max-w-2xl">
          <DialogHeader className="theme-control-sizing-19 gap-1">
            <DialogTitle>{i18nService.t('localInferenceRuntimeSettings')}</DialogTitle>
          </DialogHeader>
          <RuntimeInstallCard
            installRequestId={installRequestId}
            runtimeInstallSnapshot={runtimeInstallProgress.snapshot}
            onInstallRequestHandled={onInstallRequestHandled}
            onNotify={showToast}
          />
        </DialogContent>
      </Dialog>

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
        keepRunningOnAppQuit={draftKeepRunningOnAppQuit}
        willRestartOnSave={isRunning}
        port={draftPort}
        lanToken={draftLanToken}
        exampleModelName={exampleModelName}
        onAllowLanAccessChange={setDraftAllowLanAccess}
        onKeepRunningOnAppQuitChange={setDraftKeepRunningOnAppQuit}
        onPortChange={setDraftPort}
        onClose={closeAccessSettings}
        onSave={saveAccessSettings}
        onRegenerateLanToken={regenerateLanToken}
      />
      <LocalInferenceMemorySettingsDialog
        isOpen={memorySettingsOpen}
        saving={loading}
        policy={draftMemoryPolicy}
        memoryBudgetPercent={draftMemoryBudgetPercent}
        systemMemorySnapshot={systemMemorySnapshot}
        onPolicyChange={setDraftMemoryPolicy}
        onMemoryBudgetPercentChange={setDraftMemoryBudgetPercent}
        onClose={closeMemorySettings}
        onSave={saveMemorySettings}
      />
    </div>
  );
};

/** @knipignore Reached through a dynamic import() cast in LocalInferenceView.marketplace.test.ts. */
export const __test__shouldBlockModelAction = (input: {
  modelName: string;
  unloadingModelName: string | null;
}) => shouldBlockModelAction(input);

/** @knipignore Reached through a dynamic import() cast in LocalInferenceView.marketplace.test.ts. */
export const __test__getRemainingBusyMs = (input: {
  startedAtMs: number;
  nowMs: number;
  minimumBusyMs: number;
}) => getRemainingBusyMs(input);

export default LocalInferenceView;
