import {
  AdjustmentsHorizontalIcon,
  ArrowDownTrayIcon,
  ArrowPathIcon,
  ArrowTopRightOnSquareIcon,
  BeakerIcon,
  CheckCircleIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CpuChipIcon,
  ExclamationTriangleIcon,
  InformationCircleIcon,
  PaperAirplaneIcon,
  PlayIcon,
  QuestionMarkCircleIcon,
  ServerStackIcon,
  StopIcon,
  TrashIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { NvidiaSmiSnapshot } from '../../../shared/hardware';
import type {
  LlamaCppChatChunk as OllamaChatChunk,
  LlamaCppChatPayload as OllamaChatPayload,
  LlamaCppInstallProgress,
  LlamaCppModel as OllamaModel,
  LlamaCppModelLaunchInput as OllamaModelLaunchInput,
  LlamaCppRunningModel as OllamaRunningModel,
  LlamaCppServiceConfig as OllamaServiceConfig,
  LlamaCppStatusSnapshot as OllamaStatusSnapshot,
} from '../../../shared/llamacpp';
import {
  createLlamaCppStreamState as createOllamaStreamState,
  getLlamaCppLaunchContextLimitViolation,
  reduceLlamaCppStreamChunk as reduceOllamaStreamChunk,
} from '../../../shared/llamacpp';
import type { MarketplaceModel, MarketplaceSearchParams } from '../../../shared/marketplace';
import { notifyLlamaCppRunningModelsChanged } from '../../services/availableModels';
import { i18nService } from '../../services/i18n';
import ComposeIcon from '../icons/ComposeIcon';
import SidebarToggleIcon from '../icons/SidebarToggleIcon';
import MarkdownContent from '../MarkdownContent';
import WindowTitleBar from '../window/WindowTitleBar';
import {
  getRecommendedInferenceOptions,
  type InferenceOptions,
  loadInferenceOptions,
  normalizeOptions,
  shouldApplyModelPreset,
} from './inferenceOptions';

type LocalInferenceTab = 'inference' | 'models' | 'marketplace';

type InferenceMessage = {
  role: 'user' | 'assistant';
  content: string;
  thinking?: string;
  hiddenThinking?: boolean;
  waiting?: boolean;
  metrics?: OllamaChatChunk | null;
};

type LaunchFormState = {
  numCtx: string;
  accelerationMode: string;
  customGpuLayers: string;
  numThread: string;
  numBatch: string;
  useMmap: string;
  gpuPreset: string;
  customGpuDevices: string;
};

type SuggestedLaunchOptions = {
  numCtx: number;
  numBatch: number;
  numGpu?: number;
  numThread: number;
  summary: string;
};

type LaunchGpuPreset = 'service-default' | 'single-auto' | 'dual-gpu' | 'custom';
type LaunchAccelerationMode = 'auto' | 'cpu' | 'custom';

type LaunchRequest = {
  input: OllamaModelLaunchInput;
  gpuPreset: string;
  customGpuDevices: string;
};

type OllamaServiceConfigFormState = {
  host: string;
  port: string;
  customExecutablePath: string;
  device: string;
  modelsMax: string;
  modelsAutoload: string;
  parallel: string;
  splitMode: string;
  tensorSplit: string;
  ctxSize: string;
  gpuLayers: string;
  batchSize: string;
  ubatchSize: string;
  threads: string;
  threadsBatch: string;
  timeout: string;
  threadsHttp: string;
  cachePrompt: string;
  cacheReuse: string;
  cacheRam: string;
  flashAttn: string;
  mainGpu: string;
  mmap: string;
  mlock: string;
  jinja: string;
  reasoning: string;
  reasoningFormat: string;
  reasoningBudget: string;
};

type ServiceConfigGroup = 'basic' | 'advanced';
type ServiceConfigField = {
  key: keyof OllamaServiceConfigFormState;
  labelKey: string;
  paramName: string;
  group: ServiceConfigGroup;
  type: 'input' | 'select';
  placeholder?: string;
  placeholderKey?: string;
  hintKey: string;
  restartRequired: boolean;
};

type InferenceOptionField = {
  key: keyof InferenceOptions;
  labelKey: string;
  paramName: string;
  group: InferenceOptionGroup;
  type: 'range' | 'number' | 'text' | 'select';
  min?: number;
  max?: number;
  step?: number;
  hintKey: string;
  showParamName?: boolean;
};
type InferenceOptionGroup = 'basic' | 'advanced';

type SaveServiceConfigResult = {
  success: boolean;
  error?: string;
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

type InstallProgressState = Record<string, LlamaCppInstallProgress>;
type BuildAssistantMessageInput = {
  content: string;
  thinking: string;
  metrics: OllamaChatChunk | null;
};
type RequestPreviewInput = {
  model: string;
  systemPrompt: string;
  options: Record<string, unknown>;
};

const MARKETPLACE_MIN_PAGE_SIZE = 6;
const MARKETPLACE_MAX_PAGE_SIZE = 24;
const MARKETPLACE_CARD_MIN_HEIGHT = 236;
const MARKETPLACE_FILTER_PANEL_HEIGHT = 160;
const CHAT_NEAR_BOTTOM_THRESHOLD = 96;
const CHAT_HIDDEN_BELOW_THRESHOLD = 8;
const ASSISTANT_SCROLL_TOP_OFFSET = 0;
const CHAT_COMPOSER_MIN_PADDING = 120;
const CHAT_COMPOSER_PADDING_GAP = 20;
const CHAT_JUMP_TO_BOTTOM_MIN_OFFSET = 92;
const CHAT_JUMP_TO_BOTTOM_GAP = 16;
const LOCAL_INFERENCE_TOAST_AUTO_DISMISS_MS = 5_000;
const LOCAL_INFERENCE_PROGRESS_DISMISS_MS = 5_000;
const LOCAL_INFERENCE_UNLOAD_MIN_BUSY_MS = 500;
const LOCAL_INFERENCE_UNLOAD_SETTLE_TIMEOUT_MS = 3_000;
const LOCAL_INFERENCE_UNLOAD_SETTLE_POLL_INTERVAL_MS = 400;
const DIRECT_ANSWER_SYSTEM_HINT = [
  'Answer as quickly and directly as possible.',
  'Skip unnecessary drafts, long internal monologues, and unrelated exploration.',
  'If you produce thinking, keep it very short and focused before giving the final answer.',
  'Please think briefly, do not ramble, and keep any visible thinking within about 50 Chinese characters or one short sentence when possible.',
  'Focus on the necessary conditions first, then give the conclusion without drifting to unrelated topics.',
  '请尽快直接给出结论，跳过不必要的草稿和长篇思考。',
  '如果必须输出思考，请用非常简短的话表达，尽量控制在 50 个汉字以内或一句短句内。',
  '请先抓住必要条件，再直接给出结论，不要发散到无关内容。',
].join(' ');
const smallOutlineButtonClass =
  'inline-flex h-7 items-center gap-1.5 rounded-md border border-border px-2 text-xs text-foreground/80 transition-colors hover:bg-surface-raised disabled:cursor-not-allowed disabled:opacity-50';
const smallDangerButtonClass =
  'inline-flex h-7 items-center gap-1.5 rounded-md border border-border px-2 text-xs text-red-600 transition-colors hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50 dark:text-red-400 dark:hover:bg-red-950/30';
const SERVICE_CONFIG_FIELDS: ServiceConfigField[] = [
  {
    key: 'customExecutablePath',
    labelKey: 'localInferenceServiceConfigExecutablePathLabel',
    paramName: 'llama-server',
    group: 'advanced',
    type: 'input',
    placeholderKey: 'localInferenceServiceConfigExecutablePathPlaceholder',
    hintKey: 'localInferenceServiceConfigExecutablePathHint',
    restartRequired: true,
  },
  {
    key: 'modelsMax',
    labelKey: 'localInferenceServiceConfigModelsMaxLabel',
    paramName: 'models-max',
    group: 'basic',
    type: 'input',
    placeholderKey: 'localInferenceLaunchDefault',
    hintKey: 'localInferenceServiceConfigModelsMaxHint',
    restartRequired: true,
  },
  {
    key: 'modelsAutoload',
    labelKey: 'localInferenceServiceConfigModelsAutoloadLabel',
    paramName: 'models-autoload',
    group: 'basic',
    type: 'select',
    hintKey: 'localInferenceServiceConfigModelsAutoloadHint',
    restartRequired: true,
  },
  {
    key: 'parallel',
    labelKey: 'localInferenceServiceConfigParallelLabel',
    paramName: 'parallel',
    group: 'basic',
    type: 'input',
    placeholder: '1',
    hintKey: 'localInferenceServiceConfigParallelHint',
    restartRequired: true,
  },
  {
    key: 'timeout',
    labelKey: 'localInferenceServiceConfigTimeoutLabel',
    paramName: 'timeout',
    group: 'basic',
    type: 'input',
    placeholder: '600',
    hintKey: 'localInferenceServiceConfigTimeoutHint',
    restartRequired: true,
  },
  {
    key: 'threadsHttp',
    labelKey: 'localInferenceServiceConfigThreadsHttpLabel',
    paramName: 'threads-http',
    group: 'advanced',
    type: 'input',
    placeholderKey: 'localInferenceLaunchDefault',
    hintKey: 'localInferenceServiceConfigThreadsHttpHint',
    restartRequired: true,
  },
  {
    key: 'cachePrompt',
    labelKey: 'localInferenceServiceConfigCachePromptLabel',
    paramName: 'cache-prompt',
    group: 'advanced',
    type: 'select',
    hintKey: 'localInferenceServiceConfigCachePromptHint',
    restartRequired: true,
  },
  {
    key: 'cacheReuse',
    labelKey: 'localInferenceServiceConfigCacheReuseLabel',
    paramName: 'cache-reuse',
    group: 'advanced',
    type: 'input',
    placeholder: '256',
    hintKey: 'localInferenceServiceConfigCacheReuseHint',
    restartRequired: true,
  },
  {
    key: 'cacheRam',
    labelKey: 'localInferenceServiceConfigCacheRamLabel',
    paramName: 'cache-ram',
    group: 'advanced',
    type: 'input',
    placeholder: '8192',
    hintKey: 'localInferenceServiceConfigCacheRamHint',
    restartRequired: true,
  },
  {
    key: 'jinja',
    labelKey: 'localInferenceServiceConfigJinjaLabel',
    paramName: 'jinja',
    group: 'advanced',
    type: 'select',
    hintKey: 'localInferenceServiceConfigJinjaHint',
    restartRequired: true,
  },
  {
    key: 'device',
    labelKey: 'localInferenceServiceConfigDeviceLabel',
    paramName: 'device',
    group: 'advanced',
    type: 'input',
    placeholderKey: 'localInferenceLaunchDefault',
    hintKey: 'localInferenceServiceConfigDeviceHint',
    restartRequired: true,
  },
  {
    key: 'splitMode',
    labelKey: 'localInferenceServiceConfigSplitModeLabel',
    paramName: 'split-mode',
    group: 'advanced',
    type: 'select',
    hintKey: 'localInferenceServiceConfigSplitModeHint',
    restartRequired: true,
  },
  {
    key: 'tensorSplit',
    labelKey: 'localInferenceServiceConfigTensorSplitLabel',
    paramName: 'tensor-split',
    group: 'advanced',
    type: 'input',
    placeholder: '3,2',
    hintKey: 'localInferenceServiceConfigTensorSplitHint',
    restartRequired: true,
  },
  {
    key: 'mainGpu',
    labelKey: 'localInferenceServiceConfigMainGpuLabel',
    paramName: 'main-gpu',
    group: 'advanced',
    type: 'input',
    placeholder: '0',
    hintKey: 'localInferenceServiceConfigMainGpuHint',
    restartRequired: true,
  },
  {
    key: 'flashAttn',
    labelKey: 'localInferenceServiceConfigFlashAttnLabel',
    paramName: 'flash-attn',
    group: 'advanced',
    type: 'select',
    hintKey: 'localInferenceServiceConfigFlashAttnHint',
    restartRequired: true,
  },
  {
    key: 'mlock',
    labelKey: 'localInferenceServiceConfigMlockLabel',
    paramName: 'mlock',
    group: 'advanced',
    type: 'select',
    hintKey: 'localInferenceServiceConfigMlockHint',
    restartRequired: true,
  },
];
const INFERENCE_OPTION_FIELDS: InferenceOptionField[] = [
  {
    key: 'num_predict',
    labelKey: 'localInferenceOptionMaxTokensLabel',
    paramName: 'max_tokens',
    group: 'basic',
    type: 'range',
    min: -1,
    max: 32768,
    step: 1,
    hintKey: 'localInferenceOptionMaxTokensHint',
  },
  {
    key: 'direct_answer_mode',
    labelKey: 'localInferenceOptionDirectAnswerModeLabel',
    paramName: 'app.system_hint.direct_answer_only',
    group: 'basic',
    type: 'select',
    hintKey: 'localInferenceOptionDirectAnswerModeHint',
    showParamName: false,
  },
  {
    key: 'temperature',
    labelKey: 'localInferenceOptionTemperatureLabel',
    paramName: 'temperature',
    group: 'basic',
    type: 'range',
    min: 0,
    max: 2,
    step: 0.1,
    hintKey: 'localInferenceOptionTemperatureHint',
  },
  {
    key: 'top_p',
    labelKey: 'localInferenceOptionTopPLabel',
    paramName: 'top_p',
    group: 'basic',
    type: 'range',
    min: 0,
    max: 1,
    step: 0.05,
    hintKey: 'localInferenceOptionTopPHint',
  },
  {
    key: 'top_k',
    labelKey: 'localInferenceOptionTopKLabel',
    paramName: 'top_k',
    group: 'advanced',
    type: 'range',
    min: 0,
    max: 100,
    step: 1,
    hintKey: 'localInferenceOptionTopKHint',
  },
  {
    key: 'min_p',
    labelKey: 'localInferenceOptionMinPLabel',
    paramName: 'min_p',
    group: 'advanced',
    type: 'range',
    min: 0,
    max: 1,
    step: 0.01,
    hintKey: 'localInferenceOptionMinPHint',
  },
  {
    key: 'repeat_penalty',
    labelKey: 'localInferenceOptionRepeatPenaltyLabel',
    paramName: 'repeat_penalty',
    group: 'advanced',
    type: 'range',
    min: 0,
    max: 2,
    step: 0.05,
    hintKey: 'localInferenceOptionRepeatPenaltyHint',
  },
  {
    key: 'presence_penalty',
    labelKey: 'localInferenceOptionPresencePenaltyLabel',
    paramName: 'presence_penalty',
    group: 'advanced',
    type: 'range',
    min: -2,
    max: 2,
    step: 0.1,
    hintKey: 'localInferenceOptionPresencePenaltyHint',
  },
  {
    key: 'cache_prompt',
    labelKey: 'localInferenceOptionCachePromptLabel',
    paramName: 'cache_prompt',
    group: 'advanced',
    type: 'select',
    hintKey: 'localInferenceOptionCachePromptHint',
  },
  {
    key: 'seed',
    labelKey: 'localInferenceOptionSeedLabel',
    paramName: 'seed',
    group: 'advanced',
    type: 'number',
    hintKey: 'localInferenceOptionSeedHint',
  },
  {
    key: 'stop',
    labelKey: 'localInferenceOptionStopLabel',
    paramName: 'stop',
    group: 'advanced',
    type: 'text',
    hintKey: 'localInferenceOptionStopHint',
  },
];

interface LocalInferenceViewProps {
  isSidebarCollapsed?: boolean;
  onToggleSidebar?: () => void;
  onNewChat?: () => void;
  updateBadge?: React.ReactNode;
}

const LocalInferenceView: React.FC<LocalInferenceViewProps> = ({
  isSidebarCollapsed,
  onToggleSidebar,
  onNewChat,
  updateBadge,
}) => {
  const isMac = window.electron.platform === 'darwin';
  const [activeTab, setActiveTab] = useState<LocalInferenceTab>('inference');
  const [status, setStatus] = useState<OllamaStatusSnapshot | null>(null);
  const [localModels, setLocalModels] = useState<OllamaModel[]>([]);
  const [runningModels, setRunningModels] = useState<OllamaRunningModel[]>([]);
  const [loading, setLoading] = useState(false);
  const [unloadingModelName, setUnloadingModelName] = useState<string | null>(null);
  const [toast, setToast] = useState<LocalInferenceToast | null>(null);
  const [pullName, setPullName] = useState('');
  const [activePullName, setActivePullName] = useState<string | null>(null);
  const [pullProgress, setPullProgress] = useState<InstallProgressState>({});
  const [selectedModel, setSelectedModel] = useState('');
  const [systemPrompt, setSystemPrompt] = useState('');
  const [prompt, setPrompt] = useState('');
  const [options, setOptions] = useState<InferenceOptions>(() => loadInferenceOptions());
  const [messages, setMessages] = useState<InferenceMessage[]>([]);
  const [streamingText, setStreamingText] = useState('');
  const [streamingThinking, setStreamingThinking] = useState('');
  const [sending, setSending] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const activeRequestIdRef = useRef<string | null>(null);
  const messagesRef = useRef<InferenceMessage[]>([]);
  const conversationVersionRef = useRef(0);
  const isRunning = status?.status === 'running';
  const normalizedPullName = pullName.trim();
  const activePullProgress = activePullName ? pullProgress[activePullName] : undefined;
  const pulling = isPullInProgress(activePullProgress);
  const [marketplaceModels, setMarketplaceModels] = useState<MarketplaceModel[]>([]);
  const [marketplaceLoading, setMarketplaceLoading] = useState(false);
  const [marketplaceError, setMarketplaceError] = useState<string | null>(null);
  const [marketplaceQuery, setMarketplaceQuery] = useState('');
  const [marketplaceTask, setMarketplaceTask] = useState<string>('all');
  const [marketplaceSize, setMarketplaceSize] = useState<string>('all');
  const [launchTarget, setLaunchTarget] = useState<OllamaModel | null>(null);
  const [servicePopoverOpen, setServicePopoverOpen] = useState(false);
  const [serviceConfigDialogOpen, setServiceConfigDialogOpen] = useState(false);
  const [importGuideOpen, setImportGuideOpen] = useState(false);
  const [serviceConfig, setServiceConfig] = useState<OllamaServiceConfig>({});
  const marketplaceSearchRef = useRef<number>(0);
  const toastTimerRef = useRef<number | null>(null);
  const installProgressDismissTimersRef = useRef<Record<string, number>>({});
  const servicePopoverRef = useRef<HTMLDivElement>(null);
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

  const searchMarketplace = useCallback(async (params: MarketplaceSearchParams) => {
    const id = ++marketplaceSearchRef.current;
    setMarketplaceLoading(true);
    setMarketplaceError(null);
    try {
      const result = await window.electron.marketplace.search(params);
      if (id === marketplaceSearchRef.current) {
        setMarketplaceModels(result.models);
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

  const runningModelNames = useMemo(
    () => new Set(runningModels.map(model => model.name || model.model).filter(Boolean)),
    [runningModels],
  );
  const selectedRunningModel = useMemo(
    () =>
      runningModels.find(model => model.name === selectedModel || model.model === selectedModel),
    [runningModels, selectedModel],
  );
  const runnableModels = useMemo(
    () => localModels.filter(model => runningModelNames.has(model.name)),
    [localModels, runningModelNames],
  );

  const refreshStatus = useCallback(async () => {
    const nextStatus = await window.electron.llamacpp.status();
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
    [clearInstallProgressDismissTimer, dismissToast, refreshLocalModels, showToast],
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
    if (!servicePopoverOpen) return;
    const handlePointerDown = (event: MouseEvent) => {
      if (!servicePopoverRef.current?.contains(event.target as Node)) {
        setServicePopoverOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setServicePopoverOpen(false);
      }
    };
    document.addEventListener('mousedown', handlePointerDown);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [servicePopoverOpen]);

  useEffect(() => {
    const unsubscribers = [
      window.electron.llamacpp.onStatusChanged(setStatus),
      window.electron.llamacpp.onPullProgress(({ name, chunk }) => {
        const progress = normalizeInstallProgress(name, chunk);
        if (!isInstallTerminalPhase(progress.phase)) {
          clearInstallProgressDismissTimer(name);
        }
        setPullProgress(current => ({ ...current, [name]: progress }));
        if (isInstallTerminalPhase(progress.phase)) {
          scheduleInstallProgressDismiss(name, progress.phase);
        }
        if (isInstallTerminalPhase(progress.phase)) {
          void refreshLocalModels().catch(() => undefined);
          void searchMarketplace({
            query: marketplaceQuery.trim() || undefined,
            task: marketplaceTask === 'all' ? undefined : (marketplaceTask as any),
            size: marketplaceSize === 'all' ? undefined : (marketplaceSize as any),
            limit: 120,
          }).catch(() => undefined);
        }
      }),
    ];
    void runAction(async () => {
      const nextServiceConfig = await loadOllamaServiceConfig();
      setServiceConfig(nextServiceConfig);
      const nextStatus = await refreshStatus();
      if (nextStatus.status === 'running') {
        await refreshLocalModels();
        await refreshRunningModels();
      }
    });
    return () => {
      unsubscribers.forEach(unsubscribe => unsubscribe());
    };
  }, [
    clearInstallProgressDismissTimer,
    refreshLocalModels,
    refreshRunningModels,
    refreshStatus,
    runAction,
    scheduleInstallProgressDismiss,
  ]);

  const handleSaveServiceConfig = useCallback(
    async (config: OllamaServiceConfig): Promise<SaveServiceConfigResult> => {
      setLoading(true);
      dismissToast();
      try {
        const saved = await saveOllamaServiceConfig(config);
        setServiceConfig(saved);
        showToast(
          status?.status === 'running'
            ? i18nService.t('localInferenceServiceConfigSavedRestartRequired')
            : i18nService.t('localInferenceServiceConfigSaved'),
          LocalInferenceToastKind.Success,
        );
        return { success: true };
      } catch (saveError) {
        const message = saveError instanceof Error ? saveError.message : String(saveError);
        return { success: false, error: message };
      } finally {
        setLoading(false);
      }
    },
    [dismissToast, showToast, status?.status],
  );

  const resetInferenceConversation = useCallback(() => {
    const requestId = activeRequestIdRef.current;
    conversationVersionRef.current += 1;
    if (requestId) {
      void window.electron.llamacpp.cancelChatStream(requestId).catch(() => undefined);
    }
    activeRequestIdRef.current = null;
    messagesRef.current = [];
    setMessages([]);
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
      setOptions(current =>
        shouldApplyModelPreset(current) ? getRecommendedInferenceOptions(modelName) : current,
      );
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
    if (selectedModel) return;
    const firstRunning = runnableModels[0]?.name;
    if (firstRunning) setSelectedModel(firstRunning);
  }, [runnableModels, selectedModel]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      void searchMarketplace({
        query: marketplaceQuery.trim() || undefined,
        task: marketplaceTask === 'all' ? undefined : (marketplaceTask as any),
        size: marketplaceSize === 'all' ? undefined : (marketplaceSize as any),
        limit: 120,
      });
    }, 200);
    return () => window.clearTimeout(timeout);
  }, [marketplaceQuery, marketplaceTask, marketplaceSize, searchMarketplace]);

  const handlePrepare = () => {
    void runAction(async () => {
      if (status?.status === 'not-installed') {
        const result = await window.electron.llamacpp.install();
        showToast(
          result?.success
            ? i18nService.t('localInferenceRuntimeReady')
            : result?.error || i18nService.t('localInferenceRuntimeMissing'),
        );
      } else if (status?.status === 'installed' || status?.status === 'stopped') {
        const startStatus = await window.electron.llamacpp.start();
        if (startStatus.status !== 'running') {
          showToast(
            startStatus.error || i18nService.t('localInferenceLaunchRestartFailed'),
            LocalInferenceToastKind.Error,
          );
          return;
        }
      } else {
        await refreshStatus();
      }
      if ((await refreshStatus()).status === 'running') {
        await refreshLocalModels();
        await refreshRunningModels();
      }
    });
  };

  const handleStop = () => {
    void runAction(async () => {
      await window.electron.llamacpp.stop();
      const nextStatus = await refreshStatus();
      if (nextStatus.status === 'running') {
        await refreshRunningModels();
      } else {
        setRunningModels([]);
      }
    });
  };

  const handleImportRuntime = () => {
    void runAction(async () => {
      const result = await window.electron.llamacpp.importRuntime();
      if (!result.success) {
        if (result.error === '已取消') return;
        showToast(
          result.error || i18nService.t('localInferenceImportRuntimeFailed'),
          LocalInferenceToastKind.Error,
        );
        return;
      }
      showToast(
        i18nService.t('localInferenceImportRuntimeSuccess'),
        LocalInferenceToastKind.Success,
      );
      await refreshStatus();
    });
  };

  const handleUninstallRuntime = () => {
    void runAction(async () => {
      const result = await window.electron.llamacpp.uninstallRuntime();
      if (!result.success) {
        showToast(
          result.error || i18nService.t('localInferenceRuntimeUninstallFailed'),
          LocalInferenceToastKind.Error,
        );
        return;
      }

      if (result.deleted) {
        showToast(
          i18nService.t('localInferenceRuntimeUninstalled'),
          LocalInferenceToastKind.Success,
        );
      } else {
        showToast(
          i18nService.t('localInferenceRuntimeNotInstalled'),
          LocalInferenceToastKind.Info,
        );
      }
      if (result.status.status === 'running') {
        await refreshLocalModels();
        await refreshRunningModels();
      } else {
        setRunningModels([]);
      }
      await refreshStatus();
    });
  };

  const handlePull = () => {
    if (!normalizedPullName) return;
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

  const handlePreload = (request: LaunchRequest, openDebugger: boolean) => {
    void runAction(async () => {
      const servicePatch = resolveLaunchServiceConfig(request.gpuPreset, request.customGpuDevices);
      if (servicePatch && hasServiceConfigPatchChanged(serviceConfig, servicePatch)) {
        if (status?.status === 'running' && !status.managedByApp) {
          throw new Error(i18nService.t('localInferenceServiceConfigExternalNotApplied'));
        }
        const nextConfig = { ...serviceConfig, ...servicePatch };
        const savedConfig = await saveOllamaServiceConfig(nextConfig);
        setServiceConfig(savedConfig);
        const restartedStatus = await window.electron.llamacpp.restart();
        setStatus(restartedStatus);
        if (restartedStatus.status !== 'running') {
          throw new Error(
            restartedStatus.error || i18nService.t('localInferenceLaunchRestartFailed'),
          );
        }
      }

      const result = await window.electron.llamacpp.loadModel(request.input);
      setRunningModels(result.runningModels);
      notifyLlamaCppRunningModelsChanged();
      resetInferenceConversation();
      setSelectedModel(request.input.model);
      setLaunchTarget(null);
      if (openDebugger) {
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
      notifyLlamaCppRunningModelsChanged();
    });
  };

  const handleSetOpenClawModel = (modelName: string) => {
    if (shouldBlockModelAction({ modelName, unloadingModelName })) return;
    void runAction(async () => {
      const result = await window.electron.llamacpp.setOpenClawModel(modelName);
      if (!result.success)
        throw new Error(result.error || i18nService.t('localInferenceSetOpenClawFailed'));
      notifyLlamaCppRunningModelsChanged();
      showToast(
        i18nService.t('localInferenceSetOpenClawDone').replace('{name}', modelName),
        LocalInferenceToastKind.Success,
      );
    });
  };

  const handleSavePreset = () => {
    localStorage.setItem('lobsterai:llamacpp-inference-options', JSON.stringify(options));
    showToast(i18nService.t('localInferencePresetSaved'), LocalInferenceToastKind.Success);
  };

  const sendPrompt = async () => {
    if (!selectedModel || !selectedRunningModel || !prompt.trim()) return;
    const userMessage = prompt.trim();
    const baseHistory = messagesRef.current;
    const nextHistory: InferenceMessage[] = [
      ...baseHistory,
      { role: 'user', content: userMessage },
    ];
    setMessages(nextHistory);
    messagesRef.current = nextHistory;
    setPrompt('');
    setStreamingText('');
    setStreamingThinking('');
    setSending(true);
    setCancelling(false);
    dismissToast();
    const requestId =
      globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const conversationVersion = conversationVersionRef.current;
    activeRequestIdRef.current = requestId;
    const isCurrentRequest = () =>
      activeRequestIdRef.current === requestId &&
      conversationVersionRef.current === conversationVersion;
    const effectiveSystemPrompt = buildEffectiveSystemPrompt(
      systemPrompt,
      options.direct_answer_mode === 'enabled',
    );

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

    try {
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
        options: normalizeOptions(options),
      };
      await window.electron.llamacpp.chatStream(requestId, payload);
      if (!isCurrentRequest()) return;
      const assistantMessage = buildAssistantMessage({
        content: streamState.content,
        thinking: streamState.thinking,
        metrics: streamState.finalChunk,
      });
      setMessages([...nextHistory, assistantMessage]);
      messagesRef.current = [...nextHistory, assistantMessage];
      await refreshRunningModels().catch(() => undefined);
    } catch (sendError) {
      if (!isCurrentRequest()) return;
      if (sendError instanceof Error && sendError.message.includes('Generation cancelled')) {
        showToast(i18nService.t('localInferenceGenerationCancelled'));
        if (streamState.content || streamState.thinking) {
          const assistantMessage = buildAssistantMessage({
            content: streamState.content,
            thinking: streamState.thinking,
            metrics: streamState.finalChunk,
          });
          setMessages([...nextHistory, assistantMessage]);
          messagesRef.current = [...nextHistory, assistantMessage];
        }
      } else {
        setMessages(baseHistory);
        messagesRef.current = baseHistory;
        showToast(
          sendError instanceof Error ? sendError.message : String(sendError),
          LocalInferenceToastKind.Error,
        );
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
            <ServicePopover
              containerRef={servicePopoverRef}
              open={servicePopoverOpen}
              status={status}
              loading={loading}
              localModels={localModels}
              runningModels={runningModels}
              onToggle={() => setServicePopoverOpen(current => !current)}
              onPrepare={handlePrepare}
              onStop={handleStop}
              onImportRuntime={handleImportRuntime}
              onUninstallRuntime={handleUninstallRuntime}
              onOpenImportGuide={() => setImportGuideOpen(true)}
              onOpenServiceConfig={() => {
                setServicePopoverOpen(false);
                setServiceConfigDialogOpen(true);
              }}
              onRefresh={() =>
                void runAction(async () => {
                  const nextStatus = await refreshStatus();
                  if (nextStatus.status === 'running') {
                    await refreshLocalModels();
                    await refreshRunningModels();
                  }
                })
              }
            />
          </div>

          {activeTab === 'models' ? (
            <ModelsPanel
              isRunning={isRunning}
              loading={loading}
              unloadingModelName={unloadingModelName}
              localModels={localModels}
              runningModels={runningModels}
              pullName={pullName}
              activePullName={activePullName}
              activePullProgress={activePullProgress}
              pulling={pulling}
              onPullNameChange={setPullName}
              onPull={handlePull}
              onCancelPull={handleCancelPull}
              onConfigureLaunch={setLaunchTarget}
              onUnload={handleUnload}
              onDelete={handleDelete}
              onSetOpenClawModel={handleSetOpenClawModel}
              onOpenInference={modelName => {
                handleSelectInferenceModel(modelName);
                setActiveTab('inference');
              }}
            />
          ) : activeTab === 'marketplace' ? (
            <MarketplacePanel
              loading={loading}
              models={marketplaceModels}
              marketplaceLoading={marketplaceLoading}
              marketplaceError={marketplaceError}
              activePullName={activePullName}
              activePullProgress={activePullProgress}
              pulling={pulling}
              query={marketplaceQuery}
              task={marketplaceTask}
              size={marketplaceSize}
              installedModelPathMap={installedModelPathMap}
              installProgress={pullProgress}
              onQueryChange={setMarketplaceQuery}
              onTaskChange={setMarketplaceTask}
              onSizeChange={setMarketplaceSize}
              onSearch={() =>
                void searchMarketplace({
                  query: marketplaceQuery.trim() || undefined,
                  task: marketplaceTask === 'all' ? undefined : (marketplaceTask as any),
                  size: marketplaceSize === 'all' ? undefined : (marketplaceSize as any),
                  limit: 120,
                })
              }
              onInstall={handleMarketplaceInstall}
              onCancelPull={handleCancelPull}
            />
          ) : (
            <div className="min-h-[520px] flex-1">
              <InferencePanel
                isRunning={isRunning}
                loading={loading}
                selectedModel={selectedModel}
                selectedRunningModel={selectedRunningModel}
                runnableModels={runnableModels}
                systemPrompt={systemPrompt}
                prompt={prompt}
                options={options}
                messages={messages}
                streamingText={streamingText}
                streamingThinking={streamingThinking}
                sending={sending}
                cancelling={cancelling}
                onModelChange={handleSelectInferenceModel}
                onSystemPromptChange={setSystemPrompt}
                onPromptChange={setPrompt}
                onOptionsChange={setOptions}
                onSavePreset={handleSavePreset}
                onSend={() => void sendPrompt()}
                onStop={() => void stopGeneration()}
                onOpenModels={() => setActiveTab('models')}
              />
            </div>
          )}
        </div>
      </div>
      {launchTarget && (
        <LaunchModelDialog
          model={launchTarget}
          loading={loading}
          serviceConfig={serviceConfig}
          onClose={() => setLaunchTarget(null)}
          onLaunch={handlePreload}
        />
      )}
      {serviceConfigDialogOpen && (
        <OllamaServiceConfigDialog
          loading={loading}
          running={isRunning}
          managedByApp={Boolean(status?.managedByApp)}
          config={serviceConfig}
          onClose={() => setServiceConfigDialogOpen(false)}
          onSave={handleSaveServiceConfig}
        />
      )}
      {importGuideOpen && (
        <ImportGuideDialog onClose={() => setImportGuideOpen(false)} />
      )}
    </div>
  );
};

function ImportGuideDialog({ onClose }: { onClose: () => void }) {
  const platform = window.electron.platform as string;
  const isWin = platform === 'win32';
  const isMac = platform === 'darwin';

  const executable = isWin ? 'llama-server.exe' : 'llama-server';

  const filesKey = isWin
    ? 'localInferenceImportGuideFilesWin'
    : isMac
      ? 'localInferenceImportGuideFilesMac'
      : 'localInferenceImportGuideFilesLinux';

  const noteKey = isWin
    ? 'localInferenceImportGuideStep1WinNote'
    : isMac
      ? 'localInferenceImportGuideStep1MacNote'
      : 'localInferenceImportGuideStep1LinuxNote';

  const openUrl = useCallback(() => {
    const url = i18nService.t('localInferenceImportGuideStep1Url');
    window.electron.shell.openExternal(url).catch(() => undefined);
  }, []);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4"
      onMouseDown={event => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="flex max-h-[88vh] w-full max-w-lg flex-col overflow-hidden rounded-xl border border-border bg-background shadow-2xl">
        {/* Header */}
        <div className="flex items-start justify-between gap-4 border-b border-border bg-surface/40 px-4 py-3">
          <div className="min-w-0">
            <h3 className="text-lg font-semibold text-foreground">
              {i18nService.t('localInferenceImportGuideTitle')}
            </h3>
            <p className="mt-1 text-sm text-secondary">
              {i18nService.t('localInferenceImportGuideDescription')}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-secondary transition-colors hover:bg-surface-raised hover:text-foreground"
            aria-label={i18nService.t('close')}
          >
            <XMarkIcon className="h-5 w-5" />
          </button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto px-4 py-4">
          {/* OS info */}
          <div className="rounded-lg border border-border bg-surface/60 px-3 py-2.5 mb-4">
            <p className="text-xs font-medium text-foreground">
              {isWin ? 'Windows' : isMac ? 'macOS' : 'Linux'}
            </p>
            <p className="mt-1 text-xs text-secondary">
              {i18nService.t(filesKey)} ({executable})
            </p>
          </div>

          {/* Steps */}
          <ol className="space-y-4 text-sm">
            <li className="flex gap-3">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/15 text-xs font-medium text-primary">1</span>
              <div className="min-w-0">
                <p className="text-foreground">
                  {i18nService.t('localInferenceImportGuideStep1')}
                </p>
                <button
                  type="button"
                  onClick={openUrl}
                  className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                >
                  {i18nService.t('localInferenceImportGuideStep1LinkLabel')}
                  <ArrowTopRightOnSquareIcon className="h-3 w-3" />
                </button>
                <p className="mt-1 text-xs text-secondary">
                  {i18nService.t(noteKey)}
                </p>
              </div>
            </li>
            <li className="flex gap-3">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/15 text-xs font-medium text-primary">2</span>
              <p className="text-foreground pt-0.5">
                {i18nService.t('localInferenceImportGuideStep2')}
              </p>
            </li>
            <li className="flex gap-3">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/15 text-xs font-medium text-primary">3</span>
              <p className="text-foreground pt-0.5">
                {i18nService.t('localInferenceImportGuideStep3')}
              </p>
            </li>
          </ol>
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 border-t border-border px-4 py-3">
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-9 items-center justify-center rounded-lg bg-primary px-4 text-sm font-medium text-white transition-colors hover:bg-primary-hover"
          >
            {i18nService.t('localInferenceImportGuideClose')}
          </button>
        </div>
      </div>
    </div>
  );
}

function ServicePopover({
  containerRef,
  open,
  status,
  loading,
  localModels,
  runningModels,
  onToggle,
  onPrepare,
  onStop,
  onImportRuntime,
  onUninstallRuntime,
  onOpenImportGuide,
  onOpenServiceConfig,
  onRefresh,
}: {
  containerRef: React.RefObject<HTMLDivElement>;
  open: boolean;
  status: OllamaStatusSnapshot | null;
  loading: boolean;
  localModels: OllamaModel[];
  runningModels: OllamaRunningModel[];
  onToggle: () => void;
  onPrepare: () => void;
  onStop: () => void;
  onImportRuntime: () => void;
  onUninstallRuntime: () => void;
  onOpenImportGuide: () => void;
  onOpenServiceConfig: () => void;
  onRefresh: () => void;
}) {
  const running = status?.status === 'running';
  const managedByApp = Boolean(status?.managedByApp);
  const displayStatus = status?.status === 'installed' ? 'stopped' : (status?.status ?? 'unknown');
  const canPrepare =
    status?.status === 'not-installed' ||
    status?.status === 'installed' ||
    status?.status === 'stopped';
  const canUninstallRuntime =
    !running &&
    status?.status !== undefined &&
    status.status !== 'unknown' &&
    status.status !== 'not-installed';
  const actionLabel =
    status?.status === 'not-installed'
      ? i18nService.t('localInferenceInstall')
      : i18nService.t('localInferenceStart');
  return (
    <div ref={containerRef} className="relative shrink-0 self-end sm:self-auto">
      <button
        type="button"
        onClick={onToggle}
        className="inline-flex h-10 items-center gap-2.5 rounded-xl border border-border bg-surface px-3.5 text-sm text-foreground transition-colors hover:bg-surface-raised sm:min-w-[15rem]"
      >
        <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-surface-raised text-secondary">
          <CpuChipIcon className="h-4 w-4" />
        </span>
        <span className="hidden text-left sm:block">
          <span className="block text-[11px] text-secondary">
            {i18nService.t('localInferenceService')}
          </span>
        </span>
        <StatusBadge status={displayStatus} />
      </button>
      {open && (
        <div className="absolute right-0 top-full z-20 mt-2 w-[min(22rem,calc(100vw-2rem))] rounded-xl border border-border bg-background/95 p-3 shadow-2xl backdrop-blur">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-sm font-semibold text-foreground">
                  {i18nService.t('localInferenceService')}
                </h2>
                {running && !managedByApp && (
                  <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] font-medium text-amber-500">
                    {i18nService.t('localInferenceServiceExternal')}
                  </span>
                )}
              </div>
              <p className="mt-1 text-xs text-secondary">
                {i18nService
                  .t('localInferenceServiceHint')
                  .replace('{local}', String(localModels.length))
                  .replace('{running}', String(runningModels.length))}
              </p>
            </div>
          </div>

          <div className="mt-3 grid grid-cols-2 gap-2">
            <div className="rounded-lg border border-border bg-surface/70 px-3 py-2">
              <p className="text-[11px] text-secondary">
                {i18nService.t('localInferenceTabModels')}
              </p>
              <p className="mt-1 text-lg font-semibold text-foreground">{localModels.length}</p>
            </div>
            <div className="rounded-lg border border-border bg-surface/70 px-3 py-2">
              <p className="text-[11px] text-secondary">{i18nService.t('localInferenceLoaded')}</p>
              <p className="mt-1 text-lg font-semibold text-foreground">{runningModels.length}</p>
            </div>
          </div>

          {running && !managedByApp && (
            <p className="mt-3 rounded-lg border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
              {i18nService.t('localInferenceExternalServiceHint')}
            </p>
          )}

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={onRefresh}
              disabled={loading}
              className={smallOutlineButtonClass}
            >
              <ArrowPathIcon className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
              {i18nService.t('refresh')}
            </button>
            <button
              type="button"
              onClick={onOpenServiceConfig}
              disabled={loading}
              className={smallOutlineButtonClass}
            >
              <AdjustmentsHorizontalIcon className="h-3.5 w-3.5" />
              {i18nService.t('localInferenceServiceConfigTitle')}
            </button>
            {!running && canPrepare && (
              <button
                type="button"
                onClick={onPrepare}
                disabled={loading}
                className="inline-flex h-7 items-center gap-1.5 rounded-md bg-primary px-2.5 text-xs font-medium text-white transition-colors hover:bg-primary-hover disabled:opacity-60"
              >
                <PlayIcon className="h-3.5 w-3.5" />
                {actionLabel}
              </button>
            )}
            {!running && status?.status === 'not-installed' && (
              <>
                <button
                  type="button"
                  onClick={onImportRuntime}
                  disabled={loading}
                  className={smallOutlineButtonClass}
                  title={i18nService.t('localInferenceImportRuntimeTooltip')}
                >
                  <ArrowDownTrayIcon className="h-3.5 w-3.5" />
                  {i18nService.t('localInferenceImportRuntime')}
                </button>
                <button
                  type="button"
                  onClick={onOpenImportGuide}
                  disabled={loading}
                  className="inline-flex h-7 w-7 items-center justify-center rounded-md text-secondary transition-colors hover:bg-surface-raised hover:text-foreground"
                  title={i18nService.t('localInferenceImportGuideTitle')}
                >
                  <QuestionMarkCircleIcon className="h-4 w-4" />
                </button>
              </>
            )}
            {running && managedByApp ? (
              <button
                type="button"
                onClick={onStop}
                disabled={loading}
                className={smallOutlineButtonClass}
              >
                <StopIcon className="h-3.5 w-3.5" />
                {i18nService.t('localInferenceStop')}
              </button>
            ) : null}
            {canUninstallRuntime ? (
              <button
                type="button"
                onClick={onUninstallRuntime}
                disabled={loading}
                className={smallDangerButtonClass}
              >
                <TrashIcon className="h-3.5 w-3.5" />
                {i18nService.t('localInferenceRuntimeUninstall')}
              </button>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}

function OllamaServiceConfigDialog({
  loading,
  running,
  managedByApp,
  config,
  onClose,
  onSave,
}: {
  loading: boolean;
  running: boolean;
  managedByApp: boolean;
  config: OllamaServiceConfig;
  onClose: () => void;
  onSave: (config: OllamaServiceConfig) => Promise<SaveServiceConfigResult>;
}) {
  const [form, setForm] = useState<OllamaServiceConfigFormState>(() => serviceConfigToForm(config));
  const [saveError, setSaveError] = useState<string | null>(null);
  const [advancedOpen, setAdvancedOpen] = useState(false);

  useEffect(() => {
    setForm(serviceConfigToForm(config));
  }, [config]);

  const updateForm = (key: keyof OllamaServiceConfigFormState, value: string) => {
    setForm(current => ({ ...current, [key]: value }));
  };
  const renderField = (field: ServiceConfigField) => {
    const placeholder = field.placeholderKey
      ? i18nService.t(field.placeholderKey)
      : (field.placeholder ?? '');
    const label = i18nService.t(field.labelKey);
    const hint = i18nService.t(field.hintKey);
    return field.type === 'select' ? (
      <ServiceConfigSelect
        key={field.key}
        label={label}
        paramName={field.paramName}
        value={form[field.key]}
        hint={hint}
        onChange={value => updateForm(field.key, value)}
        options={getServiceConfigSelectOptions(field.key)}
      />
    ) : (
      <ServiceConfigInput
        key={field.key}
        label={label}
        paramName={field.paramName}
        value={form[field.key]}
        placeholder={placeholder}
        hint={hint}
        onChange={value => updateForm(field.key, value)}
      />
    );
  };

  const save = async () => {
    setSaveError(null);
    const result = await onSave({
      host: form.host,
      port: form.port,
      customExecutablePath: form.customExecutablePath,
      device: form.device,
      modelsMax: form.modelsMax,
      ...(form.modelsAutoload ? { modelsAutoload: form.modelsAutoload === 'true' } : {}),
      parallel: form.parallel,
      ctxSize: form.ctxSize,
      gpuLayers: form.gpuLayers,
      batchSize: form.batchSize,
      ubatchSize: form.ubatchSize,
      threads: form.threads,
      threadsBatch: form.threadsBatch,
      timeout: form.timeout,
      threadsHttp: form.threadsHttp,
      cacheReuse: form.cacheReuse,
      cacheRam: form.cacheRam,
      ...(form.cachePrompt ? { cachePrompt: form.cachePrompt === 'true' } : {}),
      ...(form.flashAttn
        ? { flashAttn: form.flashAttn as NonNullable<OllamaServiceConfig['flashAttn']> }
        : {}),
      mainGpu: form.mainGpu,
      tensorSplit: form.tensorSplit,
      ...(form.mmap ? { noMmap: form.mmap === 'false' } : {}),
      ...(form.mlock ? { mlock: form.mlock === 'true' } : {}),
      ...(form.jinja ? { jinja: form.jinja as NonNullable<OllamaServiceConfig['jinja']> } : {}),
      ...(form.reasoning
        ? { reasoning: form.reasoning as NonNullable<OllamaServiceConfig['reasoning']> }
        : {}),
      ...(form.reasoningFormat
        ? {
            reasoningFormat: form.reasoningFormat as NonNullable<
              OllamaServiceConfig['reasoningFormat']
            >,
          }
        : {}),
      reasoningBudget: form.reasoningBudget,
      ...(form.splitMode
        ? { splitMode: form.splitMode as NonNullable<OllamaServiceConfig['splitMode']> }
        : {}),
    });
    if (result.success) {
      onClose();
    } else {
      setSaveError(result.error || i18nService.t('localInferenceServiceConfigRestartAppRequired'));
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4"
      onMouseDown={event => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="flex max-h-[88vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-border bg-background shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-border bg-surface/40 px-4 py-3">
          <div className="min-w-0">
            <h3 className="text-lg font-semibold text-foreground">
              {i18nService.t('localInferenceServiceConfigTitle')}
            </h3>
            <p className="mt-1 text-sm text-secondary">
              {i18nService.t('localInferenceServiceConfigDescription')}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-secondary transition-colors hover:bg-surface-raised hover:text-foreground"
            aria-label={i18nService.t('close')}
          >
            <XMarkIcon className="h-5 w-5" />
          </button>
        </div>

        <div className="overflow-y-auto px-4 py-3">
          <section className="rounded-xl border border-border bg-surface/40 px-3 py-3">
            {running && !managedByApp && (
              <p className="mb-4 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
                {i18nService.t('localInferenceServiceConfigExternalWarning')}
              </p>
            )}
            {saveError && (
              <p className="mb-4 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-700 dark:text-red-300">
                {saveError}
              </p>
            )}
            <div className="space-y-5">
              <div className="space-y-3">
                <div className="flex items-center justify-between gap-3 border-b border-border/70 pb-2">
                  <h4 className="text-sm font-semibold text-foreground">
                    {i18nService.t('localInferenceServiceConfigGroupBasic')}
                  </h4>
                  <span className="text-[11px] text-secondary">
                    {i18nService.t('localInferenceServiceConfigRestartRequired')}
                  </span>
                </div>
                <div className="grid gap-3 md:grid-cols-2">
                  {SERVICE_CONFIG_FIELDS.filter(field => field.group === 'basic').map(renderField)}
                </div>
              </div>

              <div className="space-y-3">
                <button
                  type="button"
                  onClick={() => setAdvancedOpen(current => !current)}
                  className="flex w-full items-center justify-between gap-3 border-b border-border/70 pb-2 text-left"
                >
                  <span>
                    <span className="block text-sm font-semibold text-foreground">
                      {i18nService.t('localInferenceServiceConfigGroupAdvanced')}
                    </span>
                    <span className="mt-1 block text-xs text-secondary">
                      {i18nService.t('localInferenceServiceConfigAdvancedDescription')}
                    </span>
                  </span>
                  <span className="shrink-0 text-xs text-secondary">
                    {advancedOpen ? i18nService.t('hide') : i18nService.t('show')}
                  </span>
                </button>
                {advancedOpen && (
                  <div className="grid gap-3 md:grid-cols-2">
                    {SERVICE_CONFIG_FIELDS.filter(field => field.group === 'advanced').map(
                      renderField,
                    )}
                  </div>
                )}
              </div>
            </div>
            <p className="mt-4 text-xs text-secondary">
              {running && !managedByApp
                ? i18nService.t('localInferenceServiceConfigExternalHint')
                : running
                  ? i18nService.t('localInferenceServiceConfigRestartHint')
                  : i18nService.t('localInferenceServiceConfigStartHint')}
            </p>
          </section>
        </div>

        <div className="flex flex-col gap-2 border-t border-border px-4 py-3 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={onClose}
            disabled={loading}
            className="inline-flex h-9 items-center justify-center rounded-lg border border-border px-4 text-sm text-foreground transition-colors hover:bg-surface-raised disabled:opacity-60"
          >
            {i18nService.t('cancel')}
          </button>
          <button
            type="button"
            onClick={() => void save()}
            disabled={loading}
            className="inline-flex h-9 items-center justify-center rounded-lg bg-primary px-4 text-sm font-medium text-white transition-colors hover:bg-primary-hover disabled:opacity-60"
          >
            {i18nService.t('save')}
          </button>
        </div>
      </div>
    </div>
  );
}

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

function ServiceConfigInput({
  label,
  paramName,
  value,
  placeholder,
  hint,
  onChange,
}: {
  label: string;
  paramName: string;
  value: string;
  placeholder: string;
  hint: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="space-y-2">
      <span className="flex items-baseline gap-2">
        <span className="text-sm font-semibold text-foreground">{label}</span>
        <code className="text-[11px] text-secondary">{paramName}</code>
      </span>
      <input
        value={value}
        placeholder={placeholder}
        onChange={event => onChange(event.target.value)}
        className="h-10 w-full rounded-lg border border-border bg-surface-input px-3 font-mono text-sm text-foreground outline-none transition-colors placeholder:text-secondary focus:border-primary/60"
      />
      <p className="text-xs text-secondary">{hint}</p>
    </label>
  );
}

function ServiceConfigSelect({
  label,
  paramName,
  value,
  hint,
  options,
  onChange,
}: {
  label: string;
  paramName: string;
  value: string;
  hint: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
}) {
  return (
    <label className="space-y-2">
      <span className="flex items-baseline gap-2">
        <span className="text-sm font-semibold text-foreground">{label}</span>
        <code className="text-[11px] text-secondary">{paramName}</code>
      </span>
      <select
        value={value}
        onChange={event => onChange(event.target.value)}
        className="h-10 w-full rounded-lg border border-border bg-surface-input px-3 text-sm text-foreground outline-none transition-colors focus:border-primary/60"
      >
        <option value="">{i18nService.t('localInferenceLaunchDefault')}</option>
        {options.map(option => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <p className="text-xs text-secondary">{hint}</p>
    </label>
  );
}

function getServiceConfigSelectOptions(
  key: keyof OllamaServiceConfigFormState,
): Array<{ value: string; label: string }> {
  switch (key) {
    case 'splitMode':
      return [
        { value: 'none', label: i18nService.t('localInferenceServiceConfigSplitNone') },
        { value: 'layer', label: i18nService.t('localInferenceServiceConfigSplitLayer') },
        { value: 'row', label: i18nService.t('localInferenceServiceConfigSplitRow') },
        { value: 'tensor', label: i18nService.t('localInferenceServiceConfigSplitTensor') },
      ];
    case 'cachePrompt':
    case 'modelsAutoload':
    case 'mmap':
    case 'mlock':
      return booleanSelectOptions();
    case 'flashAttn':
    case 'jinja':
    case 'reasoning':
      return onOffAutoOptions();
    case 'reasoningFormat':
      return [
        { value: 'none', label: 'none' },
        { value: 'deepseek', label: 'deepseek' },
        { value: 'deepseek-legacy', label: 'deepseek-legacy' },
        { value: 'auto', label: 'auto' },
      ];
    default:
      return [];
  }
}

function booleanSelectOptions(): Array<{ value: string; label: string }> {
  return [
    { value: 'true', label: i18nService.t('localInferenceLaunchBooleanEnabled') },
    { value: 'false', label: i18nService.t('localInferenceLaunchBooleanDisabled') },
  ];
}

function onOffAutoOptions(): Array<{ value: string; label: string }> {
  return [
    { value: 'auto', label: 'auto' },
    { value: 'on', label: 'on' },
    { value: 'off', label: 'off' },
  ];
}

function StatusBadge({ status }: { status: string }) {
  const displayStatus = status === 'installed' ? 'stopped' : status;
  const ok = displayStatus === 'running';
  return (
    <span
      className={`inline-flex h-5 items-center rounded-md px-1.5 text-[11px] font-medium ${
        ok
          ? 'bg-green-500/10 text-green-600 dark:text-green-400'
          : 'bg-surface-raised text-secondary'
      }`}
    >
      {i18nService.t(`localInferenceStatus_${displayStatus}`) || displayStatus}
    </span>
  );
}

function ModelsPanel({
  isRunning,
  loading,
  unloadingModelName,
  localModels,
  runningModels,
  pullName,
  activePullName,
  activePullProgress,
  pulling,
  onPullNameChange,
  onPull,
  onCancelPull,
  onConfigureLaunch,
  onUnload,
  onDelete,
  onSetOpenClawModel,
  onOpenInference,
}: {
  isRunning: boolean;
  loading: boolean;
  unloadingModelName: string | null;
  localModels: OllamaModel[];
  runningModels: OllamaRunningModel[];
  pullName: string;
  activePullName: string | null;
  activePullProgress?: LlamaCppInstallProgress;
  pulling: boolean;
  onPullNameChange: (value: string) => void;
  onPull: () => void;
  onCancelPull: () => void;
  onConfigureLaunch: (model: OllamaModel) => void;
  onUnload: (modelName: string) => void;
  onDelete: (modelName: string) => void;
  onSetOpenClawModel: (modelName: string) => void;
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
        {activePullName && activePullProgress && (
          <div className="mt-3 rounded-md border border-border bg-surface-raised px-3 py-2">
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-secondary">
              <span className="font-mono text-foreground">{activePullName}</span>
              <span>{formatPullProgress(activePullProgress)}</span>
            </div>
            <InstallProgressBar progress={activePullProgress} className="mt-2" />
          </div>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-foreground">
          {i18nService.t('localInferenceRegisteredModels')}
        </h2>
        {!isRunning ? (
          <EmptyState title={i18nService.t('localInferenceServiceStopped')} />
        ) : localModels.length === 0 ? (
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
                  onConfigureLaunch={() => {
                    if (shouldBlockModelAction({ modelName: model.name, unloadingModelName })) return;
                    onConfigureLaunch(model);
                  }}
                  onUnload={() => onUnload(model.name)}
                  onDelete={() => onDelete(model.name)}
                  onSetOpenClawModel={() => onSetOpenClawModel(model.name)}
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
  onConfigureLaunch,
  onUnload,
  onDelete,
  onSetOpenClawModel,
  onOpenInference,
}: {
  model: OllamaModel;
  runningModel?: OllamaRunningModel;
  loading: boolean;
  unloading: boolean;
  onConfigureLaunch: () => void;
  onUnload: () => void;
  onDelete: () => void;
  onSetOpenClawModel: () => void;
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
            onClick={onConfigureLaunch}
            disabled={buttonsDisabled}
            className={smallOutlineButtonClass}
          >
            <PlayIcon className="h-3.5 w-3.5" />
            {i18nService.t('localInferenceConfigureLaunch')}
          </button>
        )}
        <button
          type="button"
          onClick={onOpenInference}
          disabled={!isRunning || buttonsDisabled}
          className={smallOutlineButtonClass}
        >
          <ServerStackIcon className="h-3.5 w-3.5" />
          {i18nService.t('localInferenceInfer')}
        </button>
        <button
          type="button"
          onClick={onSetOpenClawModel}
          disabled={!isRunning || buttonsDisabled}
          title={!isRunning ? i18nService.t('localInferenceUseOpenClawDisabledHint') : undefined}
          className={smallOutlineButtonClass}
        >
          <CheckCircleIcon className="h-3.5 w-3.5" />
          {i18nService.t('localInferenceUseOpenClaw')}
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

function LaunchModelDialog({
  model,
  loading,
  serviceConfig,
  onClose,
  onLaunch,
}: {
  model: OllamaModel;
  loading: boolean;
  serviceConfig: OllamaServiceConfig;
  onClose: () => void;
  onLaunch: (request: LaunchRequest, openDebugger: boolean) => void;
}) {
  const [form, setForm] = useState<LaunchFormState>({
    numCtx: '4096',
    accelerationMode: 'auto',
    customGpuLayers: '',
    numThread: '',
    numBatch: '',
    useMmap: '',
    gpuPreset: 'service-default',
    customGpuDevices: '',
  });
  const [optimizationSummary, setOptimizationSummary] = useState('');
  const [detectingHardware, setDetectingHardware] = useState(false);
  const updateForm = (key: keyof LaunchFormState, value: string) => {
    setForm(current => ({ ...current, [key]: value }));
  };
  const buildInput = (): OllamaModelLaunchInput => {
    const options: NonNullable<OllamaModelLaunchInput['options']> = {};
    const parsedNumCtx = parseOptionalInteger(form.numCtx);
    const parsedNumGpu = resolveAccelerationNumGpu(form.accelerationMode, form.customGpuLayers);
    const parsedNumThread = parseOptionalInteger(form.numThread);
    const parsedNumBatch = parseOptionalInteger(form.numBatch);
    const parsedUseMmap = parseOptionalBoolean(form.useMmap);

    if (parsedNumCtx !== undefined) options.ctxSize = parsedNumCtx;
    if (parsedNumBatch !== undefined) options.batchSize = parsedNumBatch;
    if (parsedNumGpu !== undefined) options.gpuLayers = parsedNumGpu;
    if (parsedUseMmap !== undefined) options.mmap = parsedUseMmap;
    if (parsedNumThread !== undefined) options.threads = parsedNumThread;

    return {
      model: model.name,
      ...(model.path ? { modelPath: model.path } : {}),
      ...(Object.keys(options).length > 0 ? { options } : {}),
    };
  };
  const applyOptimizedLaunchOptions = async () => {
    setDetectingHardware(true);
    let snapshot: NvidiaSmiSnapshot | null = null;
    try {
      snapshot = await window.electron.hardware.nvidiaSmi();
    } catch {
      snapshot = null;
    } finally {
      setDetectingHardware(false);
    }

    const next = suggestLaunchOptions(model, snapshot, navigator.hardwareConcurrency);
    setForm(current => ({
      ...current,
      numCtx: String(next.numCtx),
      accelerationMode: next.numGpu === undefined ? 'auto' : 'custom',
      customGpuLayers: next.numGpu === undefined ? '' : String(next.numGpu),
      numThread: String(next.numThread),
      numBatch: String(next.numBatch),
    }));
    setOptimizationSummary(next.summary);
  };
  const buildLaunchRequest = (): LaunchRequest => ({
    input: buildInput(),
    gpuPreset: form.gpuPreset,
    customGpuDevices: form.customGpuDevices,
  });
  const launchContextLimitViolation = getLaunchContextLimitViolation({
    requestedContextLength: parseOptionalInteger(form.numCtx),
    trainedContextLength: model.trained_context_length ?? model.details?.context_length,
  });
  const servicePatch = resolveLaunchServiceConfig(form.gpuPreset, form.customGpuDevices);
  const gpuPresetChangesService =
    servicePatch !== null && hasServiceConfigPatchChanged(serviceConfig, servicePatch);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4"
      onMouseDown={event => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-border bg-background shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-border bg-surface/40 px-5 py-4">
          <div className="min-w-0">
            <h3 className="text-xl font-semibold text-foreground">
              {i18nService.t('localInferenceLaunchTitle')}
            </h3>
            <p className="mt-1 truncate font-mono text-xs text-secondary">{model.name}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-secondary transition-colors hover:bg-surface-raised hover:text-foreground"
            aria-label={i18nService.t('close')}
          >
            <XMarkIcon className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-4 overflow-y-auto px-5 py-4">
          <section className="rounded-xl border border-border bg-surface px-4 py-3">
            <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
              <div className="min-w-0">
                <h4 className="text-sm font-semibold text-foreground">
                  {i18nService.t('localInferenceLaunchLifecycleTitle')}
                </h4>
                <p className="mt-1 text-sm text-secondary">
                  {i18nService.t('localInferenceLaunchLifecycleDescription')}
                </p>
              </div>
              <span className="shrink-0 rounded-full bg-surface-raised px-2.5 py-1 text-xs text-secondary">
                {i18nService.t('localInferenceLaunchKeepAliveForever')}
              </span>
            </div>
          </section>

          <section className="flex flex-col gap-3 rounded-xl border border-primary/20 bg-primary/5 px-4 py-3 md:flex-row md:items-center md:justify-between">
            <div className="min-w-0">
              <h4 className="text-sm font-semibold text-foreground">
                {i18nService.t('localInferenceLaunchAutoTitle')}
              </h4>
              <p className="mt-1 text-sm text-secondary">
                {optimizationSummary || i18nService.t('localInferenceLaunchAutoDescription')}
              </p>
              <p className="mt-1 text-xs text-secondary">
                {i18nService.t('localInferenceLaunchAutoFormula')}
              </p>
            </div>
            <button
              type="button"
              onClick={() => void applyOptimizedLaunchOptions()}
              disabled={loading || detectingHardware}
              className={smallOutlineButtonClass}
            >
              <AdjustmentsHorizontalIcon className="h-3.5 w-3.5" />
              {i18nService.t('localInferenceLaunchAutoOptimize')}
            </button>
          </section>

          <section className="space-y-3 rounded-xl border border-border bg-surface/40 px-4 py-3">
            <div>
              <h4 className="text-sm font-semibold text-foreground">
                {i18nService.t('localInferenceLaunchGpuPresetTitle')}
              </h4>
              <p className="mt-1 text-sm text-secondary">
                {i18nService.t('localInferenceLaunchGpuPresetDescription')}
              </p>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <LaunchChoiceGrid
                value={form.gpuPreset}
                options={[
                  {
                    value: 'service-default',
                    label: i18nService.t('localInferenceLaunchGpuServiceDefault'),
                    description: i18nService.t('localInferenceLaunchGpuServiceDefaultHint'),
                  },
                  {
                    value: 'single-auto',
                    label: i18nService.t('localInferenceLaunchGpuSingleAuto'),
                    description: i18nService.t('localInferenceLaunchGpuSingleAutoHint'),
                  },
                  {
                    value: 'dual-gpu',
                    label: i18nService.t('localInferenceLaunchGpuDual'),
                    description: i18nService.t('localInferenceLaunchGpuDualHint'),
                  },
                  {
                    value: 'custom',
                    label: i18nService.t('localInferenceLaunchGpuCustom'),
                    description: i18nService.t('localInferenceLaunchGpuCustomHint'),
                  },
                ]}
                onChange={value => updateForm('gpuPreset', value)}
              />
              <div className="rounded-lg border border-border bg-background/70 p-3">
                <p className="text-xs font-medium text-secondary">
                  {i18nService.t('localInferenceLaunchGpuCurrent')}
                </p>
                <p className="mt-1 font-mono text-sm text-foreground">
                  {formatCurrentGpuServiceConfig(serviceConfig)}
                </p>
                <p className="mt-3 text-xs font-medium text-secondary">
                  {i18nService.t('localInferenceLaunchGpuWillUse')}
                </p>
                <p className="mt-1 font-mono text-sm text-foreground">
                  {formatLaunchGpuPresetSummary(form.gpuPreset, form.customGpuDevices)}
                </p>
              </div>
            </div>
            {form.gpuPreset === 'custom' && (
              <LaunchTextInput
                label={i18nService.t('localInferenceLaunchGpuCustomValue')}
                value={form.customGpuDevices}
                placeholder="CUDA0,CUDA1"
                hint={i18nService.t('localInferenceLaunchGpuCustomValueHint')}
                onChange={value => updateForm('customGpuDevices', value)}
              />
            )}
            {gpuPresetChangesService && (
              <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
                {i18nService.t('localInferenceLaunchGpuRestartNotice')}
              </p>
            )}
          </section>

          <section className="space-y-3 rounded-xl border border-border px-4 py-3">
            <div>
              <h4 className="text-sm font-semibold text-foreground">
                {i18nService.t('localInferenceLaunchBasicTitle')}
              </h4>
              <p className="mt-1 text-sm text-secondary">
                {i18nService.t('localInferenceLaunchBasicDescription')}
              </p>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <LaunchInput
                label={i18nService.t('localInferenceLaunchNumCtx')}
                value={form.numCtx}
                min={512}
                step={512}
                hint={i18nService.t('localInferenceLaunchNumCtxHint')}
                onChange={value => updateForm('numCtx', value)}
              />
              <LaunchChoiceSelect
                label={i18nService.t('localInferenceLaunchAcceleration')}
                value={form.accelerationMode}
                options={[
                  { value: 'auto', label: i18nService.t('localInferenceLaunchAccelerationAuto') },
                  { value: 'cpu', label: i18nService.t('localInferenceLaunchAccelerationCpu') },
                  {
                    value: 'custom',
                    label: i18nService.t('localInferenceLaunchAccelerationCustom'),
                  },
                ]}
                hint={i18nService.t('localInferenceLaunchAccelerationHint')}
                onChange={value => updateForm('accelerationMode', value)}
              />
              {form.accelerationMode === 'custom' && (
                <LaunchInput
                  label={i18nService.t('localInferenceLaunchNumGpu')}
                  value={form.customGpuLayers}
                  min={0}
                  placeholder={i18nService.t('localInferenceLaunchDefault')}
                  hint={i18nService.t('localInferenceLaunchNumGpuHint')}
                  onChange={value => updateForm('customGpuLayers', value)}
                />
              )}
            </div>
            {launchContextLimitViolation && (
              <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-700 dark:text-red-300">
                {i18nService
                  .t('localInferenceLaunchContextExceedsTrainingLimit')
                  .replace(
                    '{requested}',
                    String(launchContextLimitViolation.requestedContextLength),
                  )
                  .replace(
                    '{trained}',
                    String(launchContextLimitViolation.trainedContextLength),
                  )}
              </p>
            )}
          </section>

          <section className="space-y-3 rounded-xl border border-border px-4 py-3">
            <div>
              <h4 className="text-sm font-semibold text-foreground">
                {i18nService.t('localInferenceLaunchAdvancedTitle')}
              </h4>
              <p className="mt-1 text-sm text-secondary">
                {i18nService.t('localInferenceLaunchAdvancedDescription')}
              </p>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <LaunchInput
                label={i18nService.t('localInferenceLaunchNumThread')}
                value={form.numThread}
                min={1}
                placeholder={i18nService.t('localInferenceLaunchDefault')}
                hint={i18nService.t('localInferenceLaunchNumThreadHint')}
                onChange={value => updateForm('numThread', value)}
              />
              <LaunchInput
                label={i18nService.t('localInferenceLaunchNumBatch')}
                value={form.numBatch}
                min={1}
                step={32}
                placeholder={i18nService.t('localInferenceLaunchDefault')}
                hint={i18nService.t('localInferenceLaunchNumBatchHint')}
                onChange={value => updateForm('numBatch', value)}
              />
              <LaunchSelect
                label={i18nService.t('localInferenceLaunchUseMmap')}
                value={form.useMmap}
                hint={i18nService.t('localInferenceLaunchUseMmapHint')}
                onChange={value => updateForm('useMmap', value)}
              />
            </div>
          </section>
        </div>

        <div className="flex flex-col gap-2 border-t border-border px-5 py-4 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={onClose}
            disabled={loading}
            className="inline-flex h-9 items-center justify-center rounded-lg border border-border px-4 text-sm text-foreground transition-colors hover:bg-surface-raised disabled:opacity-60"
          >
            {i18nService.t('cancel')}
          </button>
          <button
            type="button"
            onClick={() => onLaunch(buildLaunchRequest(), false)}
            disabled={loading || Boolean(launchContextLimitViolation)}
            className={
              smallOutlineButtonClass.replace('h-7', 'h-9').replace('text-xs', 'text-sm') +
              ' justify-center px-4'
            }
          >
            <PlayIcon className="h-4 w-4" />
            {i18nService.t('localInferenceLaunchLoadOnly')}
          </button>
          <button
            type="button"
            onClick={() => onLaunch(buildLaunchRequest(), true)}
            disabled={loading || Boolean(launchContextLimitViolation)}
            className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg bg-primary px-4 text-sm font-medium text-white transition-colors hover:bg-primary-hover disabled:opacity-60"
          >
            <BeakerIcon className="h-4 w-4" />
            {i18nService.t('localInferenceLaunchLoadAndDebug')}
          </button>
        </div>
      </div>
    </div>
  );
}

function LaunchInput({
  label,
  value,
  hint,
  min,
  step,
  placeholder,
  onChange,
}: {
  label: string;
  value: string;
  hint: string;
  min?: number;
  step?: number;
  placeholder?: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="space-y-2">
      <span className="text-sm font-semibold text-foreground">{label}</span>
      <input
        type="number"
        min={min}
        step={step}
        value={value}
        placeholder={placeholder}
        onChange={event => onChange(event.target.value)}
        className="h-10 w-full rounded-lg border border-border bg-surface-input px-3 font-mono text-sm text-foreground outline-none transition-colors placeholder:text-secondary focus:border-primary/60"
      />
      <p className="text-xs text-secondary">{hint}</p>
    </label>
  );
}

function LaunchTextInput({
  label,
  value,
  hint,
  placeholder,
  onChange,
}: {
  label: string;
  value: string;
  hint: string;
  placeholder?: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="space-y-2">
      <span className="text-sm font-semibold text-foreground">{label}</span>
      <input
        value={value}
        placeholder={placeholder}
        onChange={event => onChange(event.target.value)}
        className="h-10 w-full rounded-lg border border-border bg-surface-input px-3 font-mono text-sm text-foreground outline-none transition-colors placeholder:text-secondary focus:border-primary/60"
      />
      <p className="text-xs text-secondary">{hint}</p>
    </label>
  );
}

function LaunchChoiceGrid({
  value,
  options,
  onChange,
}: {
  value: string;
  options: Array<{ value: string; label: string; description: string }>;
  onChange: (value: string) => void;
}) {
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {options.map(option => {
        const selected = value === option.value;
        return (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            className={`rounded-lg border px-3 py-2 text-left transition-colors ${
              selected
                ? 'border-primary bg-primary/10 text-foreground'
                : 'border-border bg-background/70 text-foreground hover:border-primary/50 hover:bg-surface-raised'
            }`}
          >
            <span className="block text-sm font-semibold">{option.label}</span>
            <span className="mt-1 block text-xs leading-5 text-secondary">
              {option.description}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function LaunchChoiceSelect({
  label,
  value,
  options,
  hint,
  onChange,
}: {
  label: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  hint: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="space-y-2">
      <span className="text-sm font-semibold text-foreground">{label}</span>
      <select
        value={value}
        onChange={event => onChange(event.target.value)}
        className="h-10 w-full rounded-lg border border-border bg-surface-input px-3 text-sm text-foreground outline-none transition-colors focus:border-primary/60"
      >
        {options.map(option => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <p className="text-xs text-secondary">{hint}</p>
    </label>
  );
}

function LaunchSelect({
  label,
  value,
  hint,
  onChange,
}: {
  label: string;
  value: string;
  hint: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="space-y-2">
      <span className="text-sm font-semibold text-foreground">{label}</span>
      <select
        value={value}
        onChange={event => onChange(event.target.value)}
        className="h-10 w-full rounded-lg border border-border bg-surface-input px-3 text-sm text-foreground outline-none transition-colors focus:border-primary/60"
      >
        <option value="">{i18nService.t('localInferenceLaunchBooleanDefault')}</option>
        <option value="true">{i18nService.t('localInferenceLaunchBooleanEnabled')}</option>
        <option value="false">{i18nService.t('localInferenceLaunchBooleanDisabled')}</option>
      </select>
      <p className="text-xs text-secondary">{hint}</p>
    </label>
  );
}

function InferencePanel({
  isRunning,
  selectedModel,
  selectedRunningModel,
  runnableModels,
  systemPrompt,
  prompt,
  options,
  messages,
  streamingText,
  streamingThinking,
  sending,
  cancelling,
  onModelChange,
  onSystemPromptChange,
  onPromptChange,
  onOptionsChange,
  onSavePreset,
  onSend,
  onStop,
  onOpenModels,
}: {
  isRunning: boolean;
  loading: boolean;
  selectedModel: string;
  selectedRunningModel?: OllamaRunningModel;
  runnableModels: OllamaModel[];
  systemPrompt: string;
  prompt: string;
  options: InferenceOptions;
  messages: InferenceMessage[];
  streamingText: string;
  streamingThinking: string;
  sending: boolean;
  cancelling: boolean;
  onModelChange: (value: string) => void;
  onSystemPromptChange: (value: string) => void;
  onPromptChange: (value: string) => void;
  onOptionsChange: (value: InferenceOptions) => void;
  onSavePreset: () => void;
  onSend: () => void;
  onStop: () => void;
  onOpenModels: () => void;
}) {
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const chatScrollRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLDivElement>(null);
  const latestTurnStartRef = useRef<HTMLDivElement>(null);
  const latestTurnScrollTargetIndexRef = useRef<number | null>(null);
  const pendingLatestTurnAlignRef = useRef(false);
  const lockLatestTurnAnchorRef = useRef(false);
  const userDetachedFromBottomRef = useRef(false);
  const autoFollowStreamRef = useRef(true);
  const programmaticScrollRef = useRef<{ mode: 'align' | 'bottom'; until: number } | null>(null);
  const composingRef = useRef(false);
  const [configCollapsed, setConfigCollapsed] = useState(false);
  const [configPage, setConfigPage] = useState<InferenceOptionGroup>('basic');
  const [composerHeight, setComposerHeight] = useState(CHAT_COMPOSER_MIN_PADDING);
  const [chatViewportHeight, setChatViewportHeight] = useState(0);
  const [latestTurnTailSpacer, setLatestTurnTailSpacer] = useState(0);
  const [showJumpToBottom, setShowJumpToBottom] = useState(false);
  const requestPreview = useMemo(
    () =>
      buildRequestPreview({
        model: selectedModel,
        systemPrompt: buildEffectiveSystemPrompt(
          systemPrompt,
          options.direct_answer_mode === 'enabled',
        ),
        options: normalizeOptions(options),
      }),
    [options, selectedModel, systemPrompt],
  );
  const updateOption = (
    key: keyof InferenceOptions,
    value: InferenceOptions[keyof InferenceOptions],
  ) => {
    onOptionsChange({
      ...options,
      [key]: value,
    });
  };
  const visibleOptionFields = INFERENCE_OPTION_FIELDS.filter(field => field.group === configPage);
  const chatBottomPadding = getChatBottomPadding(composerHeight);
  const jumpToBottomOffset = getJumpToBottomOffset(composerHeight);
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
  const syncScrollIndicators = useCallback(() => {
    const element = chatScrollRef.current;
    if (!element) return;
    const effectiveScrollHeight = getEffectiveChatScrollHeight(
      element.scrollHeight,
      latestTurnTailSpacer,
    );
    const nearBottom = isScrollNearBottom({
      scrollTop: element.scrollTop,
      clientHeight: element.clientHeight,
      scrollHeight: effectiveScrollHeight,
    });
    const hiddenBelow = hasHiddenContentBelow({
      scrollTop: element.scrollTop,
      clientHeight: element.clientHeight,
      scrollHeight: effectiveScrollHeight,
    });
    const activeProgrammaticScroll =
      programmaticScrollRef.current &&
      window.performance.now() <= programmaticScrollRef.current.until
        ? programmaticScrollRef.current
        : null;
    if (!activeProgrammaticScroll) {
      programmaticScrollRef.current = null;
      userDetachedFromBottomRef.current = !nearBottom;
      autoFollowStreamRef.current = lockLatestTurnAnchorRef.current ? false : nearBottom;
    } else if (activeProgrammaticScroll.mode === 'bottom') {
      userDetachedFromBottomRef.current = false;
      autoFollowStreamRef.current = true;
    } else {
      autoFollowStreamRef.current = false;
    }
    setShowJumpToBottom(hiddenBelow);
  }, [latestTurnTailSpacer]);
  const submitPrompt = () => {
    latestTurnScrollTargetIndexRef.current = getNewAssistantScrollTargetIndex(messages.length);
    pendingLatestTurnAlignRef.current = true;
    lockLatestTurnAnchorRef.current = true;
    userDetachedFromBottomRef.current = false;
    autoFollowStreamRef.current = false;
    onSend();
  };
  const scrollToBottom = useCallback(
    (behavior: ScrollBehavior = 'smooth') => {
      const element = chatScrollRef.current;
      if (!element) return;
      markProgrammaticScroll('bottom', behavior);
      pendingLatestTurnAlignRef.current = false;
      lockLatestTurnAnchorRef.current = false;
      userDetachedFromBottomRef.current = false;
      autoFollowStreamRef.current = true;
      element.scrollTo({
        top: Math.max(
          0,
          getEffectiveChatScrollHeight(element.scrollHeight, latestTurnTailSpacer) -
            element.clientHeight,
        ),
        behavior,
      });
    },
    [latestTurnTailSpacer, markProgrammaticScroll],
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
      container.scrollTo({ top, behavior });
    },
    [markProgrammaticScroll],
  );
  const measureComposerHeight = useCallback(() => {
    const nextHeight = composerRef.current?.offsetHeight ?? 0;
    if (nextHeight <= 0) return;
    setComposerHeight(current => (current === nextHeight ? current : nextHeight));
  }, []);
  const measureChatViewportHeight = useCallback(() => {
    const nextHeight = chatScrollRef.current?.clientHeight ?? 0;
    if (nextHeight <= 0) return;
    setChatViewportHeight(current => (current === nextHeight ? current : nextHeight));
  }, []);
  const measureLatestTurnTailSpacer = useCallback(() => {
    const container = chatScrollRef.current;
    const latestTurnStart = latestTurnStartRef.current;
    if (!container || !latestTurnStart || messages.length === 0) {
      setLatestTurnTailSpacer(current => (current === 0 ? current : 0));
      return;
    }
    const effectiveScrollHeight = getEffectiveChatScrollHeight(
      container.scrollHeight,
      latestTurnTailSpacer,
    );
    const targetScrollTop = getAssistantScrollTop({
      containerScrollTop: container.scrollTop,
      containerTop: container.getBoundingClientRect().top,
      targetTop: latestTurnStart.getBoundingClientRect().top,
    });
    const contentHeightFromLatestTurn = getLatestTurnContentHeight(
      effectiveScrollHeight,
      targetScrollTop,
    );
    const nextSpacer = getLatestTurnTailSpacer(chatViewportHeight, contentHeightFromLatestTurn);
    setLatestTurnTailSpacer(current => (current === nextSpacer ? current : nextSpacer));
  }, [chatViewportHeight, latestTurnTailSpacer, messages.length]);

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
    const frame = window.requestAnimationFrame(() => {
      measureLatestTurnTailSpacer();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [measureLatestTurnTailSpacer, messages.length, sending, streamingText, streamingThinking]);

  useEffect(() => {
    if (!sending) return;
    if (pendingLatestTurnAlignRef.current) return;
    if (!lockLatestTurnAnchorRef.current) return;
    const frame = window.requestAnimationFrame(() => {
      scrollLatestTurnStartIntoView('auto');
    });
    return () => window.cancelAnimationFrame(frame);
  }, [scrollLatestTurnStartIntoView, sending, streamingText, streamingThinking]);

  useEffect(() => {
    if (!sending || pendingLatestTurnAlignRef.current || !autoFollowStreamRef.current) return;
    const frame = window.requestAnimationFrame(() => {
      scrollToBottom('auto');
    });
    return () => window.cancelAnimationFrame(frame);
  }, [messages.length, scrollToBottom, sending, streamingText, streamingThinking]);

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
    programmaticScrollRef.current = null;
  }, [sending]);

  useEffect(() => {
    measureComposerHeight();
    const composerElement = composerRef.current;
    if (!composerElement) return;
    const resizeObserver =
      typeof window.ResizeObserver !== 'undefined'
        ? new window.ResizeObserver(() => {
            measureComposerHeight();
          })
        : null;
    resizeObserver?.observe(composerElement);
    window.addEventListener('resize', measureComposerHeight);
    return () => {
      resizeObserver?.disconnect();
      window.removeEventListener('resize', measureComposerHeight);
    };
  }, [measureComposerHeight]);

  useEffect(() => {
    measureChatViewportHeight();
    const chatElement = chatScrollRef.current;
    if (!chatElement) return;
    const resizeObserver =
      typeof window.ResizeObserver !== 'undefined'
        ? new window.ResizeObserver(() => {
            measureChatViewportHeight();
          })
        : null;
    resizeObserver?.observe(chatElement);
    window.addEventListener('resize', measureChatViewportHeight);
    return () => {
      resizeObserver?.disconnect();
      window.removeEventListener('resize', measureChatViewportHeight);
    };
  }, [measureChatViewportHeight]);

  useEffect(() => {
    if (sending || cancelling || !selectedModel) return;
    const frame = window.requestAnimationFrame(() => {
      promptRef.current?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [cancelling, selectedModel, sending]);

  if (!isRunning || runnableModels.length === 0) {
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
    <div className="h-full min-h-0 rounded-[24px] border border-border bg-surface shadow-card overflow-hidden">
      <div
        className={`grid h-full min-h-0 ${configCollapsed ? 'lg:grid-cols-[56px_minmax(0,1fr)]' : 'lg:grid-cols-[minmax(280px,320px)_minmax(0,1fr)]'}`}
      >
        <aside
          className={`min-h-0 overflow-hidden bg-surface ${configCollapsed ? 'border-r border-border-subtle' : 'border-r border-border-subtle'}`}
        >
          {configCollapsed ? (
            <div className="flex h-full flex-col items-center gap-3 py-4">
              <button
                type="button"
                onClick={() => setConfigCollapsed(false)}
                className="inline-flex h-9 w-9 items-center justify-center rounded-xl text-secondary transition-colors hover:bg-surface-raised hover:text-foreground"
                aria-label={i18nService.t('localInferenceConfigExpand')}
                title={i18nService.t('localInferenceConfigExpand')}
              >
                <ChevronRightIcon className="h-4 w-4" />
              </button>
            </div>
          ) : (
            <div className="flex h-full min-h-0 flex-col">
              <div className="flex shrink-0 items-center justify-between border-b border-border-subtle px-4 py-4">
                <div>
                  <h2 className="text-sm font-semibold text-foreground">
                    {i18nService.t('localInferenceConfigTitle')}
                  </h2>
                  <p className="mt-0.5 text-[11px] text-secondary">{selectedModel}</p>
                </div>
                <button
                  type="button"
                  onClick={() => setConfigCollapsed(true)}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-secondary transition-colors hover:bg-surface-raised hover:text-foreground"
                  aria-label={i18nService.t('localInferenceConfigCollapse')}
                  title={i18nService.t('localInferenceConfigCollapse')}
                >
                  <ChevronLeftIcon className="h-4 w-4" />
                </button>
              </div>
              <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4">
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-secondary">
                    {i18nService.t('localInferenceModel')}
                  </label>
                  <select
                    value={selectedModel}
                    onChange={event => onModelChange(event.target.value)}
                    className="h-10 w-full rounded-xl border border-border bg-surface-input px-3 text-sm text-foreground outline-none transition-colors focus:border-primary/60"
                  >
                    {runnableModels.map(model => (
                      <option key={model.name} value={model.name}>
                        {model.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-secondary">
                    {i18nService.t('localInferenceSystemPrompt')}
                  </label>
                  <textarea
                    value={systemPrompt}
                    onChange={event => onSystemPromptChange(event.target.value)}
                    className="min-h-24 w-full resize-y rounded-xl border border-border bg-surface-input px-3 py-2.5 text-sm text-foreground outline-none transition-colors focus:border-primary/60"
                  />
                </div>
                <div className="grid grid-cols-2 rounded-xl border border-border-subtle bg-surface-raised/60 p-1">
                  {(['basic', 'advanced'] as InferenceOptionGroup[]).map(page => (
                    <button
                      key={page}
                      type="button"
                      onClick={() => setConfigPage(page)}
                      className={`h-8 rounded-lg px-2 text-xs transition-colors ${
                        configPage === page
                          ? 'bg-surface text-foreground shadow-sm'
                          : 'text-secondary hover:text-foreground'
                      }`}
                    >
                      {i18nService.t(
                        page === 'basic'
                          ? 'localInferenceConfigBasic'
                          : 'localInferenceConfigAdvanced',
                      )}
                    </button>
                  ))}
                </div>
                <div className="space-y-3">
                  {visibleOptionFields.map(field => (
                    <InferenceOptionControl
                      key={field.key}
                      field={field}
                      value={options[field.key]}
                      onChange={value => updateOption(field.key, value)}
                    />
                  ))}
                </div>
                {configPage === 'advanced' && (
                  <details className="rounded-xl border border-border-subtle bg-surface-raised/40 px-3 py-2.5 text-xs text-secondary">
                    <summary className="cursor-pointer select-none text-foreground">
                      {i18nService.t('localInferenceRequestPreview')}
                    </summary>
                    <pre className="mt-2 max-h-52 overflow-auto rounded-lg border border-border-subtle bg-background px-2.5 py-2 font-mono text-[11px] leading-4 text-foreground">
                      {JSON.stringify(requestPreview, null, 2)}
                    </pre>
                  </details>
                )}
              </div>
              <div className="shrink-0 border-t border-border-subtle p-4">
                <button
                  type="button"
                  onClick={onSavePreset}
                  className="h-9 w-full rounded-xl bg-primary text-sm font-medium text-white transition-colors hover:bg-primary-hover"
                >
                  {i18nService.t('localInferenceSavePreset')}
                </button>
              </div>
            </div>
          )}
        </aside>

        <main className="relative flex min-h-0 flex-col overflow-hidden bg-background">
          <div className="shrink-0 flex items-center justify-between border-b border-border-subtle px-5 py-4">
            <div className="min-w-0 flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-surface-raised text-secondary">
                <CpuChipIcon className="h-4 w-4" />
              </div>
              <div className="min-w-0">
                <h2 className="truncate text-sm font-medium text-foreground">{selectedModel}</h2>
              </div>
            </div>
            {selectedRunningModel?.trained_context_length && (
              <Badge>
                {i18nService.t('localInferenceTrainedContext')}:{' '}
                {selectedRunningModel.trained_context_length}
              </Badge>
            )}
            {selectedRunningModel?.runtime_context_length && (
              <Badge tone="success">
                {i18nService.t('localInferenceRuntimeContext')}:{' '}
                {selectedRunningModel.runtime_context_length}
              </Badge>
            )}
          </div>
          <div
            ref={chatScrollRef}
            className="local-inference-chat-scroll min-h-0 flex-1 overflow-y-auto px-4 pt-0 [scrollbar-gutter:stable_both-edges]"
            onScroll={syncScrollIndicators}
            style={{
              paddingBottom: `${chatBottomPadding}px`,
              scrollbarWidth: 'thin',
              scrollbarColor: 'var(--lobster-scroll-thumb) transparent',
            }}
          >
            {messages.length === 0 && !sending && (
              <div className="flex min-h-[320px] flex-col items-center justify-center gap-4 text-center">
                <div className="flex h-16 w-16 items-center justify-center rounded-2xl border border-border-subtle bg-surface-raised text-secondary">
                  <CpuChipIcon className="h-8 w-8" />
                </div>
                <div className="space-y-1">
                  <p className="text-sm font-medium text-foreground">
                    {i18nService.t('localInferenceEmptyChat')}
                  </p>
                  <p className="text-xs text-secondary">{selectedModel}</p>
                </div>
              </div>
            )}
            <div className="mx-auto flex w-full max-w-3xl flex-col gap-5">
              {messages.map((message, index) => {
                const isLatestTurnStart =
                  message.role === 'user' &&
                  (sending
                    ? index === messages.length - 1
                    : index === findLatestUserMessageIndex(messages));
                return (
                  <div key={index} ref={isLatestTurnStart ? latestTurnStartRef : undefined}>
                    <ChatBubble message={message} />
                  </div>
                );
              })}
              {sending && (
                <div>
                  <ChatBubble
                    message={buildStreamingAssistantMessage({
                      content: streamingText,
                      thinking: streamingThinking,
                    })}
                    streaming
                  />
                </div>
              )}
              {latestTurnTailSpacer > 0 && (
                <div
                  aria-hidden="true"
                  className="shrink-0"
                  style={{ height: latestTurnTailSpacer }}
                />
              )}
            </div>
          </div>
          {showJumpToBottom && (
            <div
              className="pointer-events-none absolute inset-x-0 flex justify-center px-4"
              style={{ bottom: `${jumpToBottomOffset}px` }}
            >
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
          <div ref={composerRef} className="absolute inset-x-0 bottom-0 px-4 pb-4">
            <div className="mx-auto max-w-[44rem] rounded-[20px] border border-border bg-surface-overlay p-1.5 shadow-card backdrop-blur">
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
                disabled={sending}
                className="min-h-14 w-full resize-none rounded-2xl border-0 bg-transparent px-3 py-1.5 text-sm text-foreground outline-none placeholder:text-secondary"
                placeholder={i18nService.t('localInferencePromptPlaceholder')}
              />
              <div className="flex items-center justify-between gap-2 px-1 pb-1">
                <div className="min-w-0" />
                <button
                  type="button"
                  onClick={sending ? onStop : submitPrompt}
                  disabled={!selectedModel || cancelling || (!prompt.trim() && !sending)}
                  className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary text-white transition-colors hover:bg-primary-hover disabled:opacity-40"
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
        </main>
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
  const thinkingSummary =
    streaming && !hasVisibleContent
      ? i18nService.t('localInferenceThinkingInProgress')
      : i18nService.t('localInferenceThinking');
  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`text-sm leading-7 ${
          isUser
            ? 'w-fit max-w-[86%] rounded-2xl border border-border-subtle bg-surface-raised px-4 py-2.5 text-foreground'
            : 'w-full text-foreground'
        }`}
      >
        {!isUser && hasThinking && (
          <details
            className="mb-3 rounded-2xl border border-border-subtle bg-surface-raised/55 px-3 py-2 text-sm text-foreground/90"
            open={streaming && !hasVisibleContent}
          >
            <summary className="cursor-pointer select-none text-sm font-medium text-foreground">
              {thinkingSummary}
            </summary>
            <div className="mt-2 whitespace-pre-wrap break-words text-sm leading-7 text-secondary">
              {message.thinking}
              {streaming && !hasVisibleContent && (
                <span className="ml-0.5 inline-block h-4 w-2 animate-pulse bg-foreground/45 align-text-bottom" />
              )}
            </div>
          </details>
        )}
        {message.waiting && <WaitingDots />}
        {isUser ? (
          <div className="whitespace-pre-wrap break-words">{message.content}</div>
        ) : message.content.trim() ? (
          <MarkdownContent content={message.content} />
        ) : null}
        {streaming && !message.waiting && hasVisibleContent && (
          <span className="ml-0.5 inline-block h-4 w-2 animate-pulse bg-foreground/45 align-text-bottom" />
        )}
        {hasMetricsSummary(message.metrics) && (
          <p className="mt-2 text-xs text-secondary">{formatMetricsSummary(message.metrics)}</p>
        )}
      </div>
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

function InferenceOptionControl({
  field,
  value,
  disabled = false,
  onChange,
}: {
  field: InferenceOptionField;
  value: InferenceOptions[keyof InferenceOptions];
  disabled?: boolean;
  onChange: (value: InferenceOptions[keyof InferenceOptions]) => void;
}) {
  const label = i18nService.t(field.labelKey);
  const hint = i18nService.t(field.hintKey);
  const showParamName = field.showParamName !== false;
  if (field.type === 'range') {
    return (
      <RangeControl
        label={label}
        paramName={field.paramName}
        min={field.min ?? 0}
        max={field.max ?? 1}
        step={field.step ?? 1}
        value={typeof value === 'number' ? value : 0}
        hint={hint}
        disabled={disabled}
        onChange={onChange}
      />
    );
  }
  if (field.type === 'select') {
    const selectOptions = getInferenceOptionSelectOptions(field.key);
    if (field.key === 'direct_answer_mode') {
      return (
        <div className="space-y-1.5">
          <OptionLabel label={label} paramName={showParamName ? field.paramName : undefined} />
          <div className="grid grid-cols-2 rounded-xl border border-border bg-surface-input p-1">
            {selectOptions.map(option => {
              const selected = String(value) === option.value;
              return (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => onChange(option.value)}
                  disabled={disabled}
                  aria-pressed={selected}
                  className={`h-9 rounded-lg px-3 text-sm transition-colors ${
                    selected
                      ? 'bg-surface text-foreground shadow-sm'
                      : 'text-secondary hover:text-foreground'
                  } disabled:opacity-50`}
                >
                  {option.label}
                </button>
              );
            })}
          </div>
          <p className="text-[11px] leading-4 text-secondary">{hint}</p>
        </div>
      );
    }
    return (
      <label className="space-y-1.5">
        <OptionLabel label={label} paramName={showParamName ? field.paramName : undefined} />
        <select
          value={String(value)}
          onChange={event => onChange(event.target.value)}
          disabled={disabled}
          className="h-9 w-full rounded-xl border border-border bg-surface-input px-3 text-sm text-foreground outline-none transition-colors focus:border-primary/60 disabled:opacity-50"
        >
          {getInferenceOptionSelectOptions(field.key).map(option => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <p className="text-[11px] leading-4 text-secondary">{hint}</p>
      </label>
    );
  }
  return (
    <label className="space-y-1.5">
      <OptionLabel label={label} paramName={field.paramName} />
      <input
        type={field.type === 'number' ? 'number' : 'text'}
        value={String(value)}
        onChange={event =>
          onChange(field.type === 'number' ? Number(event.target.value) : event.target.value)
        }
        disabled={disabled}
        className="h-9 w-full rounded-xl border border-border bg-surface-input px-3 font-mono text-sm text-foreground outline-none transition-colors focus:border-primary/60 disabled:opacity-50"
      />
      <p className="text-[11px] leading-4 text-secondary">{hint}</p>
    </label>
  );
}

function RangeControl({
  label,
  paramName,
  min,
  max,
  step,
  value,
  hint,
  disabled = false,
  onChange,
}: {
  label: string;
  paramName: string;
  min: number;
  max: number;
  step: number;
  value: number;
  hint: string;
  disabled?: boolean;
  onChange: (value: number) => void;
}) {
  return (
    <div className="space-y-1.5">
      <div className="mb-1 flex items-center justify-between">
        <OptionLabel label={label} paramName={paramName} />
        <span className="font-mono text-xs text-secondary">{value}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={event => onChange(Number(event.target.value))}
        disabled={disabled}
        className="w-full accent-primary disabled:opacity-50"
      />
      <p className="text-[11px] leading-4 text-secondary">{hint}</p>
    </div>
  );
}

function OptionLabel({ label, paramName }: { label: string; paramName?: string }) {
  return (
    <span className="flex min-w-0 items-baseline gap-2">
      <span className="text-xs font-medium text-secondary">{label}</span>
      {paramName && <code className="truncate text-[11px] text-secondary/80">{paramName}</code>}
    </span>
  );
}

function getInferenceOptionSelectOptions(
  key: keyof InferenceOptions,
): Array<{ value: string; label: string }> {
  switch (key) {
    case 'direct_answer_mode':
      return [
        { value: 'disabled', label: i18nService.t('localInferenceDirectAnswerModeStandard') },
        { value: 'enabled', label: i18nService.t('localInferenceDirectAnswerModeReducedThinking') },
      ];
    case 'cache_prompt':
      return [
        { value: 'auto', label: i18nService.t('localInferenceOptionAuto') },
        { value: 'enabled', label: i18nService.t('localInferenceLaunchBooleanEnabled') },
        { value: 'disabled', label: i18nService.t('localInferenceLaunchBooleanDisabled') },
      ];
    default:
      return [];
  }
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

function EmptyState({ title, action }: { title: string; action?: React.ReactNode }) {
  return (
    <div className="flex min-h-[260px] flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border bg-surface px-4 py-8 text-center">
      <ServerStackIcon className="h-7 w-7 text-secondary" />
      <p className="text-sm font-medium text-secondary">{title}</p>
      {action}
    </div>
  );
}

function parseOptionalInteger(value: string): number | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (!/^\d+$/.test(trimmed)) return undefined;
  const parsed = Number.parseInt(trimmed, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseOptionalBoolean(value: string): boolean | undefined {
  if (value === 'true') return true;
  if (value === 'false') return false;
  return undefined;
}

function getLaunchContextLimitViolation(input: {
  requestedContextLength?: number;
  trainedContextLength?: number;
}) {
  return getLlamaCppLaunchContextLimitViolation(input);
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

function resolveAccelerationNumGpu(mode: string, customGpuLayers: string): number | undefined {
  switch (mode as LaunchAccelerationMode) {
    case 'cpu':
      return 0;
    case 'custom':
      return parseOptionalInteger(customGpuLayers);
    case 'auto':
    default:
      return undefined;
  }
}

function resolveLaunchServiceConfig(
  preset: string,
  customGpuDevices: string,
): Partial<OllamaServiceConfig> | null {
  switch (preset as LaunchGpuPreset) {
    case 'service-default':
      return null;
    case 'single-auto':
      return { device: '', splitMode: 'none' };
    case 'dual-gpu':
      return { device: '', splitMode: 'layer' };
    case 'custom': {
      const normalized = normalizeGpuDeviceList(customGpuDevices);
      return normalized ? { device: normalized, splitMode: 'none' } : null;
    }
    default:
      return null;
  }
}

function hasServiceConfigPatchChanged(
  current: OllamaServiceConfig,
  patch: Partial<OllamaServiceConfig>,
): boolean {
  if ('device' in patch && patch.device !== (current.device ?? '')) return true;
  if ('modelsMax' in patch && patch.modelsMax !== (current.modelsMax ?? '')) return true;
  if ('parallel' in patch && patch.parallel !== (current.parallel ?? '')) return true;
  if ('splitMode' in patch && patch.splitMode !== current.splitMode) return true;
  return false;
}

function normalizeGpuDeviceList(value: string): string {
  return value
    .split(',')
    .map(part => part.trim())
    .filter(part => /^[A-Za-z0-9_.:-]+$/.test(part) && !/^\d+$/.test(part))
    .join(',');
}

function formatCurrentGpuServiceConfig(config: OllamaServiceConfig): string {
  const device = config.device?.trim();
  const splitMode = config.splitMode?.trim() || i18nService.t('localInferenceLaunchDefault');
  return device
    ? `${device} · ${splitMode}`
    : `${i18nService.t('localInferenceLaunchGpuAutoVisible')} · ${splitMode}`;
}

function formatLaunchGpuPresetSummary(preset: string, customGpuDevices: string): string {
  const patch = resolveLaunchServiceConfig(preset, customGpuDevices);
  if (!patch) return i18nService.t('localInferenceLaunchGpuKeepService');
  const devices = patch.device?.trim() || i18nService.t('localInferenceLaunchGpuAutoVisible');
  return `${devices} · ${patch.splitMode ?? i18nService.t('localInferenceLaunchDefault')}`;
}

function serviceConfigToForm(config: OllamaServiceConfig): OllamaServiceConfigFormState {
  return {
    host: config.host ?? '',
    port: config.port ?? '',
    customExecutablePath: config.customExecutablePath ?? '',
    device: config.device ?? '',
    modelsMax: config.modelsMax ?? '',
    modelsAutoload: config.modelsAutoload === undefined ? '' : String(config.modelsAutoload),
    parallel: config.parallel ?? '',
    splitMode: config.splitMode ?? '',
    tensorSplit: config.tensorSplit ?? '',
    ctxSize: config.ctxSize ?? '',
    gpuLayers: config.gpuLayers ?? '',
    batchSize: config.batchSize ?? '',
    ubatchSize: config.ubatchSize ?? '',
    threads: config.threads ?? '',
    threadsBatch: config.threadsBatch ?? '',
    timeout: config.timeout ?? '',
    threadsHttp: config.threadsHttp ?? '',
    cachePrompt: config.cachePrompt === undefined ? '' : String(config.cachePrompt),
    cacheReuse: config.cacheReuse ?? '',
    cacheRam: config.cacheRam ?? '',
    flashAttn: config.flashAttn ?? '',
    mainGpu: config.mainGpu ?? '',
    mmap: config.noMmap === undefined ? '' : String(!config.noMmap),
    mlock: config.mlock === undefined ? '' : String(config.mlock),
    jinja: config.jinja ?? '',
    reasoning: config.reasoning ?? '',
    reasoningFormat: config.reasoningFormat ?? '',
    reasoningBudget: config.reasoningBudget ?? '',
  };
}

async function loadOllamaServiceConfig(): Promise<OllamaServiceConfig> {
  try {
    return await window.electron.llamacpp.getServiceConfig();
  } catch (error) {
    if (isMissingIpcHandlerError(error)) return {};
    throw error;
  }
}

async function saveOllamaServiceConfig(config: OllamaServiceConfig): Promise<OllamaServiceConfig> {
  try {
    return await window.electron.llamacpp.setServiceConfig(config);
  } catch (error) {
    if (isMissingIpcHandlerError(error)) {
      throw new Error(i18nService.t('localInferenceServiceConfigRestartAppRequired'));
    }
    throw error;
  }
}

function isMissingIpcHandlerError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes('No handler registered') && message.includes('llamacpp:service-config');
}

function suggestLaunchOptions(
  model: OllamaModel,
  snapshot: NvidiaSmiSnapshot | null,
  hardwareConcurrency?: number,
): SuggestedLaunchOptions {
  const logicalThreads = Math.max(2, Math.floor(hardwareConcurrency || 4));
  const parameterCount = resolveModelParameterCount(model);
  const modelSizeBytes = model.size ?? 0;
  const detectedVramMiB = getDetectedVramMiB(snapshot);
  const estimatedMemoryBytes =
    modelSizeBytes > 0
      ? modelSizeBytes * 1.35
      : parameterCount > 0
        ? parameterCount * 0.75
        : 4 * 1024 ** 3;
  const memoryGb = detectedVramMiB > 0 ? detectedVramMiB / 1024 : estimatedMemoryBytes / 1024 ** 3;
  const numCtx = memoryGb <= 3 ? 2048 : memoryGb <= 9 ? 4096 : 8192;
  const numBatch = memoryGb <= 3 ? 128 : memoryGb <= 9 ? 256 : 512;
  const numThread = Math.max(1, Math.min(logicalThreads - 2, 16));
  const numGpu =
    detectedVramMiB <= 0
      ? memoryGb <= 3
        ? 16
        : memoryGb <= 9
          ? 32
          : undefined
      : estimateGpuLayers(estimatedMemoryBytes, detectedVramMiB);
  const summaryKey =
    detectedVramMiB > 0
      ? 'localInferenceLaunchAutoAppliedWithGpu'
      : 'localInferenceLaunchAutoAppliedFallback';
  const summary = i18nService
    .t(summaryKey)
    .replace('{context}', numCtx.toLocaleString())
    .replace(
      '{gpuLayers}',
      numGpu === undefined ? i18nService.t('localInferenceLaunchDefault') : String(numGpu),
    )
    .replace('{threads}', String(numThread))
    .replace('{batch}', String(numBatch))
    .replace('{memory}', formatVramMiB(detectedVramMiB));

  return {
    numCtx,
    numBatch,
    numGpu,
    numThread,
    summary,
  };
}

function getDetectedVramMiB(snapshot: NvidiaSmiSnapshot | null): number {
  if (!snapshot?.available) return 0;
  return snapshot.gpus.reduce((total, gpu) => total + (gpu.memoryFreeMiB ?? gpu.memoryTotalMiB), 0);
}

function estimateGpuLayers(
  estimatedModelBytes: number,
  detectedVramMiB: number,
): number | undefined {
  if (detectedVramMiB <= 0) return undefined;
  const availableBytes = detectedVramMiB * 1024 ** 2 * 0.85;
  if (availableBytes <= estimatedModelBytes * 0.2) return 0;
  if (availableBytes >= estimatedModelBytes) return undefined;
  return Math.max(1, Math.min(64, Math.floor((availableBytes / estimatedModelBytes) * 40)));
}

function formatVramMiB(value: number): string {
  if (value <= 0) return i18nService.t('localInferenceLaunchDefault');
  if (value >= 1024) return `${(value / 1024).toFixed(1)} GB`;
  return `${value} MB`;
}

function resolveModelParameterCount(model: OllamaModel): number {
  const raw = model.details?.parameter_size ?? '';
  const match = raw.trim().match(/^(\d+(?:\.\d+)?)\s*([BM])$/i);
  if (!match) return 0;
  const amount = Number(match[1]);
  if (!Number.isFinite(amount)) return 0;
  return match[2].toLowerCase() === 'b' ? amount * 1_000_000_000 : amount * 1_000_000;
}

function isPullInProgress(progress?: Record<string, unknown>): boolean {
  if (!progress) return false;
  const status = readProgressStatus(progress);
  return !['success', 'done', 'cancelled', 'error', 'failed', 'needs-manual'].includes(status);
}

function formatPullProgress(progress: Record<string, unknown>): string {
  const status = readProgressStatus(progress);
  const error = typeof progress.error === 'string' ? progress.error : '';
  const completed = typeof progress.completed === 'number' ? progress.completed : undefined;
  const total = typeof progress.total === 'number' ? progress.total : undefined;
  const percent = typeof progress.percent === 'number' ? progress.percent : undefined;
  if (error) return `${status || 'error'}: ${error}`;
  if (completed !== undefined && total !== undefined && total > 0) {
    return `${humanizeInstallPhase(status)} · ${percent !== undefined ? `${percent}% · ` : ''}${formatBytes(completed)} / ${formatBytes(total)}`;
  }
  return humanizeInstallPhase(status) || i18nService.t('loading');
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
    case 'downloading':
      return i18nService.t('marketplaceInstallPulling');
    case 'downloading-progress':
      return i18nService.t('marketplaceInstallProgress');
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

function formatMetricsSummary(metrics: OllamaChatChunk): string {
  const promptTokens =
    readMetricNumber(metrics.usage, 'prompt_tokens') ??
    readMetricNumber(metrics.timings, 'prompt_n') ??
    metrics.prompt_eval_count;
  const completionTokens =
    readMetricNumber(metrics.usage, 'completion_tokens') ??
    readMetricNumber(metrics.timings, 'predicted_n') ??
    metrics.eval_count;
  const totalTokens =
    readMetricNumber(metrics.usage, 'total_tokens') ??
    (promptTokens !== undefined && completionTokens !== undefined
      ? promptTokens + completionTokens
      : undefined);
  const speedValue =
    readMetricNumber(metrics.timings, 'predicted_per_second') ?? metrics.predicted_per_second;
  const speed = speedValue !== undefined ? speedValue.toFixed(1) : '-';
  return i18nService
    .t('localInferenceMetrics')
    .replace('{prompt}', promptTokens === undefined ? '-' : String(promptTokens))
    .replace('{completion}', completionTokens === undefined ? '-' : String(completionTokens))
    .replace('{total}', totalTokens === undefined ? '-' : String(totalTokens))
    .replace('{speed}', speed);
}

function hasMetricsSummary(
  metrics: OllamaChatChunk | null | undefined,
): metrics is OllamaChatChunk {
  if (!metrics) return false;
  return (
    readMetricNumber(metrics.usage, 'completion_tokens') !== undefined ||
    readMetricNumber(metrics.usage, 'prompt_tokens') !== undefined ||
    readMetricNumber(metrics.usage, 'total_tokens') !== undefined ||
    readMetricNumber(metrics.timings, 'predicted_n') !== undefined ||
    readMetricNumber(metrics.timings, 'predicted_per_second') !== undefined ||
    metrics.prompt_eval_count !== undefined ||
    metrics.eval_count !== undefined ||
    metrics.predicted_per_second !== undefined
  );
}

function readMetricNumber(source: unknown, key: string): number | undefined {
  if (!source || typeof source !== 'object') return undefined;
  const value = (source as Record<string, unknown>)[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
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

function getChatBottomPadding(composerHeight: number): number {
  return Math.max(CHAT_COMPOSER_MIN_PADDING, composerHeight + CHAT_COMPOSER_PADDING_GAP);
}

function getJumpToBottomOffset(composerHeight: number): number {
  return Math.max(CHAT_JUMP_TO_BOTTOM_MIN_OFFSET, composerHeight + CHAT_JUMP_TO_BOTTOM_GAP);
}

function getLatestTurnContentHeight(scrollHeight: number, latestTurnTop: number): number {
  return Math.max(0, scrollHeight - latestTurnTop);
}

function getLatestTurnTailSpacer(viewportHeight: number, latestTurnContentHeight: number): number {
  if (viewportHeight <= 0) return 0;
  return Math.max(0, viewportHeight - latestTurnContentHeight);
}

function getEffectiveChatScrollHeight(scrollHeight: number, tailSpacer: number): number {
  return Math.max(0, scrollHeight - tailSpacer);
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

function buildEffectiveSystemPrompt(
  systemPrompt: string,
  directAnswerModeEnabled: boolean,
): string {
  const trimmed = systemPrompt.trim();
  if (!directAnswerModeEnabled) return trimmed;
  return [trimmed, DIRECT_ANSWER_SYSTEM_HINT].filter(Boolean).join('\n\n');
}

function buildRequestPreview({
  model,
  systemPrompt,
  options,
}: RequestPreviewInput): Record<string, unknown> {
  const preview: Record<string, unknown> = {
    model,
    messages: systemPrompt.trim() ? [{ role: 'system', content: systemPrompt.trim() }] : [],
  };
  for (const key of ['max_tokens'] as const) {
    if (Object.prototype.hasOwnProperty.call(options, key)) {
      preview[key] = options[key];
    }
  }
  return preview;
}

function MarketplacePanel({
  loading,
  models,
  marketplaceLoading,
  marketplaceError,
  activePullName,
  activePullProgress,
  pulling,
  query,
  task,
  size,
  installedModelPathMap,
  installProgress,
  onQueryChange,
  onTaskChange,
  onSizeChange,
  onSearch,
  onInstall,
  onCancelPull,
}: {
  loading: boolean;
  models: MarketplaceModel[];
  marketplaceLoading: boolean;
  marketplaceError: string | null;
  activePullName: string | null;
  activePullProgress?: LlamaCppInstallProgress;
  pulling: boolean;
  query: string;
  task: string;
  size: string;
  installedModelPathMap: Map<string, string>;
  installProgress: InstallProgressState;
  onQueryChange: (v: string) => void;
  onTaskChange: (v: string) => void;
  onSizeChange: (v: string) => void;
  onSearch: () => void;
  onInstall: (model: MarketplaceModel) => Promise<void>;
  onCancelPull: () => void;
}) {
  const [installingModel, setInstallingModel] = useState<string | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [pageSize, setPageSize] = useState(estimateMarketplacePageSize());
  const [page, setPage] = useState(1);
  const hasActiveFilters = Boolean(query.trim()) || task !== 'all' || size !== 'all';
  const featuredModels = useMemo(() => models.filter(model => model.isFeatured), [models]);
  const pageCount = Math.max(1, Math.ceil(models.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const pageStart = (currentPage - 1) * pageSize;
  const visibleModels = useMemo(
    () => models.slice(pageStart, pageStart + pageSize),
    [models, pageStart, pageSize],
  );

  useEffect(() => {
    setPage(1);
  }, [models, query, task, size]);

  useEffect(() => {
    const updatePageSize = () => {
      setPageSize(estimateMarketplacePageSize(window.innerWidth, window.innerHeight));
    };
    updatePageSize();
    window.addEventListener('resize', updatePageSize);
    return () => window.removeEventListener('resize', updatePageSize);
  }, []);

  useEffect(() => {
    if (page > pageCount) {
      setPage(pageCount);
    }
  }, [page, pageCount]);

  const handleInstall = async (model: MarketplaceModel) => {
    setInstallingModel(model.id);
    try {
      await onInstall(model);
    } finally {
      setInstallingModel(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="space-y-3">
          <div>
            <h2 className="text-base font-semibold text-foreground">
              {i18nService.t('marketplaceTitle')}
            </h2>
            <p className="mt-1 text-xs text-secondary">{i18nService.t('marketplaceDescription')}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setFiltersOpen(value => !value)}
              className={`inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs transition-colors ${
                filtersOpen || hasActiveFilters
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'border-border text-secondary hover:bg-surface-raised hover:text-foreground'
              }`}
            >
              {i18nService.t('marketplaceFilterButton')}
              <ChevronDownIcon
                className={`h-3.5 w-3.5 transition-transform ${filtersOpen ? 'rotate-180' : ''}`}
              />
            </button>
            {task !== 'all' && (
              <FilterKeywordChip
                label={`${i18nService.t('marketplaceTaskFilterLabel')}: ${taskFilterLabel(task)}`}
                onRemove={() => onTaskChange('all')}
              />
            )}
            {size !== 'all' && (
              <FilterKeywordChip
                label={`${i18nService.t('marketplaceSizeFilterLabel')}: ${sizeFilterLabel(size)}`}
                onRemove={() => onSizeChange('all')}
              />
            )}
            {hasActiveFilters && (
              <button
                type="button"
                onClick={() => {
                  onQueryChange('');
                  onTaskChange('all');
                  onSizeChange('all');
                  setFiltersOpen(false);
                }}
                className="inline-flex h-8 items-center rounded-full border border-border px-3 text-xs text-foreground/80 transition-colors hover:bg-surface-raised"
              >
                {i18nService.t('marketplaceFilterReset')}
              </button>
            )}
          </div>
        </div>
        <form
          className="w-full lg:max-w-xl"
          onSubmit={e => {
            e.preventDefault();
            onSearch();
          }}
        >
          <div className="rounded-lg border border-border bg-surface p-3">
            <div className="flex gap-2">
              <div className="relative flex-1">
                <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-secondary" />
                <input
                  value={query}
                  onChange={e => onQueryChange(e.target.value)}
                  placeholder={i18nService.t('marketplaceSearchPlaceholder')}
                  className="h-9 w-full rounded-md border border-border bg-surface-input pl-8 pr-2 text-xs text-foreground placeholder:text-secondary focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>
              <button
                type="submit"
                className="inline-flex h-9 items-center gap-1 rounded-md bg-primary px-3 text-xs font-medium text-white transition-colors hover:bg-primary-hover disabled:opacity-60"
              >
                {i18nService.t('marketplaceSearch')}
              </button>
            </div>
            <p className="mt-2 text-[11px] text-secondary">
              {i18nService.t('marketplaceSearchHint')}
            </p>
          </div>
        </form>
      </div>

      {filtersOpen && (
        <div className="rounded-lg border border-border bg-surface p-3">
          <div className="flex flex-col gap-3 md:flex-row md:items-end">
            <div className="grid flex-1 gap-3 md:grid-cols-2">
              <CompactFilterSelect
                label={i18nService.t('marketplaceTaskFilterLabel')}
                value={task}
                onChange={onTaskChange}
                options={[
                  { value: 'all', label: i18nService.t('marketplaceFilterTaskAll') },
                  { value: 'chat', label: i18nService.t('marketplaceFilterTaskChat') },
                  { value: 'reasoning', label: i18nService.t('marketplaceFilterTaskReasoning') },
                  { value: 'code', label: i18nService.t('marketplaceFilterTaskCode') },
                  { value: 'embedding', label: i18nService.t('marketplaceFilterTaskEmbedding') },
                  { value: 'vision', label: i18nService.t('marketplaceFilterTaskVision') },
                ]}
              />
              <CompactFilterSelect
                label={i18nService.t('marketplaceSizeFilterLabel')}
                value={size}
                onChange={onSizeChange}
                options={[
                  { value: 'all', label: i18nService.t('marketplaceFilterSizeAll') },
                  { value: 'small', label: i18nService.t('marketplaceFilterSizeSmall') },
                  { value: 'desktop', label: i18nService.t('marketplaceFilterSizeDesktop') },
                  {
                    value: 'workstation',
                    label: i18nService.t('marketplaceFilterSizeWorkstation'),
                  },
                  { value: 'large', label: i18nService.t('marketplaceFilterSizeLarge') },
                ]}
              />
            </div>
            <button
              type="button"
              onClick={() => {
                onQueryChange('');
                onTaskChange('all');
                onSizeChange('all');
              }}
              className="inline-flex h-9 shrink-0 items-center justify-center rounded-lg border border-border px-3 text-xs text-foreground/80 transition-colors hover:bg-surface-raised md:min-w-20"
            >
              {i18nService.t('marketplaceFilterReset')}
            </button>
          </div>
        </div>
      )}

      {marketplaceError && (
        <div className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/20 dark:text-red-300">
          {i18nService.t('marketplaceError')}: {marketplaceError}
        </div>
      )}

      {activePullName && activePullProgress && (
        <div className="rounded-lg border border-border bg-surface px-3 py-3">
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-secondary">
            <div className="min-w-0">
              <span className="font-mono text-foreground">{activePullName}</span>
              <span className="ml-2">{formatPullProgress(activePullProgress)}</span>
            </div>
            {pulling && (
              <button type="button" onClick={onCancelPull} className={smallOutlineButtonClass}>
                <StopIcon className="h-3.5 w-3.5" />
                {i18nService.t('localInferenceCancelPull')}
              </button>
            )}
          </div>
          <InstallProgressBar progress={activePullProgress} className="mt-2" />
        </div>
      )}

      {!hasActiveFilters && featuredModels.length > 0 && (
        <section className="space-y-2">
          <div className="flex items-center gap-2">
            <SparklesIcon className="h-4 w-4 text-primary" />
            <h3 className="text-sm font-semibold text-foreground">
              {i18nService.t('marketplaceFeaturedTitle')}
            </h3>
          </div>
          <p className="text-xs text-secondary">
            {i18nService.t('marketplaceFeaturedDescription')}
          </p>
        </section>
      )}

      {models.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-secondary">
          <span>
            {i18nService
              .t('marketplaceResultSummary')
              .replace('{shown}', String(visibleModels.length))
              .replace('{total}', String(models.length))}
          </span>
          <div className="flex items-center gap-3">
            <span>{i18nService.t('marketplaceDataSourceHint')}</span>
            <span>
              {i18nService
                .t('marketplacePageSummary')
                .replace('{page}', String(currentPage))
                .replace('{total}', String(pageCount))}
            </span>
          </div>
        </div>
      )}

      {marketplaceLoading ? (
        <div className="flex items-center justify-center py-12 text-sm text-secondary">
          <ArrowPathIcon className="mr-2 h-4 w-4 animate-spin" />
          {i18nService.t('loading')}
        </div>
      ) : models.length === 0 ? (
        <EmptyState title={i18nService.t('marketplaceNoModels')} />
      ) : (
        <>
          <div className="grid gap-3 md:grid-cols-2">
            {visibleModels.map(model => {
              const progress = installProgress[model.repoId];
              const installedModelName = model.installedPath
                ? installedModelPathMap.get(model.installedPath)
                : undefined;
              const installed = model.installed || Boolean(installedModelName);
              const installing = installingModel === model.id || isPullInProgress(progress);
              return (
                <div
                  key={model.id}
                  className="flex min-h-[200px] flex-col justify-between rounded-lg border border-border bg-card p-4 transition-colors hover:bg-surface-raised"
                >
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-sm font-semibold text-foreground">{model.repoId}</h3>
                      <span
                        className={`inline-flex h-5 items-center rounded-md px-1.5 text-[11px] font-medium ${
                          installed
                            ? 'bg-green-500/10 text-green-600 dark:text-green-400'
                            : 'bg-surface-raised text-secondary'
                        }`}
                      >
                        {installed ? i18nService.t('marketplaceInstalled') : model.recommendedTag}
                      </span>
                      <span className="inline-flex h-5 items-center rounded-md border border-border px-1.5 text-[11px] font-medium text-secondary">
                        {capabilityLabel(model.capability)}
                      </span>
                      {model.isFeatured && (
                        <span className="inline-flex h-5 items-center rounded-md border border-primary/30 bg-primary/10 px-1.5 text-[11px] font-medium text-primary">
                          {i18nService.t('marketplaceFeaturedBadge')}
                        </span>
                      )}
                    </div>
                    <p className="mt-2 text-xs leading-5 text-secondary">{model.description}</p>
                    <div className="mt-2 flex flex-wrap gap-1.5">
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
                    <div className="mt-3 space-y-1 text-[11px] text-secondary">
                      <div>
                        {i18nService.t('marketplaceRepoLabel')}:{' '}
                        <span className="font-mono text-foreground">{model.repoId}</span>
                      </div>
                      {model.filePath && (
                        <div>
                          {i18nService.t('marketplaceRecommendedFileLabel')}:{' '}
                          <span className="font-mono text-foreground">{model.filePath}</span>
                        </div>
                      )}
                      {model.installedPath && (
                        <div>
                          {i18nService.t('marketplaceInstalledPathLabel')}:{' '}
                          <span className="font-mono text-foreground">{model.installedPath}</span>
                        </div>
                      )}
                    </div>
                    {progress && (
                      <div className="mt-3 rounded-md bg-surface-raised px-2.5 py-2">
                        <div className="flex items-center justify-between gap-2 text-[11px] text-secondary">
                          <span>{formatPullProgress(progress)}</span>
                          {typeof progress.percent === 'number' && <span>{progress.percent}%</span>}
                        </div>
                        <InstallProgressBar progress={progress} className="mt-2" />
                      </div>
                    )}
                  </div>
                  <div className="mt-4 flex items-center justify-between gap-2">
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
                      {installed ? null : installing ? (
                        <button
                          type="button"
                          onClick={onCancelPull}
                          disabled={!pulling}
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
            <div className="flex items-center justify-center gap-2">
              <button
                type="button"
                onClick={() => setPage(value => Math.max(1, value - 1))}
                disabled={currentPage <= 1}
                className="inline-flex h-8 items-center rounded-md border border-border px-3 text-xs text-foreground/80 transition-colors hover:bg-surface-raised disabled:cursor-not-allowed disabled:opacity-50"
              >
                {i18nService.t('skillMarketplacePrevPage')}
              </button>
              <span className="text-xs text-secondary">
                {currentPage} / {pageCount}
              </span>
              <button
                type="button"
                onClick={() => setPage(value => Math.min(pageCount, value + 1))}
                disabled={currentPage >= pageCount}
                className="inline-flex h-8 items-center rounded-md border border-border px-3 text-xs text-foreground/80 transition-colors hover:bg-surface-raised disabled:cursor-not-allowed disabled:opacity-50"
              >
                {i18nService.t('skillMarketplaceNextPage')}
              </button>
            </div>
          )}
        </>
      )}
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

function taskFilterLabel(value: string): string {
  switch (value) {
    case 'chat':
      return i18nService.t('marketplaceFilterTaskChat');
    case 'reasoning':
      return i18nService.t('marketplaceFilterTaskReasoning');
    case 'code':
      return i18nService.t('marketplaceFilterTaskCode');
    case 'embedding':
      return i18nService.t('marketplaceFilterTaskEmbedding');
    case 'vision':
      return i18nService.t('marketplaceFilterTaskVision');
    default:
      return i18nService.t('marketplaceFilterTaskAll');
  }
}

function sizeFilterLabel(value: string): string {
  switch (value) {
    case 'small':
      return i18nService.t('marketplaceFilterSizeSmall');
    case 'desktop':
      return i18nService.t('marketplaceFilterSizeDesktop');
    case 'workstation':
      return i18nService.t('marketplaceFilterSizeWorkstation');
    case 'large':
      return i18nService.t('marketplaceFilterSizeLarge');
    default:
      return i18nService.t('marketplaceFilterSizeAll');
  }
}

function FilterKeywordChip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <button
      type="button"
      onClick={onRemove}
      className="inline-flex h-8 items-center gap-1 rounded-full border border-primary/30 bg-primary/10 px-3 text-xs text-primary transition-colors hover:bg-primary/15"
    >
      <span>{label}</span>
      <XMarkIcon className="h-3.5 w-3.5" />
    </button>
  );
}

function CompactFilterSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <label className="block space-y-1.5">
      <span className="text-[11px] font-medium text-secondary">{label}</span>
      <select
        value={value}
        onChange={event => onChange(event.target.value)}
        className="h-9 w-full rounded-lg border border-border bg-surface-input px-3 text-sm text-foreground outline-none transition-colors focus:border-primary/60"
      >
        {options.map(option => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function estimateMarketplacePageSize(width = 1280, height = 900): number {
  const columns = width >= 768 ? 2 : 1;
  const availableHeight = Math.max(320, height - MARKETPLACE_FILTER_PANEL_HEIGHT);
  const rows = Math.max(1, Math.floor(availableHeight / MARKETPLACE_CARD_MIN_HEIGHT));
  const pageSize = rows * columns;
  return Math.max(MARKETPLACE_MIN_PAGE_SIZE, Math.min(MARKETPLACE_MAX_PAGE_SIZE, pageSize));
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

function SparklesIcon({ className }: { className?: string }) {
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
        d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09ZM18.259 8.715 18 9.75l-.259-1.035a3.375 3.375 0 0 0-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 0 0 2.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 0 0 2.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 0 0-2.455 2.456ZM16.894 20.567 16.5 21.75l-.394-1.183a2.25 2.25 0 0 0-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 0 0 1.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 0 0 1.423 1.423l1.183.394-1.183.394a2.25 2.25 0 0 0-1.423 1.423Z"
      />
    </svg>
  );
}

export const __test__getServiceConfigFields = () =>
  SERVICE_CONFIG_FIELDS.map(field => ({ ...field }));
export const __test__getInferenceOptionFields = () =>
  INFERENCE_OPTION_FIELDS.map(field => ({ ...field }));
export const __test__estimateMarketplacePageSize = (width?: number, height?: number) =>
  estimateMarketplacePageSize(width, height);
export const __test__buildAssistantMessage = (input: BuildAssistantMessageInput) =>
  buildAssistantMessage(input);
export const __test__buildStreamingAssistantMessage = (
  input: Parameters<typeof buildStreamingAssistantMessage>[0],
) => buildStreamingAssistantMessage(input);
export const __test__getNewAssistantScrollTargetIndex = (historyLength: number) =>
  getNewAssistantScrollTargetIndex(historyLength);
export const __test__formatMetricsSummary = (metrics: OllamaChatChunk) =>
  formatMetricsSummary(metrics);
export const __test__buildRequestPreview = (input: RequestPreviewInput) =>
  buildRequestPreview(input);
export const __test__isScrollNearBottom = (input: Parameters<typeof isScrollNearBottom>[0]) =>
  isScrollNearBottom(input);
export const __test__hasHiddenContentBelow = (input: Parameters<typeof hasHiddenContentBelow>[0]) =>
  hasHiddenContentBelow(input);
export const __test__getAssistantScrollTop = (input: Parameters<typeof getAssistantScrollTop>[0]) =>
  getAssistantScrollTop(input);
export const __test__getChatBottomPadding = (composerHeight: number) =>
  getChatBottomPadding(composerHeight);
export const __test__getJumpToBottomOffset = (composerHeight: number) =>
  getJumpToBottomOffset(composerHeight);
export const __test__getLatestTurnContentHeight = (scrollHeight: number, latestTurnTop: number) =>
  getLatestTurnContentHeight(scrollHeight, latestTurnTop);
export const __test__getLatestTurnTailSpacer = (viewportHeight: number, bottomPadding: number) =>
  getLatestTurnTailSpacer(viewportHeight, bottomPadding);
export const __test__getEffectiveChatScrollHeight = (scrollHeight: number, tailSpacer: number) =>
  getEffectiveChatScrollHeight(scrollHeight, tailSpacer);
export const __test__findLatestUserMessageIndex = (messages: InferenceMessage[]) =>
  findLatestUserMessageIndex(messages);
export const __test__getLaunchContextLimitMessage = (input: {
  requestedContextLength?: number;
  trainedContextLength?: number;
}) => getLaunchContextLimitViolation(input);
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
export const __test__matchesRunningModelName = (
  modelName: string,
  models: OllamaRunningModel[],
) => models.some(model => model.name === modelName || model.model === modelName);

export default LocalInferenceView;
