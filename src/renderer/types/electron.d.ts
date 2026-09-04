import type { CoworkError } from '../../common/coworkError';
import type { AppUpdateCheckResult, AppUpdateRuntimeState } from '../../shared/appUpdate/constants';
import type { ActivityRun } from '../../shared/activity/types';
import type { NvidiaSmiSnapshot, SystemMemorySnapshot } from '../../shared/hardware';
import type {
  CoworkPermissionMode,
  CoworkPermissionOrigin,
  CoworkSessionMode,
  CoworkSessionSource,
} from '../../shared/cowork/constants';
import type { CoworkPendingMessage } from '../../shared/cowork/pendingMessageQueue';
import type { ProductionLoopMode } from '../../shared/productionLoop';
import type { CoworkToolActivityEvent } from '../../shared/cowork/toolActivity';
import type {
  ProviderModelDiscoveryRequest,
  ProviderModelDiscoveryResult,
} from '../../shared/providers';
import type {
  LlamaCppCancelModelLoadResult,
  LlamaCppCancelInstallResult,
  LlamaCppImportModelFilesResult,
  LlamaCppInstallModelInput,
  LlamaCppInstallProgress,
  LlamaCppLatestModelLaunchLogSessionInput,
  LlamaCppModel,
  LlamaCppModelLaunchInput,
  LlamaCppModelLaunchLogClearedEvent,
  LlamaCppModelLaunchLogEvent,
  LlamaCppModelLaunchLogSession,
  LlamaCppModelLaunchLogWindowTarget,
  LlamaCppModelLaunchResult,
  LlamaCppModelPreferences,
  LlamaCppModelUnloadResult,
  LlamaCppOpenModelLaunchLogWindowInput,
  LlamaCppOpenModelLaunchLogWindowResult,
  LlamaCppReadModelLaunchLogFileInput,
  LlamaCppReadModelLaunchLogFileResult,
  LlamaCppRunningModel,
  LlamaCppRuntimeCapabilities,
  LlamaCppRuntimeImportResult,
  LlamaCppRuntimeInstallResult,
  LlamaCppRuntimeListDevicesResult,
  LlamaCppRuntimeUninstallResult,
  LlamaCppServiceConfig,
  LlamaCppSetModelPreferenceInput,
  LlamaCppStatusSnapshot,
} from '../../shared/llamacpp';
import type {
  MarketplaceSearchRequest,
  MarketplaceSearchParams,
  MarketplaceSearchResult,
} from '../../shared/marketplace';
import type {
  WorkbenchApprovalResponseInput,
  WorkbenchTaskActionResult,
  WorkbenchTaskChangedEvent,
  WorkbenchTaskExportResult,
  WorkbenchTaskListResult,
} from '../../shared/workbenchTask';
import type {
  OllamaCancelPullResult,
  OllamaChatChunk,
  OllamaChatPayload,
  OllamaInstallProgress,
  OllamaModel,
  OllamaModelLaunchInput,
  OllamaModelLaunchResult,
  OllamaRunningModel,
  OllamaServiceConfig,
  OllamaStatusSnapshot,
} from '../../shared/ollama';
import type { TriageConfig } from '../../shared/triage';
import type { CodingRoomSnapshot } from '../../shared/codingAgent';

interface CodingAgentActionResult {
  success: boolean;
  error?: string;
  conflict?: boolean;
  snapshot?: CodingRoomSnapshot;
}

interface CodingHandoffPreviewResult {
  success: boolean;
  content?: Record<string, unknown>;
  error?: string;
}

interface CodingLaneChangePreviewResult {
  success: boolean;
  preview?: import('../../shared/codingAgent').CodingLaneChangePreview;
  error?: string;
}
interface CodingGitStatusResult {
  success: boolean;
  status?: import('../../shared/codingAgent').CodingGitStatus;
  error?: string;
}
interface CodingGitDiffResult {
  success: boolean;
  diff?: string;
  error?: string;
}
interface CodingWorkspaceActionResult {
  success: boolean;
  workspaces?: import('../../shared/codingAgent').CodingWorkspaceSummary[];
  error?: string;
}
interface CodingAgentProfilesResult {
  success: boolean;
  profiles?: import('../../shared/codingAgent').CodingAgentProfile[];
  error?: string;
}
interface CodingAgentConfigOptionsResult {
  success: boolean;
  configOptions?: import('../../shared/codingAgent').CodingAgentConfigOption[];
  error?: string;
}
interface ApiResponse {
  ok: boolean;
  status: number;
  statusText: string;
  headers: Record<string, string>;
  data: any;
  error?: string;
}

interface ApiStreamResponse {
  ok: boolean;
  status: number;
  statusText: string;
  error?: string;
}

// Cowork types for IPC
interface CoworkSession {
  id: string;
  title: string;
  claudeSessionId: string | null;
  status: 'idle' | 'running' | 'completed' | 'error';
  pinned: boolean;
  pinOrder?: number | null;
  cwd: string;
  systemPrompt: string;
  modelOverride: string;
  executionMode: 'auto' | 'local' | 'sandbox';
  activeSkillIds: string[];
  workspaceId: string;
  agentId: string;
  source: CoworkSessionSource;
  messages: CoworkMessage[];
  messagesOffset: number;
  totalMessages: number;
  createdAt: number;
  updatedAt: number;
}

interface CoworkMessage {
  id: string;
  type: 'user' | 'assistant' | 'tool_use' | 'tool_result' | 'system';
  content: string;
  timestamp: number;
  metadata?: Record<string, unknown>;
}

interface CoworkSessionSummary {
  id: string;
  title: string;
  status: 'idle' | 'running' | 'completed' | 'error';
  pinned: boolean;
  pinOrder?: number | null;
  workspaceId?: string;
  agentId?: string;
  source: CoworkSessionSource;
  createdAt: number;
  updatedAt: number;
}

interface CoworkConfig {
  workingDirectory: string;
  systemPrompt: string;
  executionMode: 'auto' | 'local' | 'sandbox';
  permissionMode: CoworkPermissionMode;
  embeddingEnabled: boolean;
  embeddingProvider: string;
  embeddingModel: string;
  embeddingLocalModelPath: string;
  embeddingVectorWeight: number;
  embeddingRemoteBaseUrl: string;
  embeddingRemoteApiKey: string;
}

type CoworkConfigUpdate = Partial<
  Pick<
    CoworkConfig,
    | 'workingDirectory'
    | 'executionMode'
    | 'permissionMode'
    | 'embeddingEnabled'
    | 'embeddingProvider'
    | 'embeddingModel'
    | 'embeddingLocalModelPath'
    | 'embeddingVectorWeight'
    | 'embeddingRemoteBaseUrl'
    | 'embeddingRemoteApiKey'
  >
>;

interface CoworkPermissionRequest {
  origin: CoworkPermissionOrigin;
  sessionId: string;
  toolName: string;
  toolInput: Record<string, unknown>;
  requestId: string;
  toolUseId?: string | null;
}

interface CoworkApiConfig {
  apiKey: string;
  baseURL: string;
  model: string;
  apiType?: 'anthropic' | 'openai';
}

interface WindowState {
  isMaximized: boolean;
  isFullscreen: boolean;
  isFocused: boolean;
}

interface Skill {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  pinned: boolean;
  isOfficial: boolean;
  isBuiltIn: boolean;
  updatedAt: number;
  prompt: string;
  skillPath: string;
  iconUrl?: string;
  displayName?: string;
  displayDescription?: string;
  displayAuthor?: string;
  displayLicense?: string;
  metadataContent?: string;
  metadataFields?: Record<string, string>;
  version?: string;
}

type EmailConnectivityCheckCode = 'imap_connection' | 'smtp_connection';
type EmailConnectivityCheckLevel = 'pass' | 'fail';
type EmailConnectivityVerdict = 'pass' | 'fail';

interface EmailConnectivityCheck {
  code: EmailConnectivityCheckCode;
  level: EmailConnectivityCheckLevel;
  message: string;
  durationMs: number;
}

interface EmailConnectivityTestResult {
  testedAt: number;
  verdict: EmailConnectivityVerdict;
  checks: EmailConnectivityCheck[];
}

type CoworkPermissionResult =
  | {
      behavior: 'allow';
      updatedInput?: Record<string, unknown>;
      updatedPermissions?: Record<string, unknown>[];
      toolUseID?: string;
    }
  | {
      behavior: 'deny';
      message: string;
      interrupt?: boolean;
      toolUseID?: string;
    };

interface McpServerConfigIPC {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  transportType: 'stdio' | 'sse' | 'http';
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
  timeout?: number;
  isBuiltIn: boolean;
  githubUrl?: string;
  registryId?: string;
  createdAt: number;
  updatedAt: number;
}

