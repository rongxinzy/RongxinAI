import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type {
  LlamaCppChatPayload as OllamaChatPayload,
  LlamaCppInstallProgress,
  LlamaCppModel as OllamaModel,
  LlamaCppModelLaunchInput,
  LlamaCppRunningModel as OllamaRunningModel,
  LlamaCppStatusSnapshot as OllamaStatusSnapshot,
} from '../../../shared/llamacpp';
import {
  createLlamaCppStreamState as createOllamaStreamState,
  reduceLlamaCppStreamChunk as reduceOllamaStreamChunk,
} from '../../../shared/llamacpp';
import type { MarketplaceModel, MarketplaceSearchParams } from '../../../shared/marketplace';
import { notifyLlamaCppRunningModelsChanged } from '../../services/availableModels';
import { i18nService } from '../../services/i18n';
import ComposeIcon from '../icons/ComposeIcon';
import SidebarToggleIcon from '../icons/SidebarToggleIcon';
import WindowTitleBar from '../window/WindowTitleBar';
import { LocalInferenceToastView } from './components/Common';
import {
  LOCAL_INFERENCE_PROGRESS_DISMISS_MS,
  LOCAL_INFERENCE_TOAST_AUTO_DISMISS_MS,
  LOCAL_INFERENCE_UNLOAD_MIN_BUSY_MS,
  LOCAL_INFERENCE_UNLOAD_SETTLE_POLL_INTERVAL_MS,
  LOCAL_INFERENCE_UNLOAD_SETTLE_TIMEOUT_MS,
} from './constants';
import { useI18nLanguage } from './hooks/useI18nLanguage';
import { DEFAULT_INFERENCE_OPTIONS, normalizeOptions } from './inferenceOptions';
import { InferencePanel } from './panels/InferencePanel';
import { MarketplacePanel } from './panels/MarketplacePanel';
import { ModelsPanel } from './panels/ModelsPanel';
import type {
  BuildAssistantMessageInput,
  InferenceMessage,
  InstallProgressState,
  LocalInferenceInlineError,
  LocalInferenceSessionState,
  LocalInferenceTab,
  LocalInferenceToast,
  LocalInferenceToastKind as LocalInferenceToastKindType,
} from './types';
import { LocalInferenceToastKind } from './types';
import {
  buildAssistantMessage,
  buildEffectiveSystemPrompt,
  buildStreamingAssistantMessage,
  computeStreamMetrics,
  findLatestUserMessageIndex,
  resolveLocalInferenceInlineError,
} from './utils/chat';
import {
  buildMarketplaceSearchParams,
  getInstallableMarketplaceModels,
  getMarketplacePageSize,
  isModelScopeRepoId,
} from './utils/marketplace';
import {
  formatInstallProgressSummary,
  getLocalInferenceProgressDismissMs,
  getLocalInferenceToastAutoDismissMs,
  isInstallTerminalPhase,
  isPullInProgress,
  normalizeInstallProgress,
} from './utils/progress';
import { getAssistantScrollTop, getNewAssistantScrollTargetIndex, hasHiddenContentBelow, isScrollNearBottom } from './utils/scroll';
import {
  readLocalInferenceSessionState,
  writeLocalInferenceSessionState,
} from './utils/sessionState';

interface LocalInferenceViewProps {
  isSidebarCollapsed?: boolean;
  onToggleSidebar?: () => void;
  onNewChat?: () => void;
  updateBadge?: React.ReactNode;
}

let cachedStatus: OllamaStatusSnapshot | null = null;

