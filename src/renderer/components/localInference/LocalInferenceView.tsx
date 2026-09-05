import { Button } from '@shared/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@shared/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@shared/components/ui/dropdown-menu';
import { LayeredTabsContent } from '@shared/components/ui/layered-tabs';
import { Tabs } from '@shared/components/ui/tabs';
import { useReducedMotion } from 'motion/react';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type {
  LlamaCppInstallProgress,
  LlamaCppModel as OllamaModel,
  LlamaCppModelLaunchInput,
  LlamaCppModelPreferences,
  LlamaCppRunningModel as OllamaRunningModel,
  LlamaCppStatusSnapshot as OllamaStatusSnapshot,
} from '../../../shared/llamacpp';
import type {
  MarketplaceModel,
  MarketplaceSearchParams,
  MarketplaceSearchResult,
} from '../../../shared/marketplace';
import { createMarketplaceHardwareProfile, withMarketplaceScore, type MarketplaceHardwareProfile } from '../../../shared/marketplace/scoring';
import { notifyLlamaCppRunningModelsChanged } from '../../services/availableModels';
import { i18nService } from '../../services/i18n';
import { LocalInferenceAnimatedFolderDownIcon } from '../icons/LocalInferenceAnimatedFolderDownIcon';
import { LocalInferenceAnimatedWifiPenIcon } from '../icons/LocalInferenceAnimatedWifiPenIcon';
import {
  GalleryThumbnailsIcon,
} from '../icons/GalleryThumbnailsIcon';
import { SidebarAnimatedCpuIcon } from '../icons/SidebarAnimatedCpuIcon';
import { SettingsAnimatedSlidersHorizontalIcon } from '../icons/SettingsAnimatedSlidersHorizontalIcon';
import PageHeader from '../PageHeader';
import { PageTabs } from '@shared/components/ui/page-tabs';
import { LocalInferenceToastView } from './components/Common';
import { LocalInferenceAccessSettingsDialog } from './components/LocalInferenceAccessSettingsDialog';
import { LocalInferenceMemorySettingsDialog } from './components/LocalInferenceMemorySettingsDialog';
import { ModelContextSettingsModal } from './components/ModelContextSettingsModal';
import { MarketplaceDownloadSidebar } from './components/MarketplaceDownloadSidebar';
import { ModelLibrarySettingsModal } from './components/ModelLibrarySettingsModal';
import { ModelLaunchLogSidebar } from './components/ModelLaunchLogSidebar';
import { RuntimeInstallCard } from './components/RuntimeInstallCard';
import {
  LOCAL_INFERENCE_PROGRESS_DISMISS_MS,
  MARKETPLACE_PREFETCH_PAGE_COUNT,
  LOCAL_INFERENCE_TOAST_AUTO_DISMISS_MS,
  LOCAL_INFERENCE_UNLOAD_MIN_BUSY_MS,
  LOCAL_INFERENCE_UNLOAD_SETTLE_POLL_INTERVAL_MS,
  LOCAL_INFERENCE_UNLOAD_SETTLE_TIMEOUT_MS,
  localInferenceCompactButtonClass,
} from './constants';
import { useI18nLanguage } from './hooks/useI18nLanguage';
import { useLocalInferenceAccessSettings } from './hooks/useLocalInferenceAccessSettings';
import { useLocalInferenceMemorySettings } from './hooks/useLocalInferenceMemorySettings';
import { useMarketplaceRecommendations } from './hooks/useMarketplaceRecommendations';
import { shouldCloseLaunchLogPanelForModel, useModelLaunchLogs } from './hooks/useModelLaunchLogs';
import { useRuntimeInstallBackgroundNotifications } from './hooks/useRuntimeInstallBackgroundNotifications';
import { useRuntimeInstallProgress } from './hooks/useRuntimeInstallProgress';
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
  filterMarketplaceModelsForDevice,
  filterMarketplaceModelsForRecommendation,
  groupMarketplaceVariants,
} from './utils/marketplace';
import {
  isInstallTerminalPhase,
  isPullInProgress,
  isSuccessfulMarketplaceInstallProgress,
  normalizeInstallProgress,
} from './utils/progress';
import {
  readLocalInferenceSessionState,
  writeLocalInferenceSessionState,
} from './utils/sessionState';
import { sameRunningModelSnapshot } from './utils/runningModels';