interface McpMarketplaceServer {
  id: string;
  name: string;
  description_zh: string;
  description_en: string;
  category: string;
  transportType: 'stdio' | 'sse' | 'http';
  descriptionKey?: string;
  categoryKey?: string;
  command?: string;
  defaultArgs?: string[];
  url?: string;
  headers?: Record<string, string>;
  authType?: 'oauth' | 'cli' | 'token' | 'external';
  connectorPath?: string;
  iconPath?: string;
  metadataPath?: string;
  requiredEnvKeys?: string[];
  optionalEnvKeys?: string[];
  presentation?: {
    name?: string;
    authorization?: string;
    zh?: {
      description?: string;
      connect?: Record<string, { title?: string; description?: string }>;
    };
    en?: {
      description?: string;
      connect?: Record<string, { title?: string; description?: string }>;
    };
  };
}

interface McpMarketplaceCategory {
  id: string;
  name_zh: string;
  name_en: string;
}

interface McpMarketplaceData {
  categories: McpMarketplaceCategory[];
  servers: McpMarketplaceServer[];
}

interface McpConnectionTestResult {
  success: boolean;
  error?: string;
  toolCount?: number;
}

import type { Platform } from '@shared/platform';
import type {
  EnterprisePasswordChangeInput,
  EnterprisePasswordLoginInput,
  EnterpriseSessionResult,
} from '../../shared/enterpriseSession';

import type { Agent } from './agent';

