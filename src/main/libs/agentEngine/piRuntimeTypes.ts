import type { CoworkError } from '../../../common/coworkError';
import type { CoworkToolActivityEvent } from '../../../shared/cowork/toolActivity';
import type { CoworkMessage } from '../../coworkStore';
import type { CoworkPendingMessage } from '../../../shared/cowork/pendingMessageQueue';
import type { CoworkQueueDelivery } from '../../../shared/cowork/pendingMessageQueue';

/**
 * Pi-native workbench runtime types (issue #225).
 *
 * Pi is the sole execution kernel for Work, Chat, Channel and Cron runs and
 * owns its session, event and approval types. Shared payload primitives
 * come from the store and shared layers instead of a second runtime abstraction.
 */

export type PiPermissionResult =
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

export interface PiPermissionRequest {
  requestId: string;
  toolName: string;
  toolInput: Record<string, unknown>;
  toolUseId?: string | null;
}

export interface PiRuntimeEvents {
  message: (sessionId: string, message: CoworkMessage) => void;
  messageUpdate: (
    sessionId: string,
    messageId: string,
    content: string,
    metadata?: Record<string, unknown>,
  ) => void;
  toolActivity: (sessionId: string, event: CoworkToolActivityEvent) => void;
  permissionRequest: (sessionId: string, request: PiPermissionRequest) => void;
  permissionDismiss: (requestId: string) => void;
  complete: (sessionId: string, claudeSessionId: string | null) => void;
  error: (sessionId: string, error: CoworkError) => void;
  sessionStopped: (sessionId: string) => void;
  queueUpdated: (sessionId: string, items: CoworkPendingMessage[]) => void;
}

export type PiImageAttachment = {
  name: string;
  mimeType: string;
  base64Data: string;
};

export type PiConversationHistoryMessage = {
  role: 'user' | 'assistant';
  content: string;
};

export type PiStartOptions = {
  skipInitialUserMessage?: boolean;
  skillIds?: string[];
  systemPrompt?: string;
  autoApprove?: boolean;
  workspaceRoot?: string;
  confirmationMode?: 'modal' | 'text';
  /** UI session mode, used to apply Work-only execution controls. */
  sessionMode?: 'work' | 'chat';
  goalMode?: boolean;
  imageAttachments?: PiImageAttachment[];
  agentId?: string;
  expertIds?: string[];
  modelOverride?: string;
  /** Previous conversation to restore (user/assistant pairs), injected into PI session state */
  conversationHistory?: PiConversationHistoryMessage[];
  /** Internal: override prompt text sent to PI, while UI shows original prompt */
  _piPromptOverride?: string;
  /** Internal: run already created by an explicit Resume/Retry action. */
  _workbenchRunId?: string;
};

export type PiContinueOptions = {
  systemPrompt?: string;
  skillIds?: string[];
  /** UI session mode, preserved when a skill change recreates the Pi session. */
  sessionMode?: 'work' | 'chat';
  goalMode?: boolean;
  imageAttachments?: PiImageAttachment[];
  /** Session snapshot used when the in-process runtime needs to recreate Pi state. */
  workspaceRoot?: string;
  agentId?: string;
  expertIds?: string[];
  modelOverride?: string;
  /** Forwarded to startSession when the runtime has to recreate the session. */
  autoApprove?: boolean;
  /** Internal: run already created by an explicit Resume/Retry action. */
  _workbenchRunId?: string;
  /** Internal: do not persist a synthetic Resume/Retry prompt as a user message. */
  _skipUserMessage?: boolean;
  /** Internal: marks a queued follow-up in the persisted transcript. */
  _queueDelivery?: CoworkQueueDelivery;
  /** Internal: tells Pi how to queue a prompt while the agent is settling. */
  _streamingBehavior?: 'steer' | 'followUp';
};

/** Workbench session patch; Pi only supports switching the model. */
export type PiSessionPatch = {
  model?: string | null;
};

export interface PiRuntime {
  on<U extends keyof PiRuntimeEvents>(event: U, listener: PiRuntimeEvents[U]): this;
  off<U extends keyof PiRuntimeEvents>(event: U, listener: PiRuntimeEvents[U]): this;
  startSession(sessionId: string, prompt: string, options?: PiStartOptions): Promise<void>;
  continueSession(sessionId: string, prompt: string, options?: PiContinueOptions): Promise<void>;
  patchSession?(sessionId: string, patch: PiSessionPatch): Promise<void>;
  stopSession(sessionId: string): void;
  stopAllSessions(): void;
  respondToPermission(requestId: string, result: PiPermissionResult): void;
  isSessionActive(sessionId: string): boolean;
  isSessionRunning(sessionId: string): boolean;
  listPendingMessages(sessionId: string): CoworkPendingMessage[];
  enqueuePendingMessage(
    sessionId: string,
    text: string,
  ): { success: boolean; item?: CoworkPendingMessage; error?: string };
  updatePendingMessage(
    sessionId: string,
    itemId: string,
    text: string,
  ): { success: boolean; item?: CoworkPendingMessage; error?: string };
  deletePendingMessage(sessionId: string, itemId: string): { success: boolean; error?: string };
  steerPendingMessage(
    sessionId: string,
    itemId: string,
  ): Promise<{ success: boolean; item?: CoworkPendingMessage; error?: string }>;
  followUpPendingMessage(
    sessionId: string,
    itemId: string,
  ): Promise<{ success: boolean; item?: CoworkPendingMessage; error?: string }>;
  getSessionConfirmationMode(sessionId: string): 'modal' | 'text' | null;
  onSessionDeleted?(sessionId: string): void;
}
