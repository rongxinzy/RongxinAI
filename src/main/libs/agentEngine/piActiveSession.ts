/** Per-conversation product projection state; native execution lives in Harness. */
import type { CoworkError } from '../../../common/coworkError';
import type { CoworkMessageExpertIdentity } from '../../../shared/cowork/sessionExperts';
import type { HarnessModelProfileInput } from '../../../shared/harness';
import type { WorkbenchApprovalMode } from '../../../shared/workbenchTask';
import type { ModelCapabilities } from '../../../shared/providers';
import type { ArtifactRecorder } from '../../artifactLedger/artifactRecorder';
import type { PiEventProjectionQueue } from './piEventProjectionQueue';
import type { ImageInputAttachmentRef } from './piImageInputFallback';
import type { PiStreamAccumulator } from './piStreamAccumulator';
import type { PiTranslatorState } from './piTranslate/piTranslateUiMessageChunk';
import type { PiThinkingLifecycle } from './piThinkingLifecycle';
import type { ToolActivityTracker } from './toolActivity';
import type {
  PiEvent,
  PiSession,
  PiModelRuntime,
  PiResourceState,
  PiStartupLatency,
} from './piRuntimeContracts';
export interface ActivePiSession {
  nativeInputProjection?: boolean;
  eventProjection?: PiEventProjectionQueue<PiEvent>;
  sessionId: string;
  piSession: PiSession;
  abortController: AbortController;
  model: Record<string, unknown>;
  modelRuntime: PiModelRuntime | null;
  modelRequestOptions?: { apiKey?: string };
  /** Whether this session runs with the pi 1.0 codemode tool active. */
  codemodeEnabled: boolean;
  capabilities: ModelCapabilities;
  /** Endpoint identity behind the current model; scopes image observations. */
  imageEndpointKey?: string;
  harnessModelProfile: HarnessModelProfileInput;
  /** System prompt requested by the current Cowork session snapshot. */
  requestedSystemPrompt: string;
  requestedModelOverride?: string;
  requestedSkillIds: string[] | undefined;
  requestedExpertIds: string[];
  /** Experts selected for the current turn, retained when messages are persisted. */
  turnExperts: CoworkMessageExpertIdentity[];
  resourceState: PiResourceState;
  /** Message id for the visible answer (text) bubble of the current turn. */
  assistantMessageId: string | null;
  /** Message id for the thinking bubble of the current turn. */
  thinkingMessageId: string | null;
  /** Latest full snapshot of answer text for the current turn. */
  answerText: string;
  /** Latest full snapshot of thinking text for the current turn. */
  thinkingText: string;
  streamAccumulator: PiStreamAccumulator;
  piTranslatorState: PiTranslatorState;
  thinkingLifecycle: PiThinkingLifecycle;
  /** Latest completed answer message, promoted to final only when the agent run ends. */
  lastCompletedAnswerMessageId: string | null;
  lastCompletedAnswerText: string;
  /** Latest assistant message payload from Pi, including stopReason. */
  lastAssistantMessage?: PiEvent['message'];
  /**
   * Set once a settled turn's error was shown, preventing duplicate reporting.
   */
  errorSurfaced: boolean;
  /** Set when the model wrote (or explicitly skipped) this turn's checkpoint. */
  summaryCheckpointWritten?: boolean;
  summaryCheckpointSkipped?: string | true;
  /** Artifact work covered by the latest checkpoint outcome in this run. */
  summaryCheckpointWorkVersion?: number;
  /** Original request for this turn, before history, memory or workflow injection. */
  summaryCheckpointGoal?: string;
  /** One retry notice per turn: the user learns the model answered with an error. */
  retryNoticeEmitted: boolean;
  /** Retry attempts Pi reported in the current turn. */
  retryAttempts: number;
  /** When set, the next turn_start reuses assistant/thinking message ids (auto-retry). */
  retryStreamReusePending: boolean;
  /** Last visible answer body before a retry turn_start cleared in-memory stream state. */
  retryPriorAnswer: string;
  requestStartedAt: number | null;
  firstVisibleTextAt: number | null;
  /** Timestamp when this in-process Pi AgentSession finished creation. */
  piSessionCreatedAt: number;
  /** First agent_start timestamp for this Pi AgentSession. */
  agentStartedAt: number | null;
  /** Startup timings are recorded once, on the first visible token. */
  startupLatencyRecorded: boolean;
  startupLatency?: PiStartupLatency;
  confirmationMode: 'modal' | 'text';
  unsubscribe: () => void;
  /** Set to true once stopSession has aborted the turn. continueSession must not
   * reuse the underlying Pi session object after it has been aborted; instead it
   * should reconstruct the conversation from SQLite and create a fresh session. */
  aborted: boolean;
  /** toolCallId → tool_result message id, for streaming updates + de-dup */
  toolResultMessageIdByCallId: Map<string, string>;
  toolStartedAtByCallId: Map<string, number>;
  preparingToolCallIdByContentIndex: Map<number, string>;
  toolActivityTracker: ToolActivityTracker;
  goalMode: boolean;
  /** Whether the current turn runs in read-only plan mode. */
  planMode: boolean;
  /**
   * Error from the latest failed attempt (message_end with stopReason=error).
   * Deferred — not persisted/emitted — because Pi may auto-retry the turn;
   * flushPendingError surfaces it once the run settles (auto_retry_end /
   * agent_settled). Cleared when a retry succeeds or the turn is reset.
   *
   * `sticky` marks a terminal error (including an explicitly cancelled retry).
   * Pi can report aborted turns with a plain
   * stop reason, so a later successful-looking assistant message must not erase
   * them the way it erases a recovered retry.
   */
  pendingError: { message: string; classified: CoworkError; sticky?: boolean } | null;
  workbenchRunId: string | null;
  workspaceRoot: string;
  /** Event-time artifact capture for this session (null in chat mode or when
   * the host exposes no ledger). */
  artifactRecorder: ArtifactRecorder | null;
  approvalMode: WorkbenchApprovalMode;
  unattended: boolean;
  /** True while Pi is executing the current Work/Chat turn. */
  isRunning: boolean;
  /** Last time this session was used by a turn; idle sessions may be rebuilt from SQLite. */
  lastUsedAt: number;
  /** True when the current turn settled with an unrecoverable Pi error. */
  turnFailed: boolean;
  /**
   * True when skills changed mid-stream (via steer/followUp) and Pi should
   * reload its ResourceLoader once idle before starting another turn.
   */
  pendingSkillReload?: boolean;
  /**
   * Image attachments of the turn currently in flight. Kept so an image-payload
   * rejection can be retried as text and explained to the user; cleared on every
   * new user prompt so a stale turn can never drive the fallback.
   */
  lastImagePrompt: {
    text: string;
    sentImages: ImageInputAttachmentRef[];
    omittedImages: ImageInputAttachmentRef[];
    retried: boolean;
  } | null;
  /** Set when the failed turn carried images and deserves one text-only retry. */
  imageRetryPending: boolean;
  /**
   * True once this turn's failure has been attributed to an image payload
   * rejection, so repeated SDK retries cannot resurface it as a generic error.
   */
  imageRejectionHandled: boolean;
  /** Prevents duplicate queue drains when Pi emits multiple settled events. */
  queueFlushInFlight: boolean;
  /** MCP tool manifest generation captured when this Pi session was created. */
  mcpToolManifestGeneration: number;
}