interface IElectronAPI {
  platform: string;
  arch: string;
  store: {
    get: (key: string) => Promise<any>;
    set: (key: string, value: any) => Promise<void>;
    remove: (key: string) => Promise<void>;
  };
  skills: {
    list: () => Promise<{ success: boolean; skills?: Skill[]; error?: string }>;
    setEnabled: (options: {
      id: string;
      enabled: boolean;
    }) => Promise<{ success: boolean; skills?: Skill[]; error?: string }>;
    setEnabledBatch?: (options: {
      ids: string[];
      enabled: boolean;
    }) => Promise<{ success: boolean; skills?: Skill[]; error?: string }>;
    setPinned: (options: {
      id: string;
      pinned: boolean;
    }) => Promise<{ success: boolean; skills?: Skill[]; error?: string }>;
    delete: (id: string) => Promise<{ success: boolean; skills?: Skill[]; error?: string }>;
    download: (
      source: string,
      options?: { iconUrl?: string; displayName?: string },
    ) => Promise<{
      success: boolean;
      skills?: Skill[];
      error?: string;
      errorCode?: string;
      auditReport?: any;
      pendingInstallId?: string;
    }>;
    confirmInstall: (
      pendingId: string,
      action: string,
    ) => Promise<{ success: boolean; skills?: Skill[]; error?: string }>;
    getRoot: () => Promise<{ success: boolean; path?: string; error?: string }>;
    getContent: (
      skillId: string,
    ) => Promise<{ success: boolean; content?: string; error?: string }>;
    autoRoutingPrompt: () => Promise<{ success: boolean; prompt?: string | null; error?: string }>;
    getConfig: (
      skillId: string,
    ) => Promise<{ success: boolean; config?: Record<string, string>; error?: string }>;
    setConfig: (
      skillId: string,
      config: Record<string, string>,
    ) => Promise<{ success: boolean; error?: string }>;
    testEmailConnectivity: (
      skillId: string,
      config: Record<string, string>,
    ) => Promise<{ success: boolean; result?: EmailConnectivityTestResult; error?: string }>;
    fetchMarketplace: (options?: {
      pageNumber?: number;
      pageSize?: number;
    }) => Promise<{ success: boolean; data?: string; error?: string }>;
    fetchMarketplaceContent: (skillId: string) => Promise<{
      success: boolean;
      content?: string | null;
      error?: string;
    }>;
    onChanged: (callback: () => void) => () => void;
  };
  mcp: {
    list: () => Promise<{ success: boolean; servers?: McpServerConfigIPC[]; error?: string }>;
    create: (
      data: any,
    ) => Promise<{ success: boolean; servers?: McpServerConfigIPC[]; error?: string }>;
    update: (
      id: string,
      data: any,
    ) => Promise<{ success: boolean; servers?: McpServerConfigIPC[]; error?: string }>;
    delete: (
      id: string,
    ) => Promise<{ success: boolean; servers?: McpServerConfigIPC[]; error?: string }>;
    setEnabled: (options: {
      id: string;
      enabled: boolean;
    }) => Promise<{ success: boolean; servers?: McpServerConfigIPC[]; error?: string }>;
    testConnection: (data: any) => Promise<McpConnectionTestResult>;
    fetchMarketplace: () => Promise<{
      success: boolean;
      data?: McpMarketplaceData;
      error?: string;
    }>;
    refreshBridge: () => Promise<{ success: boolean; tools: number; error?: string }>;
    authorize: (
      data: any,
    ) => Promise<{ success: boolean; servers?: McpServerConfigIPC[]; error?: string }>;
    cancelAuthorize: (requestId: string) => Promise<{ success: boolean }>;
    getFeishuCliStatus: () => Promise<{ success: boolean; installed: boolean; error?: string }>;
    prepareFeishuCli: () => Promise<{ success: boolean; error?: string }>;
    loadIcon: (iconPath: string) => Promise<{ success: boolean; data?: string; error?: string }>;
    onBridgeSyncStart: (callback: () => void) => () => void;
    onBridgeSyncDone: (callback: (data: { tools: number; error?: string }) => void) => () => void;
  };
  ollama: {
    status: () => Promise<OllamaStatusSnapshot>;
    install: () => Promise<OllamaStatusSnapshot>;
    start: () => Promise<OllamaStatusSnapshot>;
    stop: () => Promise<OllamaStatusSnapshot>;
    restart: () => Promise<OllamaStatusSnapshot>;
    getServiceConfig: () => Promise<OllamaServiceConfig>;
    setServiceConfig: (config: OllamaServiceConfig) => Promise<OllamaServiceConfig>;
    modelsDir: () => Promise<string>;
    listLocalModels: () => Promise<OllamaModel[]>;
    listRunningModels: () => Promise<OllamaRunningModel[]>;
    deleteModel: (name: string) => Promise<{ success: boolean }>;
    showModel: (name: string) => Promise<unknown>;
    createModel: (name: string, modelfile: string) => Promise<{ success: boolean }>;
    preloadModel: (input: OllamaModelLaunchInput) => Promise<OllamaModelLaunchResult>;
    unloadModel: (name: string) => Promise<OllamaModelLaunchResult>;
    pullModel: (name: string) => Promise<{ success: boolean }>;
    cancelPull: (name: string) => Promise<OllamaCancelPullResult>;
    chat: (payload: OllamaChatPayload) => Promise<OllamaChatChunk>;
    chatStream: (requestId: string, payload: OllamaChatPayload) => Promise<{ success: boolean }>;
    cancelChatStream: (requestId: string) => Promise<{ success: boolean; cancelled: boolean }>;
    onStatusChanged: (callback: (snapshot: OllamaStatusSnapshot) => void) => () => void;
    onInstallProgress: (callback: (progress: OllamaInstallProgress) => void) => () => void;
    onPullProgress: (
      callback: (payload: { name: string; chunk: Record<string, unknown> }) => void,
    ) => () => void;
    onChatStreamChunk: (
      callback: (payload: { requestId: string; chunk: OllamaChatChunk }) => void,
    ) => () => void;
  };
  llamacpp: {
    status: () => Promise<LlamaCppStatusSnapshot>;
    install: () => Promise<LlamaCppRuntimeInstallResult>;
    cancelRuntimeInstall: () => Promise<LlamaCppCancelInstallResult>;
    importRuntime: () => Promise<LlamaCppRuntimeImportResult>;
    fetchWindowsRuntimeManifest: (url: string) => Promise<unknown | null>;
    listRuntimeDevices: (
      input?: import('../../shared/llamacpp').LlamaCppBackendRef,
    ) => Promise<LlamaCppRuntimeListDevicesResult>;
    getRuntimeCapabilities: () => Promise<LlamaCppRuntimeCapabilities>;
    listBackends: () => Promise<import('../../shared/llamacpp').LlamaCppBackendListResult>;
    getBackendDownloadSize: (
      input: import('../../shared/llamacpp').LlamaCppBackendRef,
    ) => Promise<import('../../shared/llamacpp').LlamaCppBackendDownloadSizeResult>;
    getBackendSelection: () => Promise<
      import('../../shared/llamacpp').LlamaCppBackendRef | undefined
    >;
    setBackendSelection: (
      input: import('../../shared/llamacpp').LlamaCppBackendRef,
    ) => Promise<LlamaCppRuntimeInstallResult>;
    installBackend: (
      input?: import('../../shared/llamacpp').LlamaCppBackendRef,
    ) => Promise<LlamaCppRuntimeInstallResult>;
    getRuntimeInstallSnapshot: () => Promise<
      import('../../shared/llamacpp').LlamaCppRuntimeInstallSnapshot
    >;
    uninstallBackend: (
      input?: import('../../shared/llamacpp').LlamaCppBackendRef,
    ) => Promise<LlamaCppRuntimeUninstallResult>;
    uninstallRuntime: () => Promise<LlamaCppRuntimeUninstallResult>;
    start: () => Promise<LlamaCppStatusSnapshot>;
    stop: () => Promise<LlamaCppStatusSnapshot>;
    restart: () => Promise<LlamaCppStatusSnapshot>;
    getServiceConfig: () => Promise<LlamaCppServiceConfig>;
    setServiceConfig: (config: LlamaCppServiceConfig) => Promise<LlamaCppServiceConfig>;
    modelsDir: () => Promise<string>;
    setModelsDir: (modelsDir: string) => Promise<string>;
    listLocalModels: () => Promise<LlamaCppModel[]>;
    listRunningModels: () => Promise<LlamaCppRunningModel[]>;
    refreshRunningModelBindings: () => Promise<void>;
    importModelFiles: (paths: string[]) => Promise<LlamaCppImportModelFilesResult>;
    deleteModel: (name: string) => Promise<{
      success: boolean;
      deleted?: boolean;
      reason?: 'not-local-file' | 'not-app-managed';
      error?: string;
      removedModelName?: string;
      clearedDefaultModel?: boolean;
    }>;
    showModel: (name: string) => Promise<unknown>;
    getModelPreferences: () => Promise<LlamaCppModelPreferences>;
    setModelPreference: (
      input: LlamaCppSetModelPreferenceInput,
    ) => Promise<LlamaCppModelPreferences>;
    loadModel: (input: LlamaCppModelLaunchInput) => Promise<LlamaCppModelLaunchResult>;
    cancelModelLoad: (modelName?: string) => Promise<LlamaCppCancelModelLoadResult>;
    unloadModel: (name: string) => Promise<LlamaCppModelUnloadResult>;
    getLatestModelLaunchLogSession: (
      input?: LlamaCppLatestModelLaunchLogSessionInput,
    ) => Promise<LlamaCppModelLaunchLogSession | null>;
    readModelLaunchLogFile: (
      input: LlamaCppReadModelLaunchLogFileInput,
    ) => Promise<LlamaCppReadModelLaunchLogFileResult>;
    openModelLaunchLogWindow: (
      input?: LlamaCppOpenModelLaunchLogWindowInput,
    ) => Promise<LlamaCppOpenModelLaunchLogWindowResult>;
    installModel: (
      input: LlamaCppInstallModelInput,
    ) => Promise<{ success: boolean; cancelled?: boolean }>;
    cancelInstall: (modelId: string) => Promise<LlamaCppCancelInstallResult>;
    onStatusChanged: (callback: (snapshot: LlamaCppStatusSnapshot) => void) => () => void;
    onModelBindingsChanged: (callback: () => void) => () => void;
    onInstallProgress: (callback: (progress: LlamaCppInstallProgress) => void) => () => void;
    onModelLaunchLog: (callback: (event: LlamaCppModelLaunchLogEvent) => void) => () => void;
    onModelLaunchLogCleared: (
      callback: (event: LlamaCppModelLaunchLogClearedEvent) => void,
    ) => () => void;
    onModelLaunchLogWindowTargetChanged: (
      callback: (target: LlamaCppModelLaunchLogWindowTarget) => void,
    ) => () => void;
    onPullProgress: (
      callback: (payload: { name: string; chunk: Record<string, unknown> }) => void,
    ) => () => void;
  };
  marketplace: {
    search: (request: MarketplaceSearchRequest) => Promise<MarketplaceSearchResult>;
    cancelSearch: (requestId: string) => Promise<{ cancelled: boolean }>;
  };
  triage: {
    getConfig: () => Promise<TriageConfig>;
    setConfig: (config: TriageConfig) => Promise<TriageConfig>;
  };
  hardware: {
    nvidiaSmi: () => Promise<NvidiaSmiSnapshot>;
    systemMemory: () => Promise<SystemMemorySnapshot>;
  };
  agents: {
    list: () => Promise<Agent[]>;
    get: (id: string) => Promise<Agent | null>;
    create: (request: {
      id?: string;
      name: string;
      description?: string;
      systemPrompt?: string;
      identity?: string;
      model?: string;
      workingDirectory?: string;
      icon?: string;
      skillIds?: string[];
      source?: string;
      presetId?: string;
    }) => Promise<Agent>;
    update: (
      id: string,
      updates: {
        name?: string;
        description?: string;
        systemPrompt?: string;
        identity?: string;
        model?: string;
        workingDirectory?: string;
        icon?: string;
        skillIds?: string[];
        enabled?: boolean;
        pinned?: boolean;
        triageOverride?: import('../../shared/triage').AgentTriageOverride | null;
      },
    ) => Promise<Agent>;
    delete: (id: string) => Promise<boolean>;
    importExpertPackage: (expertDir: string) => Promise<{
      success: boolean;
      agentIds?: string[];
      expertType?: string;
      name?: string;
      error?: string;
    }>;
    getPresetExperts: () => Promise<{
      experts: Array<{
        name: string;
        displayName: { en: string; zh: string };
        profession: { en: string; zh: string };
        displayDescription: { en: string; zh: string };
        categoryId: string;
        tags: Array<{ en: string; zh: string }>;
        quickPrompts: Array<{ en: string; zh: string }>;
        workflow: string[];
        path: string;
      }>;
      error?: string;
    }>;
  };
  api: {
    webSearch: (input: { query: string; maxResults?: number; requestId?: string }) => Promise<{
      ok: boolean;
      data?: {
        query: string;
        results: Array<{ title: string; url: string; snippet: string; content?: string }>;
      };
      error?: string;
    }>;
    fetch: (options: {
      url: string;
      method: string;
      headers: Record<string, string>;
      body?: string;
    }) => Promise<ApiResponse>;
    fetchModels: (input: ProviderModelDiscoveryRequest) => Promise<ProviderModelDiscoveryResult>;
    stream: (options: {
      url: string;
      method: string;
      headers: Record<string, string>;
      body?: string;
      requestId: string;
    }) => Promise<ApiStreamResponse>;
    cancelStream: (requestId: string) => Promise<boolean>;
    onStreamData: (requestId: string, callback: (chunk: string) => void) => () => void;
    onStreamDone: (requestId: string, callback: () => void) => () => void;
    onStreamError: (requestId: string, callback: (error: CoworkError) => void) => () => void;
    onStreamAbort: (requestId: string, callback: () => void) => () => void;
  };
  getApiConfig: () => Promise<CoworkApiConfig | null>;
  checkApiConfig: (options?: {
    probeModel?: boolean;
  }) => Promise<{ hasConfig: boolean; config: CoworkApiConfig | null; error?: string }>;
  saveApiConfig: (config: CoworkApiConfig) => Promise<{ success: boolean; error?: string }>;
  generateSessionTitle: (userInput: string | null) => Promise<string>;
  getRecentCwds: (limit?: number) => Promise<string[]>;
  appEvents: {
    onOpenSettings: (callback: () => void) => () => void;
    onNewTask: (callback: () => void) => () => void;
  };
  window: {
    minimize: () => void;
    toggleMaximize: () => void;
    close: () => void;
    isMaximized: () => Promise<boolean>;
    showSystemMenu: (position: { x: number; y: number }) => void;
    onStateChanged: (callback: (state: WindowState) => void) => () => void;
  };
  memory: {
    list: (
      input?: import('../../shared/memory').ManagedMemoryListInput,
    ) => Promise<
      import('../../shared/memory').MemoryIpcResult<
        import('../../shared/memory').ManagedMemoryRecord[]
      >
    >;
    resolveSessionTitles: (
      input: import('../../shared/memory').MemorySessionTitleResolveInput,
    ) => Promise<
      import('../../shared/memory').MemoryIpcResult<
        import('../../shared/memory').MemorySessionTitle[]
      >
    >;
    createManual: (
      input: import('../../shared/memory').ManualMemoryCreateInput,
    ) => Promise<
      import('../../shared/memory').MemoryIpcResult<
        import('../../shared/memory').ManagedMemoryRecord
      >
    >;
    updateManual: (
      input: import('../../shared/memory').ManualMemoryUpdateInput,
    ) => Promise<
      import('../../shared/memory').MemoryIpcResult<
        import('../../shared/memory').ManagedMemoryRecord
      >
    >;
    confirmCandidate: (
      id: string,
    ) => Promise<import('../../shared/memory').MemoryIpcResult<number | null>>;
    archive: (id: string) => Promise<import('../../shared/memory').MemoryIpcResult<void>>;
    restore: (id: string) => Promise<import('../../shared/memory').MemoryIpcResult<void>>;
    forget: (
      id: string,
      hardDelete: boolean,
    ) => Promise<import('../../shared/memory').MemoryIpcResult<boolean>>;
    drainOutbox: () => Promise<import('../../shared/memory').MemoryIpcResult<number>>;
  };
  cowork: {
    listWorkspaces: () => Promise<{
      success: boolean;
      workspaces?: import('../../shared/workspace').Workspace[];
      error?: string;
    }>;
    ensureWorkspace: (options: { path: string; name?: string; isHidden?: boolean }) => Promise<{
      success: boolean;
      workspace?: import('../../shared/workspace').Workspace;
      error?: string;
    }>;
    renameWorkspace: (
      id: string,
      name: string,
    ) => Promise<{
      success: boolean;
      workspace?: import('../../shared/workspace').Workspace;
      error?: string;
    }>;
    deleteWorkspace: (id: string) => Promise<{
      success: boolean;
      deletedSessionIds?: string[];
      error?: string;
    }>;
    startSession: (options: {
      prompt: string;
      cwd?: string;
      systemPrompt?: string;
      title?: string;
      activeSkillIds?: string[];
      goalMode?: boolean;
      productionLoopMode?: ProductionLoopMode;
      workspaceId?: string;
      agentId?: string;
      expertIds?: string[];
      permissionMode?: CoworkPermissionMode;
      permissionModeBySession?: Record<string, CoworkPermissionMode>;
      imageAttachments?: Array<{ name: string; mimeType: string; base64Data: string }>;
      fileAttachments?: Array<{ name: string; path: string; extension: string; isImage?: boolean }>;
    }) => Promise<{
      success: boolean;
      session?: CoworkSession;
      error?: string;
      code?: string;
    }>;
    continueSession: (options: {
      sessionId: string;
      prompt: string;
      systemPrompt?: string;
      activeSkillIds?: string[];
      goalMode?: boolean;
      productionLoopMode?: ProductionLoopMode;
      expertIds?: string[];
      permissionMode?: CoworkPermissionMode;
      imageAttachments?: Array<{ name: string; mimeType: string; base64Data: string }>;
      fileAttachments?: Array<{ name: string; path: string; extension: string; isImage?: boolean }>;
    }) => Promise<{
      success: boolean;
      session?: CoworkSession;
      error?: string;
      code?: string;
    }>;
    listPendingMessages: (
      sessionId: string,
    ) => Promise<{ success: boolean; items?: CoworkPendingMessage[]; error?: string }>;
    enqueuePendingMessage: (options: {
      sessionId: string;
      text: string;
      imageAttachments?: Array<{ name: string; mimeType: string; base64Data: string }>;
      fileAttachments?: Array<{ name: string; path: string; extension: string; isImage?: boolean }>;
      skillIds?: string[];
      skillPrompt?: string;
      productionLoopMode?: ProductionLoopMode;
    }) => Promise<{ success: boolean; item?: CoworkPendingMessage; error?: string }>;
    updatePendingMessage: (options: {
      sessionId: string;
      itemId: string;
      text: string;
    }) => Promise<{ success: boolean; item?: CoworkPendingMessage; error?: string }>;
    deletePendingMessage: (options: {
      sessionId: string;
      itemId: string;
    }) => Promise<{ success: boolean; error?: string }>;
    steerPendingMessage: (options: {
      sessionId: string;
      itemId: string;
    }) => Promise<{ success: boolean; item?: CoworkPendingMessage; error?: string }>;
    followUpPendingMessage: (options: {
      sessionId: string;
      itemId: string;
    }) => Promise<{ success: boolean; item?: CoworkPendingMessage; error?: string }>;
    stopSession: (sessionId: string) => Promise<{ success: boolean; error?: string }>;
    saveSession: (session: Record<string, unknown>) => Promise<CoworkSessionResult>;
    deleteSession: (sessionId: string) => Promise<{ success: boolean; error?: string }>;
    deleteSessions: (sessionIds: string[]) => Promise<{ success: boolean; error?: string }>;
    setSessionPinned: (options: {
      sessionId: string;
      pinned: boolean;
    }) => Promise<{ success: boolean; pinOrder?: number | null; error?: string }>;
    renameSession: (options: {
      sessionId: string;
      title: string;
    }) => Promise<{ success: boolean; error?: string }>;
    updateSessionModel: (options: {
      sessionId: string;
      modelOverride: string;
    }) => Promise<{ success: boolean; session?: CoworkSession | null; error?: string }>;
    getSession: (
      sessionId: string,
    ) => Promise<{ success: boolean; session?: CoworkSession; error?: string }>;
    remoteManaged: (
      sessionId: string,
    ) => Promise<{ success: boolean; remoteManaged: boolean; error?: string }>;
    listSessions: (options?: {
      limit?: number;
      offset?: number;
      agentId?: string;
      workspaceId?: string;
      mode?: CoworkSessionMode;
      sources?: CoworkSessionSource[];
    }) => Promise<{
      success: boolean;
      sessions?: CoworkSessionSummary[];
      hasMore?: boolean;
      error?: string;
    }>;
    getSessionMessages: (options: {
      sessionId: string;
      limit?: number;
      offset?: number;
    }) => Promise<{
      success: boolean;
      messages?: CoworkMessage[];
      offset?: number;
      total?: number;
      error?: string;
    }>;
    exportResultImage: (options: {
      rect: { x: number; y: number; width: number; height: number };
      defaultFileName?: string;
    }) => Promise<{ success: boolean; canceled?: boolean; path?: string; error?: string }>;
    captureImageChunk: (options: {
      rect: { x: number; y: number; width: number; height: number };
    }) => Promise<{
      success: boolean;
      width?: number;
      height?: number;
      pngBase64?: string;
      error?: string;
    }>;
    saveResultImage: (options: {
      pngBase64: string;
      defaultFileName?: string;
    }) => Promise<{ success: boolean; canceled?: boolean; path?: string; error?: string }>;
    exportSessionText: (options: {
      content: string;
      defaultFileName?: string;
      fileExtension?: string;
    }) => Promise<{ success: boolean; canceled?: boolean; path?: string; error?: string }>;
    respondToPermission: (options: {
      requestId: string;
      result: CoworkPermissionResult;
    }) => Promise<{ success: boolean; error?: string }>;
    getConfig: () => Promise<{ success: boolean; config?: CoworkConfig; error?: string }>;
    setConfig: (config: CoworkConfigUpdate) => Promise<{ success: boolean; error?: string }>;
    readBootstrapFile: (
      filename: string,
    ) => Promise<{ success: boolean; content: string; error?: string }>;
    writeBootstrapFile: (
      filename: string,
      content: string,
    ) => Promise<{ success: boolean; error?: string }>;
    onStreamMessage: (
      callback: (data: { sessionId: string; message: CoworkMessage }) => void,
    ) => () => void;
    onStreamMessageUpdate: (
      callback: (data: {
        sessionId: string;
        messageId: string;
        content: string;
        metadata?: Record<string, unknown>;
      }) => void,
    ) => () => void;
    onStreamToolActivity: (
      callback: (data: { sessionId: string; event: CoworkToolActivityEvent }) => void,
    ) => () => void;
    onStreamPermission: (
      callback: (data: {
        sessionId: string;
        request: Omit<CoworkPermissionRequest, 'origin'>;
      }) => void,
    ) => () => void;
    onStreamPermissionDismiss: (callback: (data: { requestId: string }) => void) => () => void;
    onStreamInterrupted: (
      callback: (
        data: import('../../shared/cowork/interruption').CoworkSessionInterruption,
      ) => void,
    ) => () => void;
    onStreamComplete: (
      callback: (data: { sessionId: string; claudeSessionId: string | null }) => void,
    ) => () => void;
    onStreamError: (
      callback: (data: { sessionId: string; error: CoworkError }) => void,
    ) => () => void;
    onStreamQueueUpdated: (
      callback: (data: { sessionId: string; items: CoworkPendingMessage[] }) => void,
    ) => () => void;
    onSessionsChanged: (callback: (data: { sessionId?: string }) => void) => () => void;
  };
  workbenchTask: {
    getCurrent: (sessionId: string) => Promise<WorkbenchTaskActionResult>;
    getDetail: (taskId: string) => Promise<WorkbenchTaskActionResult>;
    listForSession: (sessionId: string) => Promise<WorkbenchTaskListResult>;
    exportAudit: (taskId: string) => Promise<WorkbenchTaskExportResult>;
    resume: (
      input: import('../../shared/workbenchTask').WorkbenchTaskResumeInput,
    ) => Promise<WorkbenchTaskActionResult>;
    retry: (taskId: string) => Promise<WorkbenchTaskActionResult>;
    accept: (taskId: string) => Promise<WorkbenchTaskActionResult>;
    respondToApproval: (
      input: WorkbenchApprovalResponseInput,
    ) => Promise<WorkbenchTaskActionResult>;
    onChanged: (callback: (event: WorkbenchTaskChangedEvent) => void) => () => void;
  };
  todo: {
    list: (
      input: import('../../shared/todo').TodoListInput,
    ) => Promise<import('../../shared/todo').TodoListResult>;
    create: (
      input: import('../../shared/todo').TodoCreateInput,
    ) => Promise<import('../../shared/todo').TodoActionResult>;
    update: (
      input: import('../../shared/todo').TodoUpdateInput & { todoId: string },
    ) => Promise<import('../../shared/todo').TodoActionResult>;
    delete: (todoId: string) => Promise<{ success: boolean; error?: string }>;
    listLists: () => Promise<import('../../shared/todo').TodoListsResult>;
    createList: (
      input: import('../../shared/todo').TodoListCreateInput,
    ) => Promise<import('../../shared/todo').TodoListActionResult>;
    updateList: (
      input: import('../../shared/todo').TodoListUpdateInput & { listId: string },
    ) => Promise<import('../../shared/todo').TodoListActionResult>;
    deleteList: (listId: string) => Promise<{ success: boolean; error?: string }>;
    createStep: (
      input: import('../../shared/todo').TodoStepCreateInput,
    ) => Promise<import('../../shared/todo').TodoStepActionResult>;
    updateStep: (
      input: import('../../shared/todo').TodoStepUpdateInput,
    ) => Promise<import('../../shared/todo').TodoStepActionResult>;
    deleteStep: (stepId: string) => Promise<{ success: boolean; error?: string }>;
    onChanged: (callback: (event: import('../../shared/todo').TodoChangedEvent) => void) => () => void;
  };
  codingAgent: {
    listProfiles: () => Promise<CodingAgentProfilesResult>;
    listWorkspaces: () => Promise<CodingWorkspaceActionResult>;
    createWorkspace: (
      input: import('../../shared/codingAgent').CreateCodingWorkspaceInput,
    ) => Promise<CodingWorkspaceActionResult>;
    updateWorkspace: (
      input: import('../../shared/codingAgent').UpdateCodingWorkspaceInput,
    ) => Promise<CodingWorkspaceActionResult>;
    deleteWorkspace: (workspaceId: string) => Promise<CodingWorkspaceActionResult>;
    deleteSession: (input: {
      workspaceRoot: string;
      laneId: string;
    }) => Promise<CodingWorkspaceActionResult>;
    getProfileConfigOptions: (profileId: string) => Promise<CodingAgentConfigOptionsResult>;
    createSession: (
      input: import('../../shared/codingAgent').CreateCodingSessionInput,
    ) => Promise<CodingAgentActionResult>;
    startSession: (
      input: import('../../shared/codingAgent').StartCodingSessionInput,
    ) => Promise<CodingAgentActionResult>;
    bootstrap: (workspaceRoot: string) => Promise<CodingAgentActionResult>;
    prepareLane: (input: {
      workspaceRoot: string;
      laneId: string;
    }) => Promise<CodingAgentActionResult>;
    createMission: (
      input: import('../../shared/codingAgent').CreateCodingMissionInput,
    ) => Promise<CodingAgentActionResult>;
    selectLane: (input: {
      workspaceRoot: string;
      laneId: string;
    }) => Promise<CodingAgentActionResult>;
    prompt: (input: {
      workspaceRoot: string;
      prompt: import('../../shared/codingAgent').CodingPromptInput;
    }) => Promise<CodingAgentActionResult>;
    listPendingMessages: (laneId: string) => Promise<{ success: boolean; items?: import('../../shared/cowork/pendingMessageQueue').CoworkPendingMessage[]; error?: string }>;
    enqueuePendingMessage: (input: { laneId: string; text: string }) => Promise<{ success: boolean; item?: import('../../shared/cowork/pendingMessageQueue').CoworkPendingMessage; error?: string }>;
    updatePendingMessage: (input: { laneId: string; itemId: string; text: string }) => Promise<{ success: boolean; error?: string }>;
    deletePendingMessage: (input: { laneId: string; itemId: string }) => Promise<{ success: boolean; error?: string }>;
    steerPendingMessage: (input: { workspaceRoot: string; laneId: string; itemId: string }) => Promise<CodingAgentActionResult>;
    followUpPendingMessage: (input: { workspaceRoot: string; laneId: string; itemId: string }) => Promise<CodingAgentActionResult>;
    confirmSessionRecovery: (input: {
      workspaceRoot: string;
      laneId: string;
      includeRecoveryContext: boolean;
    }) => Promise<CodingAgentActionResult>;
    cancel: (input: { workspaceRoot: string; laneId: string }) => Promise<CodingAgentActionResult>;
    previewHandoff: (input: {
      workspaceRoot: string;
      sourceLaneId: string;
      targetLaneId: string;
    }) => Promise<CodingHandoffPreviewResult>;
    handoff: (input: {
      workspaceRoot: string;
      sourceLaneId: string;
      targetLaneId: string;
    }) => Promise<CodingAgentActionResult>;
    addLane: (input: {
      workspaceRoot: string;
      missionId: string;
      profileId: string;
    }) => Promise<CodingAgentActionResult>;
    createCollaborationPreset: (
      input: import('../../shared/codingAgent').CreateCodingCollaborationPresetInput,
    ) => Promise<CodingAgentActionResult>;
    saveLaneView: (input: {
      workspaceRoot: string;
      view: import('../../shared/codingAgent').CodingLaneViewStateInput;
    }) => Promise<CodingAgentActionResult>;
    setLaneConfigOption: (input: {
      workspaceRoot: string;
      option: import('../../shared/codingAgent').CodingLaneConfigOptionInput;
    }) => Promise<CodingAgentActionResult>;
    setLaneModelOverride: (input: {
      workspaceRoot: string;
      laneId: string;
      modelOverride: string | null;
    }) => Promise<CodingAgentActionResult>;
    previewLaneChanges: (input: {
      workspaceRoot: string;
      laneId: string;
    }) => Promise<CodingLaneChangePreviewResult>;
    applyLaneChanges: (input: {
      workspaceRoot: string;
      laneId: string;
    }) => Promise<CodingAgentActionResult>;
    getGitStatus: (
      input: import('../../shared/codingAgent').CodingGitTargetInput,
    ) => Promise<CodingGitStatusResult>;
    getGitDiff: (
      input: import('../../shared/codingAgent').CodingGitDiffInput,
    ) => Promise<CodingGitDiffResult>;
    stageGitPaths: (
      input: import('../../shared/codingAgent').CodingGitPathActionInput,
    ) => Promise<CodingGitStatusResult>;
    unstageGitPaths: (
      input: import('../../shared/codingAgent').CodingGitPathActionInput,
    ) => Promise<CodingGitStatusResult>;
    commitGitChanges: (
      input: import('../../shared/codingAgent').CodingGitCommitInput,
    ) => Promise<CodingGitStatusResult>;
    pushGitBranch: (
      input: import('../../shared/codingAgent').CodingGitTargetInput,
    ) => Promise<CodingGitStatusResult>;
    discoverAgents: (input: { workspaceRoot: string }) => Promise<CodingAgentActionResult>;
    probeAgent: (input: {
      workspaceRoot: string;
      profileId: string;
    }) => Promise<CodingAgentActionResult>;
    addProfile: (input: {
      workspaceRoot: string;
      profile: import('../../shared/codingAgent').AddCodingAgentProfileInput;
    }) => Promise<CodingAgentActionResult>;
    trustProfile: (input: {
      workspaceRoot: string;
      profileId: string;
    }) => Promise<CodingAgentActionResult>;
    authenticateProfile: (input: {
      workspaceRoot: string;
      profileId: string;
      methodId: string;
    }) => Promise<CodingAgentActionResult>;
    startAuthTerminal: (input: {
      workspaceRoot: string;
      profileId: string;
      methodId: string;
    }) => Promise<{
      success: boolean;
      terminal?: { id: string; profileId: string; methodId: string };
      error?: string;
    }>;
    writeAuthTerminal: (input: { id: string; data: string }) => Promise<CodingAgentActionResult>;
    resizeAuthTerminal: (input: {
      id: string;
      columns: number;
      rows: number;
    }) => Promise<CodingAgentActionResult>;
    cancelAuthTerminal: (id: string) => Promise<CodingAgentActionResult>;
    respondPermission: (input: {
      workspaceRoot: string;
      response: import('../../shared/codingAgent').CodingPermissionResponse;
    }) => Promise<CodingAgentActionResult>;
    onChanged: (
      callback: (snapshot: import('../../shared/codingAgent').CodingRoomSnapshot) => void,
    ) => () => void;
    onPendingMessagesChanged: (
      callback: (event: import('../../shared/codingAgent').CodingPendingMessagesChangedEvent) => void,
    ) => () => void;
    onAuthTerminalData: (callback: (event: { id: string; data: string }) => void) => () => void;
    onAuthTerminalExit: (
      callback: (event: {
        id: string;
        profileId: string;
        methodId: string;
        exitCode: number;
        signal?: number;
      }) => void,
    ) => () => void;
  };
  dialog: {
    selectDirectory: (options?: {
      defaultPath?: string;
    }) => Promise<{ success: boolean; path: string | null }>;
    selectFile: (options?: {
      title?: string;
      filters?: { name: string; extensions: string[] }[];
    }) => Promise<{ success: boolean; path: string | null }>;
    selectFiles: (options?: {
      title?: string;
      filters?: { name: string; extensions: string[] }[];
    }) => Promise<{ success: boolean; paths: string[] }>;
    saveInlineFile: (options: {
      dataBase64: string;
      fileName?: string;
      mimeType?: string;
      cwd?: string;
    }) => Promise<{ success: boolean; path: string | null; error?: string }>;
    readFileAsDataUrl: (
      filePath: string,
    ) => Promise<{ success: boolean; dataUrl?: string; error?: string }>;
    generateThumbnail: (
      filePath: string,
    ) => Promise<{ success: boolean; dataUrl?: string; error?: string }>;
    showMessageBox: (options: {
      message: string;
      type?: 'none' | 'info' | 'error' | 'question' | 'warning';
      title?: string;
    }) => Promise<{ response: number }>;
  };
  project: {
    getDefaultBaseDir: () => Promise<{ success: boolean; path: string | null; error?: string }>;
    createDirectory: (options: { name: string; baseDir?: string }) => Promise<{
      success: boolean;
      path: string | null;
      code?: 'invalid-name' | 'already-exists';
      error?: string;
    }>;
    ensureScratchDir: () => Promise<{ success: boolean; path: string | null; error?: string }>;
    createRandomWorkspace: () => Promise<{ success: boolean; path: string | null; error?: string }>;
  };
  shell: {
    openPath: (filePath: string) => Promise<{ success: boolean; error?: string }>;
    showItemInFolder: (filePath: string) => Promise<{ success: boolean; error?: string }>;
    openExternal: (url: string) => Promise<{ success: boolean; error?: string }>;
    openHtmlInBrowser: (htmlContent: string) => Promise<{ success: boolean; error?: string }>;
  };
  autoLaunch: {
    get: () => Promise<{ enabled: boolean }>;
    set: (enabled: boolean) => Promise<{ success: boolean; error?: string }>;
  };
  preventSleep: {
    get: () => Promise<{ enabled: boolean }>;
    set: (enabled: boolean) => Promise<{ success: boolean; error?: string }>;
  };
  appInfo: {
    getVersion: () => Promise<string>;
    getSystemLocale: () => Promise<string>;
    consumePendingLocalInferenceInstall: () => Promise<string | null>;
    relaunch: () => Promise<void>;
  };
  appUpdate: {
    getState: () => Promise<AppUpdateRuntimeState>;
    checkNow: (options?: {
      manual?: boolean;
      userId?: string | null;
    }) => Promise<AppUpdateCheckResult>;
    retryDownload: () => Promise<{ success: boolean; state: AppUpdateRuntimeState }>;
    pauseDownload: () => Promise<{ success: boolean; state: AppUpdateRuntimeState }>;
    resumeDownload: () => Promise<{ success: boolean; state: AppUpdateRuntimeState }>;
    cancelDownload: () => Promise<{ success: boolean; state: AppUpdateRuntimeState }>;
    installReady: () => Promise<{ success: boolean; state: AppUpdateRuntimeState; error?: string }>;
    onStateChanged: (callback: (data: AppUpdateRuntimeState) => void) => () => void;
  };
  log: {
    getPath: () => Promise<string>;
    openFolder: () => Promise<void>;
    exportZip: () => Promise<{
      success: boolean;
      canceled?: boolean;
      path?: string;
      missingEntries?: string[];
      error?: string;
    }>;
    fromRenderer: (level: string, tag: string, message: string) => void;
  };
  im: {
    getConfig: () => Promise<{ success: boolean; config?: IMGatewayConfig; error?: string }>;
    setConfig: (
      config: IMGatewayConfigPatch,
      options?: { syncGateway?: boolean },
    ) => Promise<{ success: boolean; error?: string }>;
    syncConfig: () => Promise<{ success: boolean; error?: string }>;
    startGateway: (platform: Platform) => Promise<{ success: boolean; error?: string }>;
    stopGateway: (platform: Platform) => Promise<{ success: boolean; error?: string }>;
    testGateway: (
      platform: Platform,
      configOverride?: Partial<IMGatewayConfig>,
      accountId?: string,
    ) => Promise<{ success: boolean; result?: IMConnectivityTestResult; error?: string }>;
    getStatus: () => Promise<{ success: boolean; status?: IMGatewayStatus; error?: string }>;
    getLocalIp: () => Promise<string>;
    weixinLoginStart: () => Promise<{
      success: boolean;
      status?: 'wait';
      qrcode?: string;
      qrcodeUrl?: string;
      message?: string;
    }>;
    weixinLoginPoll: (qrcode: string) => Promise<{
      success: boolean;
      status: 'wait' | 'scaned' | 'confirmed' | 'expired';
      accountId?: string;
      message?: string;
    }>;
    addQQInstance: (
      name: string,
      workspaceId: string,
    ) => Promise<{ success: boolean; instance?: QQInstanceConfig; error?: string }>;
    deleteQQInstance: (instanceId: string) => Promise<{ success: boolean; error?: string }>;
    setQQInstanceConfig: (
      instanceId: string,
      config: any,
      options?: { syncGateway?: boolean },
    ) => Promise<{ success: boolean; error?: string }>;
    addFeishuInstance: (
      name: string,
      workspaceId: string,
    ) => Promise<{ success: boolean; instance?: FeishuInstanceConfig; error?: string }>;
    deleteFeishuInstance: (instanceId: string) => Promise<{ success: boolean; error?: string }>;
    setFeishuInstanceConfig: (
      instanceId: string,
      config: any,
      options?: { syncGateway?: boolean },
    ) => Promise<{ success: boolean; error?: string }>;
    addDingTalkInstance: (
      name: string,
      workspaceId: string,
    ) => Promise<{ success: boolean; instance?: DingTalkInstanceConfig; error?: string }>;
    deleteDingTalkInstance: (instanceId: string) => Promise<{ success: boolean; error?: string }>;
    setDingTalkInstanceConfig: (
      instanceId: string,
      config: any,
      options?: { syncGateway?: boolean },
    ) => Promise<{ success: boolean; error?: string }>;
    addWecomInstance: (
      name: string,
      workspaceId: string,
    ) => Promise<{ success: boolean; instance?: WecomInstanceConfig; error?: string }>;
    deleteWecomInstance: (instanceId: string) => Promise<{ success: boolean; error?: string }>;
    setWecomInstanceConfig: (
      instanceId: string,
      config: any,
      options?: { syncGateway?: boolean },
    ) => Promise<{ success: boolean; error?: string }>;
    addTelegramInstance: (
      name: string,
      workspaceId: string,
    ) => Promise<{ success: boolean; instance?: TelegramInstanceConfig; error?: string }>;
    deleteTelegramInstance: (instanceId: string) => Promise<{ success: boolean; error?: string }>;
    setTelegramInstanceConfig: (
      instanceId: string,
      config: any,
      options?: { syncGateway?: boolean },
    ) => Promise<{ success: boolean; error?: string }>;
    addDiscordInstance: (
      name: string,
      workspaceId: string,
    ) => Promise<{ success: boolean; instance?: DiscordInstanceConfig; error?: string }>;
    deleteDiscordInstance: (instanceId: string) => Promise<{ success: boolean; error?: string }>;
    setDiscordInstanceConfig: (
      instanceId: string,
      config: any,
      options?: { syncGateway?: boolean },
    ) => Promise<{ success: boolean; error?: string }>;
    onStatusChange: (callback: (status: IMGatewayStatus) => void) => () => void;
    onMessageReceived: (callback: (message: IMMessage) => void) => () => void;
  };
  scheduledTasks: {
    list: () => Promise<{
      success: boolean;
      tasks?: import('../../scheduledTask/types').ScheduledTask[];
      error?: string;
    }>;
    get: (id: string) => Promise<{
      success: boolean;
      task?: import('../../scheduledTask/types').ScheduledTask;
      error?: string;
    }>;
    create: (input: import('../../scheduledTask/types').ScheduledTaskInput) => Promise<{
      success: boolean;
      task?: import('../../scheduledTask/types').ScheduledTask;
      error?: string;
    }>;
    update: (
      id: string,
      input: Partial<import('../../scheduledTask/types').ScheduledTaskInput>,
    ) => Promise<{
      success: boolean;
      task?: import('../../scheduledTask/types').ScheduledTask;
      error?: string;
    }>;
    delete: (id: string) => Promise<{ success: boolean; error?: string }>;
    toggle: (
      id: string,
      enabled: boolean,
    ) => Promise<{
      success: boolean;
      task?: import('../../scheduledTask/types').ScheduledTask;
      warning?: string;
      error?: string;
    }>;
    runManually: (id: string) => Promise<{ success: boolean; error?: string }>;
    stop: (id: string) => Promise<{ success: boolean; error?: string }>;
    preflight: (id: string) => Promise<{
      success: boolean;
      error?: string;
      preflight?: {
        hasChannel: boolean;
        channel?: string;
        latestDelivery?: import('../../scheduledTask/types').ScheduledTaskDeliveryRecord | null;
      };
    }>;
    listRuns: (
      taskId: string,
      limit?: number,
      offset?: number,
      filter?: import('../../scheduledTask/types').RunFilter,
    ) => Promise<{
      success: boolean;
      runs?: import('../../scheduledTask/types').ScheduledTaskRun[];
      error?: string;
    }>;
    listDeliveries: (runId: string) => Promise<{
      success: boolean;
      deliveries?: import('../../scheduledTask/types').ScheduledTaskDeliveryRecord[];
      error?: string;
    }>;
    countRuns: (taskId: string) => Promise<{ success: boolean; count?: number; error?: string }>;
    listAllRuns: (
      limit?: number,
      offset?: number,
      filter?: import('../../scheduledTask/types').RunFilter,
    ) => Promise<{
      success: boolean;
      runs?: import('../../scheduledTask/types').ScheduledTaskRunWithName[];
      error?: string;
    }>;
    resolveSession: (sessionKey: string) => Promise<{
      success: boolean;
      session?: import('./cowork').CoworkSession | null;
      error?: string;
    }>;
    listChannels: () => Promise<{
      success: boolean;
      channels?: import('../../scheduledTask/types').ScheduledTaskChannelOption[];
      error?: string;
    }>;
    listChannelConversations?: (
      channel: string,
      accountId?: string,
      filterAccountId?: string,
    ) => Promise<{
      success: boolean;
      conversations?: import('../../scheduledTask/types').ScheduledTaskConversationOption[];
      error?: string;
    }>;
    onStatusUpdate: (
      callback: (data: import('../../scheduledTask/types').ScheduledTaskStatusEvent) => void,
    ) => () => void;
    onRunUpdate: (
      callback: (data: import('../../scheduledTask/types').ScheduledTaskRunEvent) => void,
    ) => () => void;
    onRefresh: (callback: () => void) => () => void;
  };
  permissions: {
    checkCalendar: () => Promise<{
      success: boolean;
      status?: string;
      error?: string;
      autoRequested?: boolean;
    }>;
    requestCalendar: () => Promise<{
      success: boolean;
      granted?: boolean;
      status?: string;
      error?: string;
    }>;
  };
  auth: {
    communityLogin: () => Promise<{ success: boolean; error?: string }>;
    getCommunityUser: () => Promise<{ success: boolean; user?: { id: string; email: string } }>;
    communityLogout: () => Promise<{ success: boolean }>;
    onCommunityCallback: (
      callback: (data: {
        success: boolean;
        user?: { id: string; email: string; name: string };
        error?: string;
      }) => void,
    ) => () => void;
  };
  modelPool: {
    stream: (input: { requestId: string; body: Record<string, unknown> }) => Promise<{
      ok: boolean;
      status: number;
      statusText: string;
      error?: string;
    }>;
    cancelStream: (requestId: string) => Promise<boolean>;
    onStreamData: (requestId: string, callback: (data: string) => void) => () => void;
    onStreamDone: (requestId: string, callback: () => void) => () => void;
    onStreamError: (requestId: string, callback: (error: string) => void) => () => void;
    onStreamAbort: (requestId: string, callback: () => void) => () => void;
  };
  enterprise: {
    getConfig: () => Promise<{
      ui?: Record<string, 'hide' | 'disable' | 'readonly'>;
      disableUpdate?: boolean;
      version: string;
      name: string;
    } | null>;
    renderer: {
      sessionGateEntrypoint: () => Promise<string | null>;
      settingsPages: () => Promise<
        readonly import('../../shared/enterpriseRenderer').EnterpriseRendererSettingsPage[]
      >;
    };
    session: {
      snapshot: () => Promise<EnterpriseSessionResult>;
      login: (input: EnterprisePasswordLoginInput) => Promise<EnterpriseSessionResult>;
      changePassword: (input: EnterprisePasswordChangeInput) => Promise<EnterpriseSessionResult>;
      logout: () => Promise<EnterpriseSessionResult>;
    };
  };
  managedProviders: {
    policy: () => Promise<import('../../shared/managedProviders').ManagedProviderAccessPolicy>;
    catalog: () => Promise<
      readonly import('../../shared/managedProviders').ManagedProviderCatalogModel[]
    >;
    onChanged: (callback: () => void) => () => void;
  };
  networkStatus: {
    send: (status: 'online' | 'offline') => void;
  };
  qwen: Record<string, never>;
  feishu: {
    install: {
      verify: (
        appId: string,
        appSecret: string,
      ) => Promise<{
        success: boolean;
        error?: string;
      }>;
    };
  };
  dingtalk: {
    install: {
      qrcode: () => Promise<{
        url: string;
        deviceCode: string;
        interval: number;
        expireIn: number;
      }>;
      poll: (deviceCode: string) => Promise<{
        done: boolean;
        clientId?: string;
        clientSecret?: string;
        error?: string;
      }>;
      verify: (
        clientId: string,
        clientSecret: string,
      ) => Promise<{
        success: boolean;
        error?: string;
      }>;
    };
  };
  githubCopilot: {
    requestDeviceCode: () => Promise<{
      userCode: string;
      verificationUri: string;
      deviceCode: string;
      interval: number;
      expiresIn: number;
    }>;
    pollForToken: (
      deviceCode: string,
      interval: number,
      expiresIn: number,
    ) => Promise<{
      success: boolean;
      token?: string;
      githubUser?: string;
      baseUrl?: string;
      error?: string;
    }>;
    cancelPolling: () => Promise<void>;
    signOut: () => Promise<void>;
    refreshToken: () => Promise<{
      success: boolean;
      token?: string;
      baseUrl?: string;
      error?: string;
    }>;
    onTokenUpdated: (callback: (data: { token: string; baseUrl: string }) => void) => () => void;
  };
  openaiCodexOAuth: {
    start: () => Promise<
      | { success: true; email: string | null; accountId: string | null; expiresAt: number }
      | { success: false; error: string }
    >;
    cancel: () => Promise<void>;
    logout: () => Promise<void>;
    status: () => Promise<
      | { loggedIn: true; email: string | null; accountId: string | null; expiresAt: number }
      | { loggedIn: false }
    >;
  };

