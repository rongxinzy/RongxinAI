/**
 * Session-state types and prompt helpers for the Pi runtime adapter.
 *
 * These types describe the in-process Pi session the adapter drives. They
 * stay out of the adapter class so session creation, event mapping, and
 * gateway model resolution can share one shape.
 */

import { readCoworkImageBase64 } from '../../coworkImageAttachments';
import type { CoworkError } from '../../../common/coworkError';
import type { CoworkMessageExpertIdentity } from '../../../shared/cowork/sessionExperts';
import type { HarnessModelProfileInput } from '../../../shared/harness';
import type { WorkbenchApprovalMode, WorkbenchTaskContract } from '../../../shared/workbenchTask';
import type { ModelCapabilities, ProviderModelPiCompaction } from '../../../shared/providers';
import { PiAgentLoopController } from './piAgentLoop';
import {
  buildPiBackgroundCompletionContext,
  type PiBackgroundCompletionResult,
} from './piBackgroundCompletion';
import { PiEventProjectionQueue } from './piEventProjectionQueue';
import {
  buildImageOmittedNotice,
  ImageInputVerdict,
  type ImageInputAttachmentRef,
} from './piImageInputFallback';
import { PiResearchRunController } from './piResearchRun';
import { PiShortcutWorkflowController } from './piShortcutWorkflow';
import { PiStreamAccumulator } from './piStreamAccumulator';
import { PiThinkingLifecycle } from './piThinkingLifecycle';
import type { PiStartOptions } from './piRuntimeTypes';
import { PiWriteTokenLimitRecovery } from './piWriteTokenLimit';
import { ToolActivityTracker } from './toolActivity';

export const PiChatRuntimeLimit = {
  HistoryChars: 16_000,
  MaxOutputTokens: 8_192,
} as const;

/** Minimal type for the Pi AgentSession — only the methods used by this adapter. */
export interface PiSession {
  prompt(text: string, options?: { streamingBehavior?: 'steer' | 'followUp' }): Promise<void>;
  sendUserMessage?(
    content:
      | string
      | Array<{ type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string }>,
    options?: { deliverAs?: 'steer' | 'followUp' },
  ): Promise<void>;
  steer(text: string): Promise<void>;
  abort(): Promise<void>;
  abortBash(): void;
  reload(): Promise<void>;
  setModel(model: unknown): Promise<void>;
  setThinkingLevel?(level: string): unknown;
  bindExtensions?(bindings: Record<string, unknown>): Promise<void>;
  compact?(customInstructions?: string): Promise<{ cancelled?: boolean }>;
  getContextUsage?():
    | {
        tokens: number | null;
        contextWindow: number;
        percent: number | null;
      }
    | undefined;
  subscribe(listener: (event: PiEvent) => void): () => void;
}

interface PiContentBlock {
  type: string;
  text?: string;
  thinking?: string;
  id?: string;
  name?: string;
  arguments?: Record<string, unknown>;
}

export interface PiUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  reasoning?: number;
  totalTokens: number;
  cost: { input: number; output: number; cacheRead: number; cacheWrite: number; total: number };
}

export interface PiEvent {
  displayResultText?: string;
  type: string;
  success?: boolean;
  attempt?: number;
  finalError?: string;
  message?: {
    id?: string;
    role: string;
    // For message_update / message_end this is the FULL accumulating snapshot
    // (blocks: {type:'text',text} / {type:'thinking',thinking}), NOT a delta.
    content: string | PiContentBlock[];
    model?: string;
    usage?: PiUsage;
    stopReason?: string;
    errorMessage?: string;
  };
  // message_update carries the fine-grained streaming delta here.
  assistantMessageEvent?: {
    type: string; // text_delta | thinking_delta | text_end | thinking_end | ...
    delta?: string;
    content?: string;
    contentIndex?: number;
    partial?: unknown;
    toolCall?: unknown;
  };
  // tool_execution_start / _update / _end fields
  toolCallId?: string;
  toolName?: string;
  args?: unknown;
  result?: unknown;
  partialResult?: unknown;
  isError?: boolean;
}

