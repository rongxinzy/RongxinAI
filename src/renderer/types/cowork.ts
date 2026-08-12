// Cowork image attachment for vision-capable models
import type {
  CoworkPermissionMode,
  CoworkPermissionOrigin,
  CoworkSessionMode,
} from '../../shared/cowork/constants';
import type { CoworkPersistedArtifact } from '../../shared/cowork/artifacts';
import type {
  CoworkMessageExpertIdentity,
  CoworkSessionExpertSnapshot,
} from '../../shared/cowork/sessionExperts';
import type { CoworkSessionInterruption } from '../../shared/cowork/interruption';
import type { OpenClawEnginePhase } from '../../shared/openclaw/constants';

export interface CoworkImageAttachment {
  name: string;
  mimeType: string;
  base64Data: string;
}

export interface CoworkFileAttachment {
  name: string;
  path: string;
  extension: string;
  /** Keeps image rendering independent from whether the selected model accepts vision input. */
  isImage?: boolean;
}

// Cowork session status
export const CoworkSessionStatusValue = {
  Idle: 'idle',
  Running: 'running',
  Completed: 'completed',
  Error: 'error',
} as const;

export type CoworkSessionStatus =
  (typeof CoworkSessionStatusValue)[keyof typeof CoworkSessionStatusValue];

// Cowork message types
export type CoworkMessageType = 'user' | 'assistant' | 'tool_use' | 'tool_result' | 'system';

// Cowork execution mode
export type CoworkExecutionMode = 'auto' | 'local' | 'sandbox';
export type CoworkAgentEngine = 'openclaw' | 'pi';

export const OpenClawSessionKeepAlive = {
  OneDay: '1d',
  SevenDays: '7d',
  ThirtyDays: '30d',
  OneYear: '365d',
} as const;

export type OpenClawSessionKeepAlive =
  (typeof OpenClawSessionKeepAlive)[keyof typeof OpenClawSessionKeepAlive];

export interface OpenClawSessionPolicyConfig {
  keepAlive: OpenClawSessionKeepAlive;
}

// Cowork message metadata
export interface CoworkMessageMetadata {
  toolName?: string;
  toolInput?: Record<string, unknown>;
  toolResult?: string;
  toolUseId?: string | null;
  error?: string;
  isError?: boolean;
  isStreaming?: boolean;
  isFinal?: boolean;
  /** True only for the user-facing final answer of a completed turn. */
  isFinalAnswer?: boolean;
  isThinking?: boolean;
  /** Runtime-measured duration for this thinking message. */
  thinkingDurationMs?: number;
  skillIds?: string[];
  fileAttachments?: CoworkFileAttachment[];
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    cacheReadTokens?: number;
    cacheWriteTokens?: number;
    reasoningTokens?: number;
    totalTokens?: number;
  };
  contextPercent?: number;
  /** Current context measured by the agent runtime after this response. */
  contextUsage?: CoworkContextUsage;
  model?: string;
  modelProviderKey?: string;
  agentName?: string;
  /** Experts that were active for the turn that produced this message. */
  experts?: CoworkMessageExpertIdentity[];
  interruption?: CoworkSessionInterruption;
  [key: string]: unknown;
}

export interface CoworkContextUsage {
  usedTokens: number;
  contextWindowTokens: number;
  updatedAt: number;
}

// Cowork message
export interface CoworkMessage {
  id: string;
  type: CoworkMessageType;
  content: string;
  timestamp: number;
  metadata?: CoworkMessageMetadata;
}

// Cowork session
export interface CoworkSession {
  id: string;
  title: string;
  claudeSessionId: string | null;
  status: CoworkSessionStatus;
  /** Session mode: 'work' (PI/OpenClaw) or 'chat' (direct LLM via apiService) */
  mode?: 'work' | 'chat';
  pinned: boolean;
  pinOrder?: number | null;
  cwd: string;
  systemPrompt: string;
  modelOverride: string;
  executionMode: CoworkExecutionMode;
  activeSkillIds: string[];
  workspaceId: string;
  agentId: string;
  experts?: CoworkSessionExpertSnapshot[];
  messages: CoworkMessage[];
  /** Offset of the first loaded message in the full message history. 0 means loaded from the beginning. */
  messagesOffset: number;
  /** Total number of messages stored for this session. */
  totalMessages: number;
  /** Persisted artifacts collected from the full message history on the main process. */
  artifacts?: CoworkPersistedArtifact[];
  createdAt: number;
  updatedAt: number;
}