interface LocalInferenceViewProps {
  installRequestId?: string;
  onInstallRequestHandled?: (requestId: string) => void;
  isSidebarCollapsed?: boolean;
  isVisible?: boolean;
  onToggleSidebar?: () => void;
  onNewChat?: () => void;
  onOpenModelSettings?: () => void;
  updateBadge?: React.ReactNode;
}

const LOCAL_INFERENCE_TAB_ORDER: LocalInferenceTab[] = ['models', 'marketplace'];

type MarketplacePageCache = {
  key: string;
  pages: Map<number, MarketplaceSearchResult>;
  // Keep cursor positions for visited pages even when their model data is evicted.
  cursors: Map<number, string | undefined>;
};

type AnimatedIconHandle = {
  startAnimation: () => void;
  stopAnimation: () => void;
};

function marketplacePageCacheKey(params: MarketplaceSearchParams): string {
  return JSON.stringify({
    query: params.query ?? '',
    tags: params.tags ?? [],
    task: params.task ?? 'all',
    size: params.size ?? 'all',
    limit: params.limit ?? 0,
    device: params.device ?? '',
    featuredOnly: params.featuredOnly ?? false,
    fit: params.fit ?? 'all',
    quantization: params.quantization ?? '',
    minStars: params.minStars ?? null,
  });
}

function hasMarketplaceNextPage(result: MarketplaceSearchResult): boolean {
  return result.hasMore !== false && Boolean(result.nextCursor);
}

let cachedStatus: OllamaStatusSnapshot | null = null;