export interface ActivePiSession {
  eventProjection?: PiEventProjectionQueue<PiEvent>;
  sessionId: string;
  piSession: PiSession;
  abortController: AbortController;
  model: Record<string, unknown>;
  modelRuntime: PiModelRuntime | null;
  modelRequestOptions?: { apiKey?: string };
  /** Per-model compaction budgets applied on create and every reload. */
  modelCompactionOverride?: PiResolvedModel['modelCompactionOverride'];
  /** Whether this session runs with the pi 1.0 codemode tool active. */
  codemodeEnabled: boolean;
  /** Whether pi's builtin MCP extension owns this session's MCP tools. */
  mcpNativeBridge: boolean;
  capabilities: ModelCapabilities;
  /** Endpoint identity behind the current model; scopes image observations. */
  imageEndpointKey?: string;
  harnessModelProfile: HarnessModelProfileInput;
  /** System prompt requested by the current Cowork session snapshot. */
  requestedSystemPrompt: string;
  requestedModelOverride?: string;
  requestedSkillIds: string[] | undefined;
  requestedWorkflowSkillIds: string[] | undefined;
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
  thinkingLifecycle: PiThinkingLifecycle;
  /** Latest completed answer message, promoted to final only when the agent run ends. */
  lastCompletedAnswerMessageId: string | null;
  lastCompletedAnswerText: string;
  /**
   * Set once a settled turn's error was shown, preventing duplicate reporting.
   */
  errorSurfaced: boolean;
  /** One retry notice per turn: the user learns the model answered with an error. */
  retryNoticeEmitted: boolean;
  /** Retry attempts Pi reported in the current turn. */
  retryAttempts: number;
  completionPending?: Promise<void>;
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
  /** Long-horizon agent loop controller for this session (agent_loop tool). */
  agentLoop: PiAgentLoopController;
  /** Present only for the controlled academic-research workflow. */
  researchRun: PiResearchRunController | null;
  /** Present for every other first-class sidebar shortcut workflow. */
  shortcutWorkflow: PiShortcutWorkflowController | null;
  goalMode: boolean;
  /** Whether the current turn runs in read-only plan mode. */
  planMode: boolean;
  writeTokenLimitRecovery: PiWriteTokenLimitRecovery;
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
  workbenchContract: WorkbenchTaskContract;
  workspaceRoot: string;
  settingsManager: PiSettingsManager | null;
  approvalMode: WorkbenchApprovalMode;
  unattended: boolean;
  /** True while Pi is executing the current Work/Chat turn. */
  isRunning: boolean;
  /** Last time this session was used by a turn; idle sessions may be rebuilt from SQLite. */
  lastUsedAt: number;
  /** True when the current turn settled with an unrecoverable Pi error. */
  turnFailed: boolean;
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

// ── Dynamic imports ──

export interface PiModules {
  createAgentSession: (options: Record<string, unknown>) => Promise<{ session: PiSession }>;
  DefaultResourceLoader: new (options: Record<string, unknown>) => PiResourceLoader;
  SessionManager?: {
    inMemory(cwd?: string): unknown;
  };
  SettingsManager?: {
    create(cwd: string, agentDir?: string): PiSettingsManager;
    inMemory?(): PiSettingsManager;
  };
  getAgentDir: () => string;
  getModel: (provider: string, modelId: string) => unknown;
  ModelRuntime: {
    create(options?: PiModelRuntimeCreateOptions): Promise<PiModelRuntime>;
  };
  /** Registers the codemode sandbox tool (inactive until defaultTools names it). */
  createCodemodeExtension?: (options?: Record<string, unknown>) => unknown;
  /** Registers the deferred tool-loading tool (inactive until defaultTools names it). */
  createToolSearchExtension?: () => unknown;
  /** Registers the builtin MCP extension (config/transport injectable). */
  createMcpExtension?: (options?: Record<string, unknown>) => unknown;
  completeSimple: (
    model: unknown,
    context: ReturnType<typeof buildPiBackgroundCompletionContext>,
    options?: { apiKey?: string },
  ) => Promise<PiBackgroundCompletionResult>;
}

export interface PiResourceLoader {
  reload(): Promise<void>;
  settingsManager?: PiSettingsManager | null;
}

export interface PiSettingsManager {
  applyOverrides(overrides: {
    shellPath?: string;
    compaction?: {
      enabled?: boolean;
      reserveTokens?: number;
      keepRecentTokens?: number;
      /** Per-model budget overrides keyed by provider/modelId (pi 1.0.0). */
      modelOverrides?: Record<string, { reserveTokens?: number; keepRecentTokens?: number }>;
    };
    /** Tool activation overrides; "+name"/"-name" add/remove relative to defaults. */
    defaultTools?: string[];
  }): void;
  getShellPath?(): string | undefined;
  setHttpIdleTimeoutMs?(timeoutMs: number): void;
}

export interface PiResourceState {
  systemPrompt: string;
  skillIds: string[] | undefined;
  maxOutputTokens: number;
  fileToolsEnabled: boolean;
  unattended: boolean;
  /** Chat keeps the Pi kernel but opts out of Work resource discovery. */
  chatMode: boolean;
  /** Bundled preset skill dirs for the session's experts (file-sourced, live). */
  expertSkillDirs: string[];
  skillRoots: Record<string, string>;
}

export interface PiStartupLatency {
  sessionCreatedAt: number;
  agentStartedAt: number;
  firstTokenAt: number;
  sessionCreateToAgentStartMs: number;
  agentStartToFirstTokenMs: number;
  sessionCreateToFirstTokenMs: number;
}

export interface InitializingPiSession {
  abortController: AbortController;
  generation: symbol;
}

export interface PiModelRuntime {
  registerProvider(provider: string, config: Record<string, unknown>): void;
  setRuntimeApiKey(provider: string, apiKey: string): Promise<void>;
  getModel(provider: string, modelId: string): unknown;
  completeSimple?(
    model: unknown,
    context: ReturnType<typeof buildPiBackgroundCompletionContext>,
  ): Promise<PiBackgroundCompletionResult>;
}

interface PiModelRuntimeCreateOptions {
  allowModelNetwork?: boolean;
}

export type PiResolvedModel = {
  /** Base URL identity of the endpoint the model was resolved against. */
  endpointKey: string;
  model: Record<string, unknown>;
  modelRuntime: PiModelRuntime | null;
  maxOutputTokens: number;
  providerName: string;
  capabilities?: Partial<ModelCapabilities>;
  requestOptions?: {
    apiKey?: string;
  };
  /** Per-model compaction budgets keyed for pi's compaction.modelOverrides. */
  modelCompactionOverride?: {
    key: string;
    compaction: ProviderModelPiCompaction;
  };
};

export function preparePiPrompt(
  text: string,
  attachments: PiStartOptions['imageAttachments'] | undefined,
  verdict: ImageInputVerdict,
  ocrCommandFor?: (imagePath: string) => string,
  pathImageReferences: readonly ImageInputAttachmentRef[] = [],
): {
  content:
    | string
    | Array<{ type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string }>;
  hasImages: boolean;
  sentImages: ImageInputAttachmentRef[];
  omittedImages: ImageInputAttachmentRef[];
} {
  const sendImages = verdict === ImageInputVerdict.Supported;
  // A path-only image is only worth explaining when the model cannot open it as
  // an image: a vision-capable model just reads the file.
  const pathOnly = sendImages ? [] : pathImageReferences;
  if (!attachments?.length && pathOnly.length === 0) {
    return { content: text, hasImages: false, sentImages: [], omittedImages: [] };
  }
  const imageAttachments = (attachments ?? []).filter(item => item.mimeType.startsWith('image/'));
  const references = imageAttachments.map(item => ({ name: item.name, path: item.path }));
  if (sendImages) {
    const images = imageAttachments
      .filter(item => item.base64Data || item.path)
      .map(item => ({
        type: 'image' as const,
        data: readCoworkImageBase64(item),
        mimeType: item.mimeType,
      }))
      .filter(item => item.data.length > 0);
    if (images.length > 0) {
      return {
        content: [{ type: 'text', text }, ...images],
        hasImages: true,
        sentImages: references,
        omittedImages: [],
      };
    }
  }
  // Pi answers a non-vision model's `read` with an in-band note instead of a
  // failed request; Cowork images never pass through `read`, so the same facts
  // (why the picture is absent, plus the file paths) have to travel with the
  // prompt itself. Images withheld by capability and images the UI could only
  // attach by path share one note: in both cases the model holds a path, not
  // pixels.
  const notice = buildImageOmittedNotice([...references, ...pathOnly], { verdict, ocrCommandFor });
  return {
    content: text.trim() ? `${text}\n\n${notice}` : notice,
    hasImages: false,
    sentImages: [],
    omittedImages: references,
  };
}

/** Yields one macrotask so settling bookkeeping (e.g. a cancelled retry) can run. */
export const yieldToEventLoop = (): Promise<void> => {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, 0);
  return promise;
};