  activity: {
    list: () => Promise<{ success: boolean; runs: ActivityRun[] }>;
    onUpdated: (callback: (run: ActivityRun) => void) => () => void;
  };
}

interface IMGatewayConfig {
  dingtalk: DingTalkMultiInstanceConfig;
  feishu: FeishuMultiInstanceConfig;
  telegram: TelegramMultiInstanceConfig;
  qq: QQMultiInstanceConfig;
  discord: DiscordMultiInstanceConfig;
  wecom: WecomMultiInstanceConfig;
  weixin: WeixinChannelConfig;
  settings: IMSettings;
}

type IMGatewayConfigPatch = Omit<Partial<IMGatewayConfig>, 'weixin'> & {
  weixin?: Partial<WeixinChannelConfig>;
};

interface DingTalkChannelConfig {
  enabled: boolean;
  clientId: string;
  clientSecret: string;
  dmPolicy: 'open' | 'pairing' | 'allowlist';
  allowFrom: string[];
  groupPolicy: 'open' | 'allowlist';
  sessionTimeout: number;
  separateSessionByConversation: boolean;
  groupSessionScope: 'group' | 'group_sender';
  sharedMemoryAcrossConversations: boolean;
  gatewayBaseUrl: string;
  debug: boolean;
}

interface DingTalkInstanceConfig extends DingTalkChannelConfig {
  instanceId: string;
  instanceName: string;
  workspaceId: string;
}