const LocalInferenceView: React.FC<LocalInferenceViewProps> = ({
  installRequestId,
  onInstallRequestHandled,
  isSidebarCollapsed,
  isVisible = true,
  onToggleSidebar,
  onNewChat,
  onOpenModelSettings,
  updateBadge,
}) => {
  const prefersReducedMotion = useReducedMotion();
  const runtimeSettingsIconRef = useRef<AnimatedIconHandle>(null);
  const accessSettingsIconRef = useRef<AnimatedIconHandle>(null);
  const memorySettingsIconRef = useRef<AnimatedIconHandle>(null);
  const librarySettingsIconRef = useRef<AnimatedIconHandle>(null);
  const restoredSessionRef = useRef<LocalInferenceSessionState | null>(null);
  if (restoredSessionRef.current === null) {
    restoredSessionRef.current = readLocalInferenceSessionState();
  }
  const restoredSession = restoredSessionRef.current;
  const startMenuIconAnimation = useCallback(
    (iconRef: React.RefObject<AnimatedIconHandle | null>) => {
      if (!prefersReducedMotion) iconRef.current?.startAnimation();
    },
    [prefersReducedMotion],
  );
  const stopMenuIconAnimation = useCallback(
    (iconRef: React.RefObject<AnimatedIconHandle | null>) => {
      iconRef.current?.stopAnimation();
    },
    [],
  );
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
  const [modelPreferences, setModelPreferences] = useState<LlamaCppModelPreferences>({});
  const [librarySettingsOpen, setLibrarySettingsOpen] = useState(false);
  const [draftModelsDir, setDraftModelsDir] = useState('');
  const [contextModel, setContextModel] = useState<OllamaModel | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingModelName, setLoadingModelName] = useState<string | null>(null);
  const [cancellingModelLoad, setCancellingModelLoad] = useState(false);
  const cancelledModelLoadRef = useRef(false);
  const [unloadingModelName, setUnloadingModelName] = useState<string | null>(null);
  const [startedModelName, setStartedModelName] = useState<string | null>(null);
  const [toast, setToast] = useState<LocalInferenceToast | null>(null);
  const [activePullName, setActivePullName] = useState<string | null>(null);
  const [isMarketplaceInstallPending, setIsMarketplaceInstallPending] = useState(false);
  const [pullProgress, setPullProgress] = useState<InstallProgressState>({});
  const [marketplaceDownloadModel, setMarketplaceDownloadModel] = useState<MarketplaceModel | null>(null);
  const [marketplaceDownloadPanelProgress, setMarketplaceDownloadPanelProgress] =
    useState<LlamaCppInstallProgress>();
  const [marketplaceDownloadPanelVisible, setMarketplaceDownloadPanelVisible] = useState(false);
  const isRunning = status?.status === 'running';
  const activePullProgress = activePullName ? pullProgress[activePullName] : undefined;
  const pulling = isMarketplaceInstallPending || isPullInProgress(activePullProgress);
  const [marketplaceModels, setMarketplaceModels] = useState<MarketplaceModel[]>([]);
  const [marketplaceLoading, setMarketplaceLoading] = useState(false);
  const [marketplaceError, setMarketplaceError] = useState<string | null>(null);
  const contentViewportRef = useRef<HTMLDivElement>(null);
  const [marketplaceHasSearched, setMarketplaceHasSearched] = useState(false);
  const [marketplaceTotalCount, setMarketplaceTotalCount] = useState<number>();
  const [marketplaceHasNextPage, setMarketplaceHasNextPage] = useState(false);
  const [marketplaceSearchParams, setMarketplaceSearchParams] =
    useState<MarketplaceSearchParams>({});
  const [marketplaceHardware, setMarketplaceHardware] = useState<MarketplaceHardwareProfile>();
  const [marketplaceHardwareChecked, setMarketplaceHardwareChecked] = useState(false);
  useI18nLanguage();
  const launchLogs = useModelLaunchLogs();
  // Destructure the stable (useCallback-backed) controls so memoized children
  // and hook dependency arrays can reference them without the unstable wrapper object.
  const {
    state: launchLogState,
    closePanel: closeLaunchLogPanel,
  } = launchLogs;
  const runtimeInstallProgress = useRuntimeInstallProgress();
  const { notifyBackgroundContinuation } = useRuntimeInstallBackgroundNotifications({
    isVisible,
    snapshot: runtimeInstallProgress.snapshot,
    refresh: runtimeInstallProgress.refresh,
  });
  const [launchLogFullscreen, setLaunchLogFullscreen] = useState(false);
  const marketplaceSearchRef = useRef<number>(0);
  const marketplaceRequestIdRef = useRef<string | null>(null);
  const marketplacePrefetchRequestIdsRef = useRef<Set<string>>(new Set());
  const marketplacePageCacheRef = useRef<MarketplacePageCache | null>(null);
  const loadingModelNameRef = useRef<string | null>(null);
  // The marketplace panel owns the draft query state; the view only keeps a ref
  // so keystrokes do not re-render the models grid and sibling UI.
  const marketplaceQueryRef = useRef('');
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
    void Promise.all([
      typeof window.electron.hardware.nvidiaSmi === 'function'
        ? window.electron.hardware.nvidiaSmi().catch(() => null)
        : Promise.resolve(null),
      typeof window.electron.hardware.systemMemory === 'function'
        ? window.electron.hardware.systemMemory().catch(() => null)
        : Promise.resolve(null),
    ]).then(([gpuSnapshot, memorySnapshot]) => {
      setMarketplaceHardware(createMarketplaceHardwareProfile(gpuSnapshot, memorySnapshot));
      setMarketplaceHardwareChecked(true);
    });
  }, []);

  const visibleMarketplaceModels = useMemo(() => {
    const scored = marketplaceModels.map(model =>
      withMarketplaceScore(model, {
        hardware: marketplaceHardware,
        task: marketplaceSearchParams.task,
      }),
    );
    const isRecommendationBrowse =
      marketplaceSearchParams.featuredOnly || marketplaceSearchParams.fit === 'recommended';
    const filtered = marketplaceSearchParams.fit === 'all'
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

  const handleRuntimeSettingsOpenChange = useCallback(
    (open: boolean) => {
      if (!open) void notifyBackgroundContinuation();
      setRuntimeSettingsOpen(open);
    },
    [notifyBackgroundContinuation],
  );

  const openMarketplaceDownloadPanel = useCallback(() => {
    closeLaunchLogPanel();
    setMarketplaceDownloadPanelVisible(true);
  }, [closeLaunchLogPanel]);

  useEffect(() => {
    if (activePullProgress) setMarketplaceDownloadPanelProgress(activePullProgress);
  }, [activePullProgress]);

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

  const cancelMarketplacePrefetches = useCallback(() => {
    const requestIds = Array.from(marketplacePrefetchRequestIdsRef.current);
    marketplacePrefetchRequestIdsRef.current.clear();
    requestIds.forEach(requestId => {
      void window.electron.marketplace.cancelSearch(requestId).catch(() => undefined);
    });
  }, []);

  const preloadMarketplacePage = useCallback(
    async (
      cacheKey: string,
      params: MarketplaceSearchParams,
      currentResult: MarketplaceSearchResult,
      searchId: number,
    ) => {
      const cache = marketplacePageCacheRef.current;
      if (!cache || cache.key !== cacheKey) return;
      const currentPage = params.pageNumber ?? 1;
      let nextPage = currentPage + 1;
      let nextCursor = hasMarketplaceNextPage(currentResult) ? currentResult.nextCursor : undefined;

      // Cursor pagination is sequential: the second prefetched page can only be
      // requested after the first prefetched response provides its next cursor.
      for (
        let offset = 0;
        offset < MARKETPLACE_PREFETCH_PAGE_COUNT && nextCursor;
        offset += 1
      ) {
        cache.cursors.set(nextPage, nextCursor);
        const cachedNextResult = cache.pages.get(nextPage);
        if (cachedNextResult) {
          if (!hasMarketplaceNextPage(cachedNextResult)) break;
          nextCursor = cachedNextResult.nextCursor;
          nextPage += 1;
          continue;
        }

        const requestId =
          globalThis.crypto?.randomUUID?.() ??
          `marketplace-prefetch-${Date.now()}-${Math.random().toString(16).slice(2)}`;
        marketplacePrefetchRequestIdsRef.current.add(requestId);
        try {
          const nextResult = await window.electron.marketplace.search({
            requestId,
            params: { ...params, pageNumber: nextPage, cursor: nextCursor },
          });
          if (searchId !== marketplaceSearchRef.current) return;
          const currentCache = marketplacePageCacheRef.current;
          if (!currentCache || currentCache.key !== cacheKey) return;
          currentCache.pages.set(nextPage, nextResult);
          if (!hasMarketplaceNextPage(nextResult)) break;
          nextCursor = nextResult.nextCursor;
          nextPage += 1;
        } catch {
          // Prefetch is best effort. The page will be fetched when requested.
          break;
        } finally {
          marketplacePrefetchRequestIdsRef.current.delete(requestId);
        }
      }

      const currentCache = marketplacePageCacheRef.current;
      if (!currentCache || currentCache.key !== cacheKey) return;
      const lastPrefetchedPage = currentPage + MARKETPLACE_PREFETCH_PAGE_COUNT;
      for (const pageNumber of currentCache.pages.keys()) {
        if (pageNumber < currentPage || pageNumber > lastPrefetchedPage) {
          currentCache.pages.delete(pageNumber);
        }
      }
    },
    [],
  );

  const searchMarketplace = useCallback(async (params: MarketplaceSearchParams) => {
    const id = ++marketplaceSearchRef.current;
    const cacheKey = marketplacePageCacheKey(params);
    cancelMarketplacePrefetches();
    if (!marketplacePageCacheRef.current || marketplacePageCacheRef.current.key !== cacheKey) {
      marketplacePageCacheRef.current = { key: cacheKey, pages: new Map(), cursors: new Map() };
    }
    const pageNumber = params.pageNumber ?? 1;
    const cache = marketplacePageCacheRef.current;
    const cursor = pageNumber > 1 ? cache?.cursors.get(pageNumber) : undefined;
    if (pageNumber > 1 && !cursor) {
      setMarketplaceLoading(false);
      return;
    }
    const requestParams = pageNumber > 1 ? { ...params, cursor } : params;
    const cachedResult = pageNumber > 1 ? cache?.pages.get(pageNumber) : undefined;
    if (cachedResult) {
      setMarketplaceSearchParams(params);
      setMarketplaceModels(cachedResult.models);
      if (pageNumber <= 1) {
        setMarketplaceTotalCount(cachedResult.totalCount);
      }
      setMarketplaceHasNextPage(hasMarketplaceNextPage(cachedResult));
      setMarketplaceError(cachedResult.warning ?? null);
      setMarketplaceLoading(false);
      void preloadMarketplacePage(cacheKey, requestParams, cachedResult, id);
      return;
    }
    const requestId =
      globalThis.crypto?.randomUUID?.() ??
      `marketplace-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    marketplaceRequestIdRef.current = requestId;
    setMarketplaceLoading(true);
    setMarketplaceError(null);
    try {
      const result = await window.electron.marketplace.search({ requestId, params: requestParams });
      if (id === marketplaceSearchRef.current) {
        cache?.pages.set(pageNumber, result);
        cache?.cursors.set(pageNumber, cursor);
        const nextPage = hasMarketplaceNextPage(result) ? pageNumber + 1 : undefined;
        if (cache && nextPage && result.nextCursor) {
          cache.cursors.set(nextPage, result.nextCursor);
          const lastPrefetchedPage = pageNumber + MARKETPLACE_PREFETCH_PAGE_COUNT;
          for (const cachedPage of cache.pages.keys()) {
            if (cachedPage < pageNumber || cachedPage > lastPrefetchedPage) {
              cache.pages.delete(cachedPage);
            }
          }
        }
        setMarketplaceSearchParams(params);
        setMarketplaceModels(result.models);
        if (pageNumber <= 1) {
          setMarketplaceTotalCount(result.totalCount);
        }
        setMarketplaceHasNextPage(hasMarketplaceNextPage(result));
        setMarketplaceError(result.warning ?? null);
        void preloadMarketplacePage(cacheKey, requestParams, result, id);
      }
    } catch (searchError) {
      if (id === marketplaceSearchRef.current) {
        setMarketplaceHasNextPage(false);
        setMarketplaceError(getLocalInferenceUserFacingErrorMessage(searchError));
      }
    } finally {
      if (id === marketplaceSearchRef.current) {
        setMarketplaceLoading(false);
      }
      if (marketplaceRequestIdRef.current === requestId) {
        marketplaceRequestIdRef.current = null;
      }
    }
  }, [cancelMarketplacePrefetches, preloadMarketplacePage]);
  const clearMarketplaceState = useCallback(() => {
    marketplaceSearchRef.current += 1;
    cancelMarketplacePrefetches();
    marketplacePageCacheRef.current = null;
    const requestId = marketplaceRequestIdRef.current;
    marketplaceRequestIdRef.current = null;
    if (requestId) {
      void window.electron.marketplace.cancelSearch(requestId).catch(() => undefined);
    }
    setMarketplaceLoading(false);
    setMarketplaceError(null);
    setMarketplaceModels([]);
    setMarketplaceHasSearched(false);
    setMarketplaceTotalCount(undefined);
    setMarketplaceHasNextPage(false);
    setMarketplaceSearchParams({});
  }, [cancelMarketplacePrefetches]);
  useEffect(() => {
    return () => {
      cancelMarketplacePrefetches();
      const requestId = marketplaceRequestIdRef.current;
      if (requestId) {
        void window.electron.marketplace.cancelSearch(requestId).catch(() => undefined);
      }
    };
  }, [cancelMarketplacePrefetches]);

  useEffect(() => {
    if (activeTab === 'marketplace') return;
    clearMarketplaceState();
  }, [activeTab, clearMarketplaceState]);

  const handleMarketplaceSearch = useCallback((overrides: MarketplaceSearchParams = {}) => {
    const params = buildMarketplaceSearchParams({
      ...overrides,
      query: overrides.query ?? marketplaceQueryRef.current,
    });
    if (!params) {
      clearMarketplaceState();
      return;
    }
    setMarketplaceHasSearched(true);
    void searchMarketplace(params);
  }, [clearMarketplaceState, searchMarketplace]);

  const handleMarketplaceQueryChange = useCallback((value: string) => {
    marketplaceQueryRef.current = value;
  }, []);

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
    // Polling rebuilds this array every tick; keep the previous reference when
    // nothing visible changed so memoized model cards skip re-rendering.
    setRunningModels(current =>
      sameRunningModelSnapshot(current, models) ? current : models,
    );
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
        openMarketplaceDownloadPanel();
        showToast(
          i18nService.t('marketplaceInstallAlreadyInProgress'),
          LocalInferenceToastKind.Info,
        );
        return;
      }
      const name = model.repoId;
      setMarketplaceDownloadModel(model);
      setMarketplaceDownloadPanelProgress(undefined);
      openMarketplaceDownloadPanel();
      clearInstallProgressDismissTimer(name);
      setActivePullName(name);
      setIsMarketplaceInstallPending(true);
      dismissToast();
      try {
        const selectedFile =
          model.files?.find(file => file.path === model.filePath) ??
          model.files?.find(file => file.isRecommended);
        const mmprojFile = model.files?.find(file => file.path === model.mmprojFilePath);
        // Split-GGUF variants: the card pins filePath to the first part; the
        // remaining sibling parts must travel with the install request because
        // prefill short-circuits when downloadUrl+sha256 are already present.
        const selectedVariant =
          groupMarketplaceVariants(model.files).find(variant =>
            variant.files.some(file => file.path === model.filePath),
          ) ?? groupMarketplaceVariants(model.files)[0];
        const extraFiles = (selectedVariant?.files ?? [])
          .filter(file => file.path !== selectedFile?.path)
          .map(file => ({
            path: file.path,
            downloadUrl: file.downloadUrl,
            revision: file.revision,
            sha256: file.sha256,
            sizeBytes: file.sizeBytes,
          }));
        const result = await window.electron.llamacpp.installModel({
          modelId: model.repoId,
          filePath: selectedFile?.path,
          displayName: model.repoId,
          downloadUrl: selectedFile?.downloadUrl,
          revision: selectedFile?.revision ?? model.runtime?.revision,
          sha256: selectedFile?.sha256,
          fileSizeBytes: selectedFile?.sizeBytes,
          extraFiles,
          mmprojFilePath: mmprojFile?.path,
          mmprojDownloadUrl: mmprojFile?.downloadUrl,
          mmprojSha256: mmprojFile?.sha256,
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
      } finally {
        setIsMarketplaceInstallPending(false);
      }
    },
    [
      clearInstallProgressDismissTimer,
      dismissToast,
      openMarketplaceDownloadPanel,
      pulling,
      refreshLocalModels,
      showToast,
    ],
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
    draftKeepRunningOnAppQuit,
    draftPort,
    exampleModelName,
    setDraftKeepRunningOnAppQuit,
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

  useEffect(() => {
    marketplaceHasSearchedRef.current = marketplaceHasSearched;
  }, [marketplaceHasSearched]);

  useMarketplaceRecommendations({
    activeTab,
    hasSearched: marketplaceHasSearched,
    query: marketplaceQueryRef.current,
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
          void refreshLocalModels()
            .then(localModels => {
              if (progress.phase === 'done' && !isSuccessfulMarketplaceInstallProgress(progress, localModels)) {
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
                setMarketplaceModels(prev =>
                  prev.map(m => (m.repoId === name ? { ...m, installed: true } : m)),
                );
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

  const handleLoadModel = useCallback((model: OllamaModel) => {
    const modelName = model.name;
    if (loadingModelNameRef.current) return;
    loadingModelNameRef.current = modelName;
    cancelledModelLoadRef.current = false;
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
        // Only direct user launches prompt for configuration; background restoration remains silent.
        setStartedModelName(modelName);
        if (result.warning) {
          showToast(result.warning, LocalInferenceToastKind.Info);
        }
      } catch (loadError) {
        launchLogs.markModelLaunchFailed();
        if (cancelledModelLoadRef.current) {
          await refreshRunningModels();
          notifyLlamaCppRunningModelsChanged();
          return;
        }
        throw loadError;
      } finally {
        loadingModelNameRef.current = null;
        setLoadingModelName(current => (current === modelName ? null : current));
        setCancellingModelLoad(false);
        cancelledModelLoadRef.current = false;
      }
    });
  }, [launchLogs, refreshRunningModels, runAction, showToast]);

  const handleCancelModelLoad = useCallback(() => {
    const modelName = loadingModelNameRef.current;
    if (!modelName || cancellingModelLoad) return;
    cancelledModelLoadRef.current = true;
    setCancellingModelLoad(true);
    void runAction(async () => {
      try {
        const result = await window.electron.llamacpp.cancelModelLoad(modelName);
        if (!result.cancelled) {
          cancelledModelLoadRef.current = false;
          setCancellingModelLoad(false);
          return;
        }
      } catch (error) {
        cancelledModelLoadRef.current = false;
        setCancellingModelLoad(false);
        throw error;
      }
    });
  }, [cancellingModelLoad, runAction]);

  const handleUnload = useCallback(
    (modelName: string) => {
      if (shouldBlockModelAction({ modelName, unloadingModelName })) return;
      const unloadStartedAtMs = Date.now();
      setUnloadingModelName(modelName);
      if (shouldCloseLaunchLogPanelForModel(launchLogState, modelName)) {
        closeLaunchLogPanel();
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
    },
    [closeLaunchLogPanel, launchLogState, runAction, showToast, unloadingModelName, waitForUnloadSettle],
  );

  const handleDelete = useCallback(
    (modelName: string) => {
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
    },
    [
      refreshLocalModels,
      refreshModelPreferences,
      refreshRunningModels,
      runAction,
      unloadingModelName,
    ],
  );

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

  const handleTabChange = useCallback(
    (value: string) => {
      const nextTab = value as LocalInferenceTab;
      if (nextTab === activeTab) return;
      closeLaunchLogPanel();
      setTabDirection(
        LOCAL_INFERENCE_TAB_ORDER.indexOf(nextTab) >= LOCAL_INFERENCE_TAB_ORDER.indexOf(activeTab)
          ? 1
          : -1,
      );
      setActiveTab(nextTab);
    },
    [activeTab, closeLaunchLogPanel],
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
        {toast && (
          <div className="pointer-events-none absolute right-4 top-16 z-30 flex w-[min(24rem,calc(100%-2rem))] justify-end">
            <LocalInferenceToastView toast={toast} onClose={dismissToast} />
          </div>
        )}
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
                  ? 'flex h-full min-h-0 w-full flex-col gap-4 px-6 py-4'
                  : 'w-full space-y-4 px-6 py-4'
              }
            >
              {activeTab === 'models' ? (
                <div className="flex flex-wrap items-center justify-end gap-2">
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      render={
                        <Button
                          type="button"
                          variant="outline"
                          className={`${localInferenceCompactButtonClass} min-w-32 hover:bg-background dark:hover:bg-background`}
                          size="default"
                        >
                          <SettingsAnimatedSlidersHorizontalIcon className="size-4" size={16} />
                          {i18nService.t('localInferenceSettings')}
                        </Button>
                      }
                    />
                    <DropdownMenuContent align="end" className="min-w-32">
                      <DropdownMenuItem
                        onClick={() => setRuntimeSettingsOpen(true)}
                        onFocus={() => startMenuIconAnimation(runtimeSettingsIconRef)}
                        onMouseEnter={() => startMenuIconAnimation(runtimeSettingsIconRef)}
                        onMouseLeave={() => stopMenuIconAnimation(runtimeSettingsIconRef)}
                      >
                        <SidebarAnimatedCpuIcon ref={runtimeSettingsIconRef} />
                        {i18nService.t('localInferenceRuntimeSettings')}
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={openAccessSettings}
                        onFocus={() => startMenuIconAnimation(accessSettingsIconRef)}
                        onMouseEnter={() => startMenuIconAnimation(accessSettingsIconRef)}
                        onMouseLeave={() => stopMenuIconAnimation(accessSettingsIconRef)}
                      >
                        <LocalInferenceAnimatedWifiPenIcon ref={accessSettingsIconRef} />
                        {i18nService.t('localInferenceAccessMenuItem')}
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={openMemorySettings}
                        onFocus={() => startMenuIconAnimation(memorySettingsIconRef)}
                        onMouseEnter={() => startMenuIconAnimation(memorySettingsIconRef)}
                        onMouseLeave={() => stopMenuIconAnimation(memorySettingsIconRef)}
                      >
                        <GalleryThumbnailsIcon ref={memorySettingsIconRef} />
                        {i18nService.t('localInferenceMemoryMenuItem')}
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => {
                          setDraftModelsDir(modelsDir);
                          setLibrarySettingsOpen(true);
                        }}
                        onFocus={() => startMenuIconAnimation(librarySettingsIconRef)}
                        onMouseEnter={() => startMenuIconAnimation(librarySettingsIconRef)}
                        onMouseLeave={() => stopMenuIconAnimation(librarySettingsIconRef)}
                      >
                        <LocalInferenceAnimatedFolderDownIcon ref={librarySettingsIconRef} />
                        {i18nService.t('localInferenceLibraryMenuItem')}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
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
                  cancellingModelLoad={cancellingModelLoad}
                  unloadingModelName={unloadingModelName}
                  localModels={localModels}
                  runningModels={runningModels}
                  modelPreferences={modelPreferences}
                  onLoadModel={handleLoadModel}
                  onCancelModelLoad={handleCancelModelLoad}
                  onUnload={handleUnload}
                  onDelete={handleDelete}
                  onConfigureContext={setContextModel}
                  onOpenMarketplace={() => handleTabChange('marketplace')}
                  onOpenLaunchLog={launchLogs.openPanelForModel}
                  showRegisteredModelsTitle={false}
                  logPanelVisible={launchLogs.state.visible && !launchLogFullscreen}
                  logPanelModelName={launchLogFullscreen ? null : launchLogs.state.modelName}
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
                  activeDownloadModelId={pulling ? activePullName ?? undefined : undefined}
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
          ) : (
            <ModelLaunchLogSidebar
              state={launchLogs.state}
              isFullscreen={launchLogFullscreen}
              onFullscreenChange={setLaunchLogFullscreen}
              onClose={launchLogs.closePanel}
            />
          )}
        </div>
      </Tabs>

      <Dialog
        open={startedModelName !== null}
        onOpenChange={open => {
          if (!open) setStartedModelName(null);
        }}
      >
        <DialogContent
          className="w-[min(28rem,calc(100%-2rem))] gap-4"
          disableCloseAnimation
          showCloseButton={false}
        >
          <DialogHeader className="gap-1">
            <DialogTitle className="text-center">
              {i18nService.t('localInferenceModelStartedTitle')}
            </DialogTitle>
            <DialogDescription>
              {i18nService
                .t('localInferenceModelStartedDescription')
                .replace('{name}', startedModelName ?? '')}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="border-t-0 pt-0">
            <Button
              type="button"
              variant="outline"
              className={localInferenceCompactButtonClass}
              onClick={() => setStartedModelName(null)}
            >
              {i18nService.t('localInferenceConfigureLater')}
            </Button>
            <Button
              type="button"
              variant="outline"
              className={localInferenceCompactButtonClass}
              onClick={() => {
                setStartedModelName(null);
                onOpenModelSettings?.();
              }}
            >
              {i18nService.t('localInferenceOpenModelSettings')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={runtimeSettingsOpen} onOpenChange={handleRuntimeSettingsOpenChange}>
        <DialogContent className="w-[min(48rem,calc(100%-2rem))] max-h-[85vh] gap-4 overflow-y-auto sm:max-w-2xl">
          <DialogHeader className="gap-1 pr-8">
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
        exampleModelName={exampleModelName}
        onAllowLanAccessChange={setDraftAllowLanAccess}
        onKeepRunningOnAppQuitChange={setDraftKeepRunningOnAppQuit}
        onPortChange={setDraftPort}
        onClose={closeAccessSettings}
        onSave={saveAccessSettings}
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
        onValidationError={message => showToast(message, LocalInferenceToastKind.Error)}
      />
    </div>
  );
};

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

export const __test__shouldBlockModelAction = (input: {
  modelName: string;
  unloadingModelName: string | null;
}) => shouldBlockModelAction(input);
export const __test__getRemainingBusyMs = (input: {
  startedAtMs: number;
  nowMs: number;
  minimumBusyMs: number;
}) => getRemainingBusyMs(input);

export default LocalInferenceView;