/**
 * Prompt content prepared for one Pi turn: the text, plus image blocks when the
 * model may receive them, and the attachment bookkeeping the failure path needs.
 */
export interface PreparedPiPrompt {
  content:
    | string
    | Array<{ type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string }>;
  hasImages: boolean;
  sentImages: ImageInputAttachmentRef[];
  omittedImages: ImageInputAttachmentRef[];
}

/**
 * Sends a prompt that was already prepared (and recorded) by the caller.
 *
 * Preparation is deliberately separated from sending: the SDK can report a
 * rejected payload through events that land before the send promise settles, so
 * the turn's image state must be recorded *before* the request leaves.
 */
export async function sendPiPrompt(
  session: PiSession,
  prepared: PreparedPiPrompt,
  streamingBehavior?: 'steer' | 'followUp',
): Promise<void> {
  if (prepared.hasImages) {
    if (!session.sendUserMessage) {
      throw new Error('The installed agent runtime cannot send image attachments.');
    }
    await session.sendUserMessage(
      prepared.content,
      streamingBehavior ? { deliverAs: streamingBehavior } : undefined,
    );
    return;
  }
  if (streamingBehavior) {
    await session.prompt(prepared.content as string, { streamingBehavior });
  } else {
    await session.prompt(prepared.content as string);
  }
}