interface DingTalkInstanceStatus extends DingTalkGatewayStatus {
  instanceId: string;
  instanceName: string;
}

interface DingTalkMultiInstanceConfig {
  instances: DingTalkInstanceConfig[];
}

interface DingTalkMultiInstanceStatus {
  instances: DingTalkInstanceStatus[];
}

interface FeishuChannelGroupConfig {
  requireMention?: boolean;
  allowFrom?: string[];
  systemPrompt?: string;
}

interface FeishuChannelFooterConfig {
  status?: boolean;
  elapsed?: boolean;
}

interface FeishuChannelBlockStreamingCoalesceConfig {
  minChars?: number;
  maxChars?: number;
  idleMs?: number;
}

interface FeishuChannelConfig {
  enabled: boolean;
  appId: string;
  appSecret: string;
  domain: 'feishu' | 'lark' | string;
  dmPolicy: 'pairing' | 'allowlist' | 'open' | 'disabled';
  allowFrom: string[];
  groupPolicy: 'allowlist' | 'open' | 'disabled';
  groupAllowFrom: string[];
  groups: Record<string, FeishuChannelGroupConfig>;
  historyLimit: number;
  streaming: boolean;
  replyMode: 'auto' | 'static' | 'streaming';
  blockStreaming: boolean;
  footer: FeishuChannelFooterConfig;
  blockStreamingCoalesce?: FeishuChannelBlockStreamingCoalesceConfig;
  mediaMaxMb: number;
  debug: boolean;
}

