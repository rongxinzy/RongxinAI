// Types mirroring src/types/cowork.ts for main process use.
// Split from src/main/coworkStore.ts (issue #1069); re-exported from there.
import type { CoworkPersistedArtifact } from '../../shared/cowork/artifacts';
import type {
  CoworkExecutionMode,
  CoworkPermissionMode as CoworkPermissionModeType,
  CoworkSessionSource,
} from '../../shared/cowork/constants';
import type { CoworkSessionExpertSnapshot } from '../../shared/cowork/sessionExperts';

export type CoworkSessionStatus = 'idle' | 'running' | 'completed' | 'error';
export type CoworkMessageType = 'user' | 'assistant' | 'tool_use' | 'tool_result' | 'system';

export type AgentSource = 'custom' | 'preset' | 'expert-package' | 'expert-package-member';

export interface Agent {
  id: string;
  name: string;
  description: string;
  systemPrompt: string;
  identity: string;
  model: string;
  workingDirectory: string;
  icon: string;
  skillIds: string[];
  enabled: boolean;
  pinned: boolean;
  pinOrder?: number | null;
  isDefault: boolean;
  source: AgentSource;
  presetId: string;
  triageOverride?: import('../../shared/triage').AgentTriageOverride;
  createdAt: number;
  updatedAt: number;
}

export interface CreateAgentRequest {
  id?: string;
  name: string;
  description?: string;
  systemPrompt?: string;
  identity?: string;
  model?: string;
  workingDirectory?: string;
  icon?: string;
  skillIds?: string[];
  source?: AgentSource;
  presetId?: string;
  triageOverride?: import('../../shared/triage').AgentTriageOverride;
}

export interface UpdateAgentRequest {
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
}

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
  /** True when this assistant message holds reasoning/thinking content (rendered as a ThinkingBlock). */
  isThinking?: boolean;
  /** Runtime-measured duration for this thinking message. */
  thinkingDurationMs?: number;
  skillIds?: string[];
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    cacheReadTokens?: number;
    cacheWriteTokens?: number;
    reasoningTokens?: number;
    totalTokens?: number;
  };
  metrics?: {
    requestStartedAt?: number;
    firstVisibleTextAt?: number;
    completedAt?: number;
    sessionCreatedAt?: number;
    agentStartedAt?: number;
    sessionCreateToAgentStartMs?: number;
    agentStartToFirstTokenMs?: number;
    sessionCreateToFirstTokenMs?: number;
    toolDurationMs?: number;
  };
  contextPercent?: number;
  model?: string;
  modelProviderKey?: string;
  agentName?: string;
  /** Experts that were active for the turn that produced this message. */
  experts?: import('../../shared/cowork/sessionExperts').CoworkMessageExpertIdentity[];
  interruption?: import('../../shared/cowork/interruption').CoworkSessionInterruption;
  [key: string]: unknown;
}

export interface CoworkMessage {
  id: string;
  type: CoworkMessageType;
  content: string;
  timestamp: number;
  /** Monotonic persisted order within a session. */
  sequence?: number;
  metadata?: CoworkMessageMetadata;
}

export interface CoworkConversationReplacementEntry {
  role: 'user' | 'assistant';
  text: string;
  metadata?: Record<string, unknown>;
  timestamp?: number;
}

export interface CoworkSession {
  id: string;
  title: string;
  titleUserRenamed: boolean;
  status: CoworkSessionStatus;
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
  /** Origin of the session: user-created, scheduled task, or IM channel. */
  source: CoworkSessionSource;
  experts: CoworkSessionExpertSnapshot[];
  messages: CoworkMessage[];
  /** Offset of the first loaded message in the full message history. */
  messagesOffset: number;
  /** Total number of messages stored for this session. */
  totalMessages: number;
  /** Persisted artifacts aggregated across all turns (survives pagination). */
  artifacts: CoworkPersistedArtifact[];
  createdAt: number;
  updatedAt: number;
}

export interface CoworkSessionSummary {
  id: string;
  title: string;
  status: CoworkSessionStatus;
  mode?: 'work' | 'chat';
  pinned: boolean;
  pinOrder?: number | null;
  workspaceId: string;
  agentId: string;
  source: CoworkSessionSource;
  createdAt: number;
  updatedAt: number;
}

export interface CoworkConversationSearchRecord {
  sessionId: string;
  title: string;
  updatedAt: number;
  url: string;
  human: string;
  assistant: string;
}

export interface CoworkConfig {
  workingDirectory: string;
  systemPrompt: string;
  executionMode: CoworkExecutionMode;
  permissionMode: CoworkPermissionModeType;
  permissionModeBySession: Record<string, CoworkPermissionModeType>;
  embeddingEnabled: boolean;
  embeddingProvider: string;
  embeddingModel: string;
  embeddingLocalModelPath: string;
  embeddingVectorWeight: number;
  embeddingRemoteBaseUrl: string;
  embeddingRemoteApiKey: string;
  codemodeEnabled: boolean;
  mcpNativeBridge: boolean;
}

export type CoworkConfigUpdate = Partial<
  Pick<
    CoworkConfig,
    | 'workingDirectory'
    | 'executionMode'
    | 'permissionMode'
    | 'permissionModeBySession'
    | 'embeddingEnabled'
    | 'embeddingProvider'
    | 'embeddingModel'
    | 'embeddingLocalModelPath'
    | 'embeddingVectorWeight'
    | 'embeddingRemoteBaseUrl'
    | 'embeddingRemoteApiKey'
    | 'codemodeEnabled'
    | 'mcpNativeBridge'
  >
>;
