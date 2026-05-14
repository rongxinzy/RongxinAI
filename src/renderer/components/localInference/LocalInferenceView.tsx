import {
  AdjustmentsHorizontalIcon,
  ArrowDownTrayIcon,
  ArrowPathIcon,
  ArrowTopRightOnSquareIcon,
  BeakerIcon,
  CheckCircleIcon,
  CpuChipIcon,
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
  MarketplaceModel,
  MarketplaceSearchParams,
} from '../../../shared/marketplace';
import type {
  OllamaChatChunk,
  OllamaChatPayload,
  OllamaModel,
  OllamaModelLaunchInput,
  OllamaRunningModel,
  OllamaServiceConfig,
  OllamaStatusSnapshot,
} from '../../../shared/ollama';
import {
  createOllamaStreamState,
  reduceOllamaStreamChunk,
} from '../../../shared/ollama';
import { i18nService } from '../../services/i18n';
import ComposeIcon from '../icons/ComposeIcon';
import SidebarToggleIcon from '../icons/SidebarToggleIcon';
import MarkdownContent from '../MarkdownContent';
import WindowTitleBar from '../window/WindowTitleBar';

type LocalInferenceTab = 'inference' | 'models' | 'marketplace';

type InferenceOptions = {
  temperature: number;
  top_p: number;
  top_k: number;
  num_predict: number;
  repeat_penalty: number;
  seed: number;
  stop: string;
};