interface FeishuInstanceConfig extends FeishuChannelConfig {
  instanceId: string;
  instanceName: string;
  workspaceId: string;
}

interface FeishuInstanceStatus extends FeishuGatewayStatus {
  instanceId: string;
  instanceName: string;
}

interface FeishuMultiInstanceConfig {
  instances: FeishuInstanceConfig[];
}

interface FeishuMultiInstanceStatus {
  instances: FeishuInstanceStatus[];
}

interface TelegramChannelGroupConfig {
  requireMention?: boolean;
  allowFrom?: string[];
  systemPrompt?: string;
}

interface TelegramChannelConfig {
  enabled: boolean;
  botToken: string;
  dmPolicy: 'pairing' | 'allowlist' | 'open' | 'disabled';
  allowFrom: string[];
  groupPolicy: 'allowlist' | 'open' | 'disabled';
  groupAllowFrom: string[];
  groups: Record<string, TelegramChannelGroupConfig>;
  historyLimit: number;
  replyToMode: 'off' | 'first' | 'all';
  linkPreview: boolean;
  streaming: 'off' | 'partial' | 'block' | 'progress';
  mediaMaxMb: number;
  proxy: string;
  webhookUrl: string;
  webhookSecret: string;
  debug: boolean;
}

interface TelegramInstanceConfig extends TelegramChannelConfig {
  instanceId: string;
  instanceName: string;
  workspaceId: string;
}

