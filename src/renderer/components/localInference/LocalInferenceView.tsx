import {
  AdjustmentsHorizontalIcon,
  ArrowDownTrayIcon,
  ArrowPathIcon,
  ArrowTopRightOnSquareIcon,
  CheckCircleIcon,
  ChevronRightIcon,
  ClipboardDocumentIcon,
  CpuChipIcon,
  ExclamationTriangleIcon,
  EyeIcon,
  EyeSlashIcon,
  InformationCircleIcon,
  PaperAirplaneIcon,
  PlayIcon,
  ServerStackIcon,
  StopIcon,
  TrashIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type {
  LlamaCppChatChunk as OllamaChatChunk,
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
import Modal from '../common/Modal';
import ComposeIcon from '../icons/ComposeIcon';
import SidebarToggleIcon from '../icons/SidebarToggleIcon';
import MarkdownContent from '../MarkdownContent';
import WindowTitleBar from '../window/WindowTitleBar';
import {
  DEFAULT_INFERENCE_OPTIONS,
  normalizeOptions,
} from './inferenceOptions';

type LocalInferenceTab = 'inference' | 'models' | 'marketplace';

type InferenceMessage = {
  role: 'user' | 'assistant';
  content: string;
  thinking?: string;
  waiting?: boolean;
  metrics?: OllamaChatChunk | null;
  createdAt: number;
  reasoningDurationSeconds?: number;
};

const LocalInferenceToastKind = {
  Success: 'success',
  Error: 'error',
  Info: 'info',
} as const;
type LocalInferenceToastKind =
  (typeof LocalInferenceToastKind)[keyof typeof LocalInferenceToastKind];
type LocalInferenceToast = {
  id: string;
  kind: LocalInferenceToastKind;
  message: string;
  autoDismiss: boolean;
};
type LocalInferenceInlineError =
  | {
      kind: 'context-overflow';
      requestedTokens: number | null;
      availableTokens: number | null;
    };
type LocalInferenceSessionState = {
  activeTab: LocalInferenceTab;
  selectedModel: string;
  systemPrompt: string;
  prompt: string;
  messages: InferenceMessage[];
};

type InstallProgressState = Record<string, LlamaCppInstallProgress>;
type BuildAssistantMessageInput = {
  content: string;
  thinking: string;
  metrics?: OllamaChatChunk | null;
};

const MARKETPLACE_PAGE_SIZE = 6;
const MARKETPLACE_SEARCH_MAX_MODEL_COUNT = 3000;
const CHAT_NEAR_BOTTOM_THRESHOLD = 96;
const CHAT_HIDDEN_BELOW_THRESHOLD = 8;
const ASSISTANT_SCROLL_TOP_OFFSET = 0;
const CHAT_MANUAL_SCROLL_OVERRIDE_MS = 1200;
const LOCAL_INFERENCE_TOAST_AUTO_DISMISS_MS = 5_000;
const LOCAL_INFERENCE_PROGRESS_DISMISS_MS = 5_000;
const LOCAL_INFERENCE_UNLOAD_MIN_BUSY_MS = 500;
const LOCAL_INFERENCE_UNLOAD_SETTLE_TIMEOUT_MS = 3_000;
const LOCAL_INFERENCE_UNLOAD_SETTLE_POLL_INTERVAL_MS = 400;
const LOCAL_INFERENCE_MIN_SPEED_SAMPLE_SECONDS = 0.05;
const LOCAL_INFERENCE_MAX_SPEED_FOR_TINY_COMPLETION = 200;
const LOCAL_INFERENCE_MAX_SPEED_FOR_SMALL_COMPLETION = 2000;
const LOCAL_INFERENCE_SESSION_STORAGE_KEY = 'lobsterai:llamacpp-inference-session';
const DIRECT_ANSWER_SYSTEM_HINT = [
  'Answer as quickly and directly as possible.',
  'Skip unnecessary drafts, long internal monologues, and unrelated exploration.',
  'If you produce thinking, keep it very short and focused before giving the final answer.',
  'Please think briefly, do not ramble, and keep any visible thinking within about 50 Chinese characters or one short sentence when possible.',
  'Focus on the necessary conditions first, then give the conclusion without drifting to unrelated topics.',
].join(' ');
const smallOutlineButtonClass =
  'inline-flex h-7 items-center gap-1.5 rounded-md border border-border px-2 text-xs text-foreground/80 transition-colors hover:bg-surface-raised disabled:cursor-not-allowed disabled:opacity-50';
const smallDangerButtonClass =
  'inline-flex h-7 items-center gap-1.5 rounded-md border border-border px-2 text-xs text-red-600 transition-colors hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50 dark:text-red-400 dark:hover:bg-red-950/30';

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
      kind: LocalInferenceToastKind = LocalInferenceToastKind.Info,
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

function LocalInferenceToastView({
  toast,
  onClose,
}: {
  toast: LocalInferenceToast;
  onClose: () => void;
}) {
  const tone =
    toast.kind === LocalInferenceToastKind.Error
      ? {
          Icon: ExclamationTriangleIcon,
          borderClass: 'border-red-500/30',
          iconClass: 'bg-red-500/15 text-red-500',
          messageClass: 'text-red-700 dark:text-red-200',
        }
      : toast.kind === LocalInferenceToastKind.Success
        ? {
            Icon: CheckCircleIcon,
            borderClass: 'border-emerald-500/30',
            iconClass: 'bg-emerald-500/15 text-emerald-500',
            messageClass: 'text-foreground',
          }
        : {
            Icon: InformationCircleIcon,
            borderClass: 'border-primary/30',
            iconClass: 'bg-primary/15 text-primary',
            messageClass: 'text-foreground',
          };

  return (
    <div
      className={`pointer-events-auto w-full max-w-sm rounded-xl border bg-background/95 px-4 py-3 shadow-2xl backdrop-blur ${tone.borderClass}`}
    >
      <div className="flex items-start gap-3">
        <span
          className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${tone.iconClass}`}
        >
          <tone.Icon className="h-4 w-4" />
        </span>
        <div className={`min-w-0 flex-1 text-sm leading-6 ${tone.messageClass}`}>
          {toast.message}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-secondary transition-colors hover:bg-surface-raised hover:text-foreground"
          aria-label={i18nService.t('close')}
        >
          <XMarkIcon className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

function ModelsPanel({
  loading,
  unloadingModelName,
  localModels,
  runningModels,
  pullName,
  pulling,
  onPullNameChange,
  onPull,
  onCancelPull,
  onLoadModel,
  onUnload,
  onDelete,
  onOpenInference,
}: {
  loading: boolean;
  unloadingModelName: string | null;
  localModels: OllamaModel[];
  runningModels: OllamaRunningModel[];
  pullName: string;
  pulling: boolean;
  onPullNameChange: (value: string) => void;
  onPull: () => void;
  onCancelPull: () => void;
  onLoadModel: (model: OllamaModel) => void;
  onUnload: (modelName: string) => void;
  onDelete: (modelName: string) => void;
  onOpenInference: (modelName: string) => void;
}) {
  return (
    <div className="space-y-4">
      <section className="rounded-lg border border-border bg-surface px-3 py-3">
        <h2 className="text-sm font-semibold text-foreground">
          {i18nService.t('localInferencePullTitle')}
        </h2>
        <p className="mt-1 text-xs text-secondary">{i18nService.t('localInferencePullHint')}</p>
        <div className="mt-3 flex flex-col gap-2 md:flex-row md:items-center">
          <input
            value={pullName}
            onChange={event => onPullNameChange(event.target.value)}
            onKeyDown={event => {
              if (event.key === 'Enter' && pullName.trim() && !pulling) onPull();
            }}
            disabled={pulling}
            placeholder={i18nService.t('localInferencePullPlaceholder')}
            className="h-8 flex-1 rounded-md border border-border bg-background px-2.5 font-mono text-sm text-foreground outline-none transition-colors focus:border-primary/60 disabled:opacity-60"
          />
          {pulling ? (
            <button type="button" onClick={onCancelPull} className={smallOutlineButtonClass}>
              <StopIcon className="h-3.5 w-3.5" />
              {i18nService.t('localInferenceCancelPull')}
            </button>
          ) : (
            <button
              type="button"
              onClick={onPull}
              disabled={!pullName.trim() || loading}
              className="inline-flex h-8 items-center justify-center gap-1.5 rounded-md bg-primary px-3 text-sm font-medium text-white transition-colors hover:bg-primary-hover disabled:opacity-60"
            >
              <ArrowDownTrayIcon className="h-4 w-4" />
              {i18nService.t('localInferencePull')}
            </button>
          )}
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-foreground">
          {i18nService.t('localInferenceRegisteredModels')}
        </h2>
        {localModels.length === 0 ? (
          <EmptyState title={i18nService.t('localInferenceNoModels')} />
        ) : (
          <div className="overflow-hidden rounded-lg border border-border bg-surface">
            {localModels.map(model => {
              const runningModel = runningModels.find(
                item => item.name === model.name || item.model === model.name,
              );
              return (
                <ModelCard
                  key={model.name}
                  model={model}
                  runningModel={runningModel}
                  loading={loading}
                  unloading={unloadingModelName === model.name}
                  onLoadModel={() => {
                    if (shouldBlockModelAction({ modelName: model.name, unloadingModelName })) return;
                    onLoadModel(model);
                  }}
                  onUnload={() => onUnload(model.name)}
                  onDelete={() => onDelete(model.name)}
                  onOpenInference={() => {
                    if (shouldBlockModelAction({ modelName: model.name, unloadingModelName })) return;
                    onOpenInference(model.name);
                  }}
                />
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}

function ModelCard({
  model,
  runningModel,
  loading,
  unloading,
  onLoadModel,
  onUnload,
  onDelete,
  onOpenInference,
}: {
  model: OllamaModel;
  runningModel?: OllamaRunningModel;
  loading: boolean;
  unloading: boolean;
  onLoadModel: () => void;
  onUnload: () => void;
  onDelete: () => void;
  onOpenInference: () => void;
}) {
  const isRunning = Boolean(runningModel);
  const { cardBusy, buttonsDisabled } = getModelCardBusyState({
    modelName: model.name,
    unloadingModelName: unloading ? model.name : null,
    globalLoading: loading,
  });
  return (
    <div className={`flex flex-col gap-3 border-b border-border px-3 py-3 last:border-b-0 md:flex-row md:items-center md:justify-between ${cardBusy ? 'bg-surface-raised/20' : ''}`}>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="truncate font-mono text-sm font-medium text-foreground">{model.name}</h3>
          {model.details?.parameter_size && <Badge>{model.details.parameter_size}</Badge>}
          {model.details?.quantization_level && <Badge>{model.details.quantization_level}</Badge>}
          {isRunning && <Badge tone="success">{i18nService.t('localInferenceLoaded')}</Badge>}
        </div>
        <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-xs text-secondary">
          {model.size ? (
            <span>
              {i18nService.t('localInferenceSize')}: {formatBytes(model.size)}
            </span>
          ) : null}
          {model.modified_at ? (
            <span>
              {i18nService.t('localInferenceModified')}: {formatDate(model.modified_at)}
            </span>
          ) : null}
          {model.details?.family ? (
            <span>
              {i18nService.t('localInferenceFamily')}: {model.details.family}
            </span>
          ) : null}
          {model.details?.context_length ? (
            <span>
              {i18nService.t('localInferenceTrainedContext')}: {model.details.context_length}
            </span>
          ) : null}
          {runningModel?.runtime_context_length ? (
            <span>
              {i18nService.t('localInferenceRuntimeContext')}: {runningModel.runtime_context_length}
            </span>
          ) : null}
          {runningModel?.size_vram ? (
            <span>
              {i18nService.t('localInferenceVram')}: {formatBytes(runningModel.size_vram)}
            </span>
          ) : null}
        </div>
        {cardBusy && (
          <div className="mt-3 max-w-xs rounded-lg border border-primary/20 bg-primary/5 px-3 py-2">
            <div className="flex items-center gap-2 text-xs font-medium text-foreground">
              <ArrowPathIcon className="h-3.5 w-3.5 animate-spin text-primary" />
              <span>{i18nService.t('localInferenceUnloadingHint')}</span>
            </div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-raised">
              <div className="h-full w-2/3 animate-pulse rounded-full bg-primary" />
            </div>
          </div>
        )}
      </div>
      <div
        className={`flex shrink-0 flex-wrap items-center gap-2 ${cardBusy ? 'pointer-events-none' : ''}`}
      >
        {isRunning ? (
          <button
            type="button"
            onClick={onUnload}
            disabled={buttonsDisabled}
            className={smallOutlineButtonClass}
          >
            {cardBusy ? (
              <ArrowPathIcon className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <StopIcon className="h-3.5 w-3.5" />
            )}
            {cardBusy
              ? i18nService.t('localInferenceUnloading')
              : i18nService.t('localInferenceUnload')}
          </button>
        ) : (
          <button
            type="button"
            onClick={onLoadModel}
            disabled={buttonsDisabled}
            className={smallOutlineButtonClass}
          >
            <PlayIcon className="h-3.5 w-3.5" />
            {i18nService.t('localInferenceLoad')}
          </button>
        )}
        <button
          type="button"
          onClick={onOpenInference}
          disabled={buttonsDisabled}
          className={smallOutlineButtonClass}
        >
          <ServerStackIcon className="h-3.5 w-3.5" />
          {i18nService.t('localInferenceInfer')}
        </button>
        <button
          type="button"
          onClick={onDelete}
          disabled={buttonsDisabled}
          className={smallDangerButtonClass}
        >
          <TrashIcon className="h-3.5 w-3.5" />
          {i18nService.t('delete')}
        </button>
      </div>
    </div>
  );
}

function InferencePanel({
  isRunning,
  selectedModel,
  loadedModels,
  systemPrompt,
  prompt,
  messages,
  inlineError,
  streamingText,
  streamingThinking,
  sending,
  cancelling,
  onModelChange,
  onSystemPromptChange,
  onPromptChange,
  onSend,
  onStop,
  onOpenModels,
}: {
  isRunning: boolean;
  selectedModel: string;
  loadedModels: OllamaModel[];
  systemPrompt: string;
  prompt: string;
  messages: InferenceMessage[];
  inlineError: LocalInferenceInlineError | null;
  streamingText: string;
  streamingThinking: string;
  sending: boolean;
  cancelling: boolean;
  onModelChange: (value: string) => void;
  onSystemPromptChange: (value: string) => void;
  onPromptChange: (value: string) => void;
  onSend: () => void;
  onStop: () => void;
  onOpenModels: () => void;
}) {
  useI18nLanguage();
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const chatScrollRef = useRef<HTMLDivElement>(null);
  const latestTurnStartRef = useRef<HTMLDivElement>(null);
  const latestTurnScrollTargetIndexRef = useRef<number | null>(null);
  const pendingLatestTurnAlignRef = useRef(false);
  const lockLatestTurnAnchorRef = useRef(false);
  const autoFollowStreamRef = useRef(true);
  const manualScrollOverrideUntilRef = useRef(0);
  const streamFollowFrameRef = useRef<number | null>(null);
  const programmaticScrollRef = useRef<{ mode: 'align' | 'bottom'; until: number } | null>(null);
  const composingRef = useRef(false);
  const [showJumpToBottom, setShowJumpToBottom] = useState(false);
  const currentModelName = selectedModel || loadedModels[0]?.name || '';
  const markProgrammaticScroll = useCallback(
    (mode: 'align' | 'bottom', behavior: ScrollBehavior) => {
      const duration = behavior === 'smooth' ? 400 : 120;
      programmaticScrollRef.current = {
        mode,
        until: window.performance.now() + duration,
      };
    },
    [],
  );
  const stopStreamAutoFollow = useCallback(() => {
    autoFollowStreamRef.current = false;
    manualScrollOverrideUntilRef.current =
      window.performance.now() + CHAT_MANUAL_SCROLL_OVERRIDE_MS;
    if (streamFollowFrameRef.current !== null) {
      window.cancelAnimationFrame(streamFollowFrameRef.current);
      streamFollowFrameRef.current = null;
    }
  }, []);
  const syncScrollIndicators = useCallback(() => {
    const element = chatScrollRef.current;
    if (!element) return;
    const hiddenBelow = hasHiddenContentBelow({
      scrollTop: element.scrollTop,
      clientHeight: element.clientHeight,
      scrollHeight: element.scrollHeight,
    });
    const nearBottom = isScrollNearBottom({
      scrollTop: element.scrollTop,
      clientHeight: element.clientHeight,
      scrollHeight: element.scrollHeight,
    });
    const activeProgrammaticScroll =
      programmaticScrollRef.current &&
      window.performance.now() <= programmaticScrollRef.current.until
        ? programmaticScrollRef.current
        : null;
    const manualOverrideActive =
      window.performance.now() <= manualScrollOverrideUntilRef.current;
    if (!activeProgrammaticScroll) {
      programmaticScrollRef.current = null;
      autoFollowStreamRef.current = manualOverrideActive ? false : nearBottom;
    } else if (activeProgrammaticScroll.mode === 'bottom') {
      autoFollowStreamRef.current = true;
      manualScrollOverrideUntilRef.current = 0;
      setShowJumpToBottom(false);
      return;
    } else {
      autoFollowStreamRef.current = false;
    }
    setShowJumpToBottom(hiddenBelow);
  }, []);
  const submitPrompt = () => {
    latestTurnScrollTargetIndexRef.current = getNewAssistantScrollTargetIndex(messages.length);
    pendingLatestTurnAlignRef.current = true;
    lockLatestTurnAnchorRef.current = true;
    autoFollowStreamRef.current = true;
    manualScrollOverrideUntilRef.current = 0;
    onSend();
  };
  const scrollToBottom = useCallback(
    (behavior: ScrollBehavior = 'smooth') => {
      const element = chatScrollRef.current;
      if (!element) return;
      markProgrammaticScroll('bottom', behavior);
      pendingLatestTurnAlignRef.current = false;
      lockLatestTurnAnchorRef.current = false;
      autoFollowStreamRef.current = true;
      manualScrollOverrideUntilRef.current = 0;
      element.scrollTo({
        top: Math.max(0, element.scrollHeight - element.clientHeight),
        behavior,
      });
    },
    [markProgrammaticScroll],
  );
  const scrollLatestTurnStartIntoView = useCallback(
    (behavior: ScrollBehavior = 'auto') => {
      const container = chatScrollRef.current;
      const element = latestTurnStartRef.current;
      if (!container || !element) return;
      const top = getAssistantScrollTop({
        containerScrollTop: container.scrollTop,
        containerTop: container.getBoundingClientRect().top,
        targetTop: element.getBoundingClientRect().top,
      });
      markProgrammaticScroll('align', behavior);
      autoFollowStreamRef.current = false;
      manualScrollOverrideUntilRef.current = 0;
      container.scrollTo({ top, behavior });
    },
    [markProgrammaticScroll],
  );
  useEffect(() => {
    if (!sending) return;
    if (!pendingLatestTurnAlignRef.current) return;
    if (latestTurnScrollTargetIndexRef.current !== messages.length) return;
    const frame = window.requestAnimationFrame(() => {
      scrollLatestTurnStartIntoView('auto');
      pendingLatestTurnAlignRef.current = false;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [messages.length, scrollLatestTurnStartIntoView, sending]);

  useEffect(() => {
    syncScrollIndicators();
  }, [messages.length, sending, streamingText, streamingThinking, syncScrollIndicators]);

  useEffect(() => {
    if (!sending || pendingLatestTurnAlignRef.current || !autoFollowStreamRef.current) return;
    if (streamFollowFrameRef.current !== null) {
      window.cancelAnimationFrame(streamFollowFrameRef.current);
    }
    streamFollowFrameRef.current = window.requestAnimationFrame(() => {
      streamFollowFrameRef.current = null;
      const element = chatScrollRef.current;
      if (!element) return;
      element.scrollTop = Math.max(0, element.scrollHeight - element.clientHeight);
      syncScrollIndicators();
    });
    return () => {
      if (streamFollowFrameRef.current !== null) {
        window.cancelAnimationFrame(streamFollowFrameRef.current);
        streamFollowFrameRef.current = null;
      }
    };
  }, [sending, streamingText, streamingThinking, syncScrollIndicators]);

  useEffect(() => {
    if (sending) return;
    if (!lockLatestTurnAnchorRef.current) return;
    const frame = window.requestAnimationFrame(() => {
      scrollLatestTurnStartIntoView('auto');
    });
    return () => window.cancelAnimationFrame(frame);
  }, [scrollLatestTurnStartIntoView, sending]);

  useEffect(() => {
    if (sending) return;
    pendingLatestTurnAlignRef.current = false;
    latestTurnScrollTargetIndexRef.current = null;
    lockLatestTurnAnchorRef.current = false;
    autoFollowStreamRef.current = true;
    manualScrollOverrideUntilRef.current = 0;
    programmaticScrollRef.current = null;
  }, [sending]);

  useEffect(() => {
    if (sending || cancelling || !currentModelName) return;
    const frame = window.requestAnimationFrame(() => {
      promptRef.current?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [cancelling, currentModelName, sending]);

  if (!isRunning || loadedModels.length === 0) {
    return (
      <EmptyState
        title={i18nService.t(
          !isRunning ? 'localInferenceServiceStopped' : 'localInferenceNoLoadedModels',
        )}
        action={
          <button
            type="button"
            onClick={onOpenModels}
            className="inline-flex h-9 items-center rounded-lg border border-border px-3 text-sm text-foreground hover:bg-surface-raised"
          >
            {i18nService.t('localInferenceOpenModels')}
          </button>
        }
      />
    );
  }

  return (
    <div className="relative flex h-full min-h-0 flex-col overflow-hidden bg-background">
      <div className="shrink-0 border-b border-border-subtle bg-surface/40">
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 px-6 py-4">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <h2 className="truncate text-base font-medium text-foreground">
                {currentModelName}
              </h2>
              <p className="text-xs text-secondary">{i18nService.t('localInferenceTitle')}</p>
            </div>
            <button
              type="button"
              onClick={onOpenModels}
              className={smallOutlineButtonClass}
            >
              <ServerStackIcon className="h-3.5 w-3.5" />
              {i18nService.t('localInferenceOpenModels')}
            </button>
          </div>
          <div className="grid gap-4 lg:grid-cols-[minmax(220px,320px)_minmax(0,1fr)]">
            <label className="space-y-1.5">
              <span className="text-xs font-medium text-secondary">
                {i18nService.t('localInferenceModel')}
              </span>
              <select
                value={currentModelName}
                onChange={event => onModelChange(event.target.value)}
                className="h-10 w-full rounded-xl border border-border bg-surface-input px-3 text-sm text-foreground outline-none transition-colors focus:border-primary/60"
              >
                {loadedModels.map(model => (
                  <option key={model.name} value={model.name}>
                    {model.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1.5">
              <div className="space-y-0.5">
                <span className="text-xs font-medium text-secondary">
                  {i18nService.t('localInferenceSystemPrompt')}
                </span>
                <p className="text-[11px] leading-4 text-secondary">
                  {i18nService.t('localInferenceSystemPromptHint')}
                </p>
              </div>
              <textarea
                value={systemPrompt}
                onChange={event => onSystemPromptChange(event.target.value)}
                className="min-h-24 w-full resize-y rounded-2xl border border-border bg-surface-input px-3 py-3 text-sm text-foreground outline-none transition-colors focus:border-primary/60"
              />
            </label>
          </div>
        </div>
      </div>
      <div
        ref={chatScrollRef}
        className="local-inference-chat-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain px-0 [scrollbar-gutter:stable_both-edges]"
        onWheelCapture={event => {
          if (sending && event.deltaY < 0) {
            stopStreamAutoFollow();
          }
        }}
        onScroll={syncScrollIndicators}
        style={{
          scrollbarWidth: 'thin',
          scrollbarColor: 'var(--lobster-scroll-thumb) transparent',
          overflowAnchor: 'none',
        }}
      >
        {messages.length === 0 && !sending && (
          <div className="flex min-h-full flex-col items-center justify-center px-6 py-12 text-center">
            <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col items-center justify-center gap-5">
              <div className="flex h-16 w-16 items-center justify-center rounded-3xl bg-surface-raised text-secondary">
                <CpuChipIcon className="h-8 w-8" />
              </div>
              <div className="space-y-2">
                <p className="text-xl font-medium text-foreground">
                  {i18nService.t('localInferenceEmptyChat')}
                </p>
                <p className="text-sm text-secondary">{currentModelName}</p>
              </div>
            </div>
          </div>
        )}
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-6 pb-28 pt-8 select-text">
          {messages.map((message, index) => {
            const isLatestTurnStart =
              message.role === 'user' &&
              (sending
                ? index === messages.length - 1
                : index === findLatestUserMessageIndex(messages));
            return (
              <div
                key={index}
                ref={isLatestTurnStart ? latestTurnStartRef : undefined}
                data-message-index={index}
              >
                <ChatBubble message={message} />
              </div>
            );
          })}
          {sending && (
            <div data-message-index={messages.length}>
              <ChatBubble
                message={buildStreamingAssistantMessage({
                  content: streamingText,
                  thinking: streamingThinking,
                })}
                streaming
              />
            </div>
          )}
          {inlineError && (
            <InferenceInlineErrorCard error={inlineError} onOpenModels={onOpenModels} />
          )}
        </div>
      </div>
      {showJumpToBottom && (
        <div className="pointer-events-none absolute inset-x-0 bottom-28 flex justify-center px-4">
          <button
            type="button"
            onClick={() => scrollToBottom()}
            className="pointer-events-auto inline-flex h-10 w-10 items-center justify-center rounded-full border border-border-subtle bg-surface-overlay/95 text-secondary shadow-popover backdrop-blur transition-colors hover:bg-surface-raised hover:text-foreground"
            aria-label={i18nService.t('localInferenceJumpToBottom')}
            title={i18nService.t('localInferenceJumpToBottom')}
          >
            <ChevronRightIcon className="h-4 w-4 rotate-90" />
          </button>
        </div>
      )}
      <div className="sticky bottom-0 z-20 flex-shrink-0 px-6 pb-6 pt-3">
        <div className="mx-auto w-full max-w-5xl rounded-[28px] border border-border bg-surface-overlay/95 p-2 shadow-card backdrop-blur">
          <textarea
            ref={promptRef}
            value={prompt}
            onChange={event => onPromptChange(event.target.value)}
            onCompositionStart={() => {
              composingRef.current = true;
            }}
            onCompositionEnd={() => {
              composingRef.current = false;
            }}
            onKeyDown={event => {
              if (
                event.key === 'Enter' &&
                !event.shiftKey &&
                !sending &&
                !composingRef.current &&
                !event.nativeEvent.isComposing
              ) {
                event.preventDefault();
                submitPrompt();
              }
            }}
            className="min-h-20 w-full resize-none rounded-3xl border-0 bg-transparent px-4 py-3 text-sm text-foreground outline-none placeholder:text-secondary"
            placeholder={i18nService.t('localInferencePromptPlaceholder')}
          />
          <div className="flex items-center justify-end px-2 pb-1">
            <button
              type="button"
              onClick={sending ? onStop : submitPrompt}
              disabled={!currentModelName || cancelling || (!prompt.trim() && !sending)}
              className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary text-white transition-colors hover:bg-primary-hover disabled:opacity-40"
              aria-label={
                sending
                  ? i18nService.t('localInferenceStopGeneration')
                  : i18nService.t('localInferenceSend')
              }
            >
              {sending ? (
                <StopIcon className="h-4 w-4" />
              ) : (
                <PaperAirplaneIcon className="h-4 w-4" />
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ChatBubble({
  message,
  streaming = false,
}: {
  message: InferenceMessage;
  streaming?: boolean;
}) {
  const isUser = message.role === 'user';
  const hasThinking = Boolean(message.thinking?.trim());
  const hasVisibleContent = Boolean(message.content.trim());
  const [reasoningOpen, setReasoningOpen] = useState(streaming);

  useEffect(() => {
    if (streaming) {
      setReasoningOpen(true);
      return;
    }
    if (hasThinking && hasVisibleContent) {
      setReasoningOpen(false);
    }
  }, [hasThinking, hasVisibleContent, streaming]);

  return (
    <article className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div className={isUser ? 'max-w-[86%]' : 'w-full'}>
        {isUser ? (
          <div className="flex justify-end">
            <div className="w-fit rounded-2xl bg-primary px-4 py-2.5 text-sm leading-7 text-primary-foreground shadow-sm">
              <div className="whitespace-pre-wrap break-words">{message.content}</div>
            </div>
          </div>
        ) : (
          <div className="text-sm leading-7 text-foreground">
            {hasThinking && (
              <ReasoningPanel
                content={message.thinking ?? ''}
                isOpen={reasoningOpen}
                isStreaming={streaming && !hasVisibleContent}
                durationSeconds={message.reasoningDurationSeconds}
                onToggle={() => setReasoningOpen(current => !current)}
              />
            )}
            {message.waiting && <WaitingDots />}
            {message.content.trim() ? (
              <div className="mt-1">
                <MarkdownContent content={message.content} />
                {streaming && !message.waiting && hasVisibleContent && (
                  <span className="ml-0.5 inline-block h-4 w-2 animate-pulse bg-foreground/45 align-text-bottom" />
                )}
              </div>
            ) : null}
          </div>
        )}
        <MessageMetaRow message={message} isUser={isUser} />
      </div>
    </article>
  );
}

function ReasoningPanel({
  content,
  isOpen,
  isStreaming,
  durationSeconds,
  onToggle,
}: {
  content: string;
  isOpen: boolean;
  isStreaming: boolean;
  durationSeconds?: number;
  onToggle: () => void;
}) {
  return (
    <div className="mb-3">
      <button
        type="button"
        onClick={onToggle}
        className="flex items-center gap-2 text-left text-sm text-secondary transition-colors hover:text-foreground [&>span:first-child]:hidden"
      >
        <span className="text-base leading-none">+</span>
        <ThinkingStatusText
          isStreaming={isStreaming}
          durationSeconds={durationSeconds}
        />
        <ChevronRightIcon className={`h-4 w-4 transition-transform ${isOpen ? 'rotate-90' : ''}`} />
      </button>
      {isOpen && (
        <ThinkingContent content={content} streaming={isStreaming} />
      )}
    </div>
  );
}

function MessageMetaRow({
  message,
  isUser,
}: {
  message: InferenceMessage;
  isUser: boolean;
}) {
  const handleCopy = useCallback(async () => {
    const segments = [message.content.trim(), message.thinking?.trim() ?? ''].filter(Boolean);
    await navigator.clipboard.writeText(segments.join('\n\n'));
  }, [message.content, message.thinking]);

  return (
    <div
      className={`mt-2 flex flex-wrap items-center gap-3 text-xs text-secondary ${
        isUser ? 'justify-end' : 'justify-start'
      }`}
    >
      <span>{formatMessageTimestamp(message.createdAt)}</span>
      <button
        type="button"
        onClick={() => void handleCopy()}
        className="inline-flex items-center gap-1 transition-colors hover:text-foreground"
        title={i18nService.t('copy')}
      >
        <ClipboardDocumentIcon className="h-4 w-4" />
      </button>
      {!isUser && message.metrics && (
        <span>{formatMetricsSummary(message.metrics)}</span>
      )}
    </div>
  );
}

function ThinkingStatusText({
  isStreaming,
  durationSeconds,
}: {
  isStreaming: boolean;
  durationSeconds?: number;
}) {
  if (isStreaming) {
    return (
      <span className="inline-flex items-center gap-1.5 text-sm text-secondary">
        <span>{i18nService.t('localInferenceThinkingInProgress')}</span>
        <span className="flex items-center gap-1 pt-px">
          <span className="h-1 w-1 rounded-full bg-current animate-pulse" />
          <span className="h-1 w-1 rounded-full bg-current animate-pulse [animation-delay:150ms]" />
          <span className="h-1 w-1 rounded-full bg-current animate-pulse [animation-delay:300ms]" />
        </span>
      </span>
    );
  }

  return <span>{formatThoughtDuration(durationSeconds)}</span>;
}

function ThinkingContent({
  content,
  streaming,
}: {
  content: string;
  streaming: boolean;
}) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [hasOverflow, setHasOverflow] = useState(false);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      const wrapper = wrapperRef.current;
      const element = contentRef.current;
      if (!wrapper || !element) return;
      if (!streaming) {
        element.style.transform = 'translateY(0)';
        setHasOverflow(element.scrollHeight > wrapper.clientHeight);
        return;
      }
      const wrapperHeight = wrapper.clientHeight;
      const contentHeight = element.scrollHeight;
      if (contentHeight > wrapperHeight) {
        element.style.transform = `translateY(-${contentHeight - wrapperHeight}px)`;
        setHasOverflow(true);
      } else {
        element.style.transform = 'translateY(0)';
        setHasOverflow(false);
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, [content, streaming]);

  return (
    <div
      ref={wrapperRef}
      className={`relative ml-2 mt-2 max-h-48 rounded-xl border-l-2 border-dotted border-border-subtle pl-4 ${
        streaming
          ? 'overflow-hidden'
          : 'overflow-y-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden'
      }`}
    >
      <div
        ref={contentRef}
        className={`whitespace-pre-wrap break-words pr-1 text-sm leading-7 text-secondary/85 ${
          streaming ? 'transition-transform duration-200' : ''
        }`}
      >
        {content}
        {streaming && (
          <span className="ml-0.5 inline-block h-4 w-2 animate-pulse bg-foreground/45 align-text-bottom" />
        )}
      </div>
      {streaming && hasOverflow && (
        <div className="pointer-events-none absolute inset-x-0 top-0 h-8 bg-gradient-to-b from-surface-raised/95 to-transparent" />
      )}
    </div>
  );
}

function WaitingDots() {
  return (
    <div
      className="inline-flex items-center gap-1 rounded-full border border-border-subtle bg-surface-raised px-3 py-2"
      aria-label={i18nService.t('localInferenceAwaitingResponse')}
    >
      {[0, 1, 2].map(index => (
        <span
          key={index}
          className="h-1.5 w-1.5 animate-pulse rounded-full bg-secondary"
          style={{ animationDelay: `${index * 120}ms` }}
        />
      ))}
    </div>
  );
}

function InferenceInlineErrorCard({
  error,
  onOpenModels,
}: {
  error: LocalInferenceInlineError;
  onOpenModels: () => void;
}) {
  const detail =
    error.kind === 'context-overflow' &&
    error.requestedTokens != null &&
    error.availableTokens != null
      ? i18nService
        .t('localInferenceContextOverflowDetails')
        .replace('{requested}', error.requestedTokens.toLocaleString())
        .replace('{available}', error.availableTokens.toLocaleString())
      : null;

  return (
    <div className="rounded-[24px] border border-red-500/20 bg-red-500/10 px-5 py-4 text-left shadow-sm">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-red-500/12 text-red-500">
          <ExclamationTriangleIcon className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1 space-y-2">
          <div className="space-y-1">
            <p className="text-base font-semibold text-red-400">
              {i18nService.t('localInferenceContextOverflowTitle')}
            </p>
            <p className="text-sm text-red-100/75">
              {i18nService.t('localInferenceContextOverflowDescription')}
            </p>
            {detail ? (
              <p className="text-xs text-red-100/60">{detail}</p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onOpenModels}
            className="inline-flex h-10 items-center gap-2 rounded-full border border-red-400/25 bg-white/5 px-4 text-sm font-medium text-white transition-colors hover:bg-white/10"
          >
            <ServerStackIcon className="h-4 w-4" />
            {i18nService.t('localInferenceOpenModels')}
          </button>
        </div>
      </div>
    </div>
  );
}

function resolveLocalInferenceInlineError(error: unknown): LocalInferenceInlineError | null {
  const message = error instanceof Error ? error.message : String(error);
  if (!isContextOverflowErrorMessage(message)) {
    return null;
  }
  const match = message.match(
    /request\s*\((\d+)\s*tokens\)\s*exceeds the available context size\s*\((\d+)\s*tokens\)/i,
  );
  return {
    kind: 'context-overflow',
    requestedTokens: match ? Number.parseInt(match[1], 10) : null,
    availableTokens: match ? Number.parseInt(match[2], 10) : null,
  };
}

function isContextOverflowErrorMessage(message: string): boolean {
  const normalized = message.toLowerCase();
  return (
    normalized.includes('exceed_context_size_error') ||
    normalized.includes('ran out of context size') ||
    (normalized.includes('available context size') && normalized.includes('exceeds'))
  );
}

function useI18nLanguage(): ReturnType<typeof i18nService.getLanguage> {
  const [language, setLanguage] = useState(i18nService.getLanguage());

  useEffect(() => {
    return i18nService.subscribe(() => {
      setLanguage(i18nService.getLanguage());
    });
  }, []);

  return language;
}

function readLocalInferenceSessionState(): LocalInferenceSessionState | null {
  try {
    const raw = localStorage.getItem(LOCAL_INFERENCE_SESSION_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<LocalInferenceSessionState> | null;
    if (!parsed || typeof parsed !== 'object') return null;
    return {
      activeTab: isLocalInferenceTab(parsed.activeTab) ? parsed.activeTab : 'inference',
      selectedModel: typeof parsed.selectedModel === 'string' ? parsed.selectedModel : '',
      systemPrompt: typeof parsed.systemPrompt === 'string' ? parsed.systemPrompt : '',
      prompt: typeof parsed.prompt === 'string' ? parsed.prompt : '',
      messages: Array.isArray(parsed.messages)
        ? parsed.messages.filter(isInferenceMessage)
        : [],
    };
  } catch {
    return null;
  }
}

function writeLocalInferenceSessionState(state: LocalInferenceSessionState): void {
  try {
    localStorage.setItem(LOCAL_INFERENCE_SESSION_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Ignore storage failures and keep the live session usable.
  }
}

function isLocalInferenceTab(value: unknown): value is LocalInferenceTab {
  return value === 'inference' || value === 'models' || value === 'marketplace';
}

function isInferenceMessage(value: unknown): value is InferenceMessage {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<InferenceMessage>;
  return (
    (candidate.role === 'user' || candidate.role === 'assistant') &&
    typeof candidate.content === 'string' &&
    typeof candidate.createdAt === 'number'
  );
}

function Badge({
  children,
  tone = 'neutral',
}: {
  children: React.ReactNode;
  tone?: 'neutral' | 'success';
}) {
  return (
    <span
      className={`inline-flex h-5 items-center rounded-md px-1.5 text-[11px] font-medium ${
        tone === 'success'
          ? 'bg-green-500/10 text-green-600 dark:text-green-400'
          : 'bg-surface-raised text-secondary'
      }`}
    >
      {children}
    </span>
  );
}

function EmptyState({
  title,
  action,
  className = '',
}: {
  title: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`flex min-h-[260px] flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border bg-surface px-4 py-8 text-center ${className}`.trim()}>
      <ServerStackIcon className="h-7 w-7 text-secondary" />
      <p className="text-sm font-medium text-secondary">{title}</p>
      {action}
    </div>
  );
}

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


function isPullInProgress(progress?: Record<string, unknown>): boolean {
  if (!progress) return false;
  const status = readProgressStatus(progress);
  return !['success', 'done', 'cancelled', 'error', 'failed', 'needs-manual'].includes(status);
}

function formatPullProgress(progress: Record<string, unknown>): string {
  const summary = formatInstallProgressSummary(progress);
  return summary.primary || summary.phase || i18nService.t('loading');
}

function formatInstallProgressSummary(progress: Record<string, unknown>): {
  primary: string;
  phase?: string;
  error?: string;
} {
  const status = readProgressStatus(progress);
  const error = typeof progress.error === 'string' ? progress.error : '';
  const completed = typeof progress.completed === 'number' ? progress.completed : undefined;
  const total = typeof progress.total === 'number' ? progress.total : undefined;
  const percent = typeof progress.percent === 'number' ? progress.percent : undefined;
  const speed = typeof progress.speed === 'number' ? progress.speed : undefined;
  const phase = humanizeInstallPhase(status);

  if (error) {
    return {
      primary: phase || i18nService.t('marketplaceInstallFailed'),
      phase,
      error,
    };
  }

  if (completed !== undefined && total !== undefined && total > 0) {
    const parts = [
      percent !== undefined ? `${percent}%` : undefined,
      `${formatBytes(completed)} / ${formatBytes(total)}`,
      speed && speed > 0 ? `${formatBytes(speed)}/s` : undefined,
    ].filter(Boolean);
    return {
      primary: parts.join(' | '),
      phase,
    };
  }

  return {
    primary: phase || i18nService.t('loading'),
    phase,
  };
}

function readProgressStatus(progress: Record<string, unknown>): string {
  if (typeof progress.status === 'string') return progress.status;
  if (typeof progress.phase === 'string') return progress.phase;
  return '';
}

function normalizeInstallProgress(
  name: string,
  chunk: Record<string, unknown>,
): LlamaCppInstallProgress {
  return {
    modelId: typeof chunk.modelId === 'string' && chunk.modelId.trim() ? chunk.modelId : name,
    modelName:
      typeof chunk.modelName === 'string' && chunk.modelName.trim() ? chunk.modelName : name,
    phase:
      typeof chunk.phase === 'string'
        ? (chunk.phase as LlamaCppInstallProgress['phase'])
        : 'downloading',
    message: typeof chunk.message === 'string' ? chunk.message : undefined,
    percent: typeof chunk.percent === 'number' ? chunk.percent : undefined,
    completed: typeof chunk.completed === 'number' ? chunk.completed : undefined,
    total: typeof chunk.total === 'number' ? chunk.total : undefined,
    speed: typeof chunk.speed === 'number' ? chunk.speed : undefined,
    targetPath: typeof chunk.targetPath === 'string' ? chunk.targetPath : undefined,
    error: typeof chunk.error === 'string' ? chunk.error : undefined,
  };
}

function isInstallTerminalPhase(phase: LlamaCppInstallProgress['phase']): boolean {
  return ['done', 'failed', 'cancelled', 'needs-manual'].includes(phase);
}

function getLocalInferenceToastAutoDismissMs(): number {
  return LOCAL_INFERENCE_TOAST_AUTO_DISMISS_MS;
}

function getLocalInferenceProgressDismissMs(): number {
  return LOCAL_INFERENCE_PROGRESS_DISMISS_MS;
}

function humanizeInstallPhase(phase: string): string {
  switch (phase) {
    case 'starting':
      return i18nService.t('marketplaceInstallStarting');
    case 'detecting':
      return i18nService.t('localInferenceInstallVerifying');
    case 'downloading':
    case 'downloading-progress':
      return i18nService.t('marketplaceInstallPulling');
    case 'installing':
      return i18nService.t('localInferenceInstallExtracting');
    case 'cancelling':
      return i18nService.t('marketplaceCancelling');
    case 'cancelled':
      return i18nService.t('marketplacePullCancelled');
    case 'done':
      return i18nService.t('marketplaceInstallDone');
    case 'failed':
      return i18nService.t('marketplaceInstallFailed');
    default:
      return phase || i18nService.t('loading');
  }
}

function progressBarPercent(progress?: LlamaCppInstallProgress): number {
  if (!progress) return 0;
  if (typeof progress.percent === 'number') {
    return Math.max(0, Math.min(100, progress.percent));
  }
  if (
    typeof progress.completed === 'number' &&
    typeof progress.total === 'number' &&
    progress.total > 0
  ) {
    return Math.max(0, Math.min(100, Math.round((progress.completed / progress.total) * 100)));
  }
  if (progress.phase === 'done') return 100;
  if (progress.phase === 'starting') return 10;
  if (progress.phase === 'downloading') return 35;
  if (progress.phase === 'installing') return 80;
  if (progress.phase === 'failed' || progress.phase === 'cancelled') return 100;
  return 0;
}

function InstallProgressBar({
  progress,
  className = '',
}: {
  progress?: LlamaCppInstallProgress;
  className?: string;
}) {
  const percent = progressBarPercent(progress);
  return (
    <div className={className}>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-border/80">
        <div
          className="h-full rounded-full bg-primary transition-all duration-200"
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}

function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const index = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
  return `${(value / 1024 ** index).toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function isScrollNearBottom({
  scrollTop,
  clientHeight,
  scrollHeight,
  threshold = CHAT_NEAR_BOTTOM_THRESHOLD,
}: {
  scrollTop: number;
  clientHeight: number;
  scrollHeight: number;
  threshold?: number;
}): boolean {
  return scrollHeight - (scrollTop + clientHeight) <= threshold;
}

function hasHiddenContentBelow({
  scrollTop,
  clientHeight,
  scrollHeight,
  threshold = CHAT_HIDDEN_BELOW_THRESHOLD,
}: {
  scrollTop: number;
  clientHeight: number;
  scrollHeight: number;
  threshold?: number;
}): boolean {
  return scrollTop + clientHeight < scrollHeight - threshold;
}

function getAssistantScrollTop({
  containerScrollTop,
  containerTop,
  targetTop,
  offset = ASSISTANT_SCROLL_TOP_OFFSET,
}: {
  containerScrollTop: number;
  containerTop: number;
  targetTop: number;
  offset?: number;
}): number {
  return Math.max(0, containerScrollTop + (targetTop - containerTop) - offset);
}

function readNestedNumber(source: unknown, key: string): number | undefined {
  if (!source || typeof source !== 'object') return undefined;
  const value = (source as Record<string, unknown>)[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function computeStreamMetrics(
  finalChunk: OllamaChatChunk | null,
  streamStartTime: number,
  accumulatedContent: string,
): OllamaChatChunk | null {
  if (!finalChunk) return null;
  const evalCount = finalChunk.eval_count;
  const completionTokens = readNestedNumber(finalChunk.usage, 'completion_tokens')
    ?? readNestedNumber(finalChunk.timings, 'predicted_n')
    ?? evalCount;
  const rawElapsed = readNestedNumber(finalChunk.timings, 'predicted_ms') != null
    ? readNestedNumber(finalChunk.timings, 'predicted_ms')! / 1000
    : (Date.now() - streamStartTime) / 1000;
  const elapsed = Math.max(LOCAL_INFERENCE_MIN_SPEED_SAMPLE_SECONDS, rawElapsed);
  const estimatedSpeed = completionTokens != null ? completionTokens / elapsed : null;

  const reportedSpeed =
    finalChunk.predicted_per_second ?? readNestedNumber(finalChunk.timings, 'predicted_per_second');
  const sanitizedReportedSpeed = sanitizePredictedPerSecond({
    reportedSpeed,
    completionTokens,
    estimatedSpeed,
  });
  if (sanitizedReportedSpeed != null) {
    return { ...finalChunk, predicted_per_second: sanitizedReportedSpeed };
  }

  if (evalCount != null) return { ...finalChunk, predicted_per_second: evalCount / elapsed };

  const rawLen = accumulatedContent.length > 0
    ? accumulatedContent.length
    : (finalChunk.message?.content?.length ?? 0);
  if (rawLen > 0) return { ...finalChunk, predicted_per_second: Math.round(rawLen / 3) / elapsed };
  return finalChunk;
}

function sanitizePredictedPerSecond(input: {
  reportedSpeed: number | null | undefined;
  completionTokens: number | null | undefined;
  estimatedSpeed: number | null;
}): number | null {
  const { reportedSpeed, completionTokens, estimatedSpeed } = input;
  if (reportedSpeed == null || !Number.isFinite(reportedSpeed) || reportedSpeed <= 0) {
    return estimatedSpeed;
  }
  if (completionTokens != null && completionTokens <= 2) {
    return reportedSpeed > LOCAL_INFERENCE_MAX_SPEED_FOR_TINY_COMPLETION
      ? estimatedSpeed
      : reportedSpeed;
  }
  if (completionTokens != null && completionTokens <= 8) {
    return reportedSpeed > LOCAL_INFERENCE_MAX_SPEED_FOR_SMALL_COMPLETION
      ? estimatedSpeed
      : reportedSpeed;
  }
  return reportedSpeed;
}

function formatMetricsSummary(metrics: OllamaChatChunk): string {
  const speedValue = metrics.predicted_per_second;
  const speed = speedValue != null ? speedValue.toFixed(1) : '-';
  const completionTokens = readNestedNumber(metrics.usage, 'completion_tokens')
    ?? readNestedNumber(metrics.timings, 'predicted_n')
    ?? metrics.eval_count;
  const speedLabel = i18nService.t('localInferenceMetricsSpeed').replace('{speed}', speed);
  return completionTokens != null
    ? `${speedLabel} (${Math.round(completionTokens)} tokens)`
    : speedLabel;
}

function estimateReasoningDurationSeconds(metrics: OllamaChatChunk): number | undefined {
  const predictedMs = readNestedNumber(metrics.timings, 'predicted_ms');
  if (predictedMs == null) return undefined;
  return Math.max(1, Math.round(predictedMs / 1000));
}

function formatThoughtDuration(durationSeconds?: number): string {
  if (!durationSeconds || durationSeconds <= 0) {
    return i18nService.t('localInferenceThinking');
  }
  return i18nService
    .t('localInferenceThoughtForSeconds')
    .replace('{seconds}', String(durationSeconds));
}

function formatMessageTimestamp(createdAt: number): string {
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(createdAt);
}

function buildAssistantMessage({
  content,
  thinking,
  metrics,
}: BuildAssistantMessageInput): InferenceMessage {
  const visibleContent = content.trim()
    ? content
    : thinking.trim()
      ? i18nService.t('localInferenceNoVisibleReply')
      : content;
  return {
    role: 'assistant',
    content: visibleContent,
    ...(thinking.trim() ? { thinking } : {}),
    metrics,
    createdAt: Date.now(),
    ...(thinking.trim() && metrics
      ? { reasoningDurationSeconds: estimateReasoningDurationSeconds(metrics) }
      : {}),
  };
}

function buildStreamingAssistantMessage({
  content,
  thinking,
}: {
  content: string;
  thinking: string;
}): InferenceMessage {
  const hasContent = Boolean(content.trim());
  const hasThinking = Boolean(thinking.trim());
  return {
    role: 'assistant',
    content,
    ...(hasThinking ? { thinking } : {}),
    waiting: !hasContent && !hasThinking,
    createdAt: Date.now(),
  };
}

function getNewAssistantScrollTargetIndex(historyLength: number): number {
  return historyLength + 1;
}

function findLatestUserMessageIndex(messages: InferenceMessage[]): number {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === 'user') return index;
  }
  return -1;
}

function buildEffectiveSystemPrompt(systemPrompt: string): string {
  void DIRECT_ANSWER_SYSTEM_HINT;
  const trimmed = systemPrompt.trim();
  return trimmed;
}


function buildMarketplaceSearchParams(input: {
  query: string;
  pageNumber?: number;
}): MarketplaceSearchParams | null {
  const query = input.query.trim();
  if (!isMarketplaceSearchQuery(query)) return null;
  return {
    query,
    limit: MARKETPLACE_SEARCH_MAX_MODEL_COUNT,
    pageNumber: input.pageNumber,
  };
}

function isMarketplaceSearchQuery(value: string): boolean {
  return /[\p{L}\p{N}]/u.test(value.trim());
}

function isModelScopeRepoId(value: string): boolean {
  return /^[^/\s]+\/[^/\s]+$/.test(value.trim());
}

function getInstallableMarketplaceModels(
  models: MarketplaceModel[],
  installedModelPathMap: Map<string, string>,
): MarketplaceModel[] {
  return models.filter((model) => {
    const installedModelName = model.installedPath
      ? installedModelPathMap.get(model.installedPath)
      : undefined;
    return !model.installed && !installedModelName;
  });
}

function MarketplacePanel({
  loading,
  models,
  hasSearched,
  marketplaceLoading,
  marketplaceError,
  marketplaceTotalCount,
  query,
  installedModelPathMap,
  installProgress,
  onQueryChange,
  onSearch,
  onInstall,
}: {
  loading: boolean;
  models: MarketplaceModel[];
  hasSearched: boolean;
  marketplaceLoading: boolean;
  marketplaceError: string | null;
  marketplaceTotalCount: number | null;
  query: string;
  installedModelPathMap: Map<string, string>;
  installProgress: InstallProgressState;
  onQueryChange: (v: string) => void;
  onSearch: () => void;
  onInstall: (model: MarketplaceModel) => Promise<void>;
}) {
  const [installingModelIds, setInstallingModelIds] = useState<Set<string>>(new Set());
  const [tokenModalOpen, setTokenModalOpen] = useState(false);
  const [tokenInput, setTokenInput] = useState('');
  const [tokenInputVisible, setTokenInputVisible] = useState(false);
  const [savedToken, setSavedToken] = useState<string | null>(null);
  const [tokenLoaded, setTokenLoaded] = useState(false);

  useEffect(() => {
    window.electron.marketplace.getToken().then(t => {
      setSavedToken(t);
    }).catch(() => {});
  }, []);
  useEffect(() => {
    if (tokenModalOpen && !tokenLoaded) {
      window.electron.marketplace.getToken().then(t => {
        setSavedToken(t);
        setTokenInput(t ?? '');
        setTokenLoaded(true);
      }).catch(() => setTokenLoaded(true));
    }
    if (!tokenModalOpen) {
      setTokenLoaded(false);
      setTokenInputVisible(false);
    }
  }, [tokenModalOpen, tokenLoaded]);

  const handleSaveToken = async () => {
    const trimmed = tokenInput.trim();
    await window.electron.marketplace.setToken(trimmed);
    setSavedToken(trimmed || null);
    setTokenModalOpen(false);
  };

  const handleClearToken = async () => {
    setTokenInput('');
    await window.electron.marketplace.setToken('');
    setSavedToken(null);
    setTokenModalOpen(false);
  };
  const [page, setPage] = useState(1);
  const installableModels = useMemo(
    () => getInstallableMarketplaceModels(models, installedModelPathMap),
    [installedModelPathMap, models],
  );
  const pageCount = Math.max(1, Math.ceil(installableModels.length / MARKETPLACE_PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const pageStart = (currentPage - 1) * MARKETPLACE_PAGE_SIZE;
  const visibleModels = useMemo(
    () => installableModels.slice(pageStart, pageStart + MARKETPLACE_PAGE_SIZE),
    [installableModels, pageStart],
  );

  useEffect(() => {
    setPage(1);
  }, [query]);

  useEffect(() => {
    if (page > pageCount) {
      setPage(pageCount);
    }
  }, [page, pageCount]);

  const handleInstall = async (model: MarketplaceModel) => {
    setInstallingModelIds(prev => new Set(prev).add(model.id));
    try {
      await onInstall(model);
    } finally {
      setInstallingModelIds(prev => {
        const next = new Set(prev);
        next.delete(model.id);
        return next;
      });
    }
  };
  const handleNextPage = async () => {
    setPage(value => Math.min(pageCount, value + 1));
  };

  return (
    <div className="space-y-4">
      <div className={`${hasSearched ? 'flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between' : 'flex min-h-[420px] flex-col items-center justify-center gap-8'}`}>
        <div className={`${hasSearched ? 'space-y-3' : 'w-full max-w-3xl space-y-3 text-center'}`}>
          <div>
            <div className="flex items-center gap-3">
              <h2 className={`${hasSearched ? 'text-base font-semibold text-foreground' : 'text-2xl font-semibold text-foreground'}`}>
                {i18nService.t('marketplaceTitle')}
              </h2>
              <button
                type="button"
                onClick={() => setTokenModalOpen(true)}
                className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                  savedToken
                    ? 'border border-green-400/30 bg-green-500/10 text-green-600 hover:bg-green-500/20 dark:text-green-400'
                    : 'border border-border bg-surface text-secondary hover:text-foreground hover:border-primary/40'
                }`}
                title={savedToken ? i18nService.t('marketplaceTokenConfigured') : i18nService.t('marketplaceTokenNotConfigured')}
              >
                <AdjustmentsHorizontalIcon className="h-3.5 w-3.5" />
                {savedToken
                  ? i18nService.t('marketplaceTokenConfigured')
                  : i18nService.t('marketplaceTokenSettings')}
              </button>
            </div>
            {hasSearched && (
              <p className="mt-1 text-xs text-secondary">{i18nService.t('marketplaceDescription')}</p>
            )}
          </div>
        </div>
        <form
          className={`w-full ${hasSearched ? 'lg:max-w-xl' : 'max-w-4xl'}`}
          onSubmit={e => {
            e.preventDefault();
            onSearch();
          }}
        >
          <div className={`${hasSearched ? 'rounded-lg border border-border bg-surface p-3' : 'bg-transparent p-0'}`}>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <SearchIcon className={`${hasSearched ? 'left-2.5 h-3.5 w-3.5' : 'left-4 h-5 w-5'} pointer-events-none absolute top-1/2 -translate-y-1/2 text-secondary`} />
                <input
                  value={query}
                  onChange={e => onQueryChange(e.target.value)}
                  placeholder={i18nService.t('marketplaceSearchPlaceholder')}
                  className={`${hasSearched ? 'h-9 rounded-md pl-8 pr-2 text-xs' : 'h-16 rounded-2xl pl-12 pr-4 text-lg'} w-full border border-border bg-surface-input text-foreground placeholder:text-secondary focus:outline-none focus:ring-1 focus:ring-primary`}
                />
              </div>
              <button
                type="submit"
                disabled={marketplaceLoading}
                className={`${hasSearched ? 'h-9 rounded-md px-3 text-xs' : 'h-16 rounded-2xl px-8 text-lg'} inline-flex items-center gap-1 bg-primary font-medium text-white transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-60`}
              >
                {marketplaceLoading && <ArrowPathIcon className="h-3.5 w-3.5 animate-spin" />}
                {i18nService.t('marketplaceSearch')}
              </button>
            </div>
          </div>
        </form>
      </div>

      {(() => {
        const isAuthError = marketplaceError?.startsWith('AUTH_ERROR:');
        const statusClass = isAuthError
          ? 'border-yellow-400/40 bg-yellow-500/10 text-yellow-600 dark:text-yellow-400'
          : marketplaceError
            ? 'border-yellow-400/40 bg-yellow-500/10 text-yellow-700 dark:text-yellow-300'
            : savedToken
              ? 'border-green-400/40 bg-green-500/10 text-green-600 dark:text-green-400'
              : 'border-border bg-surface text-secondary';
        const statusText = isAuthError
          ? i18nService.t('marketplaceSearchStatusTokenInvalid')
          : marketplaceError
            ? i18nService.t('marketplaceSearchStatusLegacy')
            : savedToken
              ? i18nService.t('marketplaceSearchStatusOpenApi')
              : i18nService.t('marketplaceSearchStatusWarning');
        const count = marketplaceTotalCount == null
          ? installableModels.length
          : Math.min(marketplaceTotalCount, installableModels.length);
        return (
          !marketplaceLoading && installableModels.length > 0 && (
            <div className={`rounded-md border px-3 py-1.5 text-xs ${statusClass}`}>
              <span className="font-medium">{statusText}</span>
              <span className="ml-3 opacity-70">
                {i18nService.t('marketplaceResultCount').replace('{count}', String(count))}
              </span>
            </div>
          )
        );
      })()}
      {marketplaceError && models.length === 0 && (
        <div className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/20 dark:text-red-300">
          {i18nService.t('marketplaceError')}: {marketplaceError}
        </div>
      )}

      {marketplaceLoading ? (
        <div className="flex min-h-[620px] items-center justify-center text-sm text-secondary">
          <ArrowPathIcon className="mr-2 h-4 w-4 animate-spin" />
          {i18nService.t('loading')}
        </div>
      ) : !hasSearched ? null : installableModels.length === 0 ? (
        <EmptyState title={i18nService.t('marketplaceNoModels')} className="min-h-[620px]" />
      ) : (
        <div className="flex min-h-[620px] flex-col">
          <div className="grid content-start gap-3 md:grid-cols-2">
            {visibleModels.map(model => {
              const progress = installProgress[model.repoId];
              const installing = installingModelIds.has(model.id) || isPullInProgress(progress);
              return (
                <div
                  key={model.id}
                  className="flex h-[168px] min-w-0 flex-col justify-between overflow-hidden rounded-lg border border-border bg-card p-3 transition-colors hover:bg-surface-raised"
                >
                  <div className="min-h-0 overflow-hidden">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="max-h-10 min-w-0 overflow-hidden break-all text-sm font-semibold leading-5 text-foreground">{model.repoId}</h3>
                      <span
                        className="inline-flex h-5 items-center rounded-md bg-surface-raised px-1.5 text-[11px] font-medium text-secondary"
                      >
                        {model.recommendedTag}
                      </span>
                      <span className="inline-flex h-5 items-center rounded-md border border-border px-1.5 text-[11px] font-medium text-secondary">
                        {capabilityLabel(model.capability)}
                      </span>
                    </div>
                    <p className="mt-1.5 max-h-10 overflow-hidden text-xs leading-5 text-secondary">{model.description}</p>
                    <div className="mt-2 flex max-h-5 flex-wrap gap-1.5 overflow-hidden">
                      {model.sizes.map(s => (
                        <span
                          key={s}
                          className="inline-flex h-5 items-center rounded-md border border-border px-1.5 text-[11px] font-mono text-secondary"
                        >
                          {s}
                        </span>
                      ))}
                      {model.tags.slice(0, 3).map(tag => (
                        <span
                          key={tag}
                          className="inline-flex h-5 items-center rounded-md bg-surface-raised px-1.5 text-[11px] text-secondary"
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                    {progress && (
                      <div className="mt-2 rounded-md bg-surface-raised px-2 py-1.5">
                        <div className="flex items-center justify-between gap-2 text-[11px] text-secondary">
                          <span>{formatPullProgress(progress)}</span>
                          {typeof progress.percent === 'number' && <span>{progress.percent}%</span>}
                        </div>
                        <InstallProgressBar progress={progress} className="mt-2" />
                      </div>
                    )}
                  </div>
                  <div className="mt-3 flex items-center justify-between gap-2">
                    <span className="text-xs text-secondary">
                      {formatDownloadCount(model.downloads)}
                    </span>
                    <div className="flex flex-wrap items-center justify-end gap-2">
                      {model.detailUrl && (
                        <button
                          type="button"
                          onClick={() => void openExternalUrl(model.detailUrl!)}
                          className="inline-flex h-7 items-center gap-1 rounded-md border border-border px-2 text-xs text-foreground/80 transition-colors hover:bg-surface-raised"
                        >
                          <ArrowTopRightOnSquareIcon className="h-3.5 w-3.5" />
                          {i18nService.t('marketplaceOpenModelScope')}
                        </button>
                      )}
                      {installing ? (
                        <button
                          type="button"
                          onClick={() => void window.electron.llamacpp.cancelInstall(model.repoId)}
                          className={smallOutlineButtonClass}
                        >
                          <StopIcon className="h-3.5 w-3.5" />
                          {i18nService.t('marketplaceCancelInstall')}
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => void handleInstall(model)}
                          disabled={installing || loading}
                          className="inline-flex h-7 items-center gap-1 rounded-md bg-primary px-2.5 text-xs font-medium text-white transition-colors hover:bg-primary-hover disabled:opacity-60"
                        >
                          <ArrowDownTrayIcon className="h-3.5 w-3.5" />
                          {i18nService.t('marketplaceInstall')}
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          {pageCount > 1 && (
            <div className="mx-auto mt-auto flex items-center justify-center gap-3 pt-4">
              <button
                type="button"
                onClick={() => setPage(value => Math.max(1, value - 1))}
                disabled={currentPage <= 1}
                className="inline-flex h-8 min-w-20 items-center justify-center rounded-md border border-border px-3 text-xs text-foreground/80 transition-colors hover:bg-surface-raised disabled:cursor-not-allowed disabled:opacity-50"
              >
                {i18nService.t('skillMarketplacePrevPage')}
              </button>
              <span className="inline-flex h-8 min-w-16 items-center justify-center text-sm text-secondary">
                {currentPage}/{pageCount} {i18nService.t('marketplacePageUnit')}
              </span>
              <button
                type="button"
                onClick={() => void handleNextPage()}
                disabled={currentPage >= pageCount}
                className="inline-flex h-8 min-w-20 items-center justify-center rounded-md border border-border px-3 text-xs text-foreground/80 transition-colors hover:bg-surface-raised disabled:cursor-not-allowed disabled:opacity-50"
              >
                {i18nService.t('skillMarketplaceNextPage')}
              </button>
            </div>
          )}
        </div>
      )}

      {/* Token config modal */}
      <Modal
        isOpen={tokenModalOpen}
        onClose={() => setTokenModalOpen(false)}
        overlayClassName="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
        className="w-full max-w-md mx-4 rounded-2xl bg-surface border border-border shadow-2xl p-6"
      >
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold text-foreground">
              {i18nService.t('marketplaceTokenSettingsTitle')}
            </h3>
            <button
              type="button"
              onClick={() => setTokenModalOpen(false)}
              className="rounded-md p-1 text-secondary hover:text-foreground hover:bg-surface-raised transition-colors"
            >
              <XMarkIcon className="h-5 w-5" />
            </button>
          </div>
          <p className="text-sm text-secondary leading-relaxed">
            {i18nService.t('marketplaceTokenSettingsDesc')}
          </p>
          <div className="space-y-1.5">
            <label className="text-xs font-semibold tracking-wide text-secondary">
              ModelScope API Token
            </label>
            <div className="relative">
              <input
                type={tokenInputVisible ? 'text' : 'password'}
                value={tokenInput}
                onChange={e => setTokenInput(e.target.value)}
                placeholder={i18nService.t('marketplaceTokenPlaceholder')}
                className="w-full rounded-xl bg-surface-inset px-3 py-2 pr-16 text-sm text-foreground placeholder:text-secondary border border-border focus:outline-none focus:ring-2 focus:ring-primary"
              />
              <div className="absolute right-2 inset-y-0 flex items-center gap-1">
                {tokenInput && (
                  <button
                    type="button"
                    onClick={() => setTokenInput('')}
                    className="rounded p-0.5 text-secondary hover:text-primary transition-colors"
                    title={i18nService.t('marketplaceTokenClear')}
                  >
                    <XMarkIcon className="h-4 w-4" />
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setTokenInputVisible(v => !v)}
                  className="rounded p-0.5 text-secondary hover:text-primary transition-colors"
                >
                  {tokenInputVisible ? <EyeSlashIcon className="h-4 w-4" /> : <EyeIcon className="h-4 w-4" />}
                </button>
              </div>
            </div>
          </div>
          <div className="flex items-center justify-between pt-1">
            <button
              type="button"
              onClick={handleClearToken}
              disabled={!savedToken}
              className="rounded-lg px-3 py-2 text-xs font-medium text-secondary hover:text-red-500 border border-border hover:border-red-400/40 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {i18nService.t('marketplaceTokenClear')}
            </button>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setTokenModalOpen(false)}
                className="rounded-lg border border-border px-4 py-2 text-xs font-medium text-secondary hover:text-foreground hover:bg-surface-raised transition-colors"
              >
                {i18nService.t('cancel')}
              </button>
              <button
                type="button"
                onClick={() => void handleSaveToken()}
                className="rounded-lg bg-primary px-4 py-2 text-xs font-medium text-white hover:bg-primary-hover transition-colors"
              >
                {i18nService.t('marketplaceTokenSave')}
              </button>
            </div>
          </div>
        </div>
      </Modal>
    </div>
  );
}

function capabilityLabel(capability: MarketplaceModel['capability']): string {
  switch (capability) {
    case 'reasoning':
      return i18nService.t('marketplaceFilterTaskReasoning');
    case 'code':
      return i18nService.t('marketplaceFilterTaskCode');
    case 'embedding':
      return i18nService.t('marketplaceFilterTaskEmbedding');
    case 'vision':
      return i18nService.t('marketplaceFilterTaskVision');
    case 'chat':
    default:
      return i18nService.t('marketplaceFilterTaskChat');
  }
}

async function openExternalUrl(url: string): Promise<void> {
  const result = await window.electron.shell.openExternal(url);
  if (!result.success) {
    window.open(url, '_blank', 'noopener,noreferrer');
  }
}

function formatDownloadCount(downloads?: number): string {
  if (!downloads || downloads <= 0) return '';
  const value =
    downloads >= 1_000_000
      ? `${(downloads / 1_000_000).toFixed(downloads >= 10_000_000 ? 0 : 1)}M`
      : downloads >= 1_000
        ? `${(downloads / 1_000).toFixed(downloads >= 100_000 ? 0 : 1)}k`
        : String(downloads);
  return i18nService.t('marketplaceDownloads').replace('{count}', value);
}

function SearchIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={1.5}
      stroke="currentColor"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z"
      />
    </svg>
  );
}

export const __test__getMarketplacePageSize = () => MARKETPLACE_PAGE_SIZE;
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