type InferenceMessage = {
  role: 'user' | 'assistant';
  content: string;
  thinking?: string;
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

type LaunchGpuPreset = 'service-default' | 'single-auto' | 'gpu0' | 'gpu1' | 'dual-gpu' | 'custom';
type LaunchAccelerationMode = 'auto' | 'cpu' | 'custom';

type LaunchRequest = {
  input: OllamaModelLaunchInput;
  gpuPreset: string;
  customGpuDevices: string;
};

type OllamaServiceConfigFormState = {
  cudaVisibleDevices: string;
  maxLoadedModels: string;
  numParallel: string;
  schedSpread: string;
};

const DEFAULT_INFERENCE_OPTIONS: InferenceOptions = {
  temperature: 0.7,
  top_p: 0.9,
  top_k: 40,
  num_predict: 1024,
  repeat_penalty: 1.1,
  seed: -1,
  stop: '',
};
const MARKETPLACE_INITIAL_VISIBLE_COUNT = 24;
const MARKETPLACE_VISIBLE_INCREMENT = 24;
const smallOutlineButtonClass = 'inline-flex h-7 items-center gap-1.5 rounded-md border border-border px-2 text-xs text-foreground/80 transition-colors hover:bg-surface-raised disabled:cursor-not-allowed disabled:opacity-50';
const smallDangerButtonClass = 'inline-flex h-7 items-center gap-1.5 rounded-md border border-border px-2 text-xs text-red-600 transition-colors hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50 dark:text-red-400 dark:hover:bg-red-950/30';

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
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pullName, setPullName] = useState('');
  const [activePullName, setActivePullName] = useState<string | null>(null);
  const [pullProgress, setPullProgress] = useState<Record<string, Record<string, unknown>>>({});
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
  const [serviceConfig, setServiceConfig] = useState<OllamaServiceConfig>({});
  const marketplaceSearchRef = useRef<number>(0);
  const installedModelNames = useMemo(() => new Set(localModels.map((m) => m.name)), [localModels]);

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
        setMarketplaceError(searchError instanceof Error ? searchError.message : String(searchError));
      }
    } finally {
      if (id === marketplaceSearchRef.current) {
        setMarketplaceLoading(false);
      }
    }
  }, []);

  const handleMarketplaceInstall = async (model: MarketplaceModel) => {
    const name = model.installName ?? model.name;
    setActivePullName(name);
    setPullProgress((current) => ({
      ...current,
      [name]: { status: 'starting' },
    }));
    setError(null);
    setNotice(null);
    try {
      await window.electron.ollama.pullModel(name);
      await refreshLocalModels();
      setNotice(i18nService.t('marketplacePullDone').replace('{name}', name));
    } catch (installError) {
      setError(installError instanceof Error ? installError.message : String(installError));
    }
  };

  const runningModelNames = useMemo(
    () => new Set(runningModels.map((model) => model.name || model.model).filter(Boolean)),
    [runningModels],
  );
  const selectedRunningModel = useMemo(
    () => runningModels.find((model) => model.name === selectedModel || model.model === selectedModel),
    [runningModels, selectedModel],
  );
  const runnableModels = useMemo(
    () => localModels.filter((model) => runningModelNames.has(model.name)),
    [localModels, runningModelNames],
  );

  const refreshStatus = useCallback(async () => {
    const nextStatus = await window.electron.ollama.status();
    setStatus(nextStatus);
    return nextStatus;
  }, []);

  const refreshLocalModels = useCallback(async () => {
    const models = await window.electron.ollama.listLocalModels();
    setLocalModels(models);
    return models;
  }, []);

  const refreshRunningModels = useCallback(async () => {
    const models = await window.electron.ollama.listRunningModels();
    setRunningModels(models);
    return models;
  }, []);

  const runAction = useCallback(async (action: () => Promise<void>) => {
    setLoading(true);
    setError(null);
    setNotice(null);
    try {
      await action();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : String(actionError));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    const unsubscribers = [
      window.electron.ollama.onStatusChanged(setStatus),
      window.electron.ollama.onPullProgress(({ name, chunk }) => {
        setPullProgress((current) => ({ ...current, [name]: chunk }));
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
      unsubscribers.forEach((unsubscribe) => unsubscribe());
    };
  }, [refreshLocalModels, refreshRunningModels, refreshStatus, runAction]);

  const handleSaveServiceConfig = (config: OllamaServiceConfig) => {
    void runAction(async () => {
      const saved = await saveOllamaServiceConfig(config);
      setServiceConfig(saved);
      setNotice(status?.status === 'running'
        ? i18nService.t('localInferenceServiceConfigSavedRestartRequired')
        : i18nService.t('localInferenceServiceConfigSaved'));
    });
  };

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
        task: marketplaceTask === 'all' ? undefined : marketplaceTask as any,
        size: marketplaceSize === 'all' ? undefined : marketplaceSize as any,
        limit: 120,
      });
    }, 200);
    return () => window.clearTimeout(timeout);
  }, [marketplaceQuery, marketplaceTask, marketplaceSize, searchMarketplace]);

  const handlePrepare = () => {
    void runAction(async () => {
      if (status?.status === 'not-installed') {
        await window.electron.ollama.install();
        setNotice(i18nService.t('localInferenceInstallOpened'));
      } else if (status?.status === 'installed' || status?.status === 'stopped') {
        await window.electron.ollama.start();
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
      await window.electron.ollama.stop();
      const nextStatus = await refreshStatus();
      if (nextStatus.status === 'running') {
        await refreshRunningModels();
      } else {
        setRunningModels([]);
      }
    });
  };

  const handlePull = () => {
    if (!normalizedPullName) return;
    setActivePullName(normalizedPullName);
    setPullProgress((current) => ({
      ...current,
      [normalizedPullName]: { status: 'starting' },
    }));
    void runAction(async () => {
      await window.electron.ollama.pullModel(normalizedPullName);
      await refreshLocalModels();
      setNotice(i18nService.t('localInferencePullDone').replace('{name}', normalizedPullName));
    });
  };

  const handleCancelPull = () => {
    if (!activePullName) return;
    void window.electron.ollama.cancelPull(activePullName).catch((cancelError) => {
      setError(cancelError instanceof Error ? cancelError.message : String(cancelError));
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
        const restartedStatus = await window.electron.ollama.restart();
        setStatus(restartedStatus);
        if (restartedStatus.status !== 'running') {
          throw new Error(restartedStatus.error || i18nService.t('localInferenceLaunchRestartFailed'));
        }
      }

      const result = await window.electron.ollama.preloadModel(request.input);
      setRunningModels(result.runningModels);
      setSelectedModel(request.input.model);
      setLaunchTarget(null);
      if (openDebugger) {
        setActiveTab('inference');
      }
    });
  };

  const handleUnload = (modelName: string) => {
    void runAction(async () => {
      const result = await window.electron.ollama.unloadModel(modelName);
      setRunningModels(result.runningModels);
    });
  };

  const handleDelete = (modelName: string) => {
    void runAction(async () => {
      await window.electron.ollama.deleteModel(modelName);
      await refreshLocalModels();
      await refreshRunningModels();
    });
  };

  const handleSetOpenClawModel = (modelName: string) => {
    void runAction(async () => {
      const result = await window.electron.ollama.setOpenClawModel(modelName);
      if (!result.success) throw new Error(result.error || i18nService.t('localInferenceSetOpenClawFailed'));
      setNotice(i18nService.t('localInferenceSetOpenClawDone').replace('{name}', modelName));
    });
  };

  const handleSavePreset = () => {
    localStorage.setItem('lobsterai:ollama-inference-options', JSON.stringify(options));
    setNotice(i18nService.t('localInferencePresetSaved'));
  };

  const sendPrompt = async () => {
    if (!selectedModel || !selectedRunningModel || !prompt.trim()) return;
    const userMessage = prompt.trim();
    const baseHistory = messagesRef.current;
    const nextHistory: InferenceMessage[] = [...baseHistory, { role: 'user', content: userMessage }];
    setMessages(nextHistory);
    messagesRef.current = nextHistory;
    setPrompt('');
    setStreamingText('');
    setStreamingThinking('');
    setSending(true);
    setCancelling(false);
    setError(null);
    const requestId = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    activeRequestIdRef.current = requestId;

    let streamState = createOllamaStreamState();
    const unsubscribe = window.electron.ollama.onChatStreamChunk(({ requestId: eventRequestId, chunk }) => {
      if (eventRequestId !== requestId) return;
      streamState = reduceOllamaStreamChunk(streamState, chunk);
      setStreamingThinking(streamState.thinking);
      setStreamingText(streamState.content);
    });

    try {
      const payload: OllamaChatPayload = {
        model: selectedModel,
        stream: true,
        messages: [
          ...(systemPrompt.trim() ? [{ role: 'system' as const, content: systemPrompt.trim() }] : []),
          ...baseHistory.map((message) => ({
            role: message.role,
            content: message.content,
            ...(message.role === 'assistant' && message.thinking ? { thinking: message.thinking } : {}),
          })),
          { role: 'user', content: userMessage },
        ],
        options: normalizeOptions(options),
      };
      await window.electron.ollama.chatStream(requestId, payload);
      const assistantMessage: InferenceMessage = {
        role: 'assistant',
        content: streamState.content,
        thinking: streamState.thinking || undefined,
        metrics: streamState.finalChunk,
      };
      setMessages([...nextHistory, assistantMessage]);
      messagesRef.current = [...nextHistory, assistantMessage];
      await refreshRunningModels().catch(() => undefined);
    } catch (sendError) {
      if (sendError instanceof Error && sendError.message.includes('Generation cancelled')) {
        setNotice(i18nService.t('localInferenceGenerationCancelled'));
        if (streamState.content || streamState.thinking) {
          const assistantMessage: InferenceMessage = {
            role: 'assistant',
            content: streamState.content,
            thinking: streamState.thinking || undefined,
            metrics: streamState.finalChunk,
          };
          setMessages([...nextHistory, assistantMessage]);
          messagesRef.current = [...nextHistory, assistantMessage];
        }
      } else {
        setMessages(baseHistory);
        messagesRef.current = baseHistory;
        setError(sendError instanceof Error ? sendError.message : String(sendError));
      }
    } finally {
      unsubscribe();
      activeRequestIdRef.current = null;
      setSending(false);
      setCancelling(false);
      setStreamingText('');
      setStreamingThinking('');
    }
  };

  const stopGeneration = async () => {
    const requestId = activeRequestIdRef.current;
    if (!requestId) return;
    setCancelling(true);
    try {
      await window.electron.ollama.cancelChatStream(requestId);
    } catch (cancelError) {
      setError(cancelError instanceof Error ? cancelError.message : String(cancelError));
      setCancelling(false);
    }
  };

  return (
    <div className="flex-1 flex flex-col bg-background h-full">
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
          <h1 className="text-lg font-semibold text-foreground">{i18nService.t('localInferenceTitle')}</h1>
        </div>
        <WindowTitleBar inline />
      </div>

      <div className="flex-1 overflow-y-auto min-h-0 [scrollbar-gutter:stable]">
        <div className="mx-auto max-w-6xl px-4 py-5 space-y-4">
          <ServiceHeader
            status={status}
            loading={loading}
            localModels={localModels}
            runningModels={runningModels}
            serviceConfig={serviceConfig}
            onPrepare={handlePrepare}
            onStop={handleStop}
            onSaveServiceConfig={handleSaveServiceConfig}
            onRefresh={() => void runAction(async () => {
              const nextStatus = await refreshStatus();
              if (nextStatus.status === 'running') {
                await refreshLocalModels();
                await refreshRunningModels();
              }
            })}
          />

          {(notice || error) && (
            <div className={`rounded-md border px-3 py-2 text-sm ${
              error
                ? 'border-red-300 bg-red-50 text-red-700 dark:border-red-900/60 dark:bg-red-950/20 dark:text-red-300'
                : 'border-border bg-surface text-secondary'
            }`}>
              {error || notice}
            </div>
          )}

          <div className="inline-flex rounded-lg bg-surface-raised p-1">
            {(['inference', 'models', 'marketplace'] as LocalInferenceTab[]).map((tab) => (
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
                {i18nService.t(tab === 'inference' ? 'localInferenceTabInference' : tab === 'models' ? 'localInferenceTabModels' : 'localInferenceTabMarketplace')}
              </button>
            ))}
          </div>

          {activeTab === 'models' ? (
            <ModelsPanel
              isRunning={isRunning}
              loading={loading}
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
              onOpenInference={(modelName) => {
                setSelectedModel(modelName);
                setActiveTab('inference');
              }}
            />
          ) : activeTab === 'marketplace' ? (
            <MarketplacePanel
              isRunning={isRunning}
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
              installedModelNames={installedModelNames}
              onQueryChange={setMarketplaceQuery}
              onTaskChange={setMarketplaceTask}
              onSizeChange={setMarketplaceSize}
              onSearch={() => void searchMarketplace({
                query: marketplaceQuery.trim() || undefined,
                task: marketplaceTask === 'all' ? undefined : marketplaceTask as any,
                size: marketplaceSize === 'all' ? undefined : marketplaceSize as any,
                limit: 120,
              })}
              onInstall={handleMarketplaceInstall}
              onCancelPull={handleCancelPull}
              onOpenInference={(modelName) => {
                setSelectedModel(modelName);
                setActiveTab('inference');
              }}
            />
          ) : (
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
              onModelChange={setSelectedModel}
              onSystemPromptChange={setSystemPrompt}
              onPromptChange={setPrompt}
              onOptionsChange={setOptions}
              onSavePreset={handleSavePreset}
              onSend={() => void sendPrompt()}
              onStop={() => void stopGeneration()}
              onOpenModels={() => setActiveTab('models')}
            />
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
    </div>
  );
};

function ServiceHeader({
  status,
  loading,
  localModels,
  runningModels,
  serviceConfig,
  onPrepare,
  onStop,
  onSaveServiceConfig,
  onRefresh,
}: {
  status: OllamaStatusSnapshot | null;
  loading: boolean;
  localModels: OllamaModel[];
  runningModels: OllamaRunningModel[];
  serviceConfig: OllamaServiceConfig;
  onPrepare: () => void;
  onStop: () => void;
  onSaveServiceConfig: (config: OllamaServiceConfig) => void;
  onRefresh: () => void;
}) {
  const running = status?.status === 'running';
  const managedByApp = Boolean(status?.managedByApp);
  const canPrepare = status?.status === 'not-installed'
    || status?.status === 'installed'
    || status?.status === 'stopped';
  const actionLabel = status?.status === 'not-installed'
    ? i18nService.t('localInferenceInstall')
    : i18nService.t('localInferenceStart');
  return (
    <section className="rounded-lg border border-border bg-surface px-3 py-3">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <CpuChipIcon className="h-4 w-4 text-secondary" />
            <h2 className="text-sm font-semibold text-foreground">{i18nService.t('localInferenceService')}</h2>
            <StatusBadge status={status?.status ?? 'unknown'} />
            {status?.version && <span className="font-mono text-xs text-secondary">v{status.version}</span>}
            {running && (
              <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                managedByApp
                  ? 'bg-blue-500/15 text-blue-500'
                  : 'bg-amber-500/15 text-amber-500'
              }`}>
                {i18nService.t(managedByApp ? 'localInferenceServiceManagedByApp' : 'localInferenceServiceExternal')}
              </span>
            )}
          </div>
          <p className="mt-1 text-xs text-secondary">
            {i18nService.t('localInferenceServiceHint')
              .replace('{local}', String(localModels.length))
              .replace('{running}', String(runningModels.length))}
          </p>
          {running && !managedByApp && (
            <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">
              {i18nService.t('localInferenceExternalServiceHint')}
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={onRefresh}
            disabled={loading}
            className={smallOutlineButtonClass}
          >
            <ArrowPathIcon className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            {i18nService.t('refresh')}
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
        </div>
      </div>
      <OllamaServiceConfigPanel
        loading={loading}
        running={running}
        managedByApp={managedByApp}
        config={serviceConfig}
        onSave={onSaveServiceConfig}
      />
    </section>
  );
}

function OllamaServiceConfigPanel({
  loading,
  running,
  managedByApp,
  config,
  onSave,
}: {
  loading: boolean;
  running: boolean;
  managedByApp: boolean;
  config: OllamaServiceConfig;
  onSave: (config: OllamaServiceConfig) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [form, setForm] = useState<OllamaServiceConfigFormState>(() => serviceConfigToForm(config));

  useEffect(() => {
    setForm(serviceConfigToForm(config));
  }, [config]);

  const updateForm = (key: keyof OllamaServiceConfigFormState, value: string) => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  const save = () => {
    onSave({
      cudaVisibleDevices: form.cudaVisibleDevices,
      maxLoadedModels: form.maxLoadedModels,
      numParallel: form.numParallel,
      ...(form.schedSpread ? { schedSpread: form.schedSpread === 'true' } : {}),
    });
  };

  return (
    <div className="mt-3 border-t border-border pt-3">
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        className="inline-flex items-center gap-1.5 text-xs font-medium text-secondary transition-colors hover:text-foreground"
      >
        <AdjustmentsHorizontalIcon className="h-3.5 w-3.5" />
        {i18nService.t('localInferenceServiceConfigTitle')}
      </button>
      {expanded && (
        <div className="mt-3 rounded-md border border-border bg-background/60 p-3">
          <p className="text-xs text-secondary">{i18nService.t('localInferenceServiceConfigDescription')}</p>
          {running && !managedByApp && (
            <p className="mt-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
              {i18nService.t('localInferenceServiceConfigExternalWarning')}
            </p>
          )}
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <ServiceConfigInput
              label="CUDA_VISIBLE_DEVICES"
              value={form.cudaVisibleDevices}
              placeholder="0,1"
              hint={i18nService.t('localInferenceServiceConfigCudaHint')}
              onChange={(value) => updateForm('cudaVisibleDevices', value)}
            />
            <ServiceConfigInput
              label="OLLAMA_MAX_LOADED_MODELS"
              value={form.maxLoadedModels}
              placeholder={i18nService.t('localInferenceLaunchDefault')}
              hint={i18nService.t('localInferenceServiceConfigMaxLoadedHint')}
              onChange={(value) => updateForm('maxLoadedModels', value)}
            />
            <ServiceConfigInput
              label="OLLAMA_NUM_PARALLEL"
              value={form.numParallel}
              placeholder={i18nService.t('localInferenceLaunchDefault')}
              hint={i18nService.t('localInferenceServiceConfigNumParallelHint')}
              onChange={(value) => updateForm('numParallel', value)}
            />
            <label className="space-y-1.5 md:col-span-2">
              <span className="font-mono text-xs font-semibold text-foreground">OLLAMA_SCHED_SPREAD</span>
              <select
                value={form.schedSpread}
                onChange={(event) => updateForm('schedSpread', event.target.value)}
                className="h-8 w-full rounded-md border border-border bg-surface px-2 text-sm text-foreground outline-none transition-colors focus:border-primary/60"
              >
                <option value="">{i18nService.t('localInferenceLaunchDefault')}</option>
                <option value="true">{i18nService.t('localInferenceLaunchBooleanEnabled')}</option>
                <option value="false">{i18nService.t('localInferenceLaunchBooleanDisabled')}</option>
              </select>
              <p className="text-xs text-secondary">{i18nService.t('localInferenceServiceConfigSchedSpreadHint')}</p>
            </label>
          </div>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-secondary">
              {running && !managedByApp
                ? i18nService.t('localInferenceServiceConfigExternalHint')
                : running
                ? i18nService.t('localInferenceServiceConfigRestartHint')
                : i18nService.t('localInferenceServiceConfigStartHint')}
            </p>
            <button
              type="button"
              onClick={save}
              disabled={loading}
              className="inline-flex h-7 items-center rounded-md bg-primary px-2.5 text-xs font-medium text-white transition-colors hover:bg-primary-hover disabled:opacity-60"
            >
              {i18nService.t('save')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function ServiceConfigInput({
  label,
  value,
  placeholder,
  hint,
  onChange,
}: {
  label: string;
  value: string;
  placeholder: string;
  hint: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="space-y-1.5">
      <span className="font-mono text-xs font-semibold text-foreground">{label}</span>
      <input
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        className="h-8 w-full rounded-md border border-border bg-surface px-2 font-mono text-sm text-foreground outline-none transition-colors focus:border-primary/60"
      />
      <p className="text-xs text-secondary">{hint}</p>
    </label>
  );
}

function StatusBadge({ status }: { status: string }) {
  const ok = status === 'running';
  return (
    <span className={`inline-flex h-5 items-center rounded-md px-1.5 text-[11px] font-medium ${
      ok
        ? 'bg-green-500/10 text-green-600 dark:text-green-400'
        : 'bg-surface-raised text-secondary'
    }`}>
      {i18nService.t(`localInferenceStatus_${status}`) || status}
    </span>
  );
}

function ModelsPanel({
  isRunning,
  loading,
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
  localModels: OllamaModel[];
  runningModels: OllamaRunningModel[];
  pullName: string;
  activePullName: string | null;
  activePullProgress?: Record<string, unknown>;
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
        <h2 className="text-sm font-semibold text-foreground">{i18nService.t('localInferencePullTitle')}</h2>
        <p className="mt-1 text-xs text-secondary">{i18nService.t('localInferencePullHint')}</p>
        <div className="mt-3 flex flex-col gap-2 md:flex-row md:items-center">
          <input
            value={pullName}
            onChange={(event) => onPullNameChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && isRunning && pullName.trim() && !pulling) onPull();
            }}
            disabled={!isRunning || pulling}
            placeholder={i18nService.t('localInferencePullPlaceholder')}
            className="h-8 flex-1 rounded-md border border-border bg-background px-2.5 font-mono text-sm text-foreground outline-none transition-colors focus:border-primary/60 disabled:opacity-60"
          />
          {pulling ? (
            <button
              type="button"
              onClick={onCancelPull}
              className={smallOutlineButtonClass}
            >
              <StopIcon className="h-3.5 w-3.5" />
              {i18nService.t('localInferenceCancelPull')}
            </button>
          ) : (
            <button
              type="button"
              onClick={onPull}
              disabled={!isRunning || !pullName.trim() || loading}
              className="inline-flex h-8 items-center justify-center gap-1.5 rounded-md bg-primary px-3 text-sm font-medium text-white transition-colors hover:bg-primary-hover disabled:opacity-60"
            >
              <ArrowDownTrayIcon className="h-4 w-4" />
              {i18nService.t('localInferencePull')}
            </button>
          )}
        </div>
        {activePullName && activePullProgress && (
          <div className="mt-3 rounded-md bg-surface-raised px-3 py-2 text-xs text-secondary">
            <span className="font-mono text-foreground">{activePullName}</span>
            <span className="ml-2">{formatPullProgress(activePullProgress)}</span>
          </div>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-foreground">{i18nService.t('localInferenceRegisteredModels')}</h2>
        {!isRunning ? (
          <EmptyState title={i18nService.t('localInferenceServiceStopped')} />
        ) : localModels.length === 0 ? (
          <EmptyState title={i18nService.t('localInferenceNoModels')} />
        ) : (
          <div className="overflow-hidden rounded-lg border border-border bg-surface">
            {localModels.map((model) => {
              const runningModel = runningModels.find((item) => item.name === model.name || item.model === model.name);
              return (
                <ModelCard
                  key={model.name}
                  model={model}
                  runningModel={runningModel}
                  loading={loading}
                  onConfigureLaunch={() => onConfigureLaunch(model)}
                  onUnload={() => onUnload(model.name)}
                  onDelete={() => onDelete(model.name)}
                  onSetOpenClawModel={() => onSetOpenClawModel(model.name)}
                  onOpenInference={() => onOpenInference(model.name)}
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
  onConfigureLaunch,
  onUnload,
  onDelete,
  onSetOpenClawModel,
  onOpenInference,
}: {
  model: OllamaModel;
  runningModel?: OllamaRunningModel;
  loading: boolean;
  onConfigureLaunch: () => void;
  onUnload: () => void;
  onDelete: () => void;
  onSetOpenClawModel: () => void;
  onOpenInference: () => void;
}) {
  const isRunning = Boolean(runningModel);
  return (
    <div className="flex flex-col gap-3 border-b border-border px-3 py-3 last:border-b-0 md:flex-row md:items-center md:justify-between">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="truncate font-mono text-sm font-medium text-foreground">{model.name}</h3>
          {model.details?.parameter_size && <Badge>{model.details.parameter_size}</Badge>}
          {model.details?.quantization_level && <Badge>{model.details.quantization_level}</Badge>}
          {isRunning && <Badge tone="success">{i18nService.t('localInferenceLoaded')}</Badge>}
        </div>
        <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-xs text-secondary">
          {model.size ? <span>{i18nService.t('localInferenceSize')}: {formatBytes(model.size)}</span> : null}
          {model.modified_at ? <span>{i18nService.t('localInferenceModified')}: {formatDate(model.modified_at)}</span> : null}
          {model.details?.family ? <span>{i18nService.t('localInferenceFamily')}: {model.details.family}</span> : null}
          {runningModel?.size_vram ? <span>{i18nService.t('localInferenceVram')}: {formatBytes(runningModel.size_vram)}</span> : null}
        </div>
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        {isRunning ? (
          <button type="button" onClick={onUnload} disabled={loading} className={smallOutlineButtonClass}>
            <StopIcon className="h-3.5 w-3.5" />
            {i18nService.t('localInferenceUnload')}
          </button>
        ) : (
          <button type="button" onClick={onConfigureLaunch} disabled={loading} className={smallOutlineButtonClass}>
            <PlayIcon className="h-3.5 w-3.5" />
            {i18nService.t('localInferenceConfigureLaunch')}
          </button>
        )}
        <button type="button" onClick={onOpenInference} disabled={!isRunning} className={smallOutlineButtonClass}>
          <ServerStackIcon className="h-3.5 w-3.5" />
          {i18nService.t('localInferenceInfer')}
        </button>
        <button type="button" onClick={onSetOpenClawModel} className={smallOutlineButtonClass}>
          <CheckCircleIcon className="h-3.5 w-3.5" />
          {i18nService.t('localInferenceUseOpenClaw')}
        </button>
        <button type="button" onClick={onDelete} className={smallDangerButtonClass}>
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
    setForm((current) => ({ ...current, [key]: value }));
  };
  const buildInput = (): OllamaModelLaunchInput => {
    const options: NonNullable<OllamaModelLaunchInput['options']> = {};
    const parsedNumCtx = parseOptionalInteger(form.numCtx);
    const parsedNumGpu = resolveAccelerationNumGpu(form.accelerationMode, form.customGpuLayers);
    const parsedNumThread = parseOptionalInteger(form.numThread);
    const parsedNumBatch = parseOptionalInteger(form.numBatch);
    const parsedUseMmap = parseOptionalBoolean(form.useMmap);

    if (parsedNumCtx !== undefined) options.num_ctx = parsedNumCtx;
    if (parsedNumBatch !== undefined) options.num_batch = parsedNumBatch;
    if (parsedNumGpu !== undefined) options.num_gpu = parsedNumGpu;
    if (parsedUseMmap !== undefined) options.use_mmap = parsedUseMmap;
    if (parsedNumThread !== undefined) options.num_thread = parsedNumThread;

    return {
      model: model.name,
      keep_alive: -1,
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
    setForm((current) => ({
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
  const servicePatch = resolveLaunchServiceConfig(form.gpuPreset, form.customGpuDevices);
  const gpuPresetChangesService = servicePatch !== null && hasServiceConfigPatchChanged(serviceConfig, servicePatch);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-border bg-background shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-border bg-surface/40 px-5 py-4">
          <div className="min-w-0">
            <h3 className="text-xl font-semibold text-foreground">{i18nService.t('localInferenceLaunchTitle')}</h3>
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
                <h4 className="text-sm font-semibold text-foreground">{i18nService.t('localInferenceLaunchLifecycleTitle')}</h4>
                <p className="mt-1 text-sm text-secondary">{i18nService.t('localInferenceLaunchLifecycleDescription')}</p>
              </div>
              <span className="shrink-0 rounded-full bg-surface-raised px-2.5 py-1 text-xs text-secondary">
                {i18nService.t('localInferenceLaunchKeepAliveForever')}
              </span>
            </div>
          </section>

          <section className="flex flex-col gap-3 rounded-xl border border-primary/20 bg-primary/5 px-4 py-3 md:flex-row md:items-center md:justify-between">
            <div className="min-w-0">
              <h4 className="text-sm font-semibold text-foreground">{i18nService.t('localInferenceLaunchAutoTitle')}</h4>
              <p className="mt-1 text-sm text-secondary">
                {optimizationSummary || i18nService.t('localInferenceLaunchAutoDescription')}
              </p>
              <p className="mt-1 text-xs text-secondary">{i18nService.t('localInferenceLaunchAutoFormula')}</p>
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
              <h4 className="text-sm font-semibold text-foreground">{i18nService.t('localInferenceLaunchGpuPresetTitle')}</h4>
              <p className="mt-1 text-sm text-secondary">{i18nService.t('localInferenceLaunchGpuPresetDescription')}</p>
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
                    value: 'gpu0',
                    label: i18nService.t('localInferenceLaunchGpu0'),
                    description: i18nService.t('localInferenceLaunchGpu0Hint'),
                  },
                  {
                    value: 'gpu1',
                    label: i18nService.t('localInferenceLaunchGpu1'),
                    description: i18nService.t('localInferenceLaunchGpu1Hint'),
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
                onChange={(value) => updateForm('gpuPreset', value)}
              />
              <div className="rounded-lg border border-border bg-background/70 p-3">
                <p className="text-xs font-medium text-secondary">{i18nService.t('localInferenceLaunchGpuCurrent')}</p>
                <p className="mt-1 font-mono text-sm text-foreground">
                  {formatCurrentGpuServiceConfig(serviceConfig)}
                </p>
                <p className="mt-3 text-xs font-medium text-secondary">{i18nService.t('localInferenceLaunchGpuWillUse')}</p>
                <p className="mt-1 font-mono text-sm text-foreground">
                  {formatLaunchGpuPresetSummary(form.gpuPreset, form.customGpuDevices)}
                </p>
              </div>
            </div>
            {form.gpuPreset === 'custom' && (
              <LaunchTextInput
                label={i18nService.t('localInferenceLaunchGpuCustomValue')}
                value={form.customGpuDevices}
                placeholder="0,1"
                hint={i18nService.t('localInferenceLaunchGpuCustomValueHint')}
                onChange={(value) => updateForm('customGpuDevices', value)}
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
              <h4 className="text-sm font-semibold text-foreground">{i18nService.t('localInferenceLaunchBasicTitle')}</h4>
              <p className="mt-1 text-sm text-secondary">{i18nService.t('localInferenceLaunchBasicDescription')}</p>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
            <LaunchInput
              label={i18nService.t('localInferenceLaunchNumCtx')}
              value={form.numCtx}
              min={512}
              step={512}
              hint={i18nService.t('localInferenceLaunchNumCtxHint')}
              onChange={(value) => updateForm('numCtx', value)}
            />
            <LaunchChoiceSelect
              label={i18nService.t('localInferenceLaunchAcceleration')}
              value={form.accelerationMode}
              options={[
                { value: 'auto', label: i18nService.t('localInferenceLaunchAccelerationAuto') },
                { value: 'cpu', label: i18nService.t('localInferenceLaunchAccelerationCpu') },
                { value: 'custom', label: i18nService.t('localInferenceLaunchAccelerationCustom') },
              ]}
              hint={i18nService.t('localInferenceLaunchAccelerationHint')}
              onChange={(value) => updateForm('accelerationMode', value)}
            />
            {form.accelerationMode === 'custom' && (
              <LaunchInput
                label={i18nService.t('localInferenceLaunchNumGpu')}
                value={form.customGpuLayers}
                min={0}
                placeholder={i18nService.t('localInferenceLaunchDefault')}
                hint={i18nService.t('localInferenceLaunchNumGpuHint')}
                onChange={(value) => updateForm('customGpuLayers', value)}
              />
            )}
            </div>
          </section>

          <section className="space-y-3 rounded-xl border border-border px-4 py-3">
            <div>
              <h4 className="text-sm font-semibold text-foreground">{i18nService.t('localInferenceLaunchAdvancedTitle')}</h4>
              <p className="mt-1 text-sm text-secondary">{i18nService.t('localInferenceLaunchAdvancedDescription')}</p>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <LaunchInput
                label={i18nService.t('localInferenceLaunchNumThread')}
                value={form.numThread}
                min={1}
                placeholder={i18nService.t('localInferenceLaunchDefault')}
                hint={i18nService.t('localInferenceLaunchNumThreadHint')}
                onChange={(value) => updateForm('numThread', value)}
              />
              <LaunchInput
                label={i18nService.t('localInferenceLaunchNumBatch')}
                value={form.numBatch}
                min={1}
                step={32}
                placeholder={i18nService.t('localInferenceLaunchDefault')}
                hint={i18nService.t('localInferenceLaunchNumBatchHint')}
                onChange={(value) => updateForm('numBatch', value)}
              />
              <LaunchSelect
                label={i18nService.t('localInferenceLaunchUseMmap')}
                value={form.useMmap}
                hint={i18nService.t('localInferenceLaunchUseMmapHint')}
                onChange={(value) => updateForm('useMmap', value)}
              />
            </div>
          </section>
        </div>

        <div className="flex flex-col gap-2 border-t border-border px-5 py-4 sm:flex-row sm:justify-end">
          <button type="button" onClick={onClose} disabled={loading} className="inline-flex h-9 items-center justify-center rounded-lg border border-border px-4 text-sm text-foreground transition-colors hover:bg-surface-raised disabled:opacity-60">
            {i18nService.t('cancel')}
          </button>
          <button type="button" onClick={() => onLaunch(buildLaunchRequest(), false)} disabled={loading} className={smallOutlineButtonClass.replace('h-7', 'h-9').replace('text-xs', 'text-sm') + ' justify-center px-4'}>
            <PlayIcon className="h-4 w-4" />
            {i18nService.t('localInferenceLaunchLoadOnly')}
          </button>
          <button type="button" onClick={() => onLaunch(buildLaunchRequest(), true)} disabled={loading} className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg bg-primary px-4 text-sm font-medium text-white transition-colors hover:bg-primary-hover disabled:opacity-60">
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
        onChange={(event) => onChange(event.target.value)}
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
        onChange={(event) => onChange(event.target.value)}
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
      {options.map((option) => {
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
            <span className="mt-1 block text-xs leading-5 text-secondary">{option.description}</span>
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
        onChange={(event) => onChange(event.target.value)}
        className="h-10 w-full rounded-lg border border-border bg-surface-input px-3 text-sm text-foreground outline-none transition-colors focus:border-primary/60"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>{option.label}</option>
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
        onChange={(event) => onChange(event.target.value)}
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
  if (!isRunning || runnableModels.length === 0) {
    return (
      <EmptyState
        title={i18nService.t(!isRunning ? 'localInferenceServiceStopped' : 'localInferenceNoLoadedModels')}
        action={(
          <button type="button" onClick={onOpenModels} className="inline-flex h-9 items-center rounded-lg border border-border px-3 text-sm text-foreground hover:bg-surface-raised">
            {i18nService.t('localInferenceOpenModels')}
          </button>
        )}
      />
    );
  }

  return (
    <div className="grid min-h-[620px] gap-4 lg:grid-cols-[300px_minmax(0,1fr)]">
      <aside className="rounded-lg border border-border bg-surface p-3">
        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-secondary">{i18nService.t('localInferenceModel')}</label>
            <select
              value={selectedModel}
              onChange={(event) => onModelChange(event.target.value)}
              className="h-8 w-full rounded-md border border-border bg-background px-2.5 text-sm text-foreground outline-none focus:border-primary/60"
            >
              {runnableModels.map((model) => (
                <option key={model.name} value={model.name}>{model.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-secondary">{i18nService.t('localInferenceSystemPrompt')}</label>
            <textarea
              value={systemPrompt}
              onChange={(event) => onSystemPromptChange(event.target.value)}
              className="min-h-20 w-full resize-y rounded-md border border-border bg-background px-2.5 py-2 text-sm text-foreground outline-none focus:border-primary/60"
            />
          </div>
          <RangeControl label="temperature" min={0} max={2} step={0.1} value={options.temperature} onChange={(value) => onOptionsChange({ ...options, temperature: value })} />
          <RangeControl label="top_p" min={0} max={1} step={0.05} value={options.top_p} onChange={(value) => onOptionsChange({ ...options, top_p: value })} />
          <RangeControl label="top_k" min={1} max={100} step={1} value={options.top_k} onChange={(value) => onOptionsChange({ ...options, top_k: value })} />
          <RangeControl label="num_predict" min={-1} max={32768} step={1} value={options.num_predict} onChange={(value) => onOptionsChange({ ...options, num_predict: value })} />
          <RangeControl label="repeat_penalty" min={0} max={2} step={0.05} value={options.repeat_penalty} onChange={(value) => onOptionsChange({ ...options, repeat_penalty: value })} />
          <div>
            <label className="mb-1 block text-xs font-medium text-secondary">seed</label>
            <input
              type="number"
              value={options.seed}
              onChange={(event) => onOptionsChange({ ...options, seed: Number(event.target.value) })}
              className="h-8 w-full rounded-md border border-border bg-background px-2.5 font-mono text-sm text-foreground outline-none focus:border-primary/60"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-secondary">stop</label>
            <input
              value={options.stop}
              onChange={(event) => onOptionsChange({ ...options, stop: event.target.value })}
              className="h-8 w-full rounded-md border border-border bg-background px-2.5 font-mono text-sm text-foreground outline-none focus:border-primary/60"
            />
          </div>
          <button type="button" onClick={onSavePreset} className="h-8 w-full rounded-md bg-primary text-sm font-medium text-white transition-colors hover:bg-primary-hover">
            {i18nService.t('localInferenceSavePreset')}
          </button>
        </div>
      </aside>

      <main className="flex min-h-0 flex-col rounded-lg border border-border bg-surface">
        <div className="flex items-center justify-between border-b border-border px-3 py-2.5">
          <div className="min-w-0">
            <h2 className="truncate text-sm font-semibold text-foreground">{selectedModel}</h2>
            <p className="text-xs text-secondary">
              {selectedRunningModel ? i18nService.t('localInferenceLoaded') : i18nService.t('localInferenceNoLoadedModels')}
            </p>
          </div>
          {selectedRunningModel?.context_length && (
            <Badge>{selectedRunningModel.context_length}</Badge>
          )}
        </div>
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
          {messages.length === 0 && !sending && (
            <div className="flex min-h-[360px] items-center justify-center text-sm text-secondary">
              {i18nService.t('localInferenceEmptyChat')}
            </div>
          )}
          {messages.map((message, index) => (
            <ChatBubble key={index} message={message} />
          ))}
          {sending && (streamingText || streamingThinking) && (
            <ChatBubble
              message={{
                role: 'assistant',
                content: streamingText || i18nService.t('localInferenceAwaitingResponse'),
                thinking: streamingThinking || undefined,
              }}
              streaming
            />
          )}
        </div>
        <div className="border-t border-border p-3">
          <div className="flex gap-2">
            <textarea
              value={prompt}
              onChange={(event) => onPromptChange(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey && !sending) {
                  event.preventDefault();
                  onSend();
                }
              }}
              disabled={sending}
              className="min-h-16 flex-1 resize-none rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary/60"
              placeholder={i18nService.t('localInferencePromptPlaceholder')}
            />
            <button
              type="button"
              onClick={sending ? onStop : onSend}
              disabled={!selectedModel || cancelling || (!prompt.trim() && !sending)}
              className="inline-flex h-16 w-16 items-center justify-center rounded-md bg-primary text-white transition-colors hover:bg-primary-hover disabled:opacity-60"
              aria-label={sending ? i18nService.t('localInferenceStopGeneration') : i18nService.t('localInferenceSend')}
            >
              {sending ? <StopIcon className="h-5 w-5" /> : <PaperAirplaneIcon className="h-5 w-5" />}
            </button>
          </div>
        </div>
      </main>
    </div>
  );
}

function ChatBubble({ message, streaming = false }: { message: InferenceMessage; streaming?: boolean }) {
  const isUser = message.role === 'user';
  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div className={`max-w-[86%] rounded-lg border px-3 py-2.5 text-sm leading-7 ${
        isUser
          ? 'border-primary/20 bg-primary/10 text-foreground'
          : 'border-border bg-background text-foreground'
      }`}>
        {message.thinking && (
          <details className="mb-2 text-xs text-secondary">
            <summary className="cursor-pointer select-none">{i18nService.t('localInferenceThinking')}</summary>
            <p className="mt-1 whitespace-pre-wrap opacity-80">{message.thinking}</p>
          </details>
        )}
        {isUser ? (
          <div className="whitespace-pre-wrap break-words">{message.content}</div>
        ) : (
          <MarkdownContent content={message.content} />
        )}
        {streaming && <span className="ml-0.5 inline-block h-4 w-2 animate-pulse bg-foreground/50 align-text-bottom" />}
        {message.metrics && (
          <p className="mt-2 border-t border-border pt-2 text-xs text-secondary">
            {formatMetricsSummary(message.metrics)}
          </p>
        )}
      </div>
    </div>
  );
}

function RangeControl({
  label,
  min,
  max,
  step,
  value,
  onChange,
}: {
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <label className="font-mono text-xs font-medium text-secondary">{label}</label>
        <span className="font-mono text-xs text-secondary">{value}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="w-full accent-primary"
      />
    </div>
  );
}

function Badge({ children, tone = 'neutral' }: { children: React.ReactNode; tone?: 'neutral' | 'success' }) {
  return (
    <span className={`inline-flex h-5 items-center rounded-md px-1.5 text-[11px] font-medium ${
      tone === 'success'
        ? 'bg-green-500/10 text-green-600 dark:text-green-400'
        : 'bg-surface-raised text-secondary'
    }`}>
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
  const parsed = Number.parseInt(trimmed, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseOptionalBoolean(value: string): boolean | undefined {
  if (value === 'true') return true;
  if (value === 'false') return false;
  return undefined;
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

function resolveLaunchServiceConfig(preset: string, customGpuDevices: string): Partial<OllamaServiceConfig> | null {
  switch (preset as LaunchGpuPreset) {
    case 'service-default':
      return null;
    case 'single-auto':
      return { cudaVisibleDevices: '', schedSpread: false };
    case 'gpu0':
      return { cudaVisibleDevices: '0', schedSpread: false };
    case 'gpu1':
      return { cudaVisibleDevices: '1', schedSpread: false };
    case 'dual-gpu':
      return { cudaVisibleDevices: '0,1', schedSpread: true };
    case 'custom': {
      const normalized = normalizeGpuDeviceList(customGpuDevices);
      return normalized ? { cudaVisibleDevices: normalized } : null;
    }
    default:
      return null;
  }
}

function hasServiceConfigPatchChanged(current: OllamaServiceConfig, patch: Partial<OllamaServiceConfig>): boolean {
  if ('cudaVisibleDevices' in patch && patch.cudaVisibleDevices !== (current.cudaVisibleDevices ?? '')) return true;
  if ('schedSpread' in patch && patch.schedSpread !== current.schedSpread) return true;
  return false;
}

function normalizeGpuDeviceList(value: string): string {
  return value
    .split(',')
    .map((part) => part.trim())
    .filter((part) => /^\d+$/.test(part))
    .join(',');
}

function formatCurrentGpuServiceConfig(config: OllamaServiceConfig): string {
  const devices = config.cudaVisibleDevices?.trim();
  const spread = config.schedSpread === true
    ? i18nService.t('localInferenceLaunchGpuSpreadOn')
    : config.schedSpread === false
      ? i18nService.t('localInferenceLaunchGpuSpreadOff')
      : i18nService.t('localInferenceLaunchDefault');
  return devices
    ? `${devices} · ${spread}`
    : `${i18nService.t('localInferenceLaunchGpuAutoVisible')} · ${spread}`;
}

function formatLaunchGpuPresetSummary(preset: string, customGpuDevices: string): string {
  const patch = resolveLaunchServiceConfig(preset, customGpuDevices);
  if (!patch) return i18nService.t('localInferenceLaunchGpuKeepService');
  const devices = patch.cudaVisibleDevices?.trim() || i18nService.t('localInferenceLaunchGpuAutoVisible');
  if (patch.schedSpread === true) return `${devices} · ${i18nService.t('localInferenceLaunchGpuSpreadOn')}`;
  if (patch.schedSpread === false) return `${devices} · ${i18nService.t('localInferenceLaunchGpuSpreadOff')}`;
  return devices;
}

function serviceConfigToForm(config: OllamaServiceConfig): OllamaServiceConfigFormState {
  return {
    cudaVisibleDevices: config.cudaVisibleDevices ?? '',
    maxLoadedModels: config.maxLoadedModels ?? '',
    numParallel: config.numParallel ?? '',
    schedSpread: config.schedSpread === undefined ? '' : String(config.schedSpread),
  };
}

async function loadOllamaServiceConfig(): Promise<OllamaServiceConfig> {
  try {
    return await window.electron.ollama.getServiceConfig();
  } catch (error) {
    if (isMissingIpcHandlerError(error)) return {};
    throw error;
  }
}

async function saveOllamaServiceConfig(config: OllamaServiceConfig): Promise<OllamaServiceConfig> {
  try {
    return await window.electron.ollama.setServiceConfig(config);
  } catch (error) {
    if (isMissingIpcHandlerError(error)) {
      throw new Error(i18nService.t('localInferenceServiceConfigRestartAppRequired'));
    }
    throw error;
  }
}

function isMissingIpcHandlerError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes('No handler registered') && message.includes('ollama:service-config');
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
  const estimatedMemoryBytes = modelSizeBytes > 0
    ? modelSizeBytes * 1.35
    : parameterCount > 0
      ? parameterCount * 0.75
      : 4 * 1024 ** 3;
  const memoryGb = detectedVramMiB > 0
    ? detectedVramMiB / 1024
    : estimatedMemoryBytes / 1024 ** 3;
  const numCtx = memoryGb <= 3 ? 2048 : memoryGb <= 9 ? 4096 : 8192;
  const numBatch = memoryGb <= 3 ? 128 : memoryGb <= 9 ? 256 : 512;
  const numThread = Math.max(1, Math.min(logicalThreads - 2, 16));
  const numGpu = detectedVramMiB <= 0
    ? memoryGb <= 3 ? 16 : memoryGb <= 9 ? 32 : undefined
    : estimateGpuLayers(estimatedMemoryBytes, detectedVramMiB);
  const summaryKey = detectedVramMiB > 0
    ? 'localInferenceLaunchAutoAppliedWithGpu'
    : 'localInferenceLaunchAutoAppliedFallback';
  const summary = i18nService.t(summaryKey)
      .replace('{context}', numCtx.toLocaleString())
      .replace('{gpuLayers}', numGpu === undefined ? i18nService.t('localInferenceLaunchDefault') : String(numGpu))
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

function estimateGpuLayers(estimatedModelBytes: number, detectedVramMiB: number): number | undefined {
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
  return match[2].toLowerCase() === 'b'
    ? amount * 1_000_000_000
    : amount * 1_000_000;
}

function loadInferenceOptions(): InferenceOptions {
  try {
    const raw = localStorage.getItem('lobsterai:ollama-inference-options');
    if (!raw) return DEFAULT_INFERENCE_OPTIONS;
    return { ...DEFAULT_INFERENCE_OPTIONS, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_INFERENCE_OPTIONS;
  }
}

function normalizeOptions(options: InferenceOptions): Record<string, unknown> {
  const stop = options.stop
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
  return {
    temperature: options.temperature,
    top_p: options.top_p,
    top_k: options.top_k,
    num_predict: options.num_predict,
    repeat_penalty: options.repeat_penalty,
    ...(options.seed >= 0 ? { seed: options.seed } : {}),
    ...(stop.length > 0 ? { stop } : {}),
  };
}

function isPullInProgress(progress?: Record<string, unknown>): boolean {
  if (!progress) return false;
  const status = typeof progress.status === 'string' ? progress.status : '';
  return !['success', 'done', 'cancelled', 'error', 'failed'].includes(status);
}

function formatPullProgress(progress: Record<string, unknown>): string {
  const status = typeof progress.status === 'string' ? progress.status : '';
  const error = typeof progress.error === 'string' ? progress.error : '';
  const completed = typeof progress.completed === 'number' ? progress.completed : undefined;
  const total = typeof progress.total === 'number' ? progress.total : undefined;
  if (error) return `${status || 'error'}: ${error}`;
  if (completed !== undefined && total !== undefined && total > 0) {
    return `${status} · ${formatBytes(completed)} / ${formatBytes(total)}`;
  }
  return status || i18nService.t('loading');
}

function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const index = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
  return `${(value / (1024 ** index)).toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function formatMetricsSummary(metrics: OllamaChatChunk): string {
  const tokens = metrics.eval_count ?? 0;
  const durationNs = metrics.eval_duration ?? 0;
  const seconds = durationNs / 1_000_000_000;
  const speed = seconds > 0 ? (tokens / seconds).toFixed(1) : '-';
  return i18nService.t('localInferenceMetrics')
    .replace('{tokens}', String(tokens))
    .replace('{speed}', speed);
}

function MarketplacePanel({
  isRunning,
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
  installedModelNames,
  onQueryChange,
  onTaskChange,
  onSizeChange,
  onSearch,
  onInstall,
  onCancelPull,
  onOpenInference,
}: {
  isRunning: boolean;
  loading: boolean;
  models: MarketplaceModel[];
  marketplaceLoading: boolean;
  marketplaceError: string | null;
  activePullName: string | null;
  activePullProgress?: Record<string, unknown>;
  pulling: boolean;
  query: string;
  task: string;
  size: string;
  installedModelNames: Set<string>;
  onQueryChange: (v: string) => void;
  onTaskChange: (v: string) => void;
  onSizeChange: (v: string) => void;
  onSearch: () => void;
  onInstall: (model: MarketplaceModel) => Promise<void>;
  onCancelPull: () => void;
  onOpenInference: (name: string) => void;
}) {
  const [installingModel, setInstallingModel] = useState<string | null>(null);
  const [visibleCount, setVisibleCount] = useState(MARKETPLACE_INITIAL_VISIBLE_COUNT);
  const hasActiveFilters = Boolean(query.trim()) || task !== 'all' || size !== 'all';
  const visibleModels = models.slice(0, visibleCount);
  const hasMoreModels = visibleCount < models.length;

  useEffect(() => {
    setVisibleCount(MARKETPLACE_INITIAL_VISIBLE_COUNT);
  }, [models, query, task, size]);

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
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <h2 className="text-base font-semibold text-foreground">{i18nService.t('marketplaceTitle')}</h2>
          <p className="mt-1 text-xs text-secondary">{i18nService.t('marketplaceDescription')}</p>
        </div>
        <form
          className="flex w-full gap-2 md:w-80"
          onSubmit={(e) => { e.preventDefault(); onSearch(); }}
        >
          <div className="relative flex-1">
            <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-secondary" />
            <input
              value={query}
              onChange={(e) => onQueryChange(e.target.value)}
              placeholder={i18nService.t('marketplaceSearchPlaceholder')}
              className="h-8 w-full rounded-md border border-border bg-surface-input pl-8 pr-2 text-xs text-foreground placeholder:text-secondary focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>
          <button
            type="submit"
            className="inline-flex h-8 items-center gap-1 rounded-md bg-primary px-2.5 text-xs font-medium text-white transition-colors hover:bg-primary-hover disabled:opacity-60"
          >
            {i18nService.t('marketplaceSearch')}
          </button>
        </form>
      </div>

      <div className="space-y-3 rounded-lg border border-border bg-surface p-3">
        <div>
          <span className="text-[11px] font-medium text-secondary">{i18nService.t('marketplaceTaskFilterLabel')}</span>
          <div className="mt-2 flex flex-wrap gap-2">
            {[
              { value: 'all', label: i18nService.t('marketplaceFilterTaskAll') },
              { value: 'chat', label: i18nService.t('marketplaceFilterTaskChat') },
              { value: 'reasoning', label: i18nService.t('marketplaceFilterTaskReasoning') },
              { value: 'code', label: i18nService.t('marketplaceFilterTaskCode') },
              { value: 'embedding', label: i18nService.t('marketplaceFilterTaskEmbedding') },
              { value: 'vision', label: i18nService.t('marketplaceFilterTaskVision') },
            ].map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => onTaskChange(option.value)}
                className={`inline-flex h-8 items-center rounded-full border px-3 text-xs transition-colors ${
                  task === option.value
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-border text-secondary hover:bg-surface-raised hover:text-foreground'
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
        <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
          <FilterSelect
            label={i18nService.t('marketplaceSizeFilterLabel')}
            value={size}
            onChange={onSizeChange}
            options={[
              { value: 'all', label: i18nService.t('marketplaceFilterSizeAll') },
              { value: 'small', label: i18nService.t('marketplaceFilterSizeSmall') },
              { value: 'desktop', label: i18nService.t('marketplaceFilterSizeDesktop') },
              { value: 'workstation', label: i18nService.t('marketplaceFilterSizeWorkstation') },
              { value: 'large', label: i18nService.t('marketplaceFilterSizeLarge') },
            ]}
          />
          <button
            type="button"
            onClick={() => { onQueryChange(''); onTaskChange('all'); onSizeChange('all'); }}
            disabled={!hasActiveFilters}
            className="inline-flex h-8 items-center justify-center gap-1 rounded-md border border-border px-2.5 text-xs text-foreground/80 transition-colors hover:bg-surface-raised disabled:cursor-not-allowed disabled:opacity-50"
          >
            {i18nService.t('marketplaceFilterReset')}
          </button>
        </div>
      </div>

      {marketplaceError && (
        <div className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/20 dark:text-red-300">
          {i18nService.t('marketplaceError')}: {marketplaceError}
        </div>
      )}

      {!isRunning && (
        <div className="flex flex-col gap-2 rounded-lg border border-l-4 border-border border-l-primary bg-surface p-3 text-sm md:flex-row md:items-center md:justify-between">
          <div>
            <p className="font-medium text-foreground">{i18nService.t('marketplaceSetupTitle')}</p>
            <p className="text-xs text-secondary">{i18nService.t('marketplaceSetupDescription')}</p>
          </div>
        </div>
      )}

      {activePullName && activePullProgress && (
        <div className="flex flex-col gap-2 rounded-lg border border-border bg-surface px-3 py-2 text-xs text-secondary md:flex-row md:items-center md:justify-between">
          <div>
            <span className="font-mono text-foreground">{activePullName}</span>
            <span className="ml-2">{formatPullProgress(activePullProgress)}</span>
          </div>
          {pulling && (
            <button
              type="button"
              onClick={onCancelPull}
              className={smallOutlineButtonClass}
            >
              <StopIcon className="h-3.5 w-3.5" />
              {i18nService.t('localInferenceCancelPull')}
            </button>
          )}
        </div>
      )}

      {!hasActiveFilters && models.length > 0 && (
        <section className="space-y-2">
          <div className="flex items-center gap-2">
            <SparklesIcon className="h-4 w-4 text-primary" />
            <h3 className="text-sm font-semibold text-foreground">{i18nService.t('marketplaceFeaturedTitle')}</h3>
          </div>
          <p className="text-xs text-secondary">{i18nService.t('marketplaceFeaturedDescription')}</p>
        </section>
      )}

      {models.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-secondary">
          <span>
            {i18nService.t('marketplaceResultSummary')
              .replace('{shown}', String(Math.min(visibleCount, models.length)))
              .replace('{total}', String(models.length))}
          </span>
          <span>{i18nService.t('marketplaceDataSourceHint')}</span>
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
          {visibleModels.map((model) => {
            const installName = model.installName ?? model.name;
            const installed = installedModelNames.has(installName);
            const installing = installingModel === model.id;
            return (
              <div
                key={model.id}
                className="flex min-h-[160px] flex-col justify-between rounded-lg border border-border bg-card p-4 transition-colors hover:bg-surface-raised"
              >
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-sm font-semibold text-foreground">{model.name}</h3>
                    <span className={`inline-flex h-5 items-center rounded-md px-1.5 text-[11px] font-medium ${
                      installed
                        ? 'bg-green-500/10 text-green-600 dark:text-green-400'
                        : 'bg-surface-raised text-secondary'
                    }`}>
                      {installed ? i18nService.t('marketplaceInstalled') : model.recommendedTag}
                    </span>
                    <span className="inline-flex h-5 items-center rounded-md border border-border px-1.5 text-[11px] font-medium text-secondary">
                      {i18nService.t('marketplaceSourceOllama')}
                    </span>
                  </div>
                  <p className="mt-2 text-xs leading-5 text-secondary">{model.description}</p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {model.sizes.map((s) => (
                      <span key={s} className="inline-flex h-5 items-center rounded-md border border-border px-1.5 text-[11px] font-mono text-secondary">
                        {s}
                      </span>
                    ))}
                    {model.tags.slice(0, 3).map((tag) => (
                      <span key={tag} className="inline-flex h-5 items-center rounded-md bg-surface-raised px-1.5 text-[11px] text-secondary">
                        {tag}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="mt-4 flex items-center justify-between gap-2">
                  <span className="text-xs text-secondary">{formatDownloadCount(model.downloads)}</span>
                  <div className="flex flex-wrap items-center justify-end gap-2">
                    {model.detailUrl && (
                      <button
                        type="button"
                        onClick={() => void openExternalUrl(model.detailUrl!)}
                        className="inline-flex h-7 items-center gap-1 rounded-md border border-border px-2 text-xs text-foreground/80 transition-colors hover:bg-surface-raised"
                      >
                        <ArrowTopRightOnSquareIcon className="h-3.5 w-3.5" />
                        {i18nService.t('marketplaceOpenOllama')}
                      </button>
                    )}
                    {installed ? (
                      <button
                        type="button"
                        onClick={() => onOpenInference(installName)}
                        className="inline-flex h-7 items-center gap-1 rounded-md border border-border px-2 text-xs text-foreground/80 transition-colors hover:bg-surface-raised"
                      >
                        <PlayIcon className="h-3.5 w-3.5" />
                        {i18nService.t('marketplaceInfer')}
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => void handleInstall(model)}
                        disabled={!isRunning || installing || loading}
                        className="inline-flex h-7 items-center gap-1 rounded-md bg-primary px-2.5 text-xs font-medium text-white transition-colors hover:bg-primary-hover disabled:opacity-60"
                      >
                        {installing ? (
                          <ArrowPathIcon className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <ArrowDownTrayIcon className="h-3.5 w-3.5" />
                        )}
                        {installing ? i18nService.t('marketplaceInstallProgress') : i18nService.t('marketplaceInstall')}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
          </div>
          {hasMoreModels && (
            <div className="flex justify-center">
              <button
                type="button"
                onClick={() => setVisibleCount((count) => count + MARKETPLACE_VISIBLE_INCREMENT)}
                className="inline-flex h-8 items-center rounded-md border border-border px-3 text-xs text-foreground/80 transition-colors hover:bg-surface-raised"
              >
                {i18nService.t('marketplaceLoadMore')}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function FilterSelect({
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
    <label className="space-y-1">
      <span className="text-[11px] font-medium text-secondary">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-8 w-full rounded-md border border-border bg-surface-input px-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>{opt.label}</option>
        ))}
      </select>
    </label>
  );
}

async function openExternalUrl(url: string): Promise<void> {
  const result = await window.electron.shell.openExternal(url);
  if (!result.success) {
    window.open(url, '_blank', 'noopener,noreferrer');
  }
}

function formatDownloadCount(downloads?: number): string {
  if (!downloads || downloads <= 0) return '';
  const value = downloads >= 1_000_000
    ? `${(downloads / 1_000_000).toFixed(downloads >= 10_000_000 ? 0 : 1)}M`
    : downloads >= 1_000
      ? `${(downloads / 1_000).toFixed(downloads >= 100_000 ? 0 : 1)}k`
      : String(downloads);
  return i18nService.t('marketplaceDownloads').replace('{count}', value);
}

function SearchIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
    </svg>
  );
}

function SparklesIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09ZM18.259 8.715 18 9.75l-.259-1.035a3.375 3.375 0 0 0-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 0 0 2.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 0 0 2.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 0 0-2.455 2.456ZM16.894 20.567 16.5 21.75l-.394-1.183a2.25 2.25 0 0 0-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 0 0 1.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 0 0 1.423 1.423l1.183.394-1.183.394a2.25 2.25 0 0 0-1.423 1.423Z" />
    </svg>
  );
}

export default LocalInferenceView;