interface TelegramInstanceStatus extends TelegramGatewayStatus {
  instanceId: string;
  instanceName: string;
}

interface TelegramMultiInstanceConfig {
  instances: TelegramInstanceConfig[];
}

interface TelegramMultiInstanceStatus {
  instances: TelegramInstanceStatus[];
}

interface DiscordChannelGuildConfig {
  requireMention?: boolean;
  allowFrom?: string[];
  systemPrompt?: string;
}

interface DiscordChannelConfig {
  enabled: boolean;
  botToken: string;
  dmPolicy: 'pairing' | 'allowlist' | 'open' | 'disabled';
  allowFrom: string[];
  groupPolicy: 'allowlist' | 'open' | 'disabled';
  groupAllowFrom: string[];
  guilds: Record<string, DiscordChannelGuildConfig>;
  historyLimit: number;
  streaming: 'off' | 'partial' | 'block' | 'progress';
  mediaMaxMb: number;
  proxy: string;
  debug: boolean;
}

interface QQConfig {
  enabled: boolean;
  appId: string;
  appSecret: string;
  dmPolicy: 'open' | 'pairing' | 'allowlist';
  allowFrom: string[];
  groupPolicy: 'open' | 'allowlist' | 'disabled';
  groupAllowFrom: string[];
  historyLimit: number;
  markdownSupport: boolean;
  imageServerBaseUrl: string;
  debug: boolean;
}