// Cowork configuration
export interface CoworkConfig {
  workingDirectory: string;
  systemPrompt: string;
  executionMode: CoworkExecutionMode;
  agentEngine: CoworkAgentEngine;
  memoryEnabled: boolean;
  memoryImplicitUpdateEnabled: boolean;
  memoryLlmJudgeEnabled: boolean;
  memoryGuardLevel: 'strict' | 'standard' | 'relaxed';
  memoryUserMemoriesMaxItems: number;
  skipMissedJobs: boolean;
  permissionMode: CoworkPermissionMode;
  permissionModeBySession?: Record<string, CoworkPermissionMode>;
  embeddingEnabled: boolean;
  embeddingProvider: string;
  embeddingModel: string;
  embeddingLocalModelPath: string;
  embeddingVectorWeight: number;
  embeddingRemoteBaseUrl: string;
  embeddingRemoteApiKey: string;
  openClawSessionPolicy: OpenClawSessionPolicyConfig;
}

export type CoworkConfigUpdate = Partial<
  Pick<
    CoworkConfig,
    | 'workingDirectory'
    | 'executionMode'
    | 'agentEngine'
    | 'memoryEnabled'
    | 'memoryImplicitUpdateEnabled'
    | 'memoryLlmJudgeEnabled'
    | 'memoryGuardLevel'
    | 'memoryUserMemoriesMaxItems'
    | 'skipMissedJobs'
    | 'permissionMode'
    | 'permissionModeBySession'
    | 'embeddingEnabled'
    | 'embeddingProvider'
    | 'embeddingModel'
    | 'embeddingLocalModelPath'
    | 'embeddingVectorWeight'
    | 'embeddingRemoteBaseUrl'
    | 'embeddingRemoteApiKey'
  >
>;

export interface CoworkApiConfig {
  apiKey: string;
  baseURL: string;
  model: string;
  apiType?: 'anthropic' | 'openai';
}

export type { OpenClawEnginePhase } from '../../shared/openclaw/constants';

export interface OpenClawEngineStatus {
  phase: OpenClawEnginePhase;
  version: string | null;
  progressPercent?: number;
  message?: string;
  canRetry: boolean;
}

export interface CoworkUserMemoryEntry {
  id: string;
  text: string;
}

export interface CoworkMemoryStats {
  total: number;
  created: number;
  stale: number;
  deleted: number;
  explicit: number;
  implicit: number;
}

// Cowork pending permission request
export interface CoworkPermissionRequest {
  origin: CoworkPermissionOrigin;
  sessionId: string;
  toolName: string;
  toolInput: Record<string, unknown>;
  requestId: string;
  toolUseId?: string | null;
}

export type CoworkPermissionResult =
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

// Cowork permission response
export interface CoworkPermissionResponse {
  requestId: string;
  result: CoworkPermissionResult;
}

// Session summary for list display (without full messages)
export interface CoworkSessionSummary {
  id: string;
  title: string;
  status: CoworkSessionStatus;
  mode?: 'work' | 'chat';
  pinned: boolean;
  pinOrder?: number | null;
  workspaceId?: string;
  agentId?: string;
  createdAt: number;
  updatedAt: number;
}

// Start session options
export interface CoworkStartOptions {
  prompt: string;
  cwd?: string;
  systemPrompt?: string;
  title?: string;
  mode?: CoworkSessionMode;
  goalMode?: boolean;
  activeSkillIds?: string[];
  workspaceId?: string;
  agentId?: string;
  expertIds?: string[];
  modelOverride?: string;
  permissionMode?: CoworkPermissionMode;
  imageAttachments?: CoworkImageAttachment[];
  fileAttachments?: CoworkFileAttachment[];
}

// Continue session options
export interface CoworkContinueOptions {
  sessionId: string;
  prompt: string;
  systemPrompt?: string;
  activeSkillIds?: string[];
  goalMode?: boolean;
  expertIds?: string[];
  permissionMode?: CoworkPermissionMode;
  imageAttachments?: CoworkImageAttachment[];
  fileAttachments?: CoworkFileAttachment[];
}

// IPC result types
export interface CoworkSessionResult {
  success: boolean;
  session?: CoworkSession;
  error?: string;
}

export interface CoworkSessionListResult {
  success: boolean;
  sessions?: CoworkSessionSummary[];
  /** Whether more sessions exist beyond the currently loaded set. */
  hasMore?: boolean;
  error?: string;
}

export interface CoworkMessageListResult {
  success: boolean;
  messages?: CoworkMessage[];
  /** Offset of the first returned message. */
  offset?: number;
  /** Total message count for the session. */
  total?: number;
  error?: string;
}

export interface CoworkConfigResult {
  success: boolean;
  config?: CoworkConfig;
  error?: string;
}

// Stream event types for IPC communication
export type CoworkStreamEventType =
  | 'message'
  | 'tool_use'
  | 'tool_result'
  | 'permission_request'
  | 'complete'
  | 'error';

export interface CoworkStreamEvent {
  type: CoworkStreamEventType;
  sessionId: string;
  data: {
    message?: CoworkMessage;
    permission?: CoworkPermissionRequest;
    error?: string;
    claudeSessionId?: string;
  };
}