const LocalInferenceView: React.FC<LocalInferenceViewProps> = ({
  isSidebarCollapsed,
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
    restoredSession?.activeTab ?? 'inference',
  );
  const [status, setStatus] = useState<OllamaStatusSnapshot | null>(cachedStatus);
  const [localModels, setLocalModels] = useState<OllamaModel[]>([]);
  const [runningModels, setRunningModels] = useState<OllamaRunningModel[]>([]);
  const [loading, setLoading] = useState(false);
  const [unloadingModelName, setUnloadingModelName] = useState<string | null>(null);
  const [toast, setToast] = useState<LocalInferenceToast | null>(null);
  const [pullName, setPullName] = useState('');
  const [activePullName, setActivePullName] = useState<string | null>(null);
  const [pullProgress, setPullProgress] = useState<InstallProgressState>({});
  const [selectedModel, setSelectedModel] = useState(restoredSession?.selectedModel ?? '');
  const [systemPrompt, setSystemPrompt] = useState(restoredSession?.systemPrompt ?? '');
  const [prompt, setPrompt] = useState(restoredSession?.prompt ?? '');
  const [messages, setMessages] = useState<InferenceMessage[]>(restoredSession?.messages ?? []);
  const [inferenceInlineError, setInferenceInlineError] = useState<LocalInferenceInlineError | null>(null);
  const [streamingText, setStreamingText] = useState('');
  const [streamingThinking, setStreamingThinking] = useState('');
  const [sending, setSending] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const activeRequestIdRef = useRef<string | null>(null);
  const messagesRef = useRef<InferenceMessage[]>(restoredSession?.messages ?? []);
  const conversationVersionRef = useRef(0);
  const isRunning = status?.status === 'running';
  const normalizedPullName = pullName.trim();
  const activePullProgress = activePullName ? pullProgress[activePullName] : undefined;
  const pulling = isPullInProgress(activePullProgress);
  const [marketplaceModels, setMarketplaceModels] = useState<MarketplaceModel[]>([]);
  const [marketplaceLoading, setMarketplaceLoading] = useState(false);
  const [marketplaceError, setMarketplaceError] = useState<string | null>(null);
  const [marketplaceTotalCount, setMarketplaceTotalCount] = useState<number | null>(null);
  const [marketplaceQuery, setMarketplaceQuery] = useState('');
  const [marketplaceHasSearched, setMarketplaceHasSearched] = useState(false);
  useI18nLanguage();
  const marketplaceSearchRef = useRef<number>(0);
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

  const searchMarketplace = useCallback(async (
    params: MarketplaceSearchParams,
  ) => {
    const id = ++marketplaceSearchRef.current;
    setMarketplaceLoading(true);
    setMarketplaceError(null);
    try {
      const result = await window.electron.marketplace.search(params);
      if (id === marketplaceSearchRef.current) {
        setMarketplaceModels(result.models);
        setMarketplaceError(result.warning ?? null);
        setMarketplaceTotalCount(result.totalCount ?? null);
      }
    } catch (searchError) {
      if (id === marketplaceSearchRef.current) {
        setMarketplaceError(
          searchError instanceof Error ? searchError.message : String(searchError),
        );
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

  const loadedModelNames = useMemo(
    () => new Set(runningModels.map(model => model.name || model.model).filter(Boolean)),
    [runningModels],
  );
  const loadedModels = useMemo(
    () => localModels.filter(model => loadedModelNames.has(model.name)),
    [localModels, loadedModelNames],
  );

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
        latestModels.some(model => model.name === modelName || model.model === modelName)
        && Date.now() < deadline
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
          installError instanceof Error ? installError.message : String(installError),
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
          actionError instanceof Error ? actionError.message : String(actionError),
          LocalInferenceToastKind.Error,
        );
      } finally {
        setLoading(false);
      }
    },
    [dismissToast, showToast],
  );

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    marketplaceQueryRef.current = marketplaceQuery;
  }, [marketplaceQuery]);

  useEffect(() => {
    marketplaceHasSearchedRef.current = marketplaceHasSearched;
  }, [marketplaceHasSearched]);

  const sessionSaveTimerRef = useRef<number | null>(null);
  useEffect(() => {
    if (sessionSaveTimerRef.current !== null) {
      window.clearTimeout(sessionSaveTimerRef.current);
    }
    sessionSaveTimerRef.current = window.setTimeout(() => {
      sessionSaveTimerRef.current = null;
      writeLocalInferenceSessionState({
        activeTab,
        selectedModel,
        systemPrompt,
        prompt,
        messages,
      });
    }, 500);
    return () => {
      if (sessionSaveTimerRef.current !== null) {
        window.clearTimeout(sessionSaveTimerRef.current);
      }
    };
  }, [activeTab, messages, prompt, selectedModel, systemPrompt]);

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
      if (nextStatus.status === 'running') {
        await refreshRunningModels();
      }
    });
  }, [refreshLocalModels, refreshRunningModels, refreshStatus, runAction]);

  useEffect(() => {
    const unsubscribers = [
      window.electron.llamacpp.onStatusChanged((nextStatus) => {
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


  const resetInferenceConversation = useCallback(() => {
    const requestId = activeRequestIdRef.current;
    conversationVersionRef.current += 1;
    if (requestId) {
      void window.electron.llamacpp.cancelChatStream(requestId).catch(() => undefined);
    }
    activeRequestIdRef.current = null;
    messagesRef.current = [];
    setMessages([]);
    setInferenceInlineError(null);
    setStreamingText('');
    setStreamingThinking('');
    setPrompt('');
    setSending(false);
    setCancelling(false);
  }, []);

  const handleSelectInferenceModel = useCallback(
    (modelName: string) => {
      if (modelName !== selectedModel) {
        resetInferenceConversation();
      }
      setSelectedModel(modelName);
    },
    [resetInferenceConversation, selectedModel],
  );

  useEffect(() => {
    if (!isRunning) return;
    const timer = window.setInterval(() => {
      void refreshRunningModels().catch(() => undefined);
    }, 5000);
    return () => window.clearInterval(timer);
  }, [isRunning, refreshRunningModels]);

  useEffect(() => {
    if (
      selectedModel &&
      loadedModels.some(model => model.name === selectedModel || model.model === selectedModel)
    ) {
      return;
    }
    const firstRunning = loadedModels[0]?.name;
    if (firstRunning && firstRunning !== selectedModel) {
      setSelectedModel(firstRunning);
    }
  }, [loadedModels, selectedModel]);

  const ensureLlamaCppRunning = useCallback(async () => {
    let snapshot = status ?? await refreshStatus();

    if (snapshot.status === 'not-installed') {
      const installResult = await window.electron.llamacpp.install();
      if (!installResult?.success) {
        throw new Error(installResult?.error || i18nService.t('localInferenceRuntimeMissing'));
      }
      showToast(i18nService.t('localInferenceRuntimeReady'), LocalInferenceToastKind.Success);
      snapshot = await refreshStatus();
    }

    if (snapshot.status === 'installed' || snapshot.status === 'stopped') {
      snapshot = await window.electron.llamacpp.start();
      cachedStatus = snapshot;
      setStatus(snapshot);
    } else if (snapshot.status !== 'running') {
      snapshot = await refreshStatus();
    }

    if (snapshot.status !== 'running') {
      throw new Error(snapshot.error || i18nService.t('localInferenceLaunchRestartFailed'));
    }

    await refreshLocalModels().catch(() => undefined);
    await refreshRunningModels().catch(() => undefined);
    return snapshot;
  }, [refreshLocalModels, refreshRunningModels, refreshStatus, showToast, status]);

  const handlePull = () => {
    if (!normalizedPullName) return;
    if (!isModelScopeRepoId(normalizedPullName)) {
      showToast(
        i18nService.t('localInferencePullInvalidRepo'),
        LocalInferenceToastKind.Error,
      );
      return;
    }
    setActivePullName(normalizedPullName);
    setPullProgress(current => ({
      ...current,
      [normalizedPullName]: {
        phase: 'starting',
        modelId: normalizedPullName,
        modelName: normalizedPullName,
      },
    }));
    void runAction(async () => {
      const result = await window.electron.llamacpp.installModel({
        modelId: normalizedPullName,
        displayName: normalizedPullName,
      });
      if (!result.success) return;
      await refreshLocalModels();
      showToast(
        i18nService.t('localInferencePullDone').replace('{name}', normalizedPullName),
        LocalInferenceToastKind.Success,
      );
    });
  };

  const handleCancelPull = () => {
    if (!activePullName) return;
    void window.electron.llamacpp.cancelPull(activePullName).catch(cancelError => {
      showToast(
        cancelError instanceof Error ? cancelError.message : String(cancelError),
        LocalInferenceToastKind.Error,
      );
    });
  };

  const handleLoadModel = (model: OllamaModel, openInference = false) => {
    void runAction(async () => {
      await ensureLlamaCppRunning();
      const input: LlamaCppModelLaunchInput = {
        model: model.name,
        ...(model.path ? { modelPath: model.path } : {}),
      };
      const result = await window.electron.llamacpp.loadModel(input);
      setRunningModels(result.runningModels);
      notifyLlamaCppRunningModelsChanged();
      resetInferenceConversation();
      setSelectedModel(model.name);
      if (openInference) {
        setActiveTab('inference');
      }
    });
  };

  const handleUnload = (modelName: string) => {
    if (shouldBlockModelAction({ modelName, unloadingModelName })) return;
    const unloadStartedAtMs = Date.now();
    setUnloadingModelName(modelName);
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
      setMarketplaceModels(prev =>
        prev.map(m => {
          const repoName = m.repoId.split('/').pop();
          return repoName === modelName ? { ...m, installed: false } : m;
        }),
      );
      notifyLlamaCppRunningModelsChanged();
    });
  };

  const sendPrompt = async () => {
    if (!selectedModel || !loadedModelNames.has(selectedModel) || !prompt.trim()) return;
    const userMessage = prompt.trim();
    const createdAt = Date.now();
    const baseHistory = messagesRef.current;
    const nextHistory: InferenceMessage[] = [
      ...baseHistory,
      { role: 'user', content: userMessage, createdAt },
    ];
    setMessages(nextHistory);
    messagesRef.current = nextHistory;
    setPrompt('');
    setStreamingText('');
    setStreamingThinking('');
    setSending(true);
    setCancelling(false);
    setInferenceInlineError(null);
    dismissToast();
    const requestId =
      globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const conversationVersion = conversationVersionRef.current;
    activeRequestIdRef.current = requestId;
    const isCurrentRequest = () =>
      activeRequestIdRef.current === requestId &&
      conversationVersionRef.current === conversationVersion;
    const effectiveSystemPrompt = buildEffectiveSystemPrompt(systemPrompt);

    let streamState = createOllamaStreamState();
    const unsubscribe = window.electron.llamacpp.onChatStreamChunk(
      ({ requestId: eventRequestId, chunk }) => {
        if (eventRequestId !== requestId || conversationVersionRef.current !== conversationVersion)
          return;
        streamState = reduceOllamaStreamChunk(streamState, chunk);
        setStreamingThinking(streamState.thinking);
        setStreamingText(streamState.content);
      },
    );

    const streamStartTime = Date.now();

    try {
      const normalizedOptions = normalizeOptions(DEFAULT_INFERENCE_OPTIONS);
      const payload: OllamaChatPayload = {
        model: selectedModel,
        stream: true,
        messages: [
          ...(effectiveSystemPrompt
            ? [{ role: 'system' as const, content: effectiveSystemPrompt }]
            : []),
          ...baseHistory.map(message => ({
            role: message.role,
            content: message.content,
          })),
          { role: 'user', content: userMessage },
        ],
        options: Object.fromEntries(
          Object.entries(normalizedOptions).filter(([key]) => key !== 'chat_template_kwargs'),
        ),
        ...(typeof normalizedOptions.chat_template_kwargs === 'object'
          && normalizedOptions.chat_template_kwargs
          ? {
              chat_template_kwargs: normalizedOptions.chat_template_kwargs as {
                enable_thinking: boolean;
              },
            }
          : {}),
      };
      const streamResult = await window.electron.llamacpp.chatStream(requestId, payload);
      if (!isCurrentRequest()) return;
      if (streamResult.finalChunk) {
        streamState = reduceOllamaStreamChunk(streamState, streamResult.finalChunk);
      }
      const metrics = computeStreamMetrics(streamState.finalChunk, streamStartTime, streamState.content);
      const assistantMessage = buildAssistantMessage({
        content: streamState.content,
        thinking: streamState.thinking,
        metrics,
      });
      setInferenceInlineError(null);
      setMessages([...nextHistory, assistantMessage]);
      messagesRef.current = [...nextHistory, assistantMessage];
      await refreshRunningModels().catch(() => undefined);
    } catch (sendError) {
      if (!isCurrentRequest()) return;
      if (sendError instanceof Error && sendError.message.includes('Generation cancelled')) {
        showToast(i18nService.t('localInferenceGenerationCancelled'));
        if (streamState.content || streamState.thinking) {
          const metrics = computeStreamMetrics(
            streamState.finalChunk,
            streamStartTime,
            streamState.content,
          );
          const assistantMessage = buildAssistantMessage({
            content: streamState.content,
            thinking: streamState.thinking,
            metrics,
          });
          setMessages([...nextHistory, assistantMessage]);
          messagesRef.current = [...nextHistory, assistantMessage];
        }
      } else {
        const inlineError = resolveLocalInferenceInlineError(sendError);
        if (inlineError) {
          setMessages(nextHistory);
          messagesRef.current = nextHistory;
          setInferenceInlineError(inlineError);
        } else {
          setInferenceInlineError(null);
          setMessages(baseHistory);
          messagesRef.current = baseHistory;
          showToast(
            sendError instanceof Error ? sendError.message : String(sendError),
            LocalInferenceToastKind.Error,
          );
        }
      }
    } finally {
      unsubscribe();
      if (isCurrentRequest()) {
        activeRequestIdRef.current = null;
        setSending(false);
        setCancelling(false);
        setStreamingText('');
        setStreamingThinking('');
      }
    }
  };

  const stopGeneration = async () => {
    const requestId = activeRequestIdRef.current;
    if (!requestId) return;
    setCancelling(true);
    try {
      await window.electron.llamacpp.cancelChatStream(requestId);
    } catch (cancelError) {
      showToast(
        cancelError instanceof Error ? cancelError.message : String(cancelError),
        LocalInferenceToastKind.Error,
      );
      setCancelling(false);
    }
  };

  return (
    <div className="relative flex h-full flex-1 flex-col bg-background">
      <div className="draggable flex h-12 items-center justify-between px-4 border-b border-border shrink-0">
        <div className="flex items-center space-x-3 h-8">
          {isSidebarCollapsed && (
            <div className={`non-draggable flex items-center gap-1 ${isMac ? 'pl-[68px]' : ''}`}>
              <button
                type="button"
                onClick={onToggleSidebar}
                className="h-8 w-8 inline-flex items-center justify-center rounded-lg text-secondary hover:bg-surface-raised transition-colors"
              >
                <SidebarToggleIcon className="h-4 w-4" isCollapsed={true} />
              </button>
              <button
                type="button"
                onClick={onNewChat}
                className="h-8 w-8 inline-flex items-center justify-center rounded-lg text-secondary hover:bg-surface-raised transition-colors"
              >
                <ComposeIcon className="h-4 w-4" />
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
      {toast && (
        <div className="pointer-events-none absolute right-4 top-16 z-30 flex w-[min(24rem,calc(100%-2rem))] justify-end">
          <LocalInferenceToastView toast={toast} onClose={dismissToast} />
        </div>
      )}

      <div className="flex-1 min-h-0 overflow-y-auto [scrollbar-gutter:stable]">
        <div
          className={`mx-auto max-w-6xl px-4 py-5 ${activeTab === 'inference' ? 'flex h-full min-h-0 flex-col gap-4' : 'space-y-4'}`}
        >
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="inline-flex rounded-lg bg-surface-raised p-1">
              {(['inference', 'models', 'marketplace'] as LocalInferenceTab[]).map(tab => (
                <button
                  key={tab}
                  type="button"
                  onClick={() => setActiveTab(tab)}
                  className={`h-7 rounded-md px-3 text-sm transition-colors ${
                    activeTab === tab
                      ? 'bg-background text-foreground shadow-sm'
                      : 'text-secondary hover:text-foreground'
                  }`}
                >
                  {i18nService.t(
                    tab === 'inference'
                      ? 'localInferenceTabInference'
                      : tab === 'models'
                        ? 'localInferenceTabModels'
                        : 'localInferenceTabMarketplace',
                  )}
                </button>
              ))}
            </div>
            <div className="text-xs text-secondary">
              {isRunning
                ? i18nService.t('localInferenceStatus_running')
                : i18nService.t('localInferenceStatus_stopped')}
            </div>
          </div>

          {activeTab === 'models' ? (
            <ModelsPanel
              loading={loading}
              unloadingModelName={unloadingModelName}
              localModels={localModels}
              runningModels={runningModels}
              pullName={pullName}
              pulling={pulling}
              onPullNameChange={setPullName}
              onPull={handlePull}
              onCancelPull={handleCancelPull}
              onLoadModel={model => {
                handleLoadModel(model);
              }}
              onUnload={handleUnload}
              onDelete={handleDelete}
              onOpenInference={modelName => {
                handleSelectInferenceModel(modelName);
                setActiveTab('inference');
              }}
            />
          ) : activeTab === 'marketplace' ? (
            <MarketplacePanel
              loading={loading}
              models={marketplaceModels}
              hasSearched={marketplaceHasSearched}
              marketplaceLoading={marketplaceLoading}
              marketplaceError={marketplaceError}
              marketplaceTotalCount={marketplaceTotalCount}
              query={marketplaceQuery}
              installedModelPathMap={installedModelPathMap}
              installProgress={pullProgress}
              onQueryChange={setMarketplaceQuery}
              onSearch={handleMarketplaceSearch}
              onInstall={handleMarketplaceInstall}
            />
          ) : (
            <div className="min-h-[520px] flex-1">
              <InferencePanel
                isRunning={isRunning}
                selectedModel={selectedModel}
                loadedModels={loadedModels}
                systemPrompt={systemPrompt}
                prompt={prompt}
                messages={messages}
                inlineError={inferenceInlineError}
                streamingText={streamingText}
                streamingThinking={streamingThinking}
                sending={sending}
                cancelling={cancelling}
                onModelChange={handleSelectInferenceModel}
                onSystemPromptChange={setSystemPrompt}
                onPromptChange={setPrompt}
                onSend={() => void sendPrompt()}
                onStop={() => void stopGeneration()}
                onOpenModels={() => setActiveTab('models')}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

function getModelCardBusyState(input: {
  modelName: string;
  unloadingModelName: string | null;
  globalLoading: boolean;
}): { cardBusy: boolean; buttonsDisabled: boolean } {
  const cardBusy = Boolean(input.unloadingModelName && input.unloadingModelName === input.modelName);
  return {
    cardBusy,
    buttonsDisabled: input.globalLoading || cardBusy,
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

export const __test__getMarketplacePageSize = () => getMarketplacePageSize();
export const __test__buildAssistantMessage = (input: BuildAssistantMessageInput) =>
  buildAssistantMessage(input);
export const __test__buildStreamingAssistantMessage = (
  input: Parameters<typeof buildStreamingAssistantMessage>[0],
) => buildStreamingAssistantMessage(input);
export const __test__getNewAssistantScrollTargetIndex = (historyLength: number) =>
  getNewAssistantScrollTargetIndex(historyLength);
export const __test__buildMarketplaceSearchParams = (
  input: Parameters<typeof buildMarketplaceSearchParams>[0],
) => buildMarketplaceSearchParams(input);
export const __test__getInstallableMarketplaceModels = (
  models: MarketplaceModel[],
  installedModelPathMap: Map<string, string>,
) => getInstallableMarketplaceModels(models, installedModelPathMap);
export const __test__isModelScopeRepoId = (value: string) => isModelScopeRepoId(value);
export const __test__isScrollNearBottom = (input: Parameters<typeof isScrollNearBottom>[0]) =>
  isScrollNearBottom(input);
export const __test__hasHiddenContentBelow = (input: Parameters<typeof hasHiddenContentBelow>[0]) =>
  hasHiddenContentBelow(input);
export const __test__getAssistantScrollTop = (input: Parameters<typeof getAssistantScrollTop>[0]) =>
  getAssistantScrollTop(input);
export const __test__findLatestUserMessageIndex = (messages: InferenceMessage[]) =>
  findLatestUserMessageIndex(messages);
export const __test__getModelCardBusyState = (input: {
  modelName: string;
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

