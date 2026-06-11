import {
  AdjustmentsHorizontalIcon,
  ArrowDownTrayIcon,
  ArrowPathIcon,
  ArrowTopRightOnSquareIcon,
  BeakerIcon,
  CheckCircleIcon,
  CheckIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
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

import type { NvidiaSmiSnapshot } from '../../../shared/hardware';
import type {
  LlamaCppBackendInfo,
  LlamaCppBackendRef,
  LlamaCppChatChunk as OllamaChatChunk,
  LlamaCppChatPayload as OllamaChatPayload,
  LlamaCppInstallProgress,
  LlamaCppModel as OllamaModel,
  LlamaCppModelLaunchInput as OllamaModelLaunchInput,
  LlamaCppRunningModel as OllamaRunningModel,
  LlamaCppRuntimeListDevicesResult,
  LlamaCppServiceConfig as OllamaServiceConfig,
  LlamaCppStatusSnapshot as OllamaStatusSnapshot,
} from '../../../shared/llamacpp';
import {
  createLlamaCppStreamState as createOllamaStreamState,
  getLlamaCppAcceleratorDevices,
  getLlamaCppGpuDetectionState,
  getLlamaCppLaunchContextLimitViolation,
  getLlamaCppModelsMaxLimitViolation,
  LlamaCppGpuDetectionState,
  type LlamaCppStructuredServiceFieldError,
  type LlamaCppStructuredServiceFieldKey,
  reduceLlamaCppStreamChunk as reduceOllamaStreamChunk,
  validateLlamaCppStructuredServiceConfig,
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
  waiting?: boolean;
  metrics?: OllamaChatChunk | null;
  createdAt: number;
  reasoningDurationSeconds?: number;
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
};

type ServiceConfigGroup = 'service' | 'cache' | 'gpu' | 'compat' | 'request';
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
  sanitizedFields?: string[];
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
type RequestPreviewInput = {
  model: string;
  systemPrompt: string;
  options: Record<string, unknown>;
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
const OPENCLAW_MIN_CTX = 32000;
const LLAMACPP_RUNTIME_PROGRESS_KEY = '__llamacpp_runtime__';
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
const serviceActionButtonClass =
  'inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-xl border border-border bg-surface/80 px-3 text-sm font-medium text-foreground transition-colors hover:bg-surface-raised disabled:cursor-not-allowed disabled:opacity-50';
const serviceDangerButtonClass =
  'inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-xl border border-red-500/20 bg-red-500/10 px-3 text-sm font-medium text-red-600 transition-colors hover:bg-red-500/15 disabled:cursor-not-allowed disabled:opacity-50 dark:text-red-300';
const serviceRefreshButtonClass =
  'inline-flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-surface/70 text-secondary transition-colors hover:bg-surface-raised hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50';
const SERVICE_CONFIG_GROUPS: Array<{
  key: ServiceConfigGroup;
  titleKey: string;
  descriptionKey: string;
}> = [
  {
    key: 'service',
    titleKey: 'localInferenceServiceConfigGroupService',
    descriptionKey: 'localInferenceServiceConfigGroupServiceDescription',
  },
  {
    key: 'cache',
    titleKey: 'localInferenceServiceConfigGroupCache',
    descriptionKey: 'localInferenceServiceConfigGroupCacheDescription',
  },
  {
    key: 'gpu',
    titleKey: 'localInferenceServiceConfigGroupGpu',
    descriptionKey: 'localInferenceServiceConfigGroupGpuDescription',
  },
  {
    key: 'compat',
    titleKey: 'localInferenceServiceConfigGroupCompat',
    descriptionKey: 'localInferenceServiceConfigGroupCompatDescription',
  },
  {
    key: 'request',
    titleKey: 'localInferenceServiceConfigGroupRequest',
    descriptionKey: 'localInferenceServiceConfigGroupRequestDescription',
  },
];
const SERVICE_CONFIG_FIELDS: ServiceConfigField[] = [
  {
    key: 'modelsMax',
    labelKey: 'localInferenceServiceConfigModelsMaxLabel',
    paramName: 'models-max',
    group: 'service',
    type: 'input',
    placeholderKey: 'localInferenceLaunchDefault',
    hintKey: 'localInferenceServiceConfigModelsMaxHint',
    restartRequired: true,
  },
  {
    key: 'modelsAutoload',
    labelKey: 'localInferenceServiceConfigModelsAutoloadLabel',
    paramName: 'models-autoload',
    group: 'service',
    type: 'select',
    hintKey: 'localInferenceServiceConfigModelsAutoloadHint',
    restartRequired: true,
  },
  {
    key: 'device',
    labelKey: 'localInferenceServiceConfigDeviceLabel',
    paramName: 'device',
    group: 'gpu',
    type: 'input',
    placeholderKey: 'localInferenceLaunchDefault',
    hintKey: 'localInferenceServiceConfigDeviceHint',
    restartRequired: true,
  },
  {
    key: 'parallel',
    labelKey: 'localInferenceServiceConfigParallelLabel',
    paramName: 'parallel',
    group: 'request',
    type: 'input',
    placeholder: '1',
    hintKey: 'localInferenceServiceConfigParallelHint',
    restartRequired: true,
  },
  {
    key: 'timeout',
    labelKey: 'localInferenceServiceConfigTimeoutLabel',
    paramName: 'timeout',
    group: 'service',
    type: 'input',
    placeholder: '600',
    hintKey: 'localInferenceServiceConfigTimeoutHint',
    restartRequired: true,
  },
  {
    key: 'threadsHttp',
    labelKey: 'localInferenceServiceConfigThreadsHttpLabel',
    paramName: 'threads-http',
    group: 'request',
    type: 'input',
    placeholderKey: 'localInferenceLaunchDefault',
    hintKey: 'localInferenceServiceConfigThreadsHttpHint',
    restartRequired: true,
  },
  {
    key: 'cachePrompt',
    labelKey: 'localInferenceServiceConfigCachePromptLabel',
    paramName: 'cache-prompt',
    group: 'cache',
    type: 'select',
    hintKey: 'localInferenceServiceConfigCachePromptHint',
    restartRequired: true,
  },
  {
    key: 'cacheReuse',
    labelKey: 'localInferenceServiceConfigCacheReuseLabel',
    paramName: 'cache-reuse',
    group: 'cache',
    type: 'input',
    placeholder: '256',
    hintKey: 'localInferenceServiceConfigCacheReuseHint',
    restartRequired: true,
  },
  {
    key: 'cacheRam',
    labelKey: 'localInferenceServiceConfigCacheRamLabel',
    paramName: 'cache-ram',
    group: 'cache',
    type: 'input',
    placeholder: '8192',
    hintKey: 'localInferenceServiceConfigCacheRamHint',
    restartRequired: true,
  },
  {
    key: 'jinja',
    labelKey: 'localInferenceServiceConfigJinjaLabel',
    paramName: 'jinja',
    group: 'compat',
    type: 'select',
    hintKey: 'localInferenceServiceConfigJinjaHint',
    restartRequired: true,
  },
  {
    key: 'splitMode',
    labelKey: 'localInferenceServiceConfigSplitModeLabel',
    paramName: 'split-mode',
    group: 'gpu',
    type: 'select',
    hintKey: 'localInferenceServiceConfigSplitModeHint',
    restartRequired: true,
  },
  {
    key: 'tensorSplit',
    labelKey: 'localInferenceServiceConfigTensorSplitLabel',
    paramName: 'tensor-split',
    group: 'gpu',
    type: 'input',
    placeholder: '3,2',
    hintKey: 'localInferenceServiceConfigTensorSplitHint',
    restartRequired: true,
  },
  {
    key: 'mainGpu',
    labelKey: 'localInferenceServiceConfigMainGpuLabel',
    paramName: 'main-gpu',
    group: 'gpu',
    type: 'input',
    placeholder: '0',
    hintKey: 'localInferenceServiceConfigMainGpuHint',
    restartRequired: true,
  },
  {
    key: 'flashAttn',
    labelKey: 'localInferenceServiceConfigFlashAttnLabel',
    paramName: 'flash-attn',
    group: 'gpu',
    type: 'select',
    hintKey: 'localInferenceServiceConfigFlashAttnHint',
    restartRequired: true,
  },
  {
    key: 'mlock',
    labelKey: 'localInferenceServiceConfigMlockLabel',
    paramName: 'mlock',
    group: 'compat',
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
    key: 'reasoning_preference',
    labelKey: 'localInferenceReasoningPreferenceLabel',
    paramName: 'reasoning',
    group: 'basic',
    type: 'select',
    hintKey: 'localInferenceReasoningPreferenceHint',
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
  const [options, setOptions] = useState<InferenceOptions>(() => loadInferenceOptions());
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
  const runtimeInstallProgress = pullProgress[LLAMACPP_RUNTIME_PROGRESS_KEY];
  const pulling = isPullInProgress(activePullProgress);
  const [marketplaceModels, setMarketplaceModels] = useState<MarketplaceModel[]>([]);
  const [marketplaceLoading, setMarketplaceLoading] = useState(false);
  const [marketplaceError, setMarketplaceError] = useState<string | null>(null);
  const [marketplaceTotalCount, setMarketplaceTotalCount] = useState<number | null>(null);
  const [marketplaceQuery, setMarketplaceQuery] = useState('');
  const [marketplaceHasSearched, setMarketplaceHasSearched] = useState(false);
  const [launchTarget, setLaunchTarget] = useState<OllamaModel | null>(null);
  const [servicePopoverOpen, setServicePopoverOpen] = useState(false);
  const [serviceConfigDialogOpen, setServiceConfigDialogOpen] = useState(false);
  const [backendConfigDialogOpen, setBackendConfigDialogOpen] = useState(false);
  const [serviceConfig, setServiceConfig] = useState<OllamaServiceConfig>({});
  const [backendList, setBackendList] = useState<LlamaCppBackendInfo[]>([]);
  const [backendSelection, setBackendSelection] = useState<LlamaCppBackendRef | undefined>();
  const [recommendedBackend, setRecommendedBackend] = useState<LlamaCppBackendRef | undefined>();
  const [backendDevices, setBackendDevices] = useState<string | null>(null);
  const [backendError, setBackendError] = useState<string | null>(null);
  useI18nLanguage();
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

  const refreshBackends = useCallback(async () => {
    try {
      const result = await window.electron.llamacpp.listBackends();
      if (!result.success) {
        setBackendList([]);
        setBackendSelection(undefined);
        setRecommendedBackend(undefined);
        setBackendError(mapBackendErrorMessage(result.error));
        return result;
      }
      setBackendList(result.backends);
      setBackendSelection(result.selection);
      setRecommendedBackend(result.recommended);
      setBackendError(result.backends.length === 0 ? i18nService.t('localInferenceBackendListEmpty') : null);
      return result;
    } catch (error) {
      setBackendList([]);
      setBackendSelection(undefined);
      setRecommendedBackend(undefined);
      const message = error instanceof Error ? error.message : String(error);
      setBackendError(mapBackendErrorMessage(message));
      return { success: false, backends: [], error: message };
    }
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
      window.electron.llamacpp.onStatusChanged((s) => { cachedStatus = s; setStatus(s); }),
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
            const params = buildMarketplaceSearchParams({ query: marketplaceQuery });
            if (marketplaceHasSearched && params) {
              void searchMarketplace(params).catch(() => undefined);
            }
            setMarketplaceModels(prev =>
              prev.map(m => (m.repoId === name ? { ...m, installed: true } : m)),
            );
          }
        }
      }),
    ];
    void runAction(async () => {
      const nextServiceConfig = await loadOllamaServiceConfig();
      setServiceConfig(nextServiceConfig);
      await refreshBackends();
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
    marketplaceHasSearched,
    marketplaceQuery,
    refreshLocalModels,
    refreshBackends,
    refreshRunningModels,
    refreshStatus,
    runAction,
    scheduleInstallProgressDismiss,
    searchMarketplace,
  ]);

  const handleSaveServiceConfig = useCallback(
    async (config: OllamaServiceConfig): Promise<SaveServiceConfigResult> => {
      setLoading(true);
      dismissToast();
      try {
        const saved = await saveOllamaServiceConfig(config);
        setServiceConfig(saved);
        const sanitizedFields = getSanitizedServiceConfigFields(config, saved);
        showToast(
          sanitizedFields.length > 0
            ? i18nService
              .t('localInferenceServiceConfigSanitizedNotice')
              .replace('{fields}', sanitizedFields.join('、'))
            : status?.status === 'running'
              ? i18nService.t('localInferenceServiceConfigSavedRestartRequired')
              : i18nService.t('localInferenceServiceConfigSaved'),
          LocalInferenceToastKind.Success,
        );
        return { success: true, sanitizedFields };
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
    if (
      selectedModel &&
      runnableModels.some(model => model.name === selectedModel || model.model === selectedModel)
    ) {
      return;
    }
    const firstRunning = runnableModels[0]?.name;
    if (firstRunning && firstRunning !== selectedModel) {
      setSelectedModel(firstRunning);
    }
  }, [runnableModels, selectedModel]);

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
      await refreshBackends();
      await refreshStatus();
    });
  };

  const handleSelectBackend = (versionBackend: string) => {
    const backend = backendList.find(item => item.versionBackend === versionBackend);
    if (!backend) return;
    setBackendSelection(backend);
  };

  const handleInstallSelectedBackend = () => {
    void runAction(async () => {
      const target = backendSelection ?? recommendedBackend;
      const result = target
        ? await window.electron.llamacpp.installBackend(target)
        : await window.electron.llamacpp.install();
      if (!result.success) {
        showToast(
          result.error || i18nService.t('localInferenceRuntimeMissing'),
          LocalInferenceToastKind.Error,
        );
        return;
      }
      showToast(i18nService.t('localInferenceRuntimeReady'), LocalInferenceToastKind.Success);
      await refreshBackends();
      await refreshStatus();
    });
  };

  const handleUninstallSelectedBackend = () => {
    void runAction(async () => {
      const target = backendSelection;
      const result = target
        ? await window.electron.llamacpp.uninstallBackend(target)
        : await window.electron.llamacpp.uninstallRuntime();
      if (!result.success) {
        showToast(
          result.error || i18nService.t('localInferenceRuntimeUninstallFailed'),
          LocalInferenceToastKind.Error,
        );
        return;
      }
      showToast(
        result.deleted
          ? i18nService.t('localInferenceRuntimeUninstalled')
          : i18nService.t('localInferenceRuntimeNotInstalled'),
        result.deleted ? LocalInferenceToastKind.Success : LocalInferenceToastKind.Info,
      );
      await refreshBackends();
      await refreshStatus();
    });
  };

  const handleCheckRuntimeDevices = () => {
    void runAction(async () => {
      const target = backendSelection ?? recommendedBackend;
      const result = await window.electron.llamacpp.listRuntimeDevices(target);
      if (!result.success) {
        const message = result.error || i18nService.t('localInferenceBackendDeviceCheckFailed');
        setBackendDevices(message);
        showToast(message, LocalInferenceToastKind.Error);
        return;
      }
      const summary = result.devices.length > 0
        ? result.devices.map(device => `${device.id}: ${device.name}`).join('\n')
        : result.rawOutput || i18nService.t('localInferenceBackendNoDevices');
      setBackendDevices(summary);
      showToast(i18nService.t('localInferenceBackendDeviceCheckDone'), LocalInferenceToastKind.Success);
    });
  };

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

  const handlePreload = (request: LaunchRequest, openDebugger: boolean) => {
    void runAction(async () => {
      const loadLimitViolation = getLlamaCppModelsMaxLimitViolation({
        modelsMax: serviceConfig.modelsMax,
        targetModelName: request.input.model,
        runningModelNames: Array.from(
          new Set(
            runningModels
              .map(model => (model.name || model.model || '').trim())
              .filter(Boolean),
          ),
        ),
      });
      if (loadLimitViolation) {
        showToast(
          i18nService
            .t('localInferenceLoadModelLimitReached')
            .replace('{limit}', String(loadLimitViolation.limit))
            .replace('{next}', String(loadLimitViolation.next)),
          LocalInferenceToastKind.Info,
        );
        return;
      }
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
      setMarketplaceModels(prev =>
        prev.map(m => {
          const repoName = m.repoId.split('/').pop();
          return repoName === modelName ? { ...m, installed: false } : m;
        }),
      );
      notifyLlamaCppRunningModelsChanged();
    });
  };

  const handleSetOpenClawModel = (modelName: string) => {
    if (shouldBlockModelAction({ modelName, unloadingModelName })) return;

    const runningModel = runningModels.find(
      m => m.name === modelName || m.model === modelName,
    );
    const ctxLength =
      runningModel?.runtime_context_length ??
      runningModel?.context_length ??
      runningModel?.trained_context_length ??
      runningModel?.details?.context_length;

    if (ctxLength != null && ctxLength < OPENCLAW_MIN_CTX) {
      showToast(
        i18nService
          .t('localInferenceSetOpenClawCtxTooSmall')
          .replace('{ctx}', String(ctxLength))
          .replace('{min}', String(OPENCLAW_MIN_CTX)),
        LocalInferenceToastKind.Info,
      );
      return;
    }

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

  const handleIncreaseContextSize = useCallback(() => {
    const currentModel =
      localModels.find(model => model.name === selectedModel) ??
      localModels.find(model => model.path === selectedModel);
    if (currentModel) {
      setLaunchTarget(currentModel);
      return;
    }
    setActiveTab('models');
  }, [localModels, selectedModel]);

  const sendPrompt = async () => {
    if (!selectedModel || !selectedRunningModel || !prompt.trim()) return;
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
      const normalizedOptions = normalizeOptions(options);
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
            <ServicePopover
              containerRef={servicePopoverRef}
              open={servicePopoverOpen}
              status={status}
              loading={loading}
              localModels={localModels}
              runningModels={runningModels}
              installProgress={pullProgress}
              hasAvailableBackends={backendList.length > 0}
              onToggle={() => setServicePopoverOpen(current => !current)}
              onPrepare={handlePrepare}
              onStop={handleStop}
              onOpenBackendConfig={() => {
                setServicePopoverOpen(false);
                setBackendConfigDialogOpen(true);
                void refreshBackends().catch(() => undefined);
              }}
              onOpenServiceConfig={() => {
                setServicePopoverOpen(false);
                setServiceConfigDialogOpen(true);
              }}
              onRefresh={() =>
                void runAction(async () => {
                  const nextStatus = await refreshStatus();
                  await refreshBackends();
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
                loading={loading}
                selectedModel={selectedModel}
                runnableModels={runnableModels}
                systemPrompt={systemPrompt}
                prompt={prompt}
                options={options}
                messages={messages}
                inlineError={inferenceInlineError}
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
                onIncreaseContextSize={handleIncreaseContextSize}
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
      {backendConfigDialogOpen && (
        <LlamaCppBackendConfigDialog
          loading={loading}
          running={isRunning}
          backends={backendList}
          selectedBackend={backendSelection}
          recommendedBackend={recommendedBackend}
          backendDevices={backendDevices}
          backendError={backendError}
          runtimeInstallProgress={runtimeInstallProgress}
          onClose={() => setBackendConfigDialogOpen(false)}
          onBackendChange={handleSelectBackend}
          onInstallBackend={handleInstallSelectedBackend}
          onUninstallBackend={handleUninstallSelectedBackend}
          onImportRuntime={handleImportRuntime}
          onCheckDevices={handleCheckRuntimeDevices}
          onRefresh={() => void runAction(async () => {
            await refreshBackends();
            await refreshStatus();
          })}
        />
      )}
    </div>
  );
};

function ServicePopover({
  containerRef,
  open,
  status,
  loading,
  localModels,
  runningModels,
  installProgress,
  hasAvailableBackends,
  onToggle,
  onPrepare,
  onStop,
  onOpenBackendConfig,
  onOpenServiceConfig,
  onRefresh,
}: {
  containerRef: React.RefObject<HTMLDivElement>;
  open: boolean;
  status: OllamaStatusSnapshot | null;
  loading: boolean;
  localModels: OllamaModel[];
  runningModels: OllamaRunningModel[];
  installProgress: InstallProgressState;
  hasAvailableBackends: boolean;
  onToggle: () => void;
  onPrepare: () => void;
  onStop: () => void;
  onOpenBackendConfig: () => void;
  onOpenServiceConfig: () => void;
  onRefresh: () => void;
}) {
  const running = status?.status === 'running';
  const managedByApp = Boolean(status?.managedByApp);
  const displayStatus = status?.status === 'installed' ? 'stopped' : (status?.status ?? 'unknown');
  const hasCurrentBackend =
    status?.status === 'installed' ||
    status?.status === 'stopped' ||
    status?.status === 'running';
  const canPrepare = hasCurrentBackend;
  const actionLabel = i18nService.t('localInferenceStart');
  const [downloadsExpanded, setDownloadsExpanded] = useState(false);
  const downloadEntries = useMemo(
    () =>
      Object.entries(installProgress).filter(
        ([name, p]) => name !== LLAMACPP_RUNTIME_PROGRESS_KEY && isPullInProgress(p),
      ),
    [installProgress],
  );
  const downloadCount = downloadEntries.length;
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
        <div className="absolute right-0 top-full z-20 mt-2 w-[min(22rem,calc(100vw-2rem))] rounded-2xl border border-border bg-background/95 p-4 shadow-2xl backdrop-blur">
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
            <button
              type="button"
              onClick={onRefresh}
              disabled={loading}
              className={serviceRefreshButtonClass}
              aria-label={i18nService.t('refresh')}
              title={i18nService.t('refresh')}
            >
              <ArrowPathIcon className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>

          <div className={`mt-4 grid gap-3 ${downloadCount > 0 ? 'grid-cols-3' : 'grid-cols-2'}`}>
            <div className="rounded-xl border border-border bg-surface/70 px-4 py-3">
              <p className="text-[11px] text-secondary">
                {i18nService.t('localInferenceTabModels')}
              </p>
              <p className="mt-1 text-lg font-semibold text-foreground">{localModels.length}</p>
            </div>
            <div className="rounded-xl border border-border bg-surface/70 px-4 py-3">
              <p className="text-[11px] text-secondary">{i18nService.t('localInferenceLoaded')}</p>
              <p className="mt-1 text-lg font-semibold text-foreground">{runningModels.length}</p>
            </div>
            {downloadCount > 0 && (
              <button
                type="button"
                onClick={() => setDownloadsExpanded(v => !v)}
                className="rounded-xl border border-border bg-surface/70 px-4 py-3 text-left transition-colors hover:bg-surface"
              >
                <p className="text-[11px] text-secondary">
                  {i18nService.t('localInferenceActiveDownloads')}
                </p>
                <div className="mt-1 flex items-center gap-1">
                  <p className="text-lg font-semibold text-foreground">{downloadCount}</p>
                  <ChevronRightIcon className={`h-3.5 w-3.5 text-secondary transition-transform ${downloadsExpanded ? 'rotate-90' : ''}`} />
                </div>
              </button>
            )}
          </div>

          {downloadCount > 0 && downloadsExpanded && (
            <div className="mt-2 space-y-2 border-t border-border pt-2">
              {downloadEntries.map(([name, progress]) => (
                <div
                  key={name}
                  className="rounded-lg border border-border bg-surface/70 px-3 py-2"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-secondary">
                    <span className="font-mono text-foreground text-[12px]">{name}</span>
                    <div className="flex items-center gap-2">
                      <span>{formatPullProgress(progress)}</span>
                      <button
                        type="button"
                        onClick={() => void window.electron.llamacpp.cancelInstall(name)}
                        className="inline-flex h-6 items-center gap-1 rounded px-1.5 text-[10px] text-secondary hover:bg-surface-raised hover:text-red-500"
                      >
                        <XMarkIcon className="h-3 w-3" />
                      </button>
                    </div>
                  </div>
                  <InstallProgressBar progress={progress} className="mt-1" />
                </div>
              ))}
            </div>
          )}

          {running && !managedByApp && (
            <p className="mt-3 rounded-lg border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
              {i18nService.t('localInferenceExternalServiceHint')}
            </p>
          )}

          {!running && !hasCurrentBackend && (
            <p className="mt-3 rounded-lg border border-border bg-background px-3 py-2 text-xs text-secondary">
              {hasAvailableBackends
                ? i18nService.t('localInferenceServiceNeedsBackendSwitch')
                : i18nService.t('localInferenceServiceNeedsBackendInstall')}
            </p>
          )}

          <div className="mt-4 space-y-2.5">
            <div className="grid grid-cols-2 gap-2.5">
              <button
                type="button"
                onClick={onOpenBackendConfig}
                disabled={loading}
                className={serviceActionButtonClass}
              >
                {i18nService.t('localInferenceBackendConfigTitle')}
              </button>
              <button
                type="button"
                onClick={onOpenServiceConfig}
                disabled={loading}
                className={serviceActionButtonClass}
              >
                {i18nService.t('localInferenceServiceConfigTitle')}
              </button>
            </div>
            {!running && canPrepare && (
              <button
                type="button"
                onClick={onPrepare}
                disabled={loading}
                className="inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-xl bg-primary px-3 text-sm font-medium text-white transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-60"
              >
                <PlayIcon className="h-4 w-4" />
                {actionLabel}
              </button>
            )}
            {!running && !canPrepare && (
              <button
                type="button"
                disabled
                className="inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-xl bg-primary px-3 text-sm font-medium text-white opacity-60"
              >
                <PlayIcon className="h-4 w-4" />
                {actionLabel}
              </button>
            )}
            {running && managedByApp ? (
              <button
                type="button"
                onClick={onStop}
                disabled={loading}
                className={serviceDangerButtonClass}
              >
                <StopIcon className="h-4 w-4" />
                {i18nService.t('localInferenceStop')}
              </button>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}

function LlamaCppBackendConfigDialog({
  loading,
  running,
  backends,
  selectedBackend,
  recommendedBackend,
  backendDevices,
  backendError,
  runtimeInstallProgress,
  onClose,
  onBackendChange,
  onInstallBackend,
  onUninstallBackend,
  onImportRuntime,
  onCheckDevices,
  onRefresh,
}: {
  loading: boolean;
  running: boolean;
  backends: LlamaCppBackendInfo[];
  selectedBackend?: LlamaCppBackendRef;
  recommendedBackend?: LlamaCppBackendRef;
  backendDevices: string | null;
  backendError: string | null;
  runtimeInstallProgress?: LlamaCppInstallProgress;
  onClose: () => void;
  onBackendChange: (versionBackend: string) => void;
  onInstallBackend: () => void;
  onUninstallBackend: () => void;
  onImportRuntime: () => void;
  onCheckDevices: () => void;
  onRefresh: () => void;
}) {
  const [importHelpOpen, setImportHelpOpen] = useState(false);
  const currentPlatform = window.electron.platform;
  const backendVersions = useMemo(
    () => Array.from(new Set(backends.map(backend => backend.version))),
    [backends],
  );
  const selectedVersion = selectedBackend?.version ?? recommendedBackend?.version ?? backendVersions[0] ?? '';
  const backendOptions = useMemo(
    () => backends.filter(backend => backend.version === selectedVersion),
    [backends, selectedVersion],
  );
  const selectedVersionBackend =
    selectedBackend?.versionBackend ??
    recommendedBackend?.versionBackend ??
    backendOptions[0]?.versionBackend ??
    '';
  const selectedBackendInfo = backends.find(backend => backend.versionBackend === selectedVersionBackend);
  const recommendedDescription = recommendedBackend
    ? i18nService
      .t('localInferenceBackendRecommendedReason')
      .replace('{backend}', recommendedBackend.backend)
    : backends.length > 0
      ? i18nService
        .t('localInferenceBackendRecommendedUnavailable')
        .replace('{platform}', currentPlatform)
      : i18nService.t('localInferenceBackendListEmpty');

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
              {i18nService.t('localInferenceBackendConfigTitle')}
            </h3>
            <p className="mt-1 text-sm text-secondary">
              {i18nService.t('localInferenceBackendConfigDescription')}
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
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/70 pb-3">
              <div>
                <h4 className="text-sm font-semibold text-foreground">
                  {i18nService.t('localInferenceBackendManager')}
                </h4>
                <p className="mt-1 text-xs text-secondary">
                  {selectedBackendInfo?.installed
                    ? i18nService.t('localInferenceBackendInstalled')
                    : i18nService.t('localInferenceBackendNotInstalled')}
                </p>
              </div>
              {recommendedBackend ? (
                <span className="rounded-full bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary">
                  {i18nService.t('localInferenceBackendRecommended')
                    .replace('{backend}', recommendedBackend.backend)}
                </span>
              ) : null}
            </div>

            {backendError ? (
              <p className="mt-3 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
                {backendError}
              </p>
            ) : null}

            {runtimeInstallProgress ? (
              <div className="mt-3 rounded-lg border border-border bg-background px-3 py-2">
                {(() => {
                  const summary = formatInstallProgressSummary(runtimeInstallProgress);
                  return (
                    <>
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-[11px] font-medium text-foreground">
                          {runtimeInstallProgress.modelName || i18nService.t('localInferenceInstall')}
                        </span>
                        <span className="shrink-0 text-[11px] text-secondary">{summary.primary}</span>
                      </div>
                      {summary.phase ? (
                        <p className="mt-1 text-[11px] text-secondary">{summary.phase}</p>
                      ) : null}
                      {summary.error ? (
                        <p className="mt-1 text-[11px] text-destructive">{summary.error}</p>
                      ) : null}
                    </>
                  );
                })()}
                <InstallProgressBar progress={runtimeInstallProgress} className="mt-2" />
              </div>
            ) : null}

            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <label className="space-y-2">
                <span className="flex items-baseline gap-2">
                  <span className="text-sm font-semibold text-foreground">
                    {i18nService.t('localInferenceBackendVersion')}
                  </span>
                  <code className="text-[11px] text-secondary">version</code>
                </span>
                <select
                  value={selectedVersion}
                  onChange={event => {
                    const next = backends.find(backend =>
                      backend.version === event.target.value &&
                      backend.versionBackend === recommendedBackend?.versionBackend,
                    ) ?? backends.find(backend => backend.version === event.target.value);
                    if (next) onBackendChange(next.versionBackend);
                  }}
                  disabled={loading || backendVersions.length === 0}
                  className="h-10 w-full rounded-lg border border-border bg-surface-input px-3 text-sm text-foreground outline-none transition-colors focus:border-primary/60"
                >
                  {backendVersions.map(version => (
                    <option key={version} value={version}>{version}</option>
                  ))}
                </select>
              </label>
              <label className="space-y-2">
                <span className="flex items-baseline gap-2">
                  <span className="text-sm font-semibold text-foreground">
                    {i18nService.t('localInferenceBackendName')}
                  </span>
                  <code className="text-[11px] text-secondary">backend</code>
                </span>
                <select
                  value={selectedVersionBackend}
                  onChange={event => onBackendChange(event.target.value)}
                  disabled={loading || backendOptions.length === 0}
                  className="h-10 w-full rounded-lg border border-border bg-surface-input px-3 text-sm text-foreground outline-none transition-colors focus:border-primary/60"
                >
                  {backendOptions.map(backend => (
                    <option key={backend.versionBackend} value={backend.versionBackend}>
                      {backend.backend}{backend.installed ? ' ✓' : ''}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="mt-4 grid gap-3 md:grid-cols-2">
              <div className="rounded-lg border border-border bg-background px-3 py-2">
                <p className="text-[11px] text-secondary">
                  {i18nService.t('localInferenceBackendCurrent')}
                </p>
                <p className="mt-1 font-mono text-sm text-foreground">
                  {selectedBackend?.versionBackend ?? i18nService.t('localInferenceBackendNone')}
                </p>
                <p className="mt-1 text-[11px] text-secondary">
                  {selectedBackendInfo
                    ? i18nService.t(
                      selectedBackendInfo.source === 'local'
                        ? 'localInferenceBackendSourceLocal'
                        : 'localInferenceBackendSourceRemote',
                    )
                    : i18nService.t('localInferenceBackendNone')}
                </p>
              </div>
              <div className="rounded-lg border border-border bg-background px-3 py-2">
                <p className="text-[11px] text-secondary">
                  {i18nService.t('localInferenceBackendRecommendedLabel')}
                </p>
                <p className="mt-1 font-mono text-sm text-foreground">
                  {recommendedBackend?.versionBackend ?? i18nService.t('localInferenceBackendNone')}
                </p>
                <p className="mt-1 text-[11px] text-secondary">
                  {recommendedDescription}
                </p>
              </div>
            </div>

            {backendDevices ? (
              <pre className="mt-4 max-h-36 overflow-auto whitespace-pre-wrap rounded-lg border border-border bg-background px-3 py-2 text-xs text-secondary">
                {backendDevices}
              </pre>
            ) : null}
            {running ? (
              <p className="mt-4 text-xs text-secondary">
                {i18nService.t('localInferenceBackendRunningHint')}
              </p>
            ) : null}
          </section>
        </div>

        <div className="flex flex-col gap-2 border-t border-border px-4 py-3 sm:flex-row sm:flex-wrap sm:justify-end">
          <button type="button" onClick={onRefresh} disabled={loading} className={smallOutlineButtonClass}>
            <ArrowPathIcon className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            {i18nService.t('refresh')}
          </button>
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
            onClick={() => setImportHelpOpen(true)}
            className={smallOutlineButtonClass}
            aria-label={i18nService.t('localInferenceImportGuideTitle')}
            title={i18nService.t('localInferenceImportGuideTitle')}
          >
            <InformationCircleIcon className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={onCheckDevices}
            disabled={loading || !selectedBackendInfo?.installed}
            className={smallOutlineButtonClass}
          >
            <CpuChipIcon className="h-3.5 w-3.5" />
            {i18nService.t('localInferenceBackendCheckDevices')}
          </button>
          <button
            type="button"
            onClick={onUninstallBackend}
            disabled={loading || !selectedBackendInfo?.installed}
            className={smallDangerButtonClass}
          >
            <TrashIcon className="h-3.5 w-3.5" />
            {i18nService.t('localInferenceRuntimeUninstall')}
          </button>
          <button
            type="button"
            onClick={onInstallBackend}
            disabled={loading || backends.length === 0}
            className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg bg-primary px-4 text-sm font-medium text-white transition-colors hover:bg-primary-hover disabled:opacity-60"
          >
            <ArrowDownTrayIcon className="h-4 w-4" />
            {selectedBackendInfo?.installed
              ? i18nService.t('localInferenceBackendSwitch')
              : i18nService.t('localInferenceInstall')}
          </button>
        </div>
      </div>
      <Modal isOpen={importHelpOpen} onClose={() => setImportHelpOpen(false)}>
        <div className="w-full max-w-md rounded-2xl border border-border bg-background shadow-2xl">
          <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
            <div className="min-w-0">
              <h4 className="text-lg font-semibold text-foreground">
                {i18nService.t('localInferenceImportGuideTitle')}
              </h4>
              <p className="mt-1 text-sm text-secondary">
                {i18nService.t('localInferenceImportGuideInlineDescription')}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setImportHelpOpen(false)}
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-secondary transition-colors hover:bg-surface-raised hover:text-foreground"
              aria-label={i18nService.t('close')}
            >
              <XMarkIcon className="h-5 w-5" />
            </button>
          </div>
          <div className="space-y-3 px-5 py-4 text-sm leading-6 text-secondary">
            <p>{i18nService.t('localInferenceImportGuideInlineStepArchive')}</p>
            <p className="break-all rounded-lg bg-surface/50 px-3 py-2 text-xs text-foreground">
              {i18nService.t('localInferenceImportGuideInlineReleaseUrl')}
            </p>
            <div className="space-y-1.5">
              <p>{i18nService.t('localInferenceImportGuideInlineStepExtracted')}</p>
              <p className="pl-3">{i18nService.t('localInferenceImportGuideInlinePlatformWinX64Cpu')}</p>
              <p className="pl-3">{i18nService.t('localInferenceImportGuideInlinePlatformWinArm64Cpu')}</p>
              <p className="pl-3">{i18nService.t('localInferenceImportGuideInlinePlatformWinX64Nvidia')}</p>
              <p className="pl-3">{i18nService.t('localInferenceImportGuideInlinePlatformWinX64Vulkan')}</p>
              <p className="pl-3">{i18nService.t('localInferenceImportGuideInlinePlatformMacArm64')}</p>
              <p className="pl-3">{i18nService.t('localInferenceImportGuideInlinePlatformMacX64')}</p>
            </div>
            <p>{i18nService.t('localInferenceImportGuideInlineStepReject')}</p>
            <p>{i18nService.t('localInferenceImportGuideInlineStepResult')}</p>
          </div>
          <div className="flex justify-end border-t border-border px-5 py-4">
            <button
              type="button"
              onClick={() => setImportHelpOpen(false)}
              className={smallOutlineButtonClass.replace('h-9', 'h-10').replace('text-sm', 'text-sm')}
            >
              {i18nService.t('localInferenceImportGuideClose')}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

function mapBackendErrorMessage(message: string | undefined): string {
  if (!message) return i18nService.t('localInferenceBackendListFailed');
  if (message.includes('No handler registered') && message.includes('llamacpp:backends:list')) {
    return i18nService.t('localInferenceBackendHandlerMissing');
  }
  return message;
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
  const [runtimeDevices, setRuntimeDevices] = useState<LlamaCppRuntimeListDevicesResult | null>(null);
  const gpuDetectionState = getLlamaCppGpuDetectionState(runtimeDevices);
  const gpuConfigUnavailable = gpuDetectionState !== LlamaCppGpuDetectionState.Unknown
    && gpuDetectionState !== LlamaCppGpuDetectionState.Available;
  const acceleratorDevices = useMemo(
    () => getLlamaCppAcceleratorDevices(runtimeDevices),
    [runtimeDevices],
  );
  const structuredValidation = validateLlamaCppStructuredServiceConfig({
    modelsMax: form.modelsMax,
    device: form.device,
    parallel: form.parallel,
    timeout: form.timeout,
    threadsHttp: form.threadsHttp,
    cacheReuse: form.cacheReuse,
    cacheRam: form.cacheRam,
    ctxSize: form.ctxSize,
    tensorSplit: form.tensorSplit,
    splitMode: form.splitMode,
    mainGpu: form.mainGpu,
    batchSize: form.batchSize,
    ubatchSize: form.ubatchSize,
    threads: form.threads,
    threadsBatch: form.threadsBatch,
    gpuLayers: form.gpuLayers,
    runtimeDevices,
  });

  useEffect(() => {
    setForm(serviceConfigToForm(config, runtimeDevices));
  }, [config, runtimeDevices]);

  useEffect(() => {
    let cancelled = false;
    void window.electron.llamacpp.listRuntimeDevices()
      .then(result => {
        if (!cancelled) setRuntimeDevices(result);
      })
      .catch(() => {
        if (!cancelled) {
          setRuntimeDevices({
            success: false,
            devices: [],
            error: 'failed to list llama.cpp runtime devices',
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const updateForm = (key: keyof OllamaServiceConfigFormState, value: string) => {
    setSaveError(null);
    setForm(current => ({ ...current, [key]: value }));
  };
  const getFieldState = (field: ServiceConfigField) =>
    getServiceConfigFieldState(field.key, {
      acceleratorDeviceCount: acceleratorDevices.length,
      gpuDetectionState,
      cachePromptValue: form.cachePrompt,
    });
  const renderField = (field: ServiceConfigField) => {
    const fieldState = getFieldState(field);
    if (!fieldState.visible) return null;
    const placeholder = field.placeholderKey
      ? i18nService.t(field.placeholderKey)
      : (field.placeholder ?? '');
    const label = i18nService.t(field.labelKey);
    const hint = fieldState.hint ?? (
      gpuConfigUnavailable && (field.key === 'device' || field.key === 'mainGpu')
        ? getGpuConfigHint(gpuDetectionState)
        : i18nService.t(field.hintKey)
    );
    const fieldError = getStructuredServiceConfigFieldErrorMessage(
      field.key,
      structuredValidation.fieldErrors,
    );
    const disabled = loading
      || fieldState.disabled
      || isGpuIndexedFieldDisabled(field.key, gpuConfigUnavailable);
    return field.type === 'select' ? (
      <ServiceConfigSelect
        key={field.key}
        label={label}
        paramName={field.paramName}
        value={form[field.key]}
        hint={hint}
        disabled={disabled}
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
        error={fieldError}
        disabled={disabled}
        onChange={value => updateForm(field.key, value)}
      />
    );
  };

  const save = async () => {
    setSaveError(null);
    if (structuredValidation.hasErrors) {
      setSaveError(i18nService.t('localInferenceServiceConfigValidationFixErrors'));
      return;
    }
    const nextConfig: OllamaServiceConfig = { ...config };
    applyServiceConfigScalar(nextConfig, 'host', form.host);
    applyServiceConfigScalar(nextConfig, 'port', form.port);
    for (const field of SERVICE_CONFIG_FIELDS) {
      const fieldState = getFieldState(field);
      if (!fieldState.visible || fieldState.omitOnSave) continue;
      applyServiceConfigFieldToPayload(nextConfig, field.key, form[field.key], fieldState);
    }
    const result = await onSave(nextConfig);
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
              <div className="flex items-center justify-end gap-3 border-b border-border/70 pb-2">
                <span className="text-[11px] text-secondary">
                  {i18nService.t('localInferenceServiceConfigRestartRequired')}
                </span>
              </div>
              {SERVICE_CONFIG_GROUPS.map(group => {
                const visibleFields = SERVICE_CONFIG_FIELDS
                  .filter(field => field.group === group.key)
                  .filter(field => getFieldState(field).visible);
                if (visibleFields.length === 0) {
                  if (group.key !== 'gpu') return null;
                  return (
                    <div key={group.key} className="space-y-2">
                      <div>
                        <h4 className="text-sm font-semibold text-foreground">
                          {i18nService.t(group.titleKey)}
                        </h4>
                        <p className="mt-1 text-xs text-secondary">
                          {i18nService.t(group.descriptionKey)}
                        </p>
                      </div>
                      <p className="rounded-md border border-border/70 bg-surface/40 px-3 py-2 text-xs text-secondary">
                        {i18nService.t('localInferenceServiceConfigGpuHiddenHint')}
                      </p>
                    </div>
                  );
                }
                return (
                  <div key={group.key} className="space-y-3">
                    <div>
                      <h4 className="text-sm font-semibold text-foreground">
                        {i18nService.t(group.titleKey)}
                      </h4>
                      <p className="mt-1 text-xs text-secondary">
                        {i18nService.t(group.descriptionKey)}
                      </p>
                    </div>
                    <div className="grid gap-3 md:grid-cols-2">
                      {visibleFields.map(renderField)}
                    </div>
                  </div>
                );
              })}
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
            disabled={loading || structuredValidation.hasErrors}
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
  error,
  disabled,
  onChange,
}: {
  label: string;
  paramName: string;
  value: string;
  placeholder: string;
  hint: string;
  error?: string;
  disabled?: boolean;
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
        disabled={disabled}
        onChange={event => onChange(event.target.value)}
        className={`h-10 w-full rounded-lg bg-surface-input px-3 font-mono text-sm text-foreground outline-none transition-colors placeholder:text-secondary focus:border-primary/60 disabled:cursor-not-allowed disabled:opacity-60 ${error ? 'border border-red-500/70 focus:border-red-500' : 'border border-border'}`}
      />
      <p className="text-xs text-secondary">{hint}</p>
      {error ? <p className="text-xs text-red-600 dark:text-red-400">{error}</p> : null}
    </label>
  );
}

function ServiceConfigSelect({
  label,
  paramName,
  value,
  hint,
  disabled,
  options,
  onChange,
}: {
  label: string;
  paramName: string;
  value: string;
  hint: string;
  disabled?: boolean;
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
        disabled={disabled}
        onChange={event => onChange(event.target.value)}
        className="h-10 w-full rounded-lg border border-border bg-surface-input px-3 text-sm text-foreground outline-none transition-colors focus:border-primary/60 disabled:cursor-not-allowed disabled:opacity-60"
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

function getServiceConfigFieldState(
  key: keyof OllamaServiceConfigFormState,
  options: {
    acceleratorDeviceCount: number;
    gpuDetectionState: LlamaCppGpuDetectionState;
    cachePromptValue: string;
  },
): {
  visible: boolean;
  disabled: boolean;
  omitOnSave?: boolean;
  hint?: string;
} {
  const { acceleratorDeviceCount, gpuDetectionState, cachePromptValue } = options;
  const cachePromptEnabled = cachePromptValue === 'true';
  if (key === 'cacheReuse' || key === 'cacheRam') {
    return {
      visible: true,
      disabled: !cachePromptEnabled,
      omitOnSave: !cachePromptEnabled,
    };
  }
  if (key === 'flashAttn') {
    return {
      visible: gpuDetectionState !== LlamaCppGpuDetectionState.Unavailable,
      disabled: false,
    };
  }
  if (key === 'device' || key === 'splitMode' || key === 'tensorSplit' || key === 'mainGpu') {
    if (gpuDetectionState === LlamaCppGpuDetectionState.Unavailable) {
      return { visible: false, disabled: true, omitOnSave: true };
    }
    if (acceleratorDeviceCount <= 1 && gpuDetectionState !== LlamaCppGpuDetectionState.Unknown) {
      return { visible: false, disabled: true, omitOnSave: true };
    }
    return {
      visible: true,
      disabled: gpuDetectionState === LlamaCppGpuDetectionState.DetectionFailed,
      omitOnSave: gpuDetectionState === LlamaCppGpuDetectionState.DetectionFailed,
      hint: gpuDetectionState === LlamaCppGpuDetectionState.DetectionFailed
        ? getGpuConfigHint(gpuDetectionState)
        : undefined,
    };
  }
  return { visible: true, disabled: false };
}

function applyServiceConfigFieldToPayload(
  target: OllamaServiceConfig,
  key: keyof OllamaServiceConfigFormState,
  value: string,
  fieldState: {
    disabled: boolean;
  },
): void {
  if (fieldState.disabled) return;
  switch (key) {
    case 'modelsMax':
    case 'parallel':
    case 'timeout':
    case 'threadsHttp':
    case 'cacheReuse':
    case 'cacheRam':
    case 'device':
    case 'mainGpu':
    case 'tensorSplit':
      applyServiceConfigScalar(target, key, value);
      return;
    case 'modelsAutoload':
      if (value) {
        target.modelsAutoload = value === 'true';
      } else {
        delete target.modelsAutoload;
      }
      return;
    case 'cachePrompt':
      if (value) {
        target.cachePrompt = value === 'true';
      } else {
        delete target.cachePrompt;
      }
      return;
    case 'flashAttn':
      if (value) {
        target.flashAttn = value as NonNullable<OllamaServiceConfig['flashAttn']>;
      } else {
        delete target.flashAttn;
      }
      return;
    case 'mlock':
      if (value) {
        target.mlock = value === 'true';
      } else {
        delete target.mlock;
      }
      return;
    case 'jinja':
      if (value) {
        target.jinja = value as NonNullable<OllamaServiceConfig['jinja']>;
      } else {
        delete target.jinja;
      }
      return;
    case 'splitMode':
      if (value) {
        target.splitMode = value as NonNullable<OllamaServiceConfig['splitMode']>;
      } else {
        delete target.splitMode;
      }
      return;
    default:
      return;
  }
}

function applyServiceConfigScalar<
  K extends
    | 'host'
    | 'port'
    | 'modelsMax'
    | 'parallel'
    | 'timeout'
    | 'threadsHttp'
    | 'cacheReuse'
    | 'cacheRam'
    | 'device'
    | 'mainGpu'
    | 'tensorSplit',
>(
  target: OllamaServiceConfig,
  key: K,
  value: string,
): void {
  if (value) {
    target[key] = value;
  } else {
    delete target[key];
  }
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
      return onOffAutoOptions();
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
  activePullName: _activePullName,
  activePullProgress: _activePullProgress,
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
    const bounds = getModelContextWindowRange(resolveModelParameterCount(model));
    const clampedCtx = Math.min(Math.max(next.numCtx, bounds.min), bounds.max);
    setForm(current => ({
      ...current,
      numCtx: String(clampedCtx),
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
  const trainedCtxLength = model.trained_context_length ?? model.details?.context_length;
  const launchContextLimitViolation = getLaunchContextLimitViolation({
    requestedContextLength: parseOptionalInteger(form.numCtx),
    trainedContextLength: trainedCtxLength,
  });
  const contextBounds = useMemo(() => {
    const bounds = getModelContextWindowRange(resolveModelParameterCount(model));
    if (trainedCtxLength && trainedCtxLength > 0) {
      bounds.max = Math.min(bounds.max, trainedCtxLength);
    }
    return bounds;
  }, [model, trainedCtxLength]);
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
                min={contextBounds.min}
                max={contextBounds.max}
                step={contextBounds.step}
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
  max,
  step,
  placeholder,
  onChange,
}: {
  label: string;
  value: string;
  hint: string;
  min?: number;
  max?: number;
  step?: number;
  placeholder?: string;
  onChange: (value: string) => void;
}) {
  const clamp = () => {
    if (max === undefined) return;
    const parsed = parseOptionalInteger(value);
    if (parsed === undefined) return;
    if (parsed > max) onChange(String(max));
  };

  return (
    <label className="space-y-2">
      <span className="text-sm font-semibold text-foreground">{label}</span>
      <input
        type="number"
        min={min}
        max={max}
        step={step}
        value={value}
        placeholder={placeholder}
        onChange={event => onChange(event.target.value)}
        onBlur={clamp}
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
  runnableModels,
  systemPrompt,
  prompt,
  options,
  messages,
  inlineError,
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
  onIncreaseContextSize,
  onOpenModels,
}: {
  isRunning: boolean;
  loading: boolean;
  selectedModel: string;
  runnableModels: OllamaModel[];
  systemPrompt: string;
  prompt: string;
  options: InferenceOptions;
  messages: InferenceMessage[];
  inlineError: LocalInferenceInlineError | null;
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
  onIncreaseContextSize: () => void;
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
  const reasoningMenuRef = useRef<HTMLDivElement>(null);
  const [configCollapsed, setConfigCollapsed] = useState(true);
  const [configPage, setConfigPage] = useState<'common' | 'advanced'>('common');
  const [reasoningMenuOpen, setReasoningMenuOpen] = useState(false);
  const [showJumpToBottom, setShowJumpToBottom] = useState(false);
  const commonOptionFields = useMemo(
    () =>
      INFERENCE_OPTION_FIELDS.filter(
        field => field.group === 'basic' && field.key !== 'reasoning_preference',
      ),
    [],
  );
  const advancedOptionFields = useMemo(
    () => INFERENCE_OPTION_FIELDS.filter(field => field.group === 'advanced'),
    [],
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
  const reasoningOptions: Array<{
    value: InferenceOptions['reasoning_preference'];
    label: string;
  }> = [
    { value: 'auto', label: i18nService.t('localInferenceReasoningPreferenceAuto') },
    { value: 'high', label: i18nService.t('localInferenceReasoningPreferenceHigh') },
    { value: 'low', label: i18nService.t('localInferenceReasoningPreferenceLow') },
  ];
  const currentReasoningOption =
    reasoningOptions.find(option => option.value === options.reasoning_preference) ??
    reasoningOptions[0];
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
    if (sending || cancelling || !selectedModel) return;
    const frame = window.requestAnimationFrame(() => {
      promptRef.current?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [cancelling, selectedModel, sending]);

  useEffect(() => {
    if (!reasoningMenuOpen) return;
    const handlePointerDown = (event: MouseEvent) => {
      if (!reasoningMenuRef.current?.contains(event.target as Node)) {
        setReasoningMenuOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setReasoningMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handlePointerDown);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [reasoningMenuOpen]);

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
    <div className="h-full min-h-0 overflow-hidden bg-background">
      <div
        className={`grid h-full min-h-0 ${configCollapsed ? 'lg:grid-cols-[minmax(0,1fr)]' : 'lg:grid-cols-[300px_minmax(0,1fr)]'}`}
      >
        <aside
          className={`${configCollapsed ? 'hidden' : 'min-h-0 overflow-hidden border-r border-border-subtle bg-surface'}`}
        >
          {configCollapsed ? null : (
            <div className="flex h-full min-h-0 flex-col">
              <div className="flex shrink-0 items-center justify-between border-b border-border-subtle px-4 py-4">
                <div className="space-y-0.5">
                  <h2 className="text-sm font-semibold text-foreground">
                    {i18nService.t('localInferenceConfigTitle')}
                  </h2>
                  <p className="text-[11px] text-secondary">{selectedModel}</p>
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
              <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 py-4">
                <section className="space-y-3">
                  <div className="grid grid-cols-2 rounded-xl border border-border-subtle bg-surface-raised/40 p-1">
                    {([
                      { key: 'common', label: i18nService.t('localInferenceCommonParams') },
                      { key: 'advanced', label: i18nService.t('localInferenceMoreParams') },
                    ] as const).map(item => (
                      <button
                        key={item.key}
                        type="button"
                        onClick={() => setConfigPage(item.key)}
                        className={`h-9 rounded-lg px-2 text-sm transition-colors ${
                          configPage === item.key
                            ? 'bg-surface text-foreground shadow-sm'
                            : 'text-secondary hover:text-foreground'
                        }`}
                      >
                        {item.label}
                      </button>
                    ))}
                  </div>
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
                  <div className="space-y-3">
                    {(configPage === 'common' ? commonOptionFields : advancedOptionFields).map(field => (
                      <InferenceOptionControl
                        key={field.key}
                        field={field}
                        value={options[field.key]}
                        onChange={value => updateOption(field.key, value)}
                      />
                    ))}
                  </div>
                </section>

                {configPage === 'common' && (
                  <section className="space-y-3">
                  <div className="space-y-1">
                    <h3 className="text-sm font-medium text-foreground">
                      {i18nService.t('localInferenceSystemPrompt')}
                    </h3>
                    <p className="text-[11px] text-secondary">{i18nService.t('localInferenceSystemPromptHint')}</p>
                  </div>
                  <textarea
                    value={systemPrompt}
                    onChange={event => onSystemPromptChange(event.target.value)}
                    className="min-h-28 w-full resize-y rounded-2xl border border-border bg-surface-input px-3 py-3 text-sm text-foreground outline-none transition-colors focus:border-primary/60"
                  />
                  </section>
                )}
              </div>
              <div className="shrink-0 border-t border-border-subtle p-4">
                <button
                  type="button"
                  onClick={onSavePreset}
                  className="h-10 w-full rounded-2xl bg-primary text-sm font-medium text-white transition-colors hover:bg-primary-hover"
                >
                  {i18nService.t('localInferenceSavePreset')}
                </button>
              </div>
            </div>
          )}
        </aside>

        <main className="relative flex min-h-0 flex-col overflow-hidden bg-background">
          {configCollapsed && (
            <button
              type="button"
              onClick={() => setConfigCollapsed(false)}
              className="absolute left-4 top-4 z-30 inline-flex h-10 w-10 items-center justify-center rounded-xl border border-border-subtle bg-surface-raised/85 text-secondary shadow-sm transition-colors hover:bg-surface-raised hover:text-foreground"
              aria-label={i18nService.t('localInferenceConfigExpand')}
              title={i18nService.t('localInferenceConfigExpand')}
            >
              <SidebarToggleIcon className="h-4 w-4" isCollapsed={true} />
            </button>
          )}
          <div className={`shrink-0 border-b border-border-subtle px-6 py-4 ${configCollapsed ? 'pl-20' : ''}`}>
            <div className="flex items-center justify-between gap-4">
              <div className="min-w-0">
                <div className="flex items-center gap-3">
                  <div className="min-w-0">
                    <h2 className="truncate text-base font-medium text-foreground">{selectedModel}</h2>
                    <p className="text-xs text-secondary">{i18nService.t('localInferenceTitle')}</p>
                  </div>
                </div>
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
                    <p className="text-sm text-secondary">{selectedModel}</p>
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
                <InferenceInlineErrorCard
                  error={inlineError}
                  onIncreaseContextSize={onIncreaseContextSize}
                />
              )}
            </div>
          </div>
          {showJumpToBottom && (
            <div
              className="pointer-events-none absolute inset-x-0 bottom-28 flex justify-center px-4"
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
              <div className="flex items-center justify-between gap-3 px-2 pb-1">
                <div className="flex min-w-0 items-center gap-1.5">
                  <div
                    ref={reasoningMenuRef}
                    className="relative flex min-w-0 items-center"
                  >
                    <button
                      type="button"
                      onClick={() => setReasoningMenuOpen(current => !current)}
                      className="inline-flex min-w-0 items-center gap-1.5 rounded-xl px-2 py-1 text-xs text-secondary transition-colors hover:bg-surface-raised hover:text-foreground"
                      aria-haspopup="menu"
                      aria-expanded={reasoningMenuOpen}
                    >
                      <span className="truncate">
                        {i18nService.t('localInferenceReasoningPreferenceLabel')}:
                        {' '}
                        {currentReasoningOption.label}
                      </span>
                      <ChevronDownIcon
                        className={`h-3.5 w-3.5 shrink-0 transition-transform ${reasoningMenuOpen ? 'rotate-180' : ''}`}
                      />
                    </button>
                    {reasoningMenuOpen && (
                      <div className="absolute bottom-full left-0 z-30 mb-2 w-44 overflow-hidden rounded-2xl border border-border bg-surface p-1 shadow-popover">
                        {reasoningOptions.map(option => {
                          const selected = option.value === options.reasoning_preference;
                          return (
                            <button
                              key={option.value}
                              type="button"
                              onClick={() => {
                                updateOption('reasoning_preference', option.value);
                                setReasoningMenuOpen(false);
                              }}
                              className={`flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-sm transition-colors ${
                                selected
                                  ? 'bg-surface-raised text-foreground'
                                  : 'text-secondary hover:bg-surface-raised hover:text-foreground'
                              }`}
                              role="menuitemradio"
                              aria-checked={selected}
                            >
                              <span>{option.label}</span>
                              <CheckIcon
                                className={`h-4 w-4 ${selected ? 'opacity-100' : 'opacity-0'}`}
                              />
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={sending ? onStop : submitPrompt}
                  disabled={!selectedModel || cancelling || (!prompt.trim() && !sending)}
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
        <span className="text-base leading-none">✧</span>
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
  onIncreaseContextSize,
}: {
  error: LocalInferenceInlineError;
  onIncreaseContextSize: () => void;
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
            onClick={onIncreaseContextSize}
            className="inline-flex h-10 items-center gap-2 rounded-full border border-red-400/25 bg-white/5 px-4 text-sm font-medium text-white transition-colors hover:bg-white/10"
          >
            <ExclamationTriangleIcon className="h-4 w-4" />
            {i18nService.t('localInferenceContextOverflowAction')}
          </button>
        </div>
      </div>
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
    if (field.key === 'reasoning_preference') {
      return (
        <div className="space-y-1.5">
          <OptionLabel label={label} paramName={showParamName ? field.paramName : undefined} />
          <div className="grid grid-cols-3 rounded-xl border border-border bg-surface-input p-1">
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
    case 'reasoning_preference':
      return [
        { value: 'low', label: i18nService.t('localInferenceReasoningPreferenceLow') },
        { value: 'auto', label: i18nService.t('localInferenceReasoningPreferenceAuto') },
        { value: 'high', label: i18nService.t('localInferenceReasoningPreferenceHigh') },
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
      return { device: 'CUDA0', splitMode: 'none' };
    case 'dual-gpu':
      return { device: 'CUDA0,CUDA1', splitMode: 'layer' };
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
    .map(part => {
      if (/^\d+$/.test(part)) {
        return `CUDA${part}`;
      }
      return /^[A-Za-z0-9_.:-]+$/.test(part) ? part : '';
    })
    .filter(Boolean)
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

function serviceConfigToForm(
  config: OllamaServiceConfig,
  runtimeDevices?: LlamaCppRuntimeListDevicesResult | null,
): OllamaServiceConfigFormState {
  const gpuDetectionState = getLlamaCppGpuDetectionState(runtimeDevices);
  const gpuSelectorsAvailable = gpuDetectionState === LlamaCppGpuDetectionState.Unknown
    || gpuDetectionState === LlamaCppGpuDetectionState.Available;
  return {
    host: config.host ?? '',
    port: config.port ?? '',
    device: normalizeServiceConfigDeviceForForm(config.device, runtimeDevices),
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
    mainGpu: gpuSelectorsAvailable ? (config.mainGpu ?? '') : '',
    mmap: config.noMmap === undefined ? '' : String(!config.noMmap),
    mlock: config.mlock === undefined ? '' : String(config.mlock),
    jinja: config.jinja ?? '',
  };
}

function isGpuIndexedFieldDisabled(
  key: keyof OllamaServiceConfigFormState,
  gpuConfigUnavailable: boolean,
): boolean {
  if (!gpuConfigUnavailable) return false;
  return key === 'device' || key === 'mainGpu';
}

function normalizeServiceConfigDeviceForForm(
  value: string | undefined,
  runtimeDevices?: LlamaCppRuntimeListDevicesResult | null,
): string {
  const trimmed = value?.trim();
  if (!trimmed) return '';
  const gpuDetectionState = getLlamaCppGpuDetectionState(runtimeDevices);
  if (
    gpuDetectionState === LlamaCppGpuDetectionState.Unavailable ||
    gpuDetectionState === LlamaCppGpuDetectionState.DetectionFailed
  ) {
    return '';
  }
  if (/^\d+(?:\s*,\s*\d+)*$/.test(trimmed)) return trimmed;
  if (!runtimeDevices?.success || !Array.isArray(runtimeDevices.devices) || runtimeDevices.devices.length === 0) {
    return trimmed;
  }
  const parts = trimmed.split(',').map(part => part.trim()).filter(Boolean);
  if (parts.length === 0) return '';
  const indexes = parts.map(part =>
    runtimeDevices.devices.findIndex(device => device.id === part || device.name === part),
  );
  if (indexes.some(index => index < 0)) return trimmed;
  return indexes.join(',');
}

function getStructuredServiceConfigFieldErrorMessage(
  key: keyof OllamaServiceConfigFormState,
  fieldErrors: Partial<Record<LlamaCppStructuredServiceFieldKey, LlamaCppStructuredServiceFieldError>>,
): string | undefined {
  const fieldError = fieldErrors[key as LlamaCppStructuredServiceFieldKey];
  if (!fieldError) return undefined;
  switch (fieldError.code) {
    case 'integer-range':
      return i18nService
        .t('localInferenceServiceConfigFieldErrorIntegerRange')
        .replace('{min}', String(fieldError.min ?? ''))
        .replace('{max}', String(fieldError.max ?? ''));
    case 'device-format':
      return i18nService.t('localInferenceServiceConfigFieldErrorDeviceFormat');
    case 'device-unavailable':
      return i18nService.t('localInferenceServiceConfigFieldErrorDeviceUnavailable');
    case 'device-detection-failed':
      return i18nService.t('localInferenceServiceConfigFieldErrorDeviceDetectionFailed');
    case 'device-out-of-range':
      return i18nService
        .t('localInferenceServiceConfigFieldErrorDeviceOutOfRange')
        .replace('{min}', String(fieldError.min ?? ''))
        .replace('{max}', String(fieldError.max ?? ''));
    case 'gpu-layers-format':
      return i18nService.t('localInferenceServiceConfigFieldErrorGpuLayersFormat');
    case 'main-gpu-unavailable':
      return i18nService.t('localInferenceServiceConfigFieldErrorMainGpuUnavailable');
    case 'main-gpu-detection-failed':
      return i18nService.t('localInferenceServiceConfigFieldErrorMainGpuDetectionFailed');
    case 'main-gpu-out-of-range':
      return i18nService
        .t('localInferenceServiceConfigFieldErrorMainGpuOutOfRange')
        .replace('{min}', String(fieldError.min ?? ''))
        .replace('{max}', String(fieldError.max ?? ''));
    case 'tensor-split-format':
      return i18nService.t('localInferenceServiceConfigFieldErrorTensorSplitFormat');
    case 'tensor-split-requires-mode':
      return i18nService.t('localInferenceServiceConfigFieldErrorTensorSplitRequiresMode');
    default:
      return undefined;
  }
}

function getGpuConfigHint(gpuDetectionState: LlamaCppGpuDetectionState): string {
  switch (gpuDetectionState) {
    case LlamaCppGpuDetectionState.DetectionFailed:
      return i18nService.t('localInferenceServiceConfigGpuDetectionFailedHint');
    case LlamaCppGpuDetectionState.Unavailable:
      return i18nService.t('localInferenceServiceConfigGpuUnavailableHint');
    default:
      return i18nService.t('localInferenceServiceConfigGpuUnavailableHint');
  }
}

function getSanitizedServiceConfigFields(
  input: OllamaServiceConfig,
  saved: OllamaServiceConfig,
): string[] {
  const fields: Array<{ key: keyof OllamaServiceConfig; label: string }> = [
    { key: 'modelsMax', label: i18nService.t('localInferenceServiceConfigModelsMaxLabel') },
    { key: 'timeout', label: i18nService.t('localInferenceServiceConfigTimeoutLabel') },
    { key: 'threadsHttp', label: i18nService.t('localInferenceServiceConfigThreadsHttpLabel') },
    { key: 'cacheReuse', label: i18nService.t('localInferenceServiceConfigCacheReuseLabel') },
    { key: 'cacheRam', label: i18nService.t('localInferenceServiceConfigCacheRamLabel') },
    { key: 'ctxSize', label: i18nService.t('localInferenceServiceConfigCtxSizeLabel') },
    { key: 'parallel', label: i18nService.t('localInferenceServiceConfigParallelLabel') },
    { key: 'batchSize', label: i18nService.t('localInferenceServiceConfigBatchSizeLabel') },
    { key: 'ubatchSize', label: i18nService.t('localInferenceServiceConfigUbatchSizeLabel') },
    { key: 'gpuLayers', label: i18nService.t('localInferenceServiceConfigGpuLayersLabel') },
    { key: 'threads', label: i18nService.t('localInferenceServiceConfigThreadsLabel') },
    { key: 'threadsBatch', label: i18nService.t('localInferenceServiceConfigThreadsBatchLabel') },
    { key: 'mainGpu', label: i18nService.t('localInferenceServiceConfigMainGpuLabel') },
  ];
  return fields
    .filter(({ key }) => {
      const original = input[key];
      if (typeof original !== 'string' || !original.trim()) return false;
      const next = saved[key];
      return typeof next !== 'string' || next.trim() !== original.trim();
    })
    .map(({ label }) => label);
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

type ContextWindowBounds = { min: number; max: number; step: number };

function getModelContextWindowRange(params: number): ContextWindowBounds {
  if (params <= 1_500_000_000) return { min: 512, max: 32768, step: 512 };
  if (params <= 4_000_000_000) return { min: 1024, max: 65536, step: 1024 };
  if (params <= 8_000_000_000) return { min: 2048, max: 131072, step: 2048 };
  if (params <= 14_000_000_000) return { min: 2048, max: 131072, step: 4096 };
  return { min: 4096, max: 131072, step: 4096 };
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
      primary: parts.join(' · '),
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

export const __test__getServiceConfigFields = () =>
  SERVICE_CONFIG_FIELDS.map(field => ({ ...field }));
export const __test__getInferenceOptionFields = () =>
  INFERENCE_OPTION_FIELDS.map(field => ({ ...field }));
export const __test__getMarketplacePageSize = () => MARKETPLACE_PAGE_SIZE;
export const __test__buildAssistantMessage = (input: BuildAssistantMessageInput) =>
  buildAssistantMessage(input);
export const __test__buildStreamingAssistantMessage = (
  input: Parameters<typeof buildStreamingAssistantMessage>[0],
) => buildStreamingAssistantMessage(input);
export const __test__getNewAssistantScrollTargetIndex = (historyLength: number) =>
  getNewAssistantScrollTargetIndex(historyLength);
export const __test__buildRequestPreview = (input: RequestPreviewInput) =>
  buildRequestPreview(input);
export const __test__buildMarketplaceSearchParams = (
  input: Parameters<typeof buildMarketplaceSearchParams>[0],
) => buildMarketplaceSearchParams(input);
export const __test__getInstallableMarketplaceModels = (
  models: MarketplaceModel[],
  installedModelPathMap: Map<string, string>,
) => getInstallableMarketplaceModels(models, installedModelPathMap);
export const __test__resolveLaunchServiceConfig = (
  preset: string,
  customGpuDevices: string,
) => resolveLaunchServiceConfig(preset, customGpuDevices);
export const __test__formatLaunchGpuPresetSummary = (
  preset: string,
  customGpuDevices: string,
) => formatLaunchGpuPresetSummary(preset, customGpuDevices);
export const __test__isModelScopeRepoId = (value: string) => isModelScopeRepoId(value);
export const __test__isScrollNearBottom = (input: Parameters<typeof isScrollNearBottom>[0]) =>
  isScrollNearBottom(input);
export const __test__hasHiddenContentBelow = (input: Parameters<typeof hasHiddenContentBelow>[0]) =>
  hasHiddenContentBelow(input);
export const __test__getAssistantScrollTop = (input: Parameters<typeof getAssistantScrollTop>[0]) =>
  getAssistantScrollTop(input);
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