let _piModules: PiModules | null = null;

export async function getPiModules(): Promise<PiModules> {
  if (!_piModules) {
    try {
      // Pi packages are ESM-only (package.json "exports" with only "import" condition).
      // Vite/esbuild resolves them correctly at build time. Type declarations are provided
      // by piModules.d.ts for tsc --noEmit.
      const codingAgent = await import('@earendil-works/pi-coding-agent');
      const compat = await import('@earendil-works/pi-ai/compat');
      _piModules = {
        createAgentSession: codingAgent.createAgentSession as PiModules['createAgentSession'],
        DefaultResourceLoader:
          codingAgent.DefaultResourceLoader as PiModules['DefaultResourceLoader'],
        SessionManager: Object.prototype.hasOwnProperty.call(codingAgent, 'SessionManager')
          ? ((codingAgent as typeof codingAgent & { SessionManager?: unknown })
              .SessionManager as PiModules['SessionManager'])
          : undefined,
        SettingsManager: Object.prototype.hasOwnProperty.call(codingAgent, 'SettingsManager')
          ? ((codingAgent as typeof codingAgent & { SettingsManager?: unknown })
              .SettingsManager as PiModules['SettingsManager'])
          : undefined,
        getAgentDir: codingAgent.getAgentDir as PiModules['getAgentDir'],
        ModelRuntime: codingAgent.ModelRuntime as unknown as PiModules['ModelRuntime'],
        createCodemodeExtension: Object.prototype.hasOwnProperty.call(
          codingAgent,
          'createCodemodeExtension',
        )
          ? ((
              codingAgent as typeof codingAgent & {
                createCodemodeExtension?: unknown;
              }
            ).createCodemodeExtension as PiModules['createCodemodeExtension'])
          : undefined,
        createToolSearchExtension: Object.prototype.hasOwnProperty.call(
          codingAgent,
          'createToolSearchExtension',
        )
          ? ((
              codingAgent as typeof codingAgent & {
                createToolSearchExtension?: unknown;
              }
            ).createToolSearchExtension as PiModules['createToolSearchExtension'])
          : undefined,
        createMcpExtension: Object.prototype.hasOwnProperty.call(codingAgent, 'createMcpExtension')
          ? ((
              codingAgent as typeof codingAgent & {
                createMcpExtension?: unknown;
              }
            ).createMcpExtension as PiModules['createMcpExtension'])
          : undefined,
        // getModel is the current API (deprecated but functional); will migrate to createModels() later
        getModel: compat.getModel as unknown as PiModules['getModel'],
        completeSimple: compat.completeSimple as unknown as PiModules['completeSimple'],
      };
    } catch (err) {
      throw new Error(
        `[PiRuntime] Pi engine packages not found. ` +
          `Ensure @earendil-works/pi-coding-agent and @earendil-works/pi-ai are installed.\n${err}`,
      );
    }
  }
  return _piModules;
}

// ── Constants ──

/** How often the renderer receives streaming content updates. */
export const MESSAGE_UPDATE_THROTTLE_MS = 200;
/**
 * How often streaming content is written to SQLite. better-sqlite3 is synchronous
 * and blocks the main-process event loop, so writing on every Pi frame causes
 * visible streaming jank. Store writes are throttled
 * and flush the latest content on finalize.
 */
export const STORE_UPDATE_THROTTLE_MS = 250;

export const normalizeSkillIds = (skillIds: string[] | undefined): string[] | undefined =>
  skillIds === undefined
    ? undefined
    : [...new Set(skillIds.map(skillId => skillId.trim()).filter(Boolean))].sort();

/**
 * Skills are additive: a queued turn keeps whatever the session already runs
 * and adds the ones the user attached to that queued input. Both sides unknown
 * keeps the session's implicit "no explicit skill set" state instead of
 * materializing an empty list, which would force a session rebuild.
 */
export const mergeSkillIds = (
  base: string[] | undefined,
  added: string[] | undefined,
): string[] | undefined =>
  base === undefined && added === undefined
    ? undefined
    : [...new Set([...(base ?? []), ...(added ?? [])])];

export const haveSameStringList = (
  left: string[] | undefined,
  right: string[] | undefined,
): boolean =>
  left === right ||
  (left !== undefined &&
    right !== undefined &&
    left.length === right.length &&
    left.every((value, index) => value === right[index]));