interface QQInstanceConfig extends QQConfig {
  instanceId: string;
  instanceName: string;
  workspaceId: string;
}

interface QQMultiInstanceConfig {
  instances: QQInstanceConfig[];
}

interface QQInstanceStatus extends QQGatewayStatus {
  instanceId: string;
  instanceName: string;
}

interface QQMultiInstanceStatus {
  instances: QQInstanceStatus[];
}

interface WecomConfig {
  enabled: boolean;
  botId: string;
  secret: string;
  dmPolicy: 'open' | 'pairing' | 'allowlist' | 'disabled';
  allowFrom: string[];
  groupPolicy: 'open' | 'allowlist' | 'disabled';
  groupAllowFrom: string[];
  sendThinkingMessage: boolean;
  debug: boolean;
}

interface WecomInstanceConfig extends WecomConfig {
  instanceId: string;
  instanceName: string;
  workspaceId: string;
}

interface WecomMultiInstanceConfig {
  instances: WecomInstanceConfig[];
}

interface WecomInstanceStatus extends WecomGatewayStatus {
  instanceId: string;
  instanceName: string;
}

interface WecomMultiInstanceStatus {
  instances: WecomInstanceStatus[];
}

interface WeixinChannelConfig {
  enabled: boolean;
  accountId: string;
  workspaceId: string;
  token: string;
  baseUrl: string;
  dmPolicy: 'open' | 'pairing' | 'allowlist' | 'disabled';
  allowFrom: string[];
  groupPolicy: 'open' | 'allowlist' | 'disabled';
  groupAllowFrom: string[];
  debug: boolean;
}

interface IMSettings {
  systemPrompt?: string;
  skillsEnabled: boolean;
}

interface IMGatewayStatus {
  dingtalk: DingTalkMultiInstanceStatus;
  feishu: FeishuMultiInstanceStatus;
  qq: QQMultiInstanceStatus;
  telegram: TelegramMultiInstanceStatus;
  discord: DiscordMultiInstanceStatus;
  wecom: WecomMultiInstanceStatus;
  weixin: WeixinGatewayStatus;
}

type IMConnectivityVerdict = 'pass' | 'warn' | 'fail';

type IMConnectivityCheckLevel = 'pass' | 'info' | 'warn' | 'fail';

type IMConnectivityCheckCode =
  | 'missing_credentials'
  | 'auth_check'
  | 'gateway_running'
  | 'inbound_activity'
  | 'outbound_activity'
  | 'platform_last_error'
  | 'feishu_group_requires_mention'
  | 'feishu_event_subscription_required'
  | 'discord_group_requires_mention'
  | 'telegram_privacy_mode_hint'
  | 'dingtalk_bot_membership_hint'
  | 'qq_guild_mention_hint';

interface IMConnectivityCheck {
  code: IMConnectivityCheckCode;
  level: IMConnectivityCheckLevel;
  message: string;
  suggestion?: string;
}

interface IMConnectivityTestResult {
  platform: Platform;
  testedAt: number;
  verdict: IMConnectivityVerdict;
  checks: IMConnectivityCheck[];
}

interface DingTalkGatewayStatus {
  connected: boolean;
  startedAt: number | null;
  lastError: string | null;
  lastInboundAt: number | null;
  lastOutboundAt: number | null;
}

interface FeishuGatewayStatus {
  connected: boolean;
  startedAt: string | null;
  botOpenId: string | null;
  error: string | null;
  lastInboundAt: number | null;
  lastOutboundAt: number | null;
}

interface TelegramGatewayStatus {
  connected: boolean;
  startedAt: number | null;
  lastError: string | null;
  botUsername: string | null;
  lastInboundAt: number | null;
  lastOutboundAt: number | null;
}

interface DiscordGatewayStatus {
  connected: boolean;
  starting: boolean;
  startedAt: number | null;
  lastError: string | null;
  botUsername: string | null;
  lastInboundAt: number | null;
  lastOutboundAt: number | null;
}

interface DiscordInstanceConfig extends DiscordChannelConfig {
  instanceId: string;
  instanceName: string;
  workspaceId: string;
}

interface DiscordInstanceStatus extends DiscordGatewayStatus {
  instanceId: string;
  instanceName: string;
}

interface DiscordMultiInstanceConfig {
  instances: DiscordInstanceConfig[];
}

interface DiscordMultiInstanceStatus {
  instances: DiscordInstanceStatus[];
}

interface QQGatewayStatus {
  connected: boolean;
  startedAt: number | null;
  lastError: string | null;
  lastInboundAt: number | null;
  lastOutboundAt: number | null;
}

interface WecomGatewayStatus {
  connected: boolean;
  startedAt: number | null;
  lastError: string | null;
  botId: string | null;
  lastInboundAt: number | null;
  lastOutboundAt: number | null;
}

interface WeixinGatewayStatus {
  connected: boolean;
  startedAt: number | null;
  lastError: string | null;
  lastInboundAt: number | null;
  lastOutboundAt: number | null;
}

interface IMMessage {
  platform: Platform;
  messageId: string;
  conversationId: string;
  senderId: string;
  senderName?: string;
  content: string;
  chatType: 'direct' | 'group';
  timestamp: number;
}

declare global {
  interface Window {
    electron: IElectronAPI;
  }
}

export {};
