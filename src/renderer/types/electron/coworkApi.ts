/**
 * Cowork preload surface, split from `../electron.d.ts`.
 *
 * Contains the Cowork session/config/permission data types exchanged over IPC
 * and the `cowork` namespace (sessions, pending messages, streaming,
 * workspaces, image export, permission responses).
 */
import type { PiUiRuntimeSnapshot } from '../../../shared/cowork/piUiRuntimeSnapshot';
import type {
  CoworkExecutionMode,
  CoworkPermissionMode,
  CoworkSessionMode,
  CoworkSessionSource,
} from '../../../shared/cowork/constants';
import type { CoworkPendingMessage } from '../../../shared/cowork/pendingMessageQueue';

interface CoworkSession {
  mode?: import('../../../shared/cowork/constants').CoworkSessionMode;
  id: string;
  title: string;
  status: 'idle' | 'running' | 'completed' | 'error';
  pinned: boolean;
  pinOrder?: number | null;
  cwd: string;
  systemPrompt: string;
  modelOverride: string;
  executionMode: CoworkExecutionMode;
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
  sequence?: number;
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
  executionMode: CoworkExecutionMode;
  permissionMode: CoworkPermissionMode;
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
    | 'codemodeEnabled'
    | 'mcpNativeBridge'
  >
>;

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

export interface CoworkApi {
  getRunSnapshot: (
    sessionId: string,
    replayContent?: boolean,
  ) => Promise<{
    success: boolean;
    snapshot: import('../../../shared/cowork/runState').CoworkRunSnapshot | null;
    running: boolean;
  }>;
  onStreamRunState: (
    callback: (snapshot: import('../../../shared/cowork/runState').CoworkRunSnapshot) => void,
  ) => () => void;
  onStreamContentPatch: (
    callback: (patch: import('../../../shared/cowork/runState').CoworkContentPatch) => void,
  ) => () => void;
  listWorkspaces: () => Promise<{
    success: boolean;
    workspaces?: import('../../../shared/workspace').Workspace[];
    error?: string;
  }>;
  createWorkspace: (options: { path: string; name: string }) => Promise<{
    success: boolean;
    workspace?: import('../../../shared/workspace').Workspace;
    error?: string;
  }>;
  ensureWorkspace: (options: { path: string; name?: string; isHidden?: boolean }) => Promise<{
    success: boolean;
    workspace?: import('../../../shared/workspace').Workspace;
    error?: string;
  }>;
  renameWorkspace: (
    id: string,
    name: string,
  ) => Promise<{
    success: boolean;
    workspace?: import('../../../shared/workspace').Workspace;
    error?: string;
  }>;
  updateWorkspace: (options: {
    id: string;
    name?: string;
    primaryPath?: string;
    folders?: string[];
  }) => Promise<{
    success: boolean;
    workspace?: import('../../../shared/workspace').Workspace;
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
    workspaceId?: string;
    agentId?: string;
    expertIds?: string[];
    permissionMode?: CoworkPermissionMode;
    permissionModeBySession?: Record<string, CoworkPermissionMode>;
    imageAttachments?: Array<{
      name: string;
      mimeType: string;
      base64Data?: string;
      path?: string;
    }>;
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
    expertIds?: string[];
    permissionMode?: CoworkPermissionMode;
    imageAttachments?: Array<{
      name: string;
      mimeType: string;
      base64Data?: string;
      path?: string;
    }>;
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
    imageAttachments?: Array<{
      name: string;
      mimeType: string;
      base64Data?: string;
      path?: string;
    }>;
    fileAttachments?: Array<{ name: string; path: string; extension: string; isImage?: boolean }>;
    skillIds?: string[];
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
  compactSession: (
    sessionId: string,
  ) => Promise<import('../../../shared/cowork/constants').CoworkCompactResult>;
  // `CoworkSessionResult` was unresolved in the original declaration (masked by
  // skipLibCheck on the ambient .d.ts); kept as an explicit any so the public
  // surface and the generated browser mock (which emits null here) stay identical.
  saveSession: (session: Record<string, unknown>) => Promise<any>;
  deleteSession: (sessionId: string) => Promise<{ success: boolean; error?: string }>;
  deleteSessions: (sessionIds: string[]) => Promise<{ success: boolean; error?: string }>;
  setSessionPinned: (options: {
    sessionId: string;
    pinned: boolean;
  }) => Promise<{ success: boolean; pinOrder?: number | null; error?: string }>;
  renameSession: (options: {
    sessionId: string;
    title: string;
  }) => Promise<{ success: boolean; title?: string; error?: string }>;
  updateSessionModel: (options: {
    sessionId: string;
    modelOverride: string;
  }) => Promise<{ success: boolean; session?: CoworkSession | null; error?: string }>;
  getSession: (
    sessionId: string,
    options?: { messageLimit?: number | null },
  ) => Promise<{ success: boolean; session?: CoworkSession; error?: string }>;
  getRuntimeSnapshots: (sessionId?: string) => Promise<PiUiRuntimeSnapshot[]>;
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
  getSessionMessages: (options: { sessionId: string; limit?: number; offset?: number }) => Promise<{
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
  onStreamUiEvent: (
    callback: (event: import('../../../shared/cowork/piUiEvent').PiUiEvent) => void,
  ) => () => void;
  onSessionsChanged: (
    callback: (data: {
      sessionId?: string;
      deletedSessionIds?: string[];
      agentId?: string;
    }) => void,
  ) => () => void;
}
