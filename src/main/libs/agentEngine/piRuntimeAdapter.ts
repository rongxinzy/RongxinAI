/**
 * Pi Runtime Adapter
 *
 * Implements the Pi-native PiRuntime interface using the Pi SDK (in-process).
 * Pi is an embeddable agent loop library — no subprocess, no HTTP, just import.
 *
 * Architecture:
 *   startSession    → createAgentSession() → session.subscribe() → emit PiRuntimeEvents
 *   continueSession → session.prompt()
 *   stopSession     → session.abort()
 *
 * Packages:
 *   @earendil-works/pi-coding-agent — AgentSession, createAgentSession
 *   @earendil-works/pi-ai/compat    — getModel(), completeSimple()
 */

import { randomUUID } from 'crypto';
import { app } from 'electron';
import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as os from 'os';
import path from 'path';

import { classifyCoworkError, type CoworkError } from '../../../common/coworkError';
import {
  CoworkSessionExpertSource,
  normalizeSingleExpertIds,
  type CoworkMessageExpertIdentity,
} from '../../../shared/cowork/sessionExperts';
import {
  CoworkQueueDelivery,
  type CoworkPendingMessage,
} from '../../../shared/cowork/pendingMessageQueue';
import { CoworkSessionMode } from '../../../shared/cowork/constants';
import {
  CoworkInterruptionCause,
  type CoworkSessionInterruption,
} from '../../../shared/cowork/interruption';
import { CoworkToolActivityPhase } from '../../../shared/cowork/toolActivity';
import {
  HarnessVersion,
  type HarnessActivationEvent,
  type HarnessModelProfileInput,
} from '../../../shared/harness';
import {
  MAX_STALE_PRODUCTION_ITERATIONS,
  ProductionLoopStatus,
} from '../../../shared/productionLoop';
import {
  WorkbenchApprovalDecision,
  WorkbenchApprovalMode,
  WorkbenchApprovalRiskLevel,
  WorkbenchContractKind,
  WorkbenchArtifactCandidateSource,
  WorkbenchArtifactVerificationStatus,
  WorkbenchRunTrigger,
  WorkbenchTaskStatus,
  type WorkbenchTaskContract,
} from '../../../shared/workbenchTask';
import {
  isLocalProviderName,
  type ModelCapabilities,
  ModelCapabilityStatus,
  ProviderName,
  ProviderModelPiApi,
  resolveProviderModelPiReasoning,
} from '../../../shared/providers';
import type { CoworkMessage } from '../../coworkStore';
import { getCommunityAuthAccessToken } from '../../communityAuthSession';
import type { CoworkStore } from '../../coworkStore';
import { resolveBundledPresetMembers } from '../../presetExpertSnapshot';
import { buildPiConversationHistoryTool } from '../../conversationHistory/piTool';
import type { ConversationHistoryService } from '../../conversationHistory/service';
import { t } from '../../i18n';
import type { LegacyMemoryMigrationService } from '../../memory/legacyMemoryMigrationService';
import { buildPiProjectMemoryTool } from '../../memory/piMemoryTool';
import {
  buildProjectMemoryContextSafe,
  type ProjectMemoryService,
} from '../../memory/projectMemoryService';
import type {
  SessionMemoryCompletion,
  SessionMemoryCompletionMessage,
} from '../../memory/sessionMemoryExtractor';
import { SessionMemoryCompletionRole } from '../../memory/sessionMemoryExtractor';
import type { SessionSummaryService } from '../../memory/sessionSummaryService';
import type { SessionSummaryBackfillService } from '../../memory/sessionSummaryBackfillService';
import type {
  WorkbenchApprovalRequestedEvent,
  WorkbenchTaskService,
} from '../../workbenchTask/taskService';
import { composeWorkbenchWorkflowSnapshot } from '../../workbenchTask/workflowSnapshot';
import { ProductionLoopController } from '../../productionLoop/controller';
import { shouldExposeProductionControls } from '../../productionLoop/entryPolicy';
import { buildProductionLoopTool } from '../../productionLoop/tool';
import {
  type ApiConfigResolution,
  resolveRawApiConfig,
  resolveRawApiConfigForModelRef,
} from '../claudeSettings';
import { applyApplicationRuntimeEnv, getSkillsRoot, resolveGitBashPathForPi } from '../coworkUtil';
import type { McpServerManager } from '../mcpServerManager';
import { isRasterPreviewDecodable, renderOfficePreview } from '../officePreviewRenderer';
import {
  createPiAskUserQuestionTool,
  PiAskUserQuestionToolName,
  PiAskUserQuestionTimeoutMs,
  type PiAskUserQuestionInput,
  type PiAskUserQuestionResponse,
} from './piAskUserQuestion';
import { PiAgentLoopController, PiAgentLoopMode } from './piAgentLoop';
import {
  buildPiBackgroundCompletionContext,
  extractPiBackgroundCompletionText,
  type PiBackgroundCompletionResult,
} from './piBackgroundCompletion';
import {
  buildPiConversationPrompt,
  calculatePiConversationHistoryCharLimit,
} from './piConversationContext';
import { getPiBashCommandViolation } from './piBashToolGuidelines';
import { prependProductionWorkflowPrompt } from './piExpertProductionPrompt';
import { PiMcpTool } from './piMcpCapabilityPrompt';
import { isAcademicResearchSkillSet, PiResearchRunController } from './piResearchRun';
import { buildPiResearchStateTool } from './piResearchStateTool';
import {
  PiShortcutWorkflowController,
  resolveShortcutWorkflowKind,
  ShortcutWorkflowKind,
} from './piShortcutWorkflow';
import { buildPiShortcutWorkflowStateTool } from './piShortcutWorkflowStateTool';
import {
  registerPiOpenAICompatTokenRefresher,
  registerPiOpenAICompatUpstream,
} from './piOpenAICompatProxy';
import {
  PiExtensionEventType,
  type PiExtensionApi,
  type PiExtensionFactory,
} from './piExtensionTypes';
import { extractPiSubagentExecutionMetadata } from './piSubagentExecution';
import { buildPiSubagentTool, PiSubagentToolName } from './piSubagentTool';
import { buildPiSkillScriptTool } from './piSkillScriptTool';
import { buildPiSkillRuntimeCapabilitiesTool } from './piSkillRuntimeCapabilitiesTool';
import { resolvePiBuiltinProviderId } from './piProviderIds';
import { buildPiDocumentReaderTool } from './piDocumentReaderTool';
import { buildDeclareArtifactTool } from '../../declareArtifact/tool';
import { PiThinkingLifecycle } from './piThinkingLifecycle';
import { PiStreamAccumulator } from './piStreamAccumulator';
import { PiAssistantEventType } from './piStreamConstants';
import { PiPendingMessageQueue } from './piPendingMessageQueue';
import { shouldExposeAskUserQuestionTool } from './piUnattendedPolicy';
import { createPiWorkLoop } from './piWorkLoop';
import { PiWriteTokenLimitRecovery } from './piWriteTokenLimit';
import { collectPiSystemPromptContributions } from './piSystemPromptContributions';
import {
  getPiPreparingToolActivity,
  ToolActivityTracker,
  toToolActivityInput,
} from './toolActivity';
import type {
  PiContinueOptions,
  PiPermissionResult,
  PiRuntime,
  PiRuntimeEvents,
  PiSessionPatch,
  PiStartOptions,
} from './piRuntimeTypes';

// ── Types ──

/** Minimal type for the Pi AgentSession — only the methods used by this adapter. */
interface PiSession {
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

interface PiUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  reasoning?: number;
  totalTokens: number;
  cost: { input: number; output: number; cacheRead: number; cacheWrite: number; total: number };
}

interface PiEvent {
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

interface ActivePiSession {
  sessionId: string;
  piSession: PiSession;
  abortController: AbortController;
  model: Record<string, unknown>;
  modelRuntime: PiModelRuntime | null;
  modelRequestOptions?: { apiKey?: string };
  capabilities: ModelCapabilities;
  harnessModelProfile: HarnessModelProfileInput;
  /** System prompt requested by the current Cowork session snapshot. */
  requestedSystemPrompt: string;
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
  thinkingLifecycle: PiThinkingLifecycle;
  /** Latest completed answer message, promoted to final only when the agent run ends. */
  lastCompletedAnswerMessageId: string | null;
  lastCompletedAnswerText: string;
  requestStartedAt: number | null;
  firstVisibleTextAt: number | null;
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
  productionLoop: ProductionLoopController | null;
  /** Whether the current turn owns durable completion and production gates. */
  productionControlsAvailable: boolean;
  /** Whether this Work session was explicitly started in Goal mode. */
  goalMode: boolean;
  writeTokenLimitRecovery: PiWriteTokenLimitRecovery;
  /**
   * Error from the latest failed attempt (message_end with stopReason=error).
   * Deferred — not persisted/emitted — because Pi may auto-retry the turn;
   * flushPendingError surfaces it once the run settles (auto_retry_end /
   * agent_settled). Cleared when a retry succeeds or the turn is reset.
   */
  pendingError: { message: string; classified: CoworkError } | null;
  workbenchRunId: string | null;
  workbenchContract: WorkbenchTaskContract;
  workspaceRoot: string;
  settingsManager: PiSettingsManager | null;
  approvalMode: WorkbenchApprovalMode;
  unattended: boolean;
  /** True while Pi is executing the current Work/Chat turn. */
  isRunning: boolean;
  /** True when the current turn settled with an unrecoverable Pi error. */
  turnFailed: boolean;
  /** Prevents duplicate queue drains when Pi emits multiple settled events. */
  queueFlushInFlight: boolean;
  /** MCP tool manifest generation captured when this Pi session was created. */
  mcpToolManifestGeneration: number;
}

// ── Dynamic imports ──

interface PiModules {
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
  completeSimple: (
    model: unknown,
    context: ReturnType<typeof buildPiBackgroundCompletionContext>,
    options?: { apiKey?: string },
  ) => Promise<PiBackgroundCompletionResult>;
}

interface PiResourceLoader {
  reload(): Promise<void>;
  settingsManager?: PiSettingsManager | null;
}

interface PiSettingsManager {
  applyOverrides(overrides: {
    shellPath?: string;
    compaction?: {
      enabled?: boolean;
      reserveTokens?: number;
      keepRecentTokens?: number;
    };
  }): void;
  getShellPath?(): string | undefined;
}

interface PiResourceState {
  systemPrompt: string;
  skillIds: string[] | undefined;
  maxOutputTokens: number;
  fileToolsEnabled: boolean;
  unattended: boolean;
  /** Bundled preset skill dirs for the session's experts (file-sourced, live). */
  expertSkillDirs: string[];
}

interface InitializingPiSession {
  abortController: AbortController;
  generation: symbol;
}

interface PiModelRuntime {
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

type PiResolvedModel = {
  model: Record<string, unknown>;
  modelRuntime: PiModelRuntime | null;
  maxOutputTokens: number;
  providerName: string;
  capabilities?: Partial<ModelCapabilities>;
  requestOptions?: {
    apiKey?: string;
  };
};

function preparePiPrompt(
  text: string,
  attachments: PiStartOptions['imageAttachments'] | undefined,
  capabilities: ModelCapabilities,
): {
  content:
    | string
    | Array<{ type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string }>;
  hasImages: boolean;
} {
  if (!attachments?.length) return { content: text, hasImages: false };
  if (capabilities.imageInput === ModelCapabilityStatus.Supported) {
    const images = attachments
      .filter(item => item.base64Data && item.mimeType.startsWith('image/'))
      .map(item => ({ type: 'image' as const, data: item.base64Data, mimeType: item.mimeType }));
    if (images.length > 0) {
      return {
        content: [{ type: 'text', text }, ...images],
        hasImages: true,
      };
    }
  }
  const hint =
    '[image attachments were not sent because the selected model has no confirmed image support]';
  return { content: text.trim() ? `${text}\n\n${hint}` : hint, hasImages: false };
}

async function sendPiPrompt(
  session: PiSession,
  text: string,
  attachments: PiStartOptions['imageAttachments'] | undefined,
  capabilities: ModelCapabilities,
  streamingBehavior?: 'steer' | 'followUp',
): Promise<void> {
  const prepared = preparePiPrompt(text, attachments, capabilities);
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

async function getPiModules(): Promise<PiModules> {
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
const MESSAGE_UPDATE_THROTTLE_MS = 200;
/**
 * How often streaming content is written to SQLite. better-sqlite3 is synchronous
 * and blocks the main-process event loop, so writing on every Pi frame causes
 * visible streaming jank. Store writes are throttled
 * and flush the latest content on finalize.
 */
const STORE_UPDATE_THROTTLE_MS = 250;

const normalizeSkillIds = (skillIds: string[] | undefined): string[] | undefined =>
  skillIds === undefined
    ? undefined
    : [...new Set(skillIds.map(skillId => skillId.trim()).filter(Boolean))].sort();

const haveSameStringList = (left: string[] | undefined, right: string[] | undefined): boolean =>
  left === right ||
  (left !== undefined &&
    right !== undefined &&
    left.length === right.length &&
    left.every((value, index) => value === right[index]));

// ── PiRuntimeAdapter ──

// Force ANSI color output from CLI tools (npm, git, jest, etc.) run by
// Pi's bash tool.  Pi executes commands via spawn + pipe, so TTY-aware
// tools won't emit escape sequences without this env var.
if (!process.env.FORCE_COLOR) process.env.FORCE_COLOR = '1';

// Pi's bash tool inherits the main-process environment. Initialize the
// application-managed runtime once so later session creation cannot duplicate
// PATH entries in process.env.
let hasAppliedApplicationRuntimeEnv = false;

export class PiRuntimeAdapter extends EventEmitter implements PiRuntime {
  private readonly activeSessions = new Map<string, ActivePiSession>();
  private readonly pendingMessageQueue = new PiPendingMessageQueue();
  private readonly approvalSessionMap = new Map<string, string>();
  private readonly pendingAskUserQuestions = new Map<
    string,
    {
      sessionId: string;
      resolve: (response: PiAskUserQuestionResponse) => void;
      timer: ReturnType<typeof setTimeout>;
      removeAbortListener?: () => void;
    }
  >();
  private store: CoworkStore | null = null;
  private mcpServerManager: McpServerManager | null = null;
  private bundledSkillsRoot: string | null = null;
  /**
   * Pi custom tools are fixed when a session is created. Bump this whenever
   * MCP discovery changes so the next user turn recreates an outdated session
   * with the current MCP proxy topology.
   */
  private mcpToolManifestGeneration = 0;
  private workbenchTaskService: WorkbenchTaskService | null = null;
  private projectMemoryService: ProjectMemoryService | null = null;
  private sessionSummaryService: SessionSummaryService | null = null;
  private sessionSummaryBackfillService: SessionSummaryBackfillService | null = null;
  private legacyMemoryMigrationService: LegacyMemoryMigrationService | null = null;
  private conversationHistoryService: ConversationHistoryService | null = null;
  private readonly initializingSessions = new Map<string, InitializingPiSession>();
  private readonly pendingMemoryCompletions = new Map<string, Promise<string>>();
  private workbenchApprovalListener: ((event: WorkbenchApprovalRequestedEvent) => void) | null =
    null;

  setCoworkStore(store: CoworkStore): void {
    this.store = store;
  }
  /**
   * Bundled SKILLs root (resources/SKILLs in production). Injected so the
   * live member source matches the main-session preset snapshot; getSkillsRoot
   * alone is wrong in packaged builds, where it resolves to the userData copy
   * that can drift from the bundled truth.
   */
  setBundledSkillsRoot(root: string): void {
    this.bundledSkillsRoot = root;
  }
  setProjectMemoryService(service: ProjectMemoryService): void {
    this.projectMemoryService = service;
  }
  setSessionSummaryService(service: SessionSummaryService): void {
    this.sessionSummaryService = service;
  }
  setSessionSummaryBackfillService(service: SessionSummaryBackfillService): void {
    this.sessionSummaryBackfillService = service;
  }
  setLegacyMemoryMigrationService(service: LegacyMemoryMigrationService): void {
    this.legacyMemoryMigrationService = service;
  }
  setConversationHistoryService(service: ConversationHistoryService): void {
    this.conversationHistoryService = service;
  }
  setWorkbenchTaskService(service: WorkbenchTaskService): void {
    if (this.workbenchTaskService && this.workbenchApprovalListener) {
      this.workbenchTaskService.off('approvalRequested', this.workbenchApprovalListener);
    }
    this.workbenchTaskService = service;
    this.workbenchApprovalListener = ({ sessionId, approval }) => {
      this.approvalSessionMap.set(approval.id, sessionId);
      this.emit('permissionRequest', sessionId, {
        requestId: approval.id,
        toolName: approval.toolName,
        toolInput: approval.request,
        toolUseId: approval.toolCallId,
      });
    };
    service.on('approvalRequested', this.workbenchApprovalListener);
  }
  setMcpServerManager(mgr: McpServerManager): void {
    this.mcpServerManager = mgr;
    this.mcpInjected = true;
    this.mcpToolManifestGeneration += 1;
  }
  refreshMcpTools(): void {
    this.mcpToolManifestGeneration += 1;
  }
  hasMcpServerManager(): boolean {
    return this.mcpInjected;
  }
  private mcpInjected = false;

  // Throttle state
  private readonly lastMessageUpdateEmitTime = new Map<string, number>();
  private readonly pendingMessageUpdateTimer = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly pendingMessageUpdate = new Map<
    string,
    { content: string; metadata?: Record<string, unknown> }
  >();
  // Separate throttle for synchronous SQLite writes (see STORE_UPDATE_THROTTLE_MS).
  private readonly lastStoreUpdateTime = new Map<string, number>();
  private readonly pendingStoreUpdate = new Map<
    string,
    { content: string; metadata: Record<string, unknown> }
  >();
  private readonly pendingStoreUpdateTimer = new Map<string, ReturnType<typeof setTimeout>>();

  // ── PiRuntime.on/off ──

  override on<U extends keyof PiRuntimeEvents>(event: U, listener: PiRuntimeEvents[U]): this {
    return super.on(event, listener);
  }

  override off<U extends keyof PiRuntimeEvents>(event: U, listener: PiRuntimeEvents[U]): this {
    return super.off(event, listener);
  }

  // ── Session lifecycle ──

  async startSession(
    sessionId: string,
    prompt: string,
    options: PiStartOptions = {},
  ): Promise<void> {
    const hasContent =
      prompt.trim() || (options.imageAttachments && options.imageAttachments.length > 0);
    if (!hasContent) {
      throw new Error('Prompt is required.');
    }
    const expertIds = normalizeSingleExpertIds(options.expertIds);

    if (this.activeSessions.has(sessionId) || this.initializingSessions.has(sessionId)) {
      this.stopActiveSession(sessionId, 'The session was replaced by a new run.', false);
    }

    const abortController = new AbortController();
    const initialization: InitializingPiSession = {
      abortController,
      generation: Symbol(sessionId),
    };
    this.initializingSessions.set(sessionId, initialization);
    const isCurrentInitialization = (): boolean =>
      this.initializingSessions.get(sessionId)?.generation === initialization.generation &&
      !abortController.signal.aborted;

    const pi = await getPiModules();
    if (!isCurrentInitialization()) return;

    // Emit user message to UI (unless the caller already did).
    // Must persist via store.addMessage() — the CoworkStore is the source of
    // truth for messages; emit alone delivers to the in-memory Redux state
    // but never writes to SQLite, causing the prompt to vanish on session switch.
    if (!options.skipInitialUserMessage) {
      const userMsg: CoworkMessage = {
        id: randomUUID(),
        type: 'user',
        content: prompt,
        timestamp: Date.now(),
        metadata:
          options.skillIds?.length || expertIds.length
            ? {
                ...(options.skillIds?.length ? { skillIds: options.skillIds } : {}),
                ...(expertIds.length
                  ? {
                      experts: (this.store?.getSession(sessionId)?.experts ?? [])
                        .filter(expert => expertIds.includes(expert.expertId))
                        .map(expert => ({
                          expertId: expert.expertId,
                          expertName: expert.expertName,
                          presetId: expert.packageId,
                        })),
                    }
                  : {}),
              }
            : undefined,
      };
      const persisted = this.store ? this.store.addMessage(sessionId, userMsg) : userMsg;
      this.emit('message', sessionId, persisted);
    }

    let workbenchRunId: string | null = null;
    let workbenchTaskId: string | null = null;
    let workbenchTaskGoal = prompt;
    let activeSession: ActivePiSession | null = null;

    try {
      const workspaceRoot = options.workspaceRoot || process.cwd();
      // Pi's built-in bash tool snapshots process.env when it executes. Give
      // that snapshot the same app-managed Node/npm, Python, uv, and Git Bash
      // PATH configuration used by direct Skill execution.
      if (!hasAppliedApplicationRuntimeEnv) {
        applyApplicationRuntimeEnv(process.env as Record<string, string | undefined>);
        hasAppliedApplicationRuntimeEnv = true;
      }
      const sessionOptions: Record<string, unknown> = { cwd: workspaceRoot };
      // Cowork owns the canonical transcript in SQLite. Pi's default session
      // manager persists its own transcript, which would be duplicated by the
      // SQLite history prompt used when a session is recreated.
      if (pi.SessionManager?.inMemory) {
        sessionOptions.sessionManager = pi.SessionManager.inMemory(workspaceRoot);
      }

      // System prompt — user config only. Skills are discovered and appended
      // by the resource loader (additionalSkillPaths), which renders them via
      // pi's formatSkillsForPrompt — no manual injection here to avoid
      // duplicating the skills section.
      const basePrompt = options.systemPrompt?.trim() || '';
      const resourceState: PiResourceState = {
        systemPrompt: basePrompt,
        skillIds: normalizeSkillIds(options.skillIds),
        maxOutputTokens: DEFAULT_PI_LOCAL_MAX_TOKENS,
        fileToolsEnabled: options.confirmationMode !== 'text',
        unattended: options.unattended === true,
        expertSkillDirs: this.resolveExpertPresetSkillDirs(options.expertIds),
      };

      const shortcutKindForContract = isAcademicResearchSkillSet(resourceState.skillIds)
        ? null
        : resolveShortcutWorkflowKind(resourceState.skillIds);
      const productionControlsAvailable = shouldExposeProductionControls({
        sessionMode: options.sessionMode,
        prompt,
        goalMode: options.goalMode,
        productionLoopMode: options.productionLoopMode,
        inheritedProductionRequired: options._productionWorkflowRequired,
      });
      const workbenchContract = this.createWorkbenchContract(
        options.sessionMode,
        resourceState.skillIds,
        productionControlsAvailable,
      );
      if (this.workbenchTaskService) {
        const workbench = this.workbenchTaskService.beginRun({
          sessionId,
          goal: prompt,
          contract: workbenchContract,
          trigger: options._workbenchRunId
            ? WorkbenchRunTrigger.Resume
            : WorkbenchRunTrigger.Message,
          preparedRunId: options._workbenchRunId,
        });
        workbenchRunId = workbench.run.id;
        workbenchTaskId = workbench.task?.id ?? null;
        workbenchTaskGoal = workbench.task?.goal ?? prompt;
      }

      // Pi's createAgentSession does not accept a systemPrompt option. Its
      // default resource loader supplies the Pi Coding Assistant identity,
      // so override that loader per session to keep expert contexts isolated.
      // Resolve model early — needed by both MCP proxy and subagent tool
      const resolvedModel = await resolvePiModel(pi, options.modelOverride);
      if (!isCurrentInitialization()) return;
      const modelId =
        typeof resolvedModel.model.id === 'string'
          ? resolvedModel.model.id
          : options.modelOverride || 'unknown';
      const reasoning = resolvedModel.model.reasoning;
      const harnessModelProfile: HarnessModelProfileInput = {
        provider: resolvedModel.providerName,
        model: modelId,
        reasoningProfile:
          typeof reasoning === 'string' ? reasoning : reasoning === true ? 'enabled' : 'default',
        workflowKind: workbenchContract.kind,
        harnessVersion: HarnessVersion,
      };
      if (workbenchRunId && this.workbenchTaskService) {
        this.workbenchTaskService.updateRunContext(workbenchRunId, {
          model: harnessModelProfile.model,
          provider: harnessModelProfile.provider,
          reasoningProfile: harnessModelProfile.reasoningProfile,
          workspaceRoot,
          skillIds: resourceState.skillIds ?? [],
        });
        this.workbenchTaskService.measurement?.recordModelProfile(
          workbenchRunId,
          harnessModelProfile,
        );
      }
      const recordActivation = (event: HarnessActivationEvent): void => {
        const currentRunId = this.activeSessions.get(sessionId)?.workbenchRunId ?? workbenchRunId;
        if (!currentRunId) return;
        this.workbenchTaskService?.measurement?.recordActivation(currentRunId, event);
      };
      if (
        options.sessionMode === 'work' &&
        isLocalProviderName(resolvedModel.providerName) &&
        resolvedModel.capabilities?.toolCalling !== ModelCapabilityStatus.Supported
      ) {
        throw new Error(
          resolvedModel.capabilities?.toolCalling === ModelCapabilityStatus.Unsupported
            ? t('coworkLocalModelToolCallingUnsupported')
            : t('coworkLocalModelToolCallingUnknown'),
        );
      }
      resourceState.maxOutputTokens = resolvedModel.maxOutputTokens;
      sessionOptions.model = resolvedModel.model;
      if (options.thinkingLevel) {
        // Pi clamps the level to what the resolved model actually supports.
        sessionOptions.thinkingLevel = options.thinkingLevel;
      }
      if (resolvedModel.modelRuntime) {
        sessionOptions.modelRuntime = resolvedModel.modelRuntime;
      }

      console.debug(`[PiRuntime] loading isolated resources for session ${sessionId}`);
      const settingsManager = this.createPiSettingsManager(pi, workspaceRoot);
      const contextWindowTokens =
        typeof resolvedModel.model.contextWindow === 'number'
          ? resolvedModel.model.contextWindow
          : undefined;
      const resourceLoader = await this.createPiResourceLoader(pi, workspaceRoot, resourceState, {
        sessionId,
        getRunId: () => this.activeSessions.get(sessionId)?.workbenchRunId ?? workbenchRunId,
        settingsManager,
        getApprovalMode: () =>
          this.activeSessions.get(sessionId)?.approvalMode ??
          options.approvalMode ??
          WorkbenchApprovalMode.Ask,
      });
      this.applyPiCompactionOverrides(settingsManager, contextWindowTokens);
      if (!isCurrentInitialization()) return;
      sessionOptions.resourceLoader = resourceLoader;
      if (settingsManager) {
        sessionOptions.settingsManager = settingsManager;
      }

      // Build custom tools: MCP proxy + optional subagent for Team Leads.
      // Each call creates a distinct tool instance for this Pi session, so its
      // sequential execution mode cannot block another session.
      const customTools: Record<string, unknown>[] = [];

      if (shouldExposeAskUserQuestionTool(resourceState.unattended)) {
        customTools.push(
          createPiAskUserQuestionTool((toolCallId, input, signal) =>
            this.requestAskUserQuestion(sessionId, toolCallId, input, signal),
          ),
        );
      }
      if (this.projectMemoryService) {
        customTools.push(
          buildPiProjectMemoryTool({
            service: this.projectMemoryService,
            sessionId,
            workingDirectory: workspaceRoot,
            getMessages: () => this.store?.getSession(sessionId, 32)?.messages ?? [],
            complete: async messages => {
              const complete = this.getSessionMemoryCompletion(sessionId);
              if (!complete)
                throw new Error('The session model is unavailable for memory extraction.');
              return await complete(messages);
            },
          }),
        );
      }
      if (this.conversationHistoryService) {
        customTools.push(
          buildPiConversationHistoryTool({
            service: this.conversationHistoryService,
            workingDirectory: workspaceRoot,
          }),
        );
      }
      if (resourceState.fileToolsEnabled) {
        customTools.push(buildPiDocumentReaderTool({ workspaceRoot }));
        customTools.push(
          buildDeclareArtifactTool({
            onDeclare: this.workbenchTaskService
              ? artifact => {
                  const runId =
                    this.activeSessions.get(sessionId)?.workbenchRunId ?? workbenchRunId;
                  if (!runId) throw new Error('No active workbench run is available.');
                  this.workbenchTaskService?.registerArtifact({
                    sessionId,
                    runId,
                    workspaceRoot,
                    candidate: {
                      path: artifact.filePath,
                      source: WorkbenchArtifactCandidateSource.Declaration,
                      verificationStatus: WorkbenchArtifactVerificationStatus.Pending,
                      role: artifact.role,
                      ...(artifact.title ? { title: artifact.title } : {}),
                      ...(artifact.kind ? { kind: artifact.kind } : {}),
                    },
                  });
                }
              : undefined,
          }),
        );
      }

      // MCP tools: register a single proxy tool (pi-mcp-adapter pattern)
      const mcpProxyTool = this.buildMcpProxyTool();
      if (mcpProxyTool) {
        customTools.push(mcpProxyTool);
      }

      // Academic research is a controlled workflow, not a prompt-only label.
      // It owns durable state and completion gates for the lifetime of this
      // session (and reloads the same state directory after a session restart).
      const researchRun =
        productionControlsAvailable && isAcademicResearchSkillSet(resourceState.skillIds)
          ? new PiResearchRunController({
              sessionId,
              workspaceRoot,
              task: prompt,
              onActivation: recordActivation,
            })
          : null;
      if (researchRun) {
        researchRun.resumeForPrompt(prompt);
        customTools.push(buildPiResearchStateTool(researchRun));
      }
      const shortcutKind = researchRun ? null : shortcutKindForContract;
      const shortcutWorkflow =
        shortcutKind && productionControlsAvailable
          ? new PiShortcutWorkflowController({
              sessionId,
              workspaceRoot,
              task: prompt,
              kind: shortcutKind,
              validateRasterPreview: isRasterPreviewDecodable,
              renderOfficePreview,
              onActivation: recordActivation,
            })
          : null;
      if (shortcutWorkflow) {
        shortcutWorkflow.resumeForPrompt(prompt);
        customTools.push(buildPiShortcutWorkflowStateTool(shortcutWorkflow));
      }

      if (options.sessionMode === 'work' && resourceState.skillIds?.length) {
        customTools.push(buildPiSkillRuntimeCapabilitiesTool());
        customTools.push(
          buildPiSkillScriptTool({
            workspaceRoot,
            allowedSkillIds: resourceState.skillIds,
          }),
        );
      }

      // Subagent tool: registered for every cowork session. When the session
      // agent is a Team Lead from a package, its presetId additionally exposes
      // the team member agents alongside the built-in profiles.
      let subagentPresetId: string | undefined;
      if (this.store) {
        const candidateAgentIds = expertIds.length
          ? expertIds
          : options.agentId
            ? [options.agentId]
            : [];
        const leadAgent = candidateAgentIds
          .map(agentId => this.store?.getAgent(agentId))
          .find(
            candidate =>
              candidate?.source === CoworkSessionExpertSource.Package && candidate.presetId,
          );
        subagentPresetId = leadAgent?.presetId;
      }
      const subagentTool = buildPiSubagentTool({
        getPiAgentsDir: () => this.getPiAgentsDir(),
        presetId: subagentPresetId,
        loadBundledMembers: subagentPresetId
          ? presetId =>
              this.resolveBundledMemberProfiles(presetId)?.map(member => ({
                ...member,
                source: 'member' as const,
              })) ?? null
          : undefined,
        resolvedModel,
        workspaceRoot,
        webSearchSkillPath:
          researchRun ||
          (productionControlsAvailable && shortcutKind === ShortcutWorkflowKind.DeepResearch)
            ? path.join(getSkillsRoot(), 'web-search')
            : undefined,
        createPiResourceLoader: (
          cwd,
          systemPrompt,
          maxOutputTokens,
          skillIds,
          extensionFactories,
        ) =>
          this.createPiResourceLoader(
            pi,
            cwd,
            {
              systemPrompt,
              skillIds,
              maxOutputTokens,
              fileToolsEnabled: true,
              unattended: resourceState.unattended,
              expertSkillDirs: [],
            },
            {
              sessionId,
              getRunId: () => this.activeSessions.get(sessionId)?.workbenchRunId ?? workbenchRunId,
              getApprovalMode: () =>
                this.activeSessions.get(sessionId)?.approvalMode ??
                options.approvalMode ??
                WorkbenchApprovalMode.Ask,
            },
            extensionFactories,
          ),
      });
      if (subagentTool) {
        customTools.push(subagentTool);
      }

      // Agent loop tool: lets the LLM drive multi-iteration long-horizon
      // loops; the controller continues the session on agent_end.
      const completionWorkflow = researchRun || shortcutWorkflow;
      const productionLoop =
        productionControlsAvailable &&
        workbenchTaskId &&
        workbenchRunId &&
        this.workbenchTaskService?.productionLoop
          ? new ProductionLoopController(
              this.workbenchTaskService.productionLoop,
              {
                taskId: workbenchTaskId,
                runId: workbenchRunId,
                workflowKind: workbenchContract.kind,
                goal: workbenchTaskGoal,
                prototypeRequired: workbenchContract.metadata?.requiresPrototype === true,
                deferDecision:
                  options.goalMode !== true && options._productionWorkflowRequired !== true,
                skipAllowed: options.goalMode !== true,
                // System-side risk probe: an approved approval whose risk was
                // classified as irreversible OR unknown (e.g. mcp tools,
                // unclassified shell commands) forces the full reviewer —
                // lightweight review is fail-open only for positively
                // read-only/reversible runs.
                resolveElevatedRisk: probeRunId =>
                  this.workbenchTaskService?.repository
                    .listApprovalsForRun(probeRunId)
                    .some(
                      approval =>
                        approval.decision === WorkbenchApprovalDecision.Approved &&
                        (approval.riskLevel === WorkbenchApprovalRiskLevel.Irreversible ||
                          approval.riskLevel === WorkbenchApprovalRiskLevel.Unknown),
                    ) ?? false,
              },
              completionWorkflow || undefined,
            )
          : null;
      if (productionLoop) customTools.push(buildProductionLoopTool(productionLoop));
      const shouldRunGoalLoop =
        options.goalMode === true && options.sessionMode === CoworkSessionMode.Work;
      const workLoop = createPiWorkLoop({
        goal: productionLoop?.goal || completionWorkflow?.goal || prompt,
        completionWorkflow: productionLoop || completionWorkflow || undefined,
        onActivation: recordActivation,
        start: Boolean(productionLoop || completionWorkflow || shouldRunGoalLoop),
      });
      const agentLoop = workLoop.controller;
      const workLoopPrompt = shouldRunGoalLoop ? workLoop.initialPrompt : '';
      customTools.push(workLoop.tool);

      if (customTools.length > 0) {
        sessionOptions.customTools = customTools;
      }

      // Chat mode: disable all built-in tools for direct LLM access
      if (options.confirmationMode === 'text') {
        sessionOptions.noTools = 'all';
      }

      console.debug(`[PiRuntime] creating agent session for ${sessionId}`);
      const result = await pi.createAgentSession(sessionOptions);
      const session = result.session;
      if (!isCurrentInitialization()) {
        void session.abort();
        return;
      }

      const active: ActivePiSession = {
        sessionId,
        piSession: session,
        abortController,
        model: resolvedModel.model,
        modelRuntime: resolvedModel.modelRuntime,
        modelRequestOptions: resolvedModel.requestOptions,
        capabilities: {
          toolCalling: ModelCapabilityStatus.Unknown,
          imageInput: ModelCapabilityStatus.Unknown,
          videoInput: ModelCapabilityStatus.Unknown,
          audioInput: ModelCapabilityStatus.Unknown,
          documentInput: ModelCapabilityStatus.Unknown,
          reasoning: ModelCapabilityStatus.Unknown,
          ...resolvedModel.capabilities,
        },
        harnessModelProfile,
        requestedSystemPrompt: basePrompt,
        requestedSkillIds: resourceState.skillIds,
        requestedExpertIds: expertIds,
        turnExperts: (this.store?.getSession(sessionId)?.experts ?? [])
          .filter(expert => expertIds.includes(expert.expertId))
          .map(expert => ({
            expertId: expert.expertId,
            expertName: expert.expertName,
            presetId: expert.packageId,
          })),
        resourceState,
        assistantMessageId: null,
        thinkingMessageId: null,
        answerText: '',
        thinkingText: '',
        streamAccumulator: new PiStreamAccumulator(),
        thinkingLifecycle: new PiThinkingLifecycle(),
        lastCompletedAnswerMessageId: null,
        lastCompletedAnswerText: '',
        requestStartedAt: null,
        firstVisibleTextAt: null,
        confirmationMode: options.confirmationMode || 'modal',
        unsubscribe: () => {},
        aborted: false,
        toolResultMessageIdByCallId: new Map(),
        toolStartedAtByCallId: new Map(),
        preparingToolCallIdByContentIndex: new Map(),
        toolActivityTracker: new ToolActivityTracker(),
        agentLoop,
        researchRun,
        shortcutWorkflow,
        productionLoop,
        productionControlsAvailable,
        goalMode: options.goalMode === true,
        writeTokenLimitRecovery: new PiWriteTokenLimitRecovery(resolvedModel.maxOutputTokens),
        pendingError: null,
        workbenchRunId,
        workbenchContract,
        workspaceRoot,
        settingsManager,
        approvalMode: options.approvalMode ?? WorkbenchApprovalMode.Ask,
        unattended: resourceState.unattended,
        isRunning: true,
        turnFailed: false,
        queueFlushInFlight: false,
        mcpToolManifestGeneration: this.mcpToolManifestGeneration,
      };
      activeSession = active;

      // Subscribe to Pi events before sending the prompt
      active.unsubscribe = session.subscribe(event => {
        if (abortController.signal.aborted || this.activeSessions.get(sessionId) !== active) {
          return;
        }
        this.handlePiEvent(sessionId, active, event);
      });

      if (!isCurrentInitialization()) {
        active.unsubscribe();
        void session.abort();
        return;
      }
      this.activeSessions.set(sessionId, active);
      this.initializingSessions.delete(sessionId);

      // Send the prompt (may include conversation history for restart restores)
      let initialPrompt = researchRun
        ? researchRun.buildInitialPrompt(options._piPromptOverride || prompt)
        : shortcutWorkflow
          ? shortcutWorkflow.buildInitialPrompt(options._piPromptOverride || prompt)
          : options._piPromptOverride || prompt;
      if (shouldRunGoalLoop) {
        initialPrompt = `${workLoopPrompt}\n\n${initialPrompt}`;
      }
      if (productionLoop) {
        initialPrompt = prependProductionWorkflowPrompt(
          initialPrompt,
          productionLoop.buildInitialPrompt(),
          expertIds.length > 0,
        );
      }
      const projectMemoryContext = await buildProjectMemoryContextSafe(
        this.projectMemoryService,
        workspaceRoot,
        sessionId,
        prompt,
      );
      if (this.activeSessions.get(sessionId) !== active || abortController.signal.aborted) return;
      if (projectMemoryContext) initialPrompt = `${projectMemoryContext}\n\n${initialPrompt}`;

      // The user may stop the session while the execution-mode question is
      // open. Do not revive an aborted Pi turn when that question resolves.
      if (abortController.signal.aborted) return;

      console.debug(`[PiRuntime] dispatching initial prompt for session ${sessionId}`);
      await sendPiPrompt(
        session,
        initialPrompt,
        options.imageAttachments,
        active.capabilities,
        undefined,
      );
    } catch (error) {
      // A stopped turn can immediately restart from the first queued follow-up.
      // Its eventual abort rejection must not delete that replacement session.
      if (activeSession && this.activeSessions.get(sessionId) === activeSession) {
        this.activeSessions.delete(sessionId);
      }
      if (abortController.signal.aborted) {
        this.emit('sessionStopped', sessionId);
        return;
      }
      const message = error instanceof Error ? error.message : String(error);
      this.workbenchTaskService?.failRun?.(sessionId, { message });
      this.emit('error', sessionId, classifyCoworkError(message));
      throw error;
    } finally {
      if (this.initializingSessions.get(sessionId)?.generation === initialization.generation) {
        this.initializingSessions.delete(sessionId);
      }
    }
  }

  async continueSession(
    sessionId: string,
    prompt: string,
    options: PiContinueOptions = {},
  ): Promise<void> {
    const explicitExpertIds = normalizeSingleExpertIds(options.expertIds);
    const nextUnattended = options.unattended === true;
    const active = this.activeSessions.get(sessionId);
    if (!active || active.aborted) {
      if (active?.aborted) {
        this.activeSessions.delete(sessionId);
      }
      console.log(
        `[PiRuntime] continueSession: session ${sessionId} not active or was aborted, restoring context via prompt`,
      );
      const storedSession = this.store?.getSession(sessionId);
      const history = storedSession?.messages ?? [];
      const piPrompt = buildPiConversationPrompt(history, prompt, {
        maxChars: calculatePiConversationHistoryCharLimit(),
      });
      return this.startSession(sessionId, prompt, {
        ...options,
        skipInitialUserMessage: options._skipUserMessage,
        systemPrompt: options.systemPrompt ?? storedSession?.systemPrompt,
        expertIds:
          options.expertIds === undefined
            ? storedSession?.experts.slice(0, 1).map(expert => expert.expertId)
            : explicitExpertIds,
        workspaceRoot: options.workspaceRoot ?? storedSession?.cwd,
        agentId: options.agentId ?? storedSession?.agentId,
        modelOverride: options.modelOverride ?? storedSession?.modelOverride,
        goalMode: options.goalMode ?? active?.goalMode,
        unattended: nextUnattended,
        _piPromptOverride: piPrompt,
      });
    }

    const requestedSystemPrompt = options.systemPrompt?.trim();
    const requestedSkillIds =
      options.skillIds === undefined
        ? active.requestedSkillIds
        : normalizeSkillIds(options.skillIds);
    const requestedExpertIds =
      options.expertIds === undefined ? active.requestedExpertIds : explicitExpertIds;
    const requestedSessionMode =
      options.sessionMode ??
      (active.workbenchContract.kind === WorkbenchContractKind.Chat
        ? CoworkSessionMode.Chat
        : CoworkSessionMode.Work);
    const nextGoalMode = options.goalMode ?? active.goalMode;
    let activeProductionSnapshot: Record<string, unknown> | undefined;
    try {
      activeProductionSnapshot = active.productionLoop?.getSnapshot();
    } catch {
      // A deleted or otherwise unavailable persisted run should not make a
      // normal continuation fail; the next turn can rebuild its topology.
      activeProductionSnapshot = undefined;
    }
    const inheritedProductionRequired =
      options._productionWorkflowRequired === true ||
      (activeProductionSnapshot?.productionActive === true &&
        activeProductionSnapshot.skipped !== true &&
        activeProductionSnapshot.status !== ProductionLoopStatus.Completed);
    const productionControlsAvailable = shouldExposeProductionControls({
      sessionMode: requestedSessionMode,
      prompt,
      goalMode: nextGoalMode,
      productionLoopMode: options.productionLoopMode,
      inheritedProductionRequired,
    });
    const productionWorkflowTopologyChanged =
      productionControlsAvailable !== active.productionControlsAvailable;
    const mcpToolTopologyChanged =
      active.mcpToolManifestGeneration !== this.mcpToolManifestGeneration;
    const unattendedTopologyChanged = nextUnattended !== active.unattended;
    if (
      !haveSameStringList(requestedExpertIds, active.requestedExpertIds) ||
      productionWorkflowTopologyChanged ||
      mcpToolTopologyChanged ||
      unattendedTopologyChanged
    ) {
      const history = this.store?.getSession(sessionId)?.messages ?? [];
      if (mcpToolTopologyChanged) {
        console.log('[PiRuntime] recreating session after MCP tool manifest refresh');
      }
      this.disposeSessionForRecreation(sessionId, active);
      return this.startSession(sessionId, prompt, {
        ...options,
        sessionMode: requestedSessionMode,
        systemPrompt: requestedSystemPrompt ?? active.requestedSystemPrompt,
        skillIds: requestedSkillIds,
        expertIds: requestedExpertIds,
        goalMode: nextGoalMode,
        unattended: nextUnattended,
        _piPromptOverride: buildPiConversationPrompt(history, prompt, {
          maxChars: calculatePiConversationHistoryCharLimit(
            typeof active.model.contextWindow === 'number' ? active.model.contextWindow : undefined,
            typeof active.model.maxTokens === 'number' ? active.model.maxTokens : undefined,
          ),
        }),
      });
    }

    if (options.approvalMode !== undefined) {
      active.approvalMode = options.approvalMode;
    }
    active.isRunning = true;
    active.turnFailed = false;

    const nextSystemPrompt = requestedSystemPrompt ?? active.requestedSystemPrompt;
    const promptChanged = nextSystemPrompt !== active.requestedSystemPrompt;
    const skillsChanged = !haveSameStringList(requestedSkillIds, active.requestedSkillIds);
    if (skillsChanged) {
      const history = this.store?.getSession(sessionId)?.messages ?? [];
      this.disposeSessionForRecreation(sessionId, active);
      return this.startSession(sessionId, prompt, {
        ...options,
        sessionMode: requestedSessionMode,
        systemPrompt: nextSystemPrompt,
        skillIds: requestedSkillIds,
        expertIds: requestedExpertIds,
        goalMode: nextGoalMode,
        unattended: nextUnattended,
        _piPromptOverride: buildPiConversationPrompt(history, prompt, {
          maxChars: calculatePiConversationHistoryCharLimit(
            typeof active.model.contextWindow === 'number' ? active.model.contextWindow : undefined,
            typeof active.model.maxTokens === 'number' ? active.model.maxTokens : undefined,
          ),
        }),
      });
    }

    active.goalMode = nextGoalMode;

    if (promptChanged) {
      const previousSystemPrompt = active.resourceState.systemPrompt;
      const previousSkillIds = active.resourceState.skillIds;
      active.resourceState.systemPrompt = nextSystemPrompt;
      active.resourceState.skillIds = requestedSkillIds;
      try {
        // Pi reloads the existing ResourceLoader without replacing transcript
        // state, model, MCP tools, or custom expert tools.
        await active.piSession.reload();
        // AgentSession.reload() reloads SettingsManager from disk, so restore
        // the per-process bundled PortableGit override after every reload.
        this.applyPiShellOverride(active.settingsManager);
        this.applyPiCompactionOverrides(
          active.settingsManager,
          typeof active.model.contextWindow === 'number' ? active.model.contextWindow : undefined,
        );
        active.requestedSystemPrompt = nextSystemPrompt;
        active.requestedSkillIds = requestedSkillIds;
        console.debug('[PiRuntime] reloaded session resources after prompt change');
      } catch (error) {
        active.resourceState.systemPrompt = previousSystemPrompt;
        active.resourceState.skillIds = previousSkillIds;
        active.isRunning = false;
        const message = error instanceof Error ? error.message : String(error);
        this.emit('error', sessionId, classifyCoworkError(message));
        throw error;
      }
    }

    if (this.workbenchTaskService) {
      const workbenchContract = this.createWorkbenchContract(
        requestedSessionMode,
        requestedSkillIds,
        productionControlsAvailable,
      );
      const workbench = this.workbenchTaskService.beginRun({
        sessionId,
        goal: prompt,
        contract: workbenchContract,
        trigger: options._workbenchRunId ? WorkbenchRunTrigger.Resume : WorkbenchRunTrigger.Message,
        preparedRunId: options._workbenchRunId,
      });
      active.workbenchRunId = workbench.run.id;
      active.workbenchContract = workbenchContract;
      active.harnessModelProfile = {
        ...active.harnessModelProfile,
        workflowKind: workbenchContract.kind,
      };
      this.workbenchTaskService.measurement?.recordModelProfile(
        workbench.run.id,
        active.harnessModelProfile,
      );
      this.workbenchTaskService.updateRunContext(workbench.run.id, {
        model: active.harnessModelProfile.model,
        provider: active.harnessModelProfile.provider,
        reasoningProfile: active.harnessModelProfile.reasoningProfile,
        workspaceRoot: active.workspaceRoot,
        skillIds: requestedSkillIds ?? [],
      });
      if (productionControlsAvailable && workbench.task?.id) {
        active.productionLoop?.startRun({
          taskId: workbench.task.id,
          runId: workbench.run.id,
          workflowKind: workbenchContract.kind,
          goal: workbench.task.goal,
          prototypeRequired: workbenchContract.metadata?.requiresPrototype === true,
          deferDecision: nextGoalMode !== true && options._productionWorkflowRequired !== true,
          skipAllowed: nextGoalMode !== true,
        });
      }
    }

    // Reset turn state
    active.answerText = '';
    active.thinkingText = '';
    active.assistantMessageId = null;
    active.thinkingMessageId = null;
    active.thinkingLifecycle.reset();
    active.lastCompletedAnswerMessageId = null;
    active.lastCompletedAnswerText = '';
    active.toolResultMessageIdByCallId.clear();
    active.toolStartedAtByCallId.clear();
    active.preparingToolCallIdByContentIndex.clear();
    const clearActivity = active.toolActivityTracker.clear();
    if (clearActivity) this.emit('toolActivity', sessionId, clearActivity);
    active.writeTokenLimitRecovery.reset();
    active.pendingError = null;
    active.turnFailed = false;
    active.turnExperts = (this.store?.getSession(sessionId)?.experts ?? [])
      .filter(expert => active.requestedExpertIds.includes(expert.expertId))
      .map(expert => ({
        expertId: expert.expertId,
        expertName: expert.expertName,
        presetId: expert.packageId,
      }));

    // Emit user message (persisted to SQLite, same as startSession).
    if (!options._skipUserMessage) {
      const userMsg: CoworkMessage = {
        id: randomUUID(),
        type: 'user',
        content: prompt,
        timestamp: Date.now(),
        metadata:
          options.skillIds?.length ||
          options._queueDelivery ||
          options.imageAttachments?.length ||
          options.fileAttachments?.length ||
          active.turnExperts.length
            ? {
                ...(options.skillIds?.length ? { skillIds: options.skillIds } : {}),
                ...(options._queueDelivery ? { queueDelivery: options._queueDelivery } : {}),
                ...(options.imageAttachments?.length
                  ? { imageAttachments: options.imageAttachments }
                  : {}),
                ...(options.fileAttachments?.length
                  ? { fileAttachments: options.fileAttachments }
                  : {}),
                ...(active.turnExperts.length ? { experts: active.turnExperts } : {}),
              }
            : undefined,
      };
      const persisted = this.store ? this.store.addMessage(sessionId, userMsg) : userMsg;
      this.emit('message', sessionId, persisted);
    }

    let nextPrompt = prompt;
    const domainCompletionWorkflow = active.productionControlsAvailable
      ? active.researchRun || active.shortcutWorkflow
      : null;
    const completionWorkflow = active.productionControlsAvailable
      ? active.productionLoop || domainCompletionWorkflow
      : null;
    if (options.goalMode !== undefined && !completionWorkflow) {
      active.goalMode = options.goalMode;
      if (!active.goalMode && active.agentLoop.getState().active) {
        active.agentLoop.stop();
      }
    }
    const shouldRunGoalLoop =
      active.goalMode && active.workbenchContract.kind !== WorkbenchContractKind.Chat;
    if ((completionWorkflow || shouldRunGoalLoop) && !active.agentLoop.getState().active) {
      domainCompletionWorkflow?.resumeForPrompt(prompt);
      const loopPrompt = active.agentLoop.start({
        mode: PiAgentLoopMode.Goal,
        goal: completionWorkflow?.goal || prompt,
        passes: 0,
        stages: [],
      });
      nextPrompt = active.researchRun
        ? active.researchRun.buildInitialPrompt(prompt)
        : active.shortcutWorkflow
          ? active.shortcutWorkflow.buildInitialPrompt(prompt)
          : prompt;
      if (!completionWorkflow) {
        nextPrompt = `${loopPrompt}\n\n${nextPrompt}`;
      }
    }
    if (active.productionLoop && productionControlsAvailable) {
      nextPrompt = prependProductionWorkflowPrompt(
        nextPrompt,
        active.productionLoop.buildInitialPrompt(),
        active.requestedExpertIds.length > 0,
      );
    }

    try {
      const projectMemoryContext = await buildProjectMemoryContextSafe(
        this.projectMemoryService,
        active.workspaceRoot,
        sessionId,
        prompt,
      );
      if (projectMemoryContext) nextPrompt = `${projectMemoryContext}\n\n${nextPrompt}`;
      await sendPiPrompt(
        active.piSession,
        nextPrompt,
        options.imageAttachments,
        active.capabilities,
        options._streamingBehavior,
      );
    } catch (error) {
      active.isRunning = false;
      if (active.abortController.signal.aborted) {
        this.emit('sessionStopped', sessionId);
        return;
      }
      const message = error instanceof Error ? error.message : String(error);
      this.emit('error', sessionId, classifyCoworkError(message));
      throw error;
    }
  }

  async patchSession(sessionId: string, patch: PiSessionPatch): Promise<void> {
    const active = this.activeSessions.get(sessionId);
    if (!active) return;

    if (patch.thinkingLevel) {
      try {
        await active.piSession.setThinkingLevel?.(patch.thinkingLevel);
        console.log('[PiRuntime] Thinking level updated via patchSession:', patch.thinkingLevel);
      } catch (err) {
        console.warn('[PiRuntime] Failed to update thinking level via patchSession:', err);
      }
    }

    if (!patch.model) return;

    try {
      const pi = await getPiModules();
      const resolvedModel = await resolvePiModel(pi, patch.model, active.modelRuntime);
      const model = resolvedModel.model;
      await active.piSession.setModel(model);
      active.model = model;
      active.modelRuntime = resolvedModel.modelRuntime;
      active.modelRequestOptions = resolvedModel.requestOptions;
      active.capabilities = {
        ...active.capabilities,
        ...resolvedModel.capabilities,
      };
      const reasoning = resolvedModel.model.reasoning;
      active.harnessModelProfile = {
        provider: resolvedModel.providerName,
        model:
          typeof resolvedModel.model.id === 'string' ? resolvedModel.model.id : patch.model.trim(),
        reasoningProfile:
          typeof reasoning === 'string' ? reasoning : reasoning === true ? 'enabled' : 'default',
        workflowKind: active.workbenchContract.kind,
        harnessVersion: HarnessVersion,
      };
      active.writeTokenLimitRecovery = new PiWriteTokenLimitRecovery(resolvedModel.maxOutputTokens);
      if (active.resourceState.maxOutputTokens !== resolvedModel.maxOutputTokens) {
        active.resourceState.maxOutputTokens = resolvedModel.maxOutputTokens;
        await active.piSession.reload();
        this.applyPiShellOverride(active.settingsManager);
        this.applyPiCompactionOverrides(
          active.settingsManager,
          typeof active.model.contextWindow === 'number' ? active.model.contextWindow : undefined,
        );
      }
      console.log('[PiRuntime] Model updated via patchSession:', patch.model);
    } catch (err) {
      console.warn('[PiRuntime] Failed to update model via patchSession:', err);
    }
  }

  private disposeSessionForRecreation(sessionId: string, active: ActivePiSession): void {
    this.dismissAskUserQuestionsBySession(sessionId);
    active.agentLoop.stop();
    active.pendingError = null;
    active.toolStartedAtByCallId.clear();
    const clearActivity = active.toolActivityTracker.clear();
    if (clearActivity) this.emit('toolActivity', sessionId, clearActivity);
    active.piSession.abortBash();
    active.abortController.abort();
    active.unsubscribe();
    void active.piSession.abort();
    this.workbenchTaskService?.pauseRun?.(
      sessionId,
      'The session resources changed before the approval was resolved.',
    );
    this.clearApprovalsBySession(sessionId);
    this.activeSessions.delete(sessionId);
  }

  stopSession(sessionId: string): void {
    this.stopActiveSession(
      sessionId,
      'The user stopped this run.',
      true,
      CoworkInterruptionCause.UserStop,
    );
  }

  private stopActiveSession(
    sessionId: string,
    reason: string,
    drainQueuedFollowUp: boolean,
    cause?: CoworkInterruptionCause,
  ): void {
    this.dismissAskUserQuestionsBySession(sessionId);
    const initializing = this.initializingSessions.get(sessionId);
    if (initializing) {
      initializing.abortController.abort();
      this.initializingSessions.delete(sessionId);
    }
    const active = this.activeSessions.get(sessionId);
    if (!active) {
      this.workbenchTaskService?.pauseRun?.(sessionId, reason);
      this.clearApprovalsBySession(sessionId);
      if (cause) this.recordSessionInterruption(sessionId, cause);
      return;
    }
    const wasRunning = active.isRunning;
    if (!wasRunning && active.aborted) return;

    this.finalizeActiveThinking(sessionId, active);

    // Mark the session as aborted so continueSession knows not to reuse the Pi
    // session object, which may be in an inconsistent state after abort.
    active.aborted = true;
    active.isRunning = false;
    active.turnFailed = false;
    active.agentLoop.stop();
    // Drop any deferred error without surfacing it — the user stopped the turn.
    active.pendingError = null;
    active.toolStartedAtByCallId.clear();
    const clearActivity = active.toolActivityTracker.clear();
    if (clearActivity) this.emit('toolActivity', sessionId, clearActivity);

    // Only abort the current turn — keep the session entry in activeSessions
    // so isSessionActive still reports true for IM routing, but do not reuse
    // the underlying Pi session for subsequent turns.
    active.piSession.abortBash();
    active.abortController.abort();
    active.unsubscribe();
    void active.piSession.abort();
    this.workbenchTaskService?.pauseRun?.(sessionId, reason);
    this.clearApprovalsBySession(sessionId);
    this.emit('sessionStopped', sessionId);
    if (cause) this.recordSessionInterruption(sessionId, cause);

    // A user stop ends the current turn without cancelling messages already
    // queued in Work. Start the next follow-up from a fresh Pi session; the
    // internal stop used during that recreation is not running and will not
    // recursively drain the queue.
    if (
      wasRunning &&
      drainQueuedFollowUp &&
      active.workbenchContract.kind !== WorkbenchContractKind.Chat &&
      this.pendingMessageQueue.hasPendingFollowUp(sessionId)
    ) {
      const next = this.pendingMessageQueue.findNextPending(
        sessionId,
        CoworkQueueDelivery.FollowUp,
      );
      if (next) void this.followUpPendingMessage(sessionId, next.id);
    }
  }

  private recordSessionInterruption(
    sessionId: string,
    cause: CoworkInterruptionCause,
  ): CoworkSessionInterruption {
    const task = this.workbenchTaskService?.getCurrent(sessionId)?.task ?? null;
    const resumableTask = task?.contract.kind === WorkbenchContractKind.Chat ? null : task;
    const interruption: CoworkSessionInterruption = {
      sessionId,
      interruptionId: randomUUID(),
      cause,
      taskId: resumableTask?.id ?? null,
      recoverable: resumableTask?.status === WorkbenchTaskStatus.Paused,
    };
    const seed: CoworkMessage = {
      id: randomUUID(),
      type: 'system',
      content: '',
      timestamp: Date.now(),
      metadata: { interruption },
    };
    const message = this.store ? this.store.addMessage(sessionId, seed) : seed;
    this.store?.updateSession(sessionId, { status: 'idle' });
    this.emit('message', sessionId, message);
    this.emit('sessionInterrupted', interruption);
    return interruption;
  }

  stopAllSessions(): void {
    const sessionIds = new Set([
      ...this.activeSessions.keys(),
      ...this.initializingSessions.keys(),
    ]);
    for (const sessionId of sessionIds) {
      this.stopActiveSession(sessionId, 'The application stopped the active session.', false);
    }
  }

  /** Applies the current approval mode to sessions that are already running. */
  setApprovalModeForSession(sessionId: string, approvalMode: WorkbenchApprovalMode): void {
    const active = this.activeSessions.get(sessionId);
    if (active) active.approvalMode = approvalMode;
  }

  respondToPermission(requestId: string, result: PiPermissionResult): void {
    const pendingQuestion = this.pendingAskUserQuestions.get(requestId);
    if (pendingQuestion) {
      this.finishAskUserQuestion(requestId, {
        behavior: result.behavior,
        ...(result.behavior === 'allow'
          ? { updatedInput: result.updatedInput }
          : { message: result.message }),
      });
      return;
    }

    const sessionId = this.approvalSessionMap.get(requestId);
    if (!sessionId) return;
    this.approvalSessionMap.delete(requestId);

    if (this.workbenchTaskService?.repository.getApproval(requestId)) {
      const denied = result.behavior === 'deny';
      this.workbenchTaskService.respondToApproval({
        approvalId: requestId,
        approved: !denied,
        reason: denied ? result.message : undefined,
      });
      if (denied) {
        this.stopActiveSession(
          sessionId,
          result.message || 'The user denied this action.',
          false,
          CoworkInterruptionCause.ApprovalDenied,
        );
      }
      return;
    }

    // Pi has no built-in permission system.
    // For deny: abort the current turn so the model stops.
    if (result.behavior === 'deny') {
      const active = this.activeSessions.get(sessionId);
      if (active) {
        void active.piSession.abort();
      }
    }
  }

  isSessionActive(sessionId: string): boolean {
    return this.activeSessions.has(sessionId);
  }

  isSessionRunning(sessionId: string): boolean {
    const active = this.activeSessions.get(sessionId);
    return Boolean(active && active.isRunning && !active.aborted);
  }

  listPendingMessages(sessionId: string): CoworkPendingMessage[] {
    return this.pendingMessageQueue.list(sessionId);
  }

  enqueuePendingMessage(
    sessionId: string,
    text: string,
    imageAttachments?: PiContinueOptions['imageAttachments'],
    fileAttachments?: PiContinueOptions['fileAttachments'],
    skillIds?: string[],
    skillPrompt?: string,
    productionLoopMode?: PiContinueOptions['productionLoopMode'],
  ): { success: boolean; item?: CoworkPendingMessage; error?: string } {
    const active = this.activeSessions.get(sessionId);
    if (!this.isWorkSession(sessionId, active)) {
      return { success: false, error: 'Pending message queue is only available in Work sessions.' };
    }
    if (!active || !this.isSessionRunning(sessionId)) {
      return { success: false, error: 'The Work session is not running.' };
    }
    const normalizedText = text.trim();
    if (!normalizedText) return { success: false, error: 'Message text is required.' };
    const item = this.pendingMessageQueue.enqueue(
      sessionId,
      normalizedText,
      CoworkQueueDelivery.FollowUp,
      imageAttachments,
      fileAttachments,
      skillIds,
      skillPrompt,
      productionLoopMode,
    );
    this.emitQueueUpdated(sessionId);
    return { success: true, item };
  }

  updatePendingMessage(
    sessionId: string,
    itemId: string,
    text: string,
  ): { success: boolean; item?: CoworkPendingMessage; error?: string } {
    if (!this.isWorkSession(sessionId, this.activeSessions.get(sessionId))) {
      return { success: false, error: 'Pending message queue is only available in Work sessions.' };
    }
    const normalizedText = text.trim();
    if (!normalizedText) return { success: false, error: 'Message text is required.' };
    const item = this.pendingMessageQueue.update(sessionId, itemId, normalizedText);
    if (!item) return { success: false, error: 'Pending message was not found.' };
    this.emitQueueUpdated(sessionId);
    return { success: true, item };
  }

  deletePendingMessage(sessionId: string, itemId: string): { success: boolean; error?: string } {
    if (!this.isWorkSession(sessionId, this.activeSessions.get(sessionId))) {
      return { success: false, error: 'Pending message queue is only available in Work sessions.' };
    }
    if (!this.pendingMessageQueue.remove(sessionId, itemId)) {
      return { success: false, error: 'Pending message was not found.' };
    }
    this.emitQueueUpdated(sessionId);
    return { success: true };
  }

  async steerPendingMessage(
    sessionId: string,
    itemId: string,
  ): Promise<{ success: boolean; item?: CoworkPendingMessage; error?: string }> {
    const active = this.activeSessions.get(sessionId);
    if (!this.isWorkSession(sessionId, active)) {
      return { success: false, error: 'Pending message queue is only available in Work sessions.' };
    }
    if (!active || !this.isSessionRunning(sessionId)) {
      return { success: false, error: 'The Work session is not running.' };
    }
    // A queued message is initially classified as FollowUp, but the user can
    // explicitly promote any pending item to an immediate Steer.
    const item = this.pendingMessageQueue.take(sessionId, itemId);
    if (!item) return { success: false, error: 'Pending message was not found.' };
    this.emitQueueUpdated(sessionId);
    try {
      await sendPiPrompt(
        active.piSession,
        item.skillPrompt ? `${item.skillPrompt}\n\n${item.text}` : item.text,
        item.imageAttachments,
        active.capabilities,
        'steer',
      );
      this.persistQueuedUserMessage(sessionId, item, CoworkQueueDelivery.Steer);
      active.isRunning = true;
      this.pendingMessageQueue.finishDelivery(item.id);
      return { success: true, item };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const restored = this.pendingMessageQueue.restore(sessionId, { ...item, error: message });
      this.emitQueueUpdated(sessionId);
      return { success: false, item: restored, error: message };
    }
  }

  async followUpPendingMessage(
    sessionId: string,
    itemId: string,
  ): Promise<{ success: boolean; item?: CoworkPendingMessage; error?: string }> {
    const active = this.activeSessions.get(sessionId);
    if (!this.isWorkSession(sessionId, active)) {
      return { success: false, error: 'Pending message queue is only available in Work sessions.' };
    }
    if (!active) return { success: false, error: 'The Work session is not active.' };
    if (this.isSessionRunning(sessionId)) {
      return { success: false, error: 'The Work session is still running.' };
    }
    const item = this.pendingMessageQueue.take(sessionId, itemId, CoworkQueueDelivery.FollowUp);
    if (!item) return { success: false, error: 'Pending message was not found.' };
    this.emitQueueUpdated(sessionId);
    try {
      await this.continueSession(sessionId, item.text, {
        sessionMode: CoworkSessionMode.Work,
        _queueDelivery: CoworkQueueDelivery.FollowUp,
        _streamingBehavior: 'followUp',
        imageAttachments: item.imageAttachments,
        fileAttachments: item.fileAttachments,
        skillIds: item.skillIds,
        productionLoopMode: item.productionLoopMode,
      });
      this.pendingMessageQueue.finishDelivery(item.id);
      return { success: true, item };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const restored = this.pendingMessageQueue.restore(sessionId, { ...item, error: message });
      this.emitQueueUpdated(sessionId);
      return { success: false, item: restored, error: message };
    }
  }

  private isWorkSession(sessionId: string, active: ActivePiSession | undefined): boolean {
    if (active) return active.workbenchContract.kind !== WorkbenchContractKind.Chat;
    return this.store?.getSession(sessionId)?.mode !== CoworkSessionMode.Chat;
  }

  private persistQueuedUserMessage(
    sessionId: string,
    item: CoworkPendingMessage,
    delivery: CoworkQueueDelivery,
  ): CoworkMessage {
    const message: CoworkMessage = {
      id: randomUUID(),
      type: 'user',
      content: item.text,
      timestamp: Date.now(),
      metadata: {
        queueDelivery: delivery,
        ...(item.skillIds?.length ? { skillIds: item.skillIds } : {}),
        ...(item.productionLoopMode ? { productionLoopMode: item.productionLoopMode } : {}),
        ...(item.imageAttachments?.length ? { imageAttachments: item.imageAttachments } : {}),
        ...(item.fileAttachments?.length ? { fileAttachments: item.fileAttachments } : {}),
      },
    };
    const persisted = this.store ? this.store.addMessage(sessionId, message) : message;
    this.emit('message', sessionId, persisted);
    if (this.store) this.store.updateSession(sessionId, { status: 'running' });
    return persisted;
  }

  private emitQueueUpdated(sessionId: string): void {
    this.emit('queueUpdated', sessionId, this.pendingMessageQueue.list(sessionId));
  }

  private async flushFollowUpQueue(sessionId: string, active: ActivePiSession): Promise<void> {
    if (active.queueFlushInFlight || active.aborted || active.pendingError || active.turnFailed)
      return;
    if (active.workbenchContract.kind === WorkbenchContractKind.Chat) return;
    active.queueFlushInFlight = true;
    let retryAfterFailure = false;
    try {
      if (active.aborted || active.isRunning) return;
      const next = this.pendingMessageQueue.takeNext(sessionId, CoworkQueueDelivery.FollowUp);
      if (!next) return;
      this.emitQueueUpdated(sessionId);
      try {
        await this.continueSession(sessionId, next.text, {
          sessionMode: CoworkSessionMode.Work,
          _queueDelivery: CoworkQueueDelivery.FollowUp,
          _streamingBehavior: 'followUp',
          imageAttachments: next.imageAttachments,
          fileAttachments: next.fileAttachments,
          skillIds: next.skillIds,
          productionLoopMode: next.productionLoopMode,
        });
        this.pendingMessageQueue.finishDelivery(next.id);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.pendingMessageQueue.restore(sessionId, { ...next, error: message });
        this.emitQueueUpdated(sessionId);
        console.error('[PiRuntime] queued follow-up failed:', error);
        retryAfterFailure = true;
      }
    } finally {
      active.queueFlushInFlight = false;
      const hasNextFollowUp = this.pendingMessageQueue.hasPendingFollowUp(sessionId);
      if (
        (retryAfterFailure || hasNextFollowUp) &&
        this.activeSessions.get(sessionId) === active &&
        !active.aborted &&
        !active.isRunning
      ) {
        void this.flushFollowUpQueue(sessionId, active);
      }
    }
  }

  getSessionConfirmationMode(sessionId: string): 'modal' | 'text' | null {
    return this.activeSessions.get(sessionId)?.confirmationMode || null;
  }

  onSessionDeleted(sessionId: string): void {
    this.stopActiveSession(sessionId, 'The session was deleted.', false);
    this.clearApprovalsBySession(sessionId);
    this.activeSessions.delete(sessionId);
    if (this.pendingMessageQueue.clear(sessionId)) this.emitQueueUpdated(sessionId);
    this.workbenchTaskService?.deleteSession(sessionId);
  }

  // ── Chat mode: direct LLM without agent loop ──

  private createPiSettingsManager(pi: PiModules, cwd: string): PiSettingsManager | null {
    if (!pi.SettingsManager) return null;
    // Cowork owns its runtime configuration. Loading Pi's user/project settings here can
    // trigger package installation or third-party extensions that differ between machines.
    return pi.SettingsManager.inMemory?.() ?? pi.SettingsManager.create(cwd, pi.getAgentDir());
  }

  private applyPiCompactionOverrides(
    settingsManager: PiSettingsManager | null,
    contextWindowTokens?: number,
  ): void {
    if (!settingsManager) return;
    const contextWindow =
      Number.isFinite(contextWindowTokens) && (contextWindowTokens ?? 0) > 0
        ? Math.floor(contextWindowTokens!)
        : 32_768;
    // Keep compaction's summary request and retained conversation inside the
    // active model window. Pi's defaults (16K reserve, 20K recent) are tuned
    // for large hosted models and can exceed a local 16K/32K model's budget.
    const reserveTokens = Math.max(2_048, Math.min(16_384, Math.floor(contextWindow * 0.25)));
    const keepRecentTokens = Math.max(2_048, Math.min(20_000, Math.floor(contextWindow * 0.5)));
    settingsManager.applyOverrides({
      compaction: {
        enabled: true,
        reserveTokens,
        keepRecentTokens,
      },
    });
  }

  private applyPiShellOverride(settingsManager: PiSettingsManager | null): void {
    if (!settingsManager || process.platform !== 'win32') return;
    const bashPath = resolveGitBashPathForPi();
    if (bashPath) {
      settingsManager.applyOverrides({ shellPath: bashPath });
    }
  }

  private async createPiResourceLoader(
    pi: PiModules,
    cwd: string,
    resourceState: PiResourceState,
    approvalContext?: {
      sessionId: string;
      getRunId: () => string | null;
      settingsManager?: PiSettingsManager | null;
      getApprovalMode: () => WorkbenchApprovalMode;
    },
    additionalExtensionFactories: PiExtensionFactory[] = [],
  ): Promise<PiResourceLoader> {
    const settingsManager =
      approvalContext?.settingsManager ?? this.createPiSettingsManager(pi, cwd);
    const resourceLoader = new pi.DefaultResourceLoader({
      cwd,
      agentDir: pi.getAgentDir(),
      ...(settingsManager ? { settingsManager } : {}),
      // ZhiYuanAgent skills come exclusively from the app-managed SKILLs dirs —
      // never from the developer's global ~/.agents/skills (which would leak
      // dev-only tooling skills like ai-sdk/shadcn into user sessions).
      noExtensions: true,
      noSkills: true,
      noPromptTemplates: true,
      noThemes: true,
      additionalSkillPaths: [...this.resolveZhiyuanSkillDirs(), ...resourceState.expertSkillDirs],
      skillsOverride: (base: {
        skills: Array<{ name?: string; id?: string }>;
        diagnostics: unknown[];
      }) =>
        resourceState.skillIds === undefined
          ? base
          : {
              ...base,
              skills: base.skills.filter(
                skill =>
                  resourceState.skillIds?.includes(skill.id || '') ||
                  resourceState.skillIds?.includes(skill.name || ''),
              ),
            },
      systemPromptOverride: (base: string | undefined): string | undefined => {
        const custom = resourceState.systemPrompt.trim();
        if (!custom) return base;
        if (!base?.trim()) return custom;
        return `${base.trim()}\n\n${custom}`;
      },
      // Pi bypasses tool promptGuidelines when systemPromptOverride is non-empty.
      // The registry is the single collection point for tool-usage policies.
      appendSystemPromptOverride: (base: string[] = []): string[] => [
        ...base,
        ...collectPiSystemPromptContributions({
          fileToolsEnabled: resourceState.fileToolsEnabled,
          maxOutputTokens: resourceState.maxOutputTokens,
          platform: process.platform,
          unattended: resourceState.unattended,
          mcpToolManifest: this.mcpServerManager?.toolManifest ?? [],
          mcpServerStatuses: this.mcpServerManager?.serverStatuses ?? [],
        }),
      ],
      extensionFactories: [
        ...(approvalContext?.getRunId()
          ? [
              (extensionApi: PiExtensionApi) => {
                extensionApi.on(PiExtensionEventType.ToolCall, async event => {
                  const runId = approvalContext.getRunId();
                  if (!runId) {
                    return {
                      block: true as const,
                      reason: 'No active workbench run is available.',
                    };
                  }
                  const toolInput =
                    event.input && typeof event.input === 'object'
                      ? (event.input as Record<string, unknown>)
                      : {};
                  const authorization = await this.workbenchTaskService?.authorizeToolCall({
                    sessionId: approvalContext.sessionId,
                    runId,
                    toolCallId: event.toolCallId,
                    toolName: event.toolName,
                    toolInput,
                    approvalMode: approvalContext.getApprovalMode(),
                  });
                  return authorization && !authorization.allow
                    ? {
                        block: true as const,
                        reason: authorization.reason || 'The action was not approved.',
                      }
                    : undefined;
                });
              },
            ]
          : []),
        (extensionApi: PiExtensionApi) => {
          extensionApi.on(PiExtensionEventType.ToolCall, event => {
            if (event.toolName !== 'bash' || !event.input || typeof event.input !== 'object') {
              return undefined;
            }
            const command = (event.input as Record<string, unknown>).command;
            if (typeof command !== 'string') return undefined;
            const reason = getPiBashCommandViolation(command);
            return reason ? { block: true as const, reason } : undefined;
          });
        },
        ...additionalExtensionFactories,
      ],
    });
    await resourceLoader.reload();
    // Pi's resource reload refreshes settings from disk, so apply the resolved
    // per-process shell override after reload and share the same manager with
    // createAgentSession. This makes bundled PortableGit usable by every Pi
    // session without changing the user's global Pi settings file.
    this.applyPiShellOverride(settingsManager);
    resourceLoader.settingsManager = settingsManager;
    return resourceLoader;
  }

  /**
   * Skill directories exposed to Pi sessions, in priority order.
   * Development: project-root SKILLs/ (via getSkillsRoot) plus userData/SKILLs
   * (may exist from a previous packaged run). Production: userData/SKILLs only
   * (getSkillsRoot already resolves there).
   */
  private resolveZhiyuanSkillDirs(): string[] {
    const dirs: string[] = [];
    const push = (dir: string): void => {
      if (!dirs.includes(dir) && fs.existsSync(dir)) dirs.push(dir);
    };
    push(getSkillsRoot());
    if (!app.isPackaged) {
      push(path.join(app.getPath('userData'), 'SKILLs'));
    }
    return dirs;
  }

  /**
   * Bundled preset skill directories for the session's selected experts.
   * File-sourced like regular skills: editing a preset SKILL.md takes effect
   * on the next session. Falls back to the imported userData copies when the
   * preset directory is not present in this build.
   */
  private resolveExpertPresetSkillDirs(expertIds: string[] | undefined): string[] {
    const dirs: string[] = [];
    if (!expertIds?.length) return dirs;
    const skillsRoot = getSkillsRoot();
    for (const expertId of expertIds) {
      const agent = this.store?.getAgent(expertId);
      const presetId = agent?.presetId?.trim();
      if (!presetId) continue;
      const dir = path.join(skillsRoot, 'zhiyuan-expert-manager', 'presets', presetId, 'skills');
      if (!dirs.includes(dir) && fs.existsSync(dir)) dirs.push(dir);
    }
    return dirs;
  }

  /**
   * Send a prompt directly to the LLM, bypassing the agent loop.
   * For Chat mode — fast response, no tool execution.
   */
  async chatDirect(prompt: string, modelId?: string): Promise<string> {
    const pi = await getPiModules();
    const resolvedModel = await resolvePiModel(pi, modelId);
    const context = buildPiBackgroundCompletionContext([
      { role: SessionMemoryCompletionRole.User, content: prompt },
    ]);
    const result = resolvedModel.modelRuntime?.completeSimple
      ? await resolvedModel.modelRuntime.completeSimple(resolvedModel.model, context)
      : await pi.completeSimple(resolvedModel.model, context, resolvedModel.requestOptions);
    return extractPiBackgroundCompletionText(result);
  }

  private createSessionMemoryCompletion(active: ActivePiSession): SessionMemoryCompletion {
    const sessionId = active.sessionId;
    const model = active.model;
    const modelRuntime = active.modelRuntime;
    const modelRequestOptions = active.modelRequestOptions;
    return messages => {
      const previous = this.pendingMemoryCompletions.get(sessionId) ?? Promise.resolve('');
      const current = previous
        .catch(() => '')
        .then(() => this.completeSessionMemory(model, modelRuntime, modelRequestOptions, messages))
        .finally(() => {
          if (this.pendingMemoryCompletions.get(sessionId) === current) {
            this.pendingMemoryCompletions.delete(sessionId);
          }
        });
      this.pendingMemoryCompletions.set(sessionId, current);
      return current;
    };
  }

  getSessionMemoryCompletion(sessionId: string): SessionMemoryCompletion | null {
    const active = this.activeSessions.get(sessionId);
    return active ? this.createSessionMemoryCompletion(active) : null;
  }

  private async runPostTurnMemoryMaintenance(
    sessionId: string,
    workingDirectory: string,
    complete: SessionMemoryCompletion,
  ): Promise<void> {
    if (this.legacyMemoryMigrationService) {
      try {
        await this.legacyMemoryMigrationService.migrateSession({
          sessionId,
          workingDirectory,
          complete,
        });
      } catch (error) {
        console.warn(`[MemoryMigration] Failed to migrate session ${sessionId}:`, error);
      }
    }
    if (this.sessionSummaryService) {
      try {
        await this.sessionSummaryService.rollup({ sessionId, workingDirectory, complete });
      } catch (error) {
        console.warn(`[SessionSummary] Failed to roll up session ${sessionId}:`, error);
      }
    }
    if (this.sessionSummaryBackfillService) {
      try {
        await this.sessionSummaryBackfillService.run(complete);
      } catch (error) {
        console.warn('[SessionSummaryBackfill] Failed to run semantic backfill:', error);
      }
    }
  }

  private async completeSessionMemory(
    model: Record<string, unknown>,
    modelRuntime: PiModelRuntime | null,
    modelRequestOptions: { apiKey?: string } | undefined,
    messages: readonly SessionMemoryCompletionMessage[],
  ): Promise<string> {
    const pi = await getPiModules();
    const context = buildPiBackgroundCompletionContext(messages);
    const result = modelRuntime?.completeSimple
      ? await modelRuntime.completeSimple(model, context)
      : await pi.completeSimple(model, context, modelRequestOptions);
    return extractPiBackgroundCompletionText(result);
  }

  // ── Private: event mapping ──

  private handlePiEvent(sessionId: string, active: ActivePiSession, event: PiEvent): void {
    // Debug: log all Pi events to diagnose frontend rendering issues
    if (event.type !== 'message_update') {
      console.log(
        '[PiRuntime] Event:',
        event.type,
        event.message?.role ? `role=${event.message.role}` : '',
        event.message?.stopReason ? `stopReason=${event.message.stopReason}` : '',
      );
    }
    switch (event.type) {
      case 'agent_start':
        active.isRunning = true;
        break;

      case 'turn_start':
        active.isRunning = true;
        active.toolStartedAtByCallId.clear();
        active.preparingToolCallIdByContentIndex.clear();
        {
          const clearActivity = active.toolActivityTracker.clear();
          if (clearActivity) this.emit('toolActivity', sessionId, clearActivity);
        }
        // New turn → fresh answer + thinking messages, created lazily on first content.
        active.assistantMessageId = null;
        active.thinkingMessageId = null;
        active.answerText = '';
        active.thinkingText = '';
        active.streamAccumulator.reset();
        active.thinkingLifecycle.reset();
        break;

      case 'message_start':
        active.requestStartedAt = Date.now();
        active.firstVisibleTextAt = null;
        break;

      case 'message_update': {
        const assistantEvent = event.assistantMessageEvent;
        if (assistantEvent?.type.startsWith('toolcall_')) {
          const contentIndex = assistantEvent.contentIndex ?? -1;
          const fallbackToolCallId =
            active.preparingToolCallIdByContentIndex.get(contentIndex) ??
            `pi-preparing:${event.message?.id ?? sessionId}:${contentIndex}`;
          const activity = getPiPreparingToolActivity(assistantEvent, fallbackToolCallId);
          if (activity) {
            const previousToolCallId = active.preparingToolCallIdByContentIndex.get(contentIndex);
            if (previousToolCallId && previousToolCallId !== activity.toolCallId) {
              const removeEvent = active.toolActivityTracker.remove(previousToolCallId);
              if (removeEvent) this.emit('toolActivity', sessionId, removeEvent);
            }
            active.preparingToolCallIdByContentIndex.set(contentIndex, activity.toolCallId);
            const activityEvent = active.toolActivityTracker.upsert(activity);
            if (activityEvent) this.emit('toolActivity', sessionId, activityEvent);
          }
        }
        // Pi 0.84 emits fine-grained assistantMessageEvent deltas. Keep support
        // for older cumulative snapshots, then reconcile against message_end.
        const { text, thinking } = active.streamAccumulator.update(
          event.assistantMessageEvent,
          event.message,
        );
        const segmentEventType = event.assistantMessageEvent?.type;
        const thinkingEnded = segmentEventType === PiAssistantEventType.ThinkingEnd;
        if (segmentEventType === PiAssistantEventType.ThinkingDelta) {
          active.thinkingLifecycle.start();
        } else if (thinkingEnded) {
          active.thinkingLifecycle.finish();
        }
        if (thinking && thinking !== active.thinkingText) {
          active.thinkingText = thinking;
          if (!thinkingEnded) active.thinkingLifecycle.start();
          this.streamInto(sessionId, active, 'thinking', thinking);
        }
        if (thinkingEnded) {
          this.finalizeActiveThinking(sessionId, active);
        }
        if (text && text !== active.answerText) {
          active.firstVisibleTextAt ??= Date.now();
          this.finalizeActiveThinking(sessionId, active);
          active.answerText = text;
          this.streamInto(sessionId, active, 'answer', text);
        }
        break;
      }

      case 'message_end': {
        if (event.message?.role === 'assistant') {
          active.writeTokenLimitRecovery.queueIfNeeded(event.message, active.piSession);
          if (event.message.stopReason === 'error') {
            const { text, thinking } = active.streamAccumulator.reconcile(event.message);
            if (thinking && thinking !== active.thinkingText) {
              active.thinkingText = thinking;
              active.thinkingLifecycle.markContentStreaming();
            }
            if (text) {
              active.answerText = text;
              active.firstVisibleTextAt ??= Date.now();
            }
            this.finalizeActiveThinking(sessionId, active);
            const errMsg = event.message.errorMessage || 'Pi agent error';
            const errDetail = event.message.content
              ? typeof event.message.content === 'string'
                ? event.message.content
                : JSON.stringify(event.message.content)
              : '(no content)';
            console.error('[PiRuntime] Assistant error:', errMsg, 'detail:', errDetail);
            // Defer surfacing: Pi may auto-retry this turn (auto_retry_start).
            // Persisting/emitting here would produce one error bubble per failed
            // attempt — flushPendingError surfaces the error exactly once when
            // the run settles (auto_retry_end / agent_settled).
            active.pendingError = { message: errMsg, classified: classifyCoworkError(errMsg) };
            active.turnFailed = true;
            return;
          }

          // A successful assistant message after failed attempts means the retry
          // recovered — drop the deferred error so it is never surfaced.
          active.pendingError = null;
          active.turnFailed = false;

          const { text, thinking } = active.streamAccumulator.reconcile(event.message);
          const finalThinking = thinking || active.thinkingText;
          const finalAnswer = text || active.answerText;

          // Finalize thinking bubble (if any) on its own id.
          if (finalThinking.trim()) {
            if (finalThinking !== active.thinkingText) {
              active.thinkingLifecycle.markContentStreaming();
            }
            active.thinkingText = finalThinking;
            this.finalizeActiveThinking(sessionId, active);
          }
          // Finalize the answer bubble on its own id.
          if (finalAnswer.trim()) {
            active.answerText = finalAnswer;
            this.finalizeMessage(sessionId, active, 'answer', finalAnswer);
            active.lastCompletedAnswerMessageId = active.assistantMessageId;
            active.lastCompletedAnswerText = finalAnswer;
            this.scheduleContextUsageSync(
              sessionId,
              active.assistantMessageId,
              event.message.usage,
              event.message.model,
              active.requestStartedAt,
              active.firstVisibleTextAt,
            );
          }

          // Turn's segments are done; next turn starts fresh messages.
          active.assistantMessageId = null;
          active.thinkingMessageId = null;
          active.answerText = '';
          active.thinkingText = '';
          active.streamAccumulator.reset();
        }
        break;
      }

      case 'turn_end':
        break;

      case 'tool_execution_start': {
        // Agent invoked a tool → emit a tool_use message so the UI renders the tool card.
        // Preserve the shared tool_use message shape.
        if (!event.toolCallId || !event.toolName) break;
        const runningActivity = active.toolActivityTracker.upsert(
          {
            toolCallId: event.toolCallId,
            toolName: event.toolName,
            toolInput: toToolActivityInput(event.args),
          },
          CoworkToolActivityPhase.Running,
        );
        active.toolStartedAtByCallId.set(event.toolCallId, Date.now());
        if (runningActivity) this.emit('toolActivity', sessionId, runningActivity);
        if (event.toolName === PiSubagentToolName) {
          active.productionLoop?.recordSubagentStart(event.toolCallId, event.args);
          active.researchRun?.recordSubagentStart(event.toolCallId, event.args);
          active.shortcutWorkflow?.recordSubagentStart(event.toolCallId, event.args);
        }
        const toolUseMsg: CoworkMessage = {
          id: randomUUID(),
          type: 'tool_use',
          content: `Using tool: ${event.toolName}`,
          timestamp: Date.now(),
          metadata: {
            toolName: event.toolName,
            toolInput: toToolInputRecord(event.args),
            toolUseId: event.toolCallId,
          },
        };
        // Emit the persisted message (store assigns its own id) to keep the
        // rendered id and DB id in sync — see message_end note.
        const emittedToolUse = this.store
          ? this.store.addMessage(sessionId, toolUseMsg)
          : toolUseMsg;
        this.emit('message', sessionId, emittedToolUse);
        break;
      }

      case 'tool_execution_end': {
        // Tool finished → emit tool_result linked by toolUseId.
        if (!event.toolCallId) break;
        const removeActivity = active.toolActivityTracker.remove(event.toolCallId);
        if (removeActivity) this.emit('toolActivity', sessionId, removeActivity);
        // Avoid duplicate result for the same call.
        if (active.toolResultMessageIdByCallId.has(event.toolCallId)) break;
        const resultText = extractToolResultText(event.result);
        if (active.workbenchRunId) {
          this.workbenchTaskService?.recordToolResult(
            active.workbenchRunId,
            event.toolCallId,
            event.result,
            Boolean(event.isError),
          );
        }
        if (event.toolName) {
          active.productionLoop?.recordToolResult(
            event.toolCallId,
            event.toolName,
            resultText,
            Boolean(event.isError),
          );
        }
        if (event.toolName === PiSubagentToolName) {
          const execution = extractPiSubagentExecutionMetadata(event.result);
          active.productionLoop?.recordSubagentResult(
            event.toolCallId,
            resultText,
            Boolean(event.isError),
            execution,
          );
          active.researchRun?.recordSubagentResult(
            event.toolCallId,
            resultText,
            Boolean(event.isError),
          );
          active.shortcutWorkflow?.recordSubagentResult(
            event.toolCallId,
            resultText,
            Boolean(event.isError),
          );
        }
        const toolResultMsg: CoworkMessage = {
          id: randomUUID(),
          type: 'tool_result',
          content: resultText,
          timestamp: Date.now(),
          metadata: {
            toolResult: resultText,
            toolUseId: event.toolCallId,
            isError: Boolean(event.isError),
            isStreaming: false,
            isFinal: true,
            ...(active.toolStartedAtByCallId.has(event.toolCallId)
              ? {
                  metrics: {
                    toolDurationMs: Math.max(
                      0,
                      Date.now() -
                        (active.toolStartedAtByCallId.get(event.toolCallId) ?? Date.now()),
                    ),
                  },
                }
              : {}),
          },
        };
        active.toolStartedAtByCallId.delete(event.toolCallId);
        const emittedToolResult = this.store
          ? this.store.addMessage(sessionId, toolResultMsg)
          : toolResultMsg;
        active.toolResultMessageIdByCallId.set(event.toolCallId, emittedToolResult.id);
        this.emit('message', sessionId, emittedToolResult);
        break;
      }

      case 'tool_execution_update':
        // Streaming partial tool output — ignored for now (final result emitted on _end).
        // Kept as an explicit no-op so it doesn't fall to the "Unhandled" default log.
        break;

      case 'agent_end': {
        this.finalizeActiveThinking(sessionId, active);
        active.toolStartedAtByCallId.clear();
        const clearActivity = active.toolActivityTracker.clear();
        if (clearActivity) this.emit('toolActivity', sessionId, clearActivity);
        // Failed attempt (deferred error pending): do not continue the agent
        // loop, mark completed, or emit complete. flushPendingError surfaces
        // the error when the run settles (auto_retry_end / agent_settled).
        if (active.pendingError) break;
        if (
          active.workbenchRunId &&
          this.workbenchTaskService &&
          !this.workbenchTaskService.isRunRunning(active.workbenchRunId)
        ) {
          this.stopActiveSession(
            sessionId,
            'The workbench run is no longer active.',
            false,
            CoworkInterruptionCause.RuntimePaused,
          );
          break;
        }
        // Agent loop: when the finished iteration signaled "next", continue
        // the session with the next iteration prompt instead of completing.
        const loopDecision = active.agentLoop.handleAgentEnd();
        if (loopDecision.shouldContinue && loopDecision.nextPrompt) {
          if (
            active.productionLoop &&
            active.productionLoop.getStaleCount() >= MAX_STALE_PRODUCTION_ITERATIONS
          ) {
            this.stopActiveSession(
              sessionId,
              `Production workflow made no progress for ${MAX_STALE_PRODUCTION_ITERATIONS} consecutive iterations.`,
              false,
              CoworkInterruptionCause.RuntimePaused,
            );
            break;
          }
          // Reset turn state (same as continueSession).
          active.answerText = '';
          active.thinkingText = '';
          active.assistantMessageId = null;
          active.thinkingMessageId = null;
          active.thinkingLifecycle.reset();
          active.lastCompletedAnswerMessageId = null;
          active.lastCompletedAnswerText = '';
          active.toolResultMessageIdByCallId.clear();
          active.toolStartedAtByCallId.clear();
          active.piSession
            .prompt(loopDecision.nextPrompt, { streamingBehavior: 'followUp' })
            .catch(error => {
              const message = error instanceof Error ? error.message : String(error);
              this.emit('error', sessionId, classifyCoworkError(message));
            });
          break;
        }
        this.markFinalAnswer(sessionId, active);
        active.isRunning = false;
        // Pi versions differ in whether they emit agent_settled after agent_end.
        // Drain queued Work follow-ups here so completion never leaves them stuck.
        if (
          active.workbenchContract.kind !== WorkbenchContractKind.Chat &&
          this.pendingMessageQueue.hasPendingFollowUp(sessionId)
        ) {
          void this.flushFollowUpQueue(sessionId, active);
          break;
        }
        if (this.store) {
          this.store.updateSession(sessionId, { status: 'idle' });
          try {
            this.store.refreshSessionArtifacts(sessionId);
          } catch (error) {
            console.error(
              `[PiRuntimeAdapter] Failed to refresh artifacts for session ${sessionId}:`,
              error,
            );
          }
        }
        if (active.workbenchRunId && this.workbenchTaskService) {
          const domainWorkflowSnapshot = active.researchRun
            ? active.researchRun.getSnapshot()
            : active.shortcutWorkflow
              ? active.shortcutWorkflow.getSnapshot()
              : null;
          const workflowSnapshot = composeWorkbenchWorkflowSnapshot({
            production:
              active.productionControlsAvailable && active.productionLoop
                ? active.productionLoop.getSnapshot()
                : null,
            domain: domainWorkflowSnapshot,
          });
          // Deliver-phase artifacts are preserved regardless of review
          // outcome: a reviewer pass marks them Verified, a lightweight skip
          // leaves them Pending so user acceptance can elevate them
          // (markArtifactsVerified on accept).
          const deliveryArtifacts = active.productionLoop?.getDeliveryArtifacts().map(artifact => ({
            path: artifact.reference,
            kind: artifact.kind,
            role: artifact.kind,
            source: WorkbenchArtifactCandidateSource.ProductionInspection,
            verificationStatus: active.productionLoop?.getReviewOutcome().skipped
              ? WorkbenchArtifactVerificationStatus.Pending
              : WorkbenchArtifactVerificationStatus.Verified,
          }));
          this.workbenchTaskService.completeRun({
            sessionId,
            runId: active.workbenchRunId,
            workspaceRoot: active.workspaceRoot,
            finalAnswer: active.lastCompletedAnswerText,
            finalMessageId: active.lastCompletedAnswerMessageId,
            workflowCompleted: active.productionControlsAvailable
              ? active.agentLoop.getState().done
              : undefined,
            workflowSnapshot,
            artifactCandidates: deliveryArtifacts,
          });
        }
        void this.runPostTurnMemoryMaintenance(
          sessionId,
          active.workspaceRoot,
          this.createSessionMemoryCompletion(active),
        );
        this.emit('complete', sessionId, null);
        break;
      }

      case 'auto_retry_start':
        // Pi is retrying after an error — silently wait
        break;

      case 'auto_retry_end':
        // Pi reports both recovered retries and final exhaustion here.
        if (event.success === true) {
          active.pendingError = null;
          active.turnFailed = false;
          break;
        }
        if (event.finalError) {
          active.pendingError = {
            message: event.finalError,
            classified: classifyCoworkError(event.finalError),
          };
        }
        this.flushPendingError(sessionId, active);
        break;

      case 'agent_settled':
        // Run settled (covers non-retryable errors with no auto-retry) —
        // surface the deferred error, if any. Idempotent after auto_retry_end.
        active.isRunning = false;
        this.flushPendingError(sessionId, active);
        void this.flushFollowUpQueue(sessionId, active);
        break;

      default:
        // Silently ignore unknown/internal events
        if (event.type && !event.type.startsWith('_')) {
          console.log('[PiRuntime] Unhandled event type:', event.type);
        }
    }
  }

  // ── Private: deferred error handling ──

  /**
   * Persist and emit a deferred turn error exactly once.
   *
   * message_end(stopReason=error) only records the error on the session because
   * Pi may auto-retry the turn; this flush runs on auto_retry_end / agent_settled,
   * when the run has genuinely failed. Idempotent — a second call is a no-op.
   */
  private flushPendingError(sessionId: string, active: ActivePiSession): void {
    const pending = active.pendingError;
    if (!pending) return;
    active.pendingError = null;
    active.turnFailed = true;
    active.isRunning = false;
    if (active.answerText.trim()) {
      this.finalizeMessage(sessionId, active, 'answer', active.answerText);
      active.assistantMessageId = null;
      active.answerText = '';
    }
    this.workbenchTaskService?.failRun?.(sessionId, { message: pending.message });
    // Persist a system error message so the error survives session switching
    // and is visible in the message list. The classified kind lets the renderer
    // translate it into a user-friendly i18n message; the raw message is kept
    // for console diagnostics only.
    const errorMessageSeed: CoworkMessage = {
      id: randomUUID(),
      type: 'system',
      content: '',
      timestamp: Date.now(),
      metadata: { error: pending.message, errorKind: pending.classified.kind },
    };
    let errorMessage = errorMessageSeed;
    if (this.store) {
      this.store.updateSession(sessionId, { status: 'error' });
      errorMessage = this.store.addMessage(sessionId, errorMessageSeed);
    }
    this.emit('message', sessionId, errorMessage);
    this.emit('error', sessionId, pending.classified);
  }

  // ── Private: assistant message lifecycle ──

  /**
   * Lazily create the answer or thinking message for the current turn, returning its id.
   *
   * The message is persisted via store.addMessage() (which assigns its own id) and the
   * initial 'message' event is emitted ONCE, so the rendered bubble and the DB row share
   * the same id. Streaming updates and the final content go out as 'messageUpdate' on this
   * same id — never a second 'message' event — which prevents the duplicate-render bug.
   *
   * Thinking messages carry metadata.isThinking so the frontend renders them as a
   * ThinkingBlock instead of a normal answer bubble.
   */
  private ensureMessage(
    sessionId: string,
    active: ActivePiSession,
    kind: 'answer' | 'thinking',
    initialContent: string,
  ): string {
    const existing = kind === 'thinking' ? active.thinkingMessageId : active.assistantMessageId;
    if (existing) return existing;

    const seed: CoworkMessage = {
      id: randomUUID(),
      type: 'assistant',
      content: initialContent,
      timestamp: Date.now(),
      metadata:
        kind === 'thinking'
          ? { isStreaming: true, isFinal: false, isThinking: true }
          : {
              isStreaming: true,
              isFinal: false,
              ...(active.turnExperts.length ? { experts: active.turnExperts } : {}),
            },
    };
    if (kind === 'thinking') {
      active.thinkingLifecycle.start(seed.timestamp);
    }
    const created = this.store ? this.store.addMessage(sessionId, seed) : seed;
    if (kind === 'thinking') active.thinkingMessageId = created.id;
    else active.assistantMessageId = created.id;
    this.emit('message', sessionId, created);
    return created.id;
  }

  /** Push a streaming (non-final) content snapshot to the answer/thinking message. */
  private streamInto(
    sessionId: string,
    active: ActivePiSession,
    kind: 'answer' | 'thinking',
    content: string,
  ): void {
    const messageId = this.ensureMessage(sessionId, active, kind, content);
    const metadata =
      kind === 'thinking'
        ? { isStreaming: true, isFinal: false, isThinking: true }
        : {
            isStreaming: true,
            isFinal: false,
            ...(active.turnExperts.length ? { experts: active.turnExperts } : {}),
          };
    if (kind === 'thinking') {
      active.thinkingLifecycle.markContentStreaming();
    }
    // Throttle the synchronous SQLite write separately from the IPC emit so a
    // fast Pi stream doesn't block the main-process event loop every frame.
    this.throttledStoreUpdate(sessionId, messageId, content, metadata);
    this.throttledEmitMessageUpdate(sessionId, messageId, content, metadata);
  }

  /** Finalize the answer/thinking message: flush throttles, mark final, emit last update. */
  private finalizeMessage(
    sessionId: string,
    active: ActivePiSession,
    kind: 'answer' | 'thinking',
    content: string,
  ): void {
    const messageId = this.ensureMessage(sessionId, active, kind, content);
    this.clearPendingMessageUpdate(messageId);
    this.clearPendingStoreUpdate(messageId);
    const thinkingDurationMs = kind === 'thinking' ? active.thinkingLifecycle.finish() : undefined;
    const metadata =
      kind === 'thinking'
        ? {
            isStreaming: false,
            isFinal: true,
            isThinking: true,
            ...(thinkingDurationMs !== undefined && { thinkingDurationMs }),
          }
        : {
            isStreaming: false,
            isFinal: true,
            ...(active.turnExperts.length ? { experts: active.turnExperts } : {}),
          };
    if (this.store) {
      this.store.updateMessage(sessionId, messageId, { content, metadata });
    }
    this.emit('messageUpdate', sessionId, messageId, content, metadata);
    if (kind === 'thinking') {
      active.thinkingLifecycle.markMessageFinalized();
    }
  }

  private finalizeActiveThinking(sessionId: string, active: ActivePiSession): void {
    if (!active.thinkingText.trim() || active.thinkingLifecycle.isMessageFinalized) return;
    this.finalizeMessage(sessionId, active, 'thinking', active.thinkingText);
  }

  private markFinalAnswer(sessionId: string, active: ActivePiSession): void {
    const messageId = active.lastCompletedAnswerMessageId;
    const content = active.lastCompletedAnswerText;
    if (!messageId || !content.trim()) return;

    const metadata = {
      isStreaming: false,
      isFinal: true,
      isFinalAnswer: true,
      ...(active.turnExperts.length ? { experts: active.turnExperts } : {}),
    };
    if (this.store) {
      const message = this.store
        .getSession(sessionId)
        ?.messages.find(candidate => candidate.id === messageId);
      this.store.updateMessage(sessionId, messageId, {
        content,
        metadata: { ...message?.metadata, ...metadata },
      });
    }
    this.emit('messageUpdate', sessionId, messageId, content, metadata);
  }

  /**
   * Pi commits usage after emitting the terminal assistant event. Deferring one
   * task ensures the snapshot corresponds to the response just persisted.
   */
  private scheduleContextUsageSync(
    sessionId: string,
    messageId: string | null,
    piUsage: PiUsage | undefined,
    model: string | undefined,
    requestStartedAt: number | null,
    firstVisibleTextAt: number | null,
  ): void {
    if (!messageId) return;
    setTimeout(() => {
      const active = this.activeSessions.get(sessionId);
      const contextUsage = active?.piSession.getContextUsage?.();
      if (
        !contextUsage ||
        contextUsage.tokens == null ||
        !Number.isFinite(contextUsage.tokens) ||
        !Number.isFinite(contextUsage.contextWindow) ||
        contextUsage.tokens < 0 ||
        contextUsage.contextWindow <= 0
      ) {
        return;
      }

      const usage = {
        usedTokens: Math.round(contextUsage.tokens),
        contextWindowTokens: Math.round(contextUsage.contextWindow),
        updatedAt: Date.now(),
      };
      const message = this.store
        ?.getSession(sessionId)
        ?.messages.find(item => item.id === messageId);
      if (!message) return;
      const metadata = {
        ...message?.metadata,
        contextUsage: usage,
        ...(model ? { model } : {}),
        ...(requestStartedAt !== null
          ? {
              metrics: {
                requestStartedAt,
                ...(firstVisibleTextAt !== null ? { firstVisibleTextAt } : {}),
                completedAt: Date.now(),
              },
            }
          : {}),
        ...(piUsage
          ? {
              usage: {
                inputTokens: piUsage.input,
                outputTokens: piUsage.output,
                cacheReadTokens: piUsage.cacheRead,
                cacheWriteTokens: piUsage.cacheWrite,
                reasoningTokens: piUsage.reasoning,
                totalTokens: piUsage.totalTokens,
              },
            }
          : {}),
      };
      this.store?.updateMessage(sessionId, messageId, { metadata });
      this.emit('messageUpdate', sessionId, messageId, message.content, metadata);
    }, 0);
  }

  // ── Private: throttling ──

  private throttledEmitMessageUpdate(
    sessionId: string,
    messageId: string,
    content: string,
    metadata?: Record<string, unknown>,
  ): void {
    const now = Date.now();
    const lastEmit = this.lastMessageUpdateEmitTime.get(messageId) ?? 0;
    const elapsed = now - lastEmit;

    if (elapsed >= MESSAGE_UPDATE_THROTTLE_MS) {
      this.clearPendingMessageUpdate(messageId);
      this.lastMessageUpdateEmitTime.set(messageId, now);
      this.emit('messageUpdate', sessionId, messageId, content, metadata);
      return;
    }

    // Within the throttle window: record the latest content and arm a single
    // trailing emit at the window's end. Do NOT re-arm on every frame, or a
    // continuous fast stream keeps pushing the deadline back and the UI freezes
    // until the stream pauses ("burst-freeze" jank).
    this.pendingMessageUpdate.set(messageId, { content, metadata });
    if (!this.pendingMessageUpdateTimer.has(messageId)) {
      this.pendingMessageUpdateTimer.set(
        messageId,
        setTimeout(() => {
          this.pendingMessageUpdateTimer.delete(messageId);
          const pending = this.pendingMessageUpdate.get(messageId);
          this.pendingMessageUpdate.delete(messageId);
          this.lastMessageUpdateEmitTime.set(messageId, Date.now());
          if (pending) {
            this.emit('messageUpdate', sessionId, messageId, pending.content, pending.metadata);
          }
        }, MESSAGE_UPDATE_THROTTLE_MS - elapsed),
      );
    }
  }

  private clearPendingMessageUpdate(messageId: string): void {
    const timer = this.pendingMessageUpdateTimer.get(messageId);
    if (timer) {
      clearTimeout(timer);
      this.pendingMessageUpdateTimer.delete(messageId);
    }
    this.pendingMessageUpdate.delete(messageId);
  }

  /**
   * Throttle synchronous SQLite writes. Leading write fires immediately; further
   * writes within the window are coalesced into a single trailing write that
   * persists the latest content. Prevents per-frame event-loop stalls.
   */
  private throttledStoreUpdate(
    sessionId: string,
    messageId: string,
    content: string,
    metadata: Record<string, unknown>,
  ): void {
    if (!this.store) return;
    const now = Date.now();
    const lastWrite = this.lastStoreUpdateTime.get(messageId) ?? 0;
    const elapsed = now - lastWrite;

    if (elapsed >= STORE_UPDATE_THROTTLE_MS) {
      this.clearPendingStoreUpdate(messageId);
      this.lastStoreUpdateTime.set(messageId, now);
      this.store.updateMessage(sessionId, messageId, { content, metadata });
      return;
    }

    // Coalesce: remember the latest content and (re)arm a single trailing write.
    this.pendingStoreUpdate.set(messageId, { content, metadata });
    if (!this.pendingStoreUpdateTimer.has(messageId)) {
      this.pendingStoreUpdateTimer.set(
        messageId,
        setTimeout(() => {
          this.pendingStoreUpdateTimer.delete(messageId);
          const pending = this.pendingStoreUpdate.get(messageId);
          this.pendingStoreUpdate.delete(messageId);
          this.lastStoreUpdateTime.set(messageId, Date.now());
          if (pending && this.store) {
            this.store.updateMessage(sessionId, messageId, pending);
          }
        }, STORE_UPDATE_THROTTLE_MS - elapsed),
      );
    }
  }

  private clearPendingStoreUpdate(messageId: string): void {
    const timer = this.pendingStoreUpdateTimer.get(messageId);
    if (timer) {
      clearTimeout(timer);
      this.pendingStoreUpdateTimer.delete(messageId);
    }
    this.pendingStoreUpdate.delete(messageId);
  }

  private clearThrottleStateBySession(_sessionId: string): void {
    // Clean up any pending timers for this session's messages.
    // We iterate all timers since we don't track session→messageId mapping.
    for (const [messageId, timer] of this.pendingMessageUpdateTimer) {
      clearTimeout(timer);
      this.pendingMessageUpdateTimer.delete(messageId);
      this.lastMessageUpdateEmitTime.delete(messageId);
    }
    for (const [messageId, timer] of this.pendingStoreUpdateTimer) {
      clearTimeout(timer);
      this.pendingStoreUpdateTimer.delete(messageId);
      this.pendingStoreUpdate.delete(messageId);
      this.lastStoreUpdateTime.delete(messageId);
    }
  }

  private clearApprovalsBySession(sessionId: string): void {
    for (const [requestId, sid] of this.approvalSessionMap.entries()) {
      if (sid !== sessionId) continue;
      this.approvalSessionMap.delete(requestId);
      this.emit('permissionDismiss', requestId);
    }
  }

  private requestAskUserQuestion(
    sessionId: string,
    toolCallId: string,
    input: PiAskUserQuestionInput,
    signal?: AbortSignal,
  ): Promise<PiAskUserQuestionResponse> {
    if (signal?.aborted) {
      return Promise.resolve({ behavior: 'deny', message: 'The request was cancelled.' });
    }

    const requestId = randomUUID();
    return new Promise(resolve => {
      const timer = setTimeout(() => {
        this.finishAskUserQuestion(requestId, {
          behavior: 'deny',
          message: 'The question timed out without a response.',
        });
      }, PiAskUserQuestionTimeoutMs);

      const onAbort = () => {
        this.finishAskUserQuestion(requestId, {
          behavior: 'deny',
          message: 'The request was cancelled.',
        });
      };
      signal?.addEventListener('abort', onAbort, { once: true });

      this.pendingAskUserQuestions.set(requestId, {
        sessionId,
        resolve,
        timer,
        removeAbortListener: () => signal?.removeEventListener('abort', onAbort),
      });

      try {
        this.emit('permissionRequest', sessionId, {
          requestId,
          toolName: PiAskUserQuestionToolName,
          toolInput: input as unknown as Record<string, unknown>,
          toolUseId: toolCallId,
        });
      } catch (error) {
        console.error('[PiRuntime] failed to emit AskUserQuestion request:', error);
        this.finishAskUserQuestion(requestId, {
          behavior: 'deny',
          message: 'Unable to show the question to the user.',
        });
      }
    });
  }

  private finishAskUserQuestion(requestId: string, response: PiAskUserQuestionResponse): void {
    const pending = this.pendingAskUserQuestions.get(requestId);
    if (!pending) return;
    this.pendingAskUserQuestions.delete(requestId);
    clearTimeout(pending.timer);
    pending.removeAbortListener?.();
    pending.resolve(response);
    this.emit('permissionDismiss', requestId);
  }

  private dismissAskUserQuestionsBySession(sessionId: string): void {
    for (const [requestId, pending] of this.pendingAskUserQuestions.entries()) {
      if (pending.sessionId === sessionId) {
        this.finishAskUserQuestion(requestId, {
          behavior: 'deny',
          message: 'The session was stopped.',
        });
      }
    }
  }

  // ── Skills & MCP integration ──

  /**
   * Build a single MCP proxy tool (pi-mcp-adapter pattern) instead of
   * registering every MCP tool as an individual customTool.
   *
   * One proxy tool costs ~200 system-prompt tokens regardless of how many
   * MCP servers/tools are configured, vs N × ~200 tokens for per-tool
   * registration. Uses ZhiYuanAgent's McpServerManager for tool execution
   * rather than creating duplicate MCP connections.
   */
  private buildMcpProxyTool(): Record<string, unknown> | null {
    if (!this.mcpServerManager) return null;
    if (
      this.mcpServerManager.toolManifest.length === 0 &&
      this.mcpServerManager.serverStatuses.length === 0
    ) {
      return null;
    }

    const mgr = this.mcpServerManager;
    const getManifest = () => mgr.toolManifest;

    const buildStatusLine = (): string => {
      const manifest = this.mcpServerManager?.toolManifest ?? [];
      const statuses = this.mcpServerManager?.serverStatuses ?? [];
      const connectedCount = statuses.filter(status => status.connected).length;
      const summary = `MCP — ${statuses.length} configured server(s), ${connectedCount} connected, ${manifest.length} tool(s)`;
      if (statuses.length === 0) return summary;
      return [
        summary,
        ...statuses.map(status => {
          const state = status.connected ? 'connected' : 'unavailable';
          const error = status.error ? ` — ${status.error}` : '';
          return `  ${status.name}: ${state}, ${status.toolCount} tool(s)${error}`;
        }),
      ].join('\n');
    };

    return {
      name: PiMcpTool.Name,
      label: PiMcpTool.Label,
      description:
        'MCP gateway — call MCP tools, search, or describe. ' +
        'Use {tool, args} to invoke. Use {search} to find tools by name/description. ' +
        'Use {describe} for parameter schemas. Use {server} to list tools on a server. ' +
        'Use {} for status overview.',
      promptSnippet: 'MCP gateway — call MCP tools (use search to discover, tool+args to invoke)',
      parameters: {
        type: 'object',
        properties: {
          tool: { type: 'string', description: 'Tool name to call (e.g. "read_file")' },
          args: {
            type: 'string',
            description: 'Arguments as JSON string (e.g. {"path":"/tmp/x"})',
          },
          server: {
            type: 'string',
            description: 'Filter to a specific server, or disambiguate tool calls',
          },
          search: {
            type: 'string',
            description: 'Search tools by name or description (substring match)',
          },
          describe: {
            type: 'string',
            description: 'Tool name to describe — returns parameter schema',
          },
        },
        additionalProperties: false,
      },
      execute: async (_toolCallId: string, params: Record<string, unknown>) => {
        // Pi SDK calls execute(toolCallId, params, signal, onUpdate, ctx).
        // params is the validated parameter object (2nd arg, not 1st).
        // MUST return AgentToolResult { content, details } — NOT a JSON string.
        // Returning a string causes createToolResultMessage() to set
        // content = undefined, which breaks the next LLM turn with
        // "content is not iterable". See agent-loop.ts createToolResultMessage.
        try {
          const manifest = getManifest();
          const toolIndex = manifest.map(e => ({
            server: e.server,
            name: e.name,
            description: e.description,
          }));
          const tool = typeof params.tool === 'string' ? params.tool : undefined;
          const argsStr = typeof params.args === 'string' ? params.args : undefined;
          const server = typeof params.server === 'string' ? params.server : undefined;
          const search = typeof params.search === 'string' ? params.search : undefined;
          const describe = typeof params.describe === 'string' ? params.describe : undefined;

          // ── tool + args: invoke an MCP tool ──
          if (tool) {
            let parsedArgs: Record<string, unknown> | undefined;
            if (argsStr) {
              try {
                parsedArgs = JSON.parse(argsStr);
                if (!parsedArgs || typeof parsedArgs !== 'object' || Array.isArray(parsedArgs)) {
                  return {
                    content: [
                      { type: 'text', text: 'args must be a JSON object, e.g. {"key":"value"}' },
                    ],
                    details: {},
                  };
                }
              } catch {
                return {
                  content: [{ type: 'text', text: `Invalid args JSON: ${argsStr}` }],
                  details: {},
                };
              }
            }
            let resolvedServer: string | undefined = server;
            if (!resolvedServer) {
              const candidates = manifest.filter(e => e.name === tool);
              if (candidates.length === 0) {
                return {
                  content: [
                    {
                      type: 'text',
                      text: `Tool "${tool}" not found. Use mcp({ search: "..." }) to discover tools.`,
                    },
                  ],
                  details: {},
                };
              }
              if (candidates.length > 1) {
                return {
                  content: [
                    {
                      type: 'text',
                      text: `Tool "${tool}" exists on multiple servers: ${candidates.map(c => c.server).join(', ')}. Use {server} to disambiguate.`,
                    },
                  ],
                  details: {},
                };
              }
              resolvedServer = candidates[0].server;
            }
            const result = await mgr.callTool(resolvedServer, tool, parsedArgs ?? {});
            return { content: result.content, details: { isError: result.isError } };
          }

          // ── search: find tools by substring match ──
          if (search) {
            const q = search.toLowerCase();
            const matches = toolIndex.filter(
              t => t.name.toLowerCase().includes(q) || t.description.toLowerCase().includes(q),
            );
            if (matches.length === 0) {
              return {
                content: [{ type: 'text', text: `No tools matching "${search}".` }],
                details: {},
              };
            }
            return {
              content: [
                {
                  type: 'text',
                  text:
                    matches
                      .slice(0, 30)
                      .map(t => `[${t.server}] ${t.name}: ${t.description}`)
                      .join('\n') +
                    (matches.length > 30 ? `\n... and ${matches.length - 30} more` : ''),
                },
              ],
              details: {},
            };
          }

          // ── describe: show tool parameter schema ──
          if (describe) {
            const match = manifest.find(e => e.name === describe);
            if (!match) {
              return {
                content: [{ type: 'text', text: `Tool "${describe}" not found.` }],
                details: {},
              };
            }
            return {
              content: [
                {
                  type: 'text',
                  text: `[${match.server}] ${match.name}\n${match.description}\nParameters: ${JSON.stringify(match.inputSchema, null, 2)}`,
                },
              ],
              details: {},
            };
          }

          // ── server: list tools on a specific server ──
          if (server) {
            const serverTools = manifest.filter(e => e.server === server);
            if (serverTools.length === 0) {
              return {
                content: [{ type: 'text', text: `Server "${server}" not found or has no tools.` }],
                details: {},
              };
            }
            return {
              content: [
                {
                  type: 'text',
                  text: `${server} (${serverTools.length} tools):\n${serverTools.map(t => `  ${t.name}: ${t.description}`).join('\n')}`,
                },
              ],
              details: {},
            };
          }

          // ── default: status overview ──
          return {
            content: [{ type: 'text', text: buildStatusLine() }],
            details: {},
          };
        } catch (err) {
          return {
            content: [
              {
                type: 'text',
                text: `MCP error: ${err instanceof Error ? err.message : String(err)}`,
              },
            ],
            details: {},
          };
        }
      },
    };
  }

  /**
   * Get the pi agents directory where subagent definitions are stored.
   * Mirrors getPiAgentsDir() in register_expert.js.
   * Uses PI_CODING_AGENT_DIR env var if set, otherwise defaults to ~/.pi/agent/agents.
   */
  private getPiAgentsDir(): string {
    const homedir = os.homedir();
    const configDir = process.env.PI_CODING_AGENT_DIR || path.join(homedir, '.pi', 'agent');
    return path.join(configDir, 'agents');
  }

  /**
   * Live team member definitions for bundled presets. Returns null when the
   * preset is not bundled, so the subagent tool falls back to the synced pi
   * agents files (user-imported packages).
   */
  private resolveBundledMemberProfiles(
    presetId: string,
  ): Array<{ id: string; description: string; systemPrompt: string }> | null {
    return resolveBundledPresetMembers(this.bundledSkillsRoot ?? getSkillsRoot(), presetId);
  }
  private createWorkbenchContract(
    sessionMode: PiStartOptions['sessionMode'],
    skillIds: string[] | undefined,
    productionControlsAvailable = true,
  ): WorkbenchTaskContract {
    const research = productionControlsAvailable && isAcademicResearchSkillSet(skillIds);
    const shortcut = research ? null : resolveShortcutWorkflowKind(skillIds);
    const kind =
      sessionMode === 'chat'
        ? WorkbenchContractKind.Chat
        : research
          ? WorkbenchContractKind.Research
          : productionControlsAvailable && shortcut
            ? WorkbenchContractKind.Shortcut
            : WorkbenchContractKind.GenericWork;
    return {
      kind,
      // Generic Work keeps production controls available. Verification uses
      // the controller snapshot to distinguish a dormant direct answer from
      // an activated production run; only the latter owns the acceptance gate.
      requiresUserAcceptance:
        sessionMode !== 'chat' &&
        kind === WorkbenchContractKind.GenericWork &&
        productionControlsAvailable,
      metadata: {
        productionControlsAvailable,
        ...(skillIds?.length ? { skillIds } : {}),
      },
    };
  }
}

// ── Provider resolution ──

/**
 * Infer the Pi provider name from environment variables.
 * ZhiYuanAgent stores keys as DEEPSEEK_API_KEY, ANTHROPIC_API_KEY, etc.
 * Pi SDK looks up providers by name (deepseek, anthropic, openai, etc.).
 */
const DEFAULT_PI_LOCAL_CONTEXT_WINDOW = 32768;
const DEFAULT_PI_LOCAL_MAX_TOKENS = 4096;
const DEFAULT_PI_CLOUD_CONTEXT_WINDOW = 256000;
const DEFAULT_PI_CLOUD_MAX_TOKENS = 32768;
const PI_LOCAL_API_KEY = 'sk-zhiyuan-local';
const PI_MANAGED_PROXY_API_KEY = `sk-zhiyuan-${randomUUID()}`;

function resolvePiCustomModelApi(resolution: ApiConfigResolution): ProviderModelPiApi {
  const configuredApi = resolution.providerMetadata?.piRuntime?.api;
  if (configuredApi) return configuredApi;
  return resolution.config?.apiType === 'anthropic'
    ? ProviderModelPiApi.AnthropicMessages
    : ProviderModelPiApi.OpenAICompletions;
}

function hasRecordEntries(value: unknown): value is Record<string, unknown> {
  return Boolean(
    value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length,
  );
}

function buildPiCustomModel(
  resolution: ApiConfigResolution,
  baseUrlOverride?: string,
): Record<string, unknown> {
  const config = resolution.config;
  const providerMetadata = resolution.providerMetadata;
  if (!config || !providerMetadata) {
    throw new Error(resolution.error || 'Pi model configuration is unavailable.');
  }

  const isLocalModel = isLocalProviderName(providerMetadata.providerName);
  const endpoint = resolution.endpoint;
  const fallbackContextWindow = isLocalModel
    ? DEFAULT_PI_LOCAL_CONTEXT_WINDOW
    : DEFAULT_PI_CLOUD_CONTEXT_WINDOW;
  const fallbackMaxTokens = isLocalModel
    ? DEFAULT_PI_LOCAL_MAX_TOKENS
    : DEFAULT_PI_CLOUD_MAX_TOKENS;
  const capabilities = endpoint?.capabilities ?? providerMetadata.capabilities;
  const piRuntime = providerMetadata.piRuntime;
  const compat = piRuntime?.compat;
  const supportsImage =
    providerMetadata.supportsImage || capabilities?.imageInput === ModelCapabilityStatus.Supported;

  return {
    id: endpoint?.modelId ?? config.model,
    name: endpoint?.displayName || providerMetadata.modelName || config.model,
    api: resolvePiCustomModelApi(resolution),
    provider: providerMetadata.providerName,
    baseUrl: baseUrlOverride || endpoint?.baseUrl || config.baseURL,
    reasoning: resolveProviderModelPiReasoning(piRuntime, capabilities),
    input: supportsImage ? ['text', 'image'] : ['text'],
    ...(hasRecordEntries(compat) ? { compat } : {}),
    cost: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
    },
    contextWindow:
      endpoint?.contextWindow ||
      providerMetadata.contextWindow ||
      providerMetadata.contextTokens ||
      fallbackContextWindow,
    maxTokens: endpoint?.maxTokens || providerMetadata.maxTokens || fallbackMaxTokens,
  };
}

function normalizePiBaseUrl(baseUrl: unknown): string {
  return typeof baseUrl === 'string' ? baseUrl.trim().replace(/\/+$/, '') : '';
}

function canUsePiBuiltinModel(
  builtinModel: Record<string, unknown> | null,
  resolution: ApiConfigResolution,
): boolean {
  if (!builtinModel || !resolution.config) return false;
  return normalizePiBaseUrl(builtinModel.baseUrl) === normalizePiBaseUrl(resolution.config.baseURL);
}

function shouldUsePiOpenAICompatProxy(
  resolution: ApiConfigResolution,
  api: ProviderModelPiApi,
): boolean {
  const providerName = resolution.providerMetadata?.providerName ?? '';
  return (
    (providerName === ProviderName.Zhiyuan || providerName.startsWith('custom_')) &&
    resolution.config?.apiType === 'openai' &&
    api === ProviderModelPiApi.OpenAICompletions
  );
}

async function resolvePiCustomModelBaseUrl(
  resolution: ApiConfigResolution,
  api: ProviderModelPiApi,
): Promise<string> {
  const config = resolution.config;
  const providerMetadata = resolution.providerMetadata;
  if (!config || !providerMetadata) {
    return '';
  }

  if (providerMetadata.providerName === ProviderName.Zhiyuan) {
    const accessToken = await getCommunityAuthAccessToken();
    registerPiOpenAICompatTokenRefresher(providerMetadata.providerName, () =>
      getCommunityAuthAccessToken({ forceRefresh: true }),
    );
    return registerPiOpenAICompatUpstream(providerMetadata.providerName, {
      baseURL: config.baseURL,
      apiKey: accessToken,
      requiredIncomingApiKey: PI_MANAGED_PROXY_API_KEY,
    });
  }

  if (!shouldUsePiOpenAICompatProxy(resolution, api)) {
    return config.baseURL;
  }

  return registerPiOpenAICompatUpstream(providerMetadata.providerName, {
    baseURL: config.baseURL,
    apiKey: config.apiKey,
  });
}

interface PiCustomModelRuntimeResolution {
  modelRuntime: PiModelRuntime | null;
  customModel: Record<string, unknown> | null;
}

async function resolvePiCustomModelRuntime(
  pi: PiModules,
  resolution: ApiConfigResolution,
  builtinModel: Record<string, unknown> | null,
  existingModelRuntime?: PiModelRuntime | null,
): Promise<PiCustomModelRuntimeResolution> {
  const config = resolution.config;
  const providerMetadata = resolution.providerMetadata;
  if (!config || !providerMetadata) {
    return { modelRuntime: existingModelRuntime ?? null, customModel: null };
  }
  if (canUsePiBuiltinModel(builtinModel, resolution)) {
    // Builtin model path (e.g. MiniMax M3 resolves to pi's built-in `minimax-cn`
    // provider): the agent session authenticates via pi's model registry, which
    // only knows provider-specific env vars (MINIMAX_CN_API_KEY) that we never
    // set. Register the user's key under the builtin provider id so the session
    // can authenticate — otherwise it fails with "No API key found for <id>".
    const apiKey = config.apiKey?.trim() || '';
    const builtinProviderId =
      typeof builtinModel?.provider === 'string' ? builtinModel.provider : null;
    if (!apiKey || !builtinProviderId) {
      return { modelRuntime: existingModelRuntime ?? null, customModel: null };
    }
    const modelRuntime =
      existingModelRuntime ?? (await pi.ModelRuntime.create({ allowModelNetwork: false }));
    await modelRuntime.setRuntimeApiKey(builtinProviderId, apiKey);
    return { modelRuntime, customModel: null };
  }

  const modelRuntime =
    existingModelRuntime ?? (await pi.ModelRuntime.create({ allowModelNetwork: false }));
  const api = resolvePiCustomModelApi(resolution);
  const runtimeBaseUrl = await resolvePiCustomModelBaseUrl(resolution, api);
  const model = buildPiCustomModel(resolution, runtimeBaseUrl);
  const providerId = providerMetadata.providerName;
  modelRuntime.registerProvider(providerId, {
    name: providerId,
    baseUrl: runtimeBaseUrl,
    api: model.api,
    models: [model],
  });
  const apiKey =
    providerMetadata.providerName === ProviderName.Zhiyuan
      ? PI_MANAGED_PROXY_API_KEY
      : config.apiKey?.trim() ||
        (isLocalProviderName(providerMetadata.providerName) ? PI_LOCAL_API_KEY : '');
  if (apiKey) await modelRuntime.setRuntimeApiKey(providerId, apiKey);
  return { modelRuntime, customModel: model };
}

function buildPiBuiltinModel(
  pi: PiModules,
  resolution: ApiConfigResolution,
): Record<string, unknown> | null {
  const config = resolution.config;
  const providerMetadata = resolution.providerMetadata;
  if (!config || !providerMetadata || isLocalProviderName(providerMetadata.providerName)) {
    return null;
  }

  const providerId = resolvePiBuiltinProviderId(providerMetadata.providerName);
  if (!providerId) {
    return null;
  }

  try {
    const builtinModel = pi.getModel(providerId, config.model);
    return builtinModel && typeof builtinModel === 'object'
      ? (builtinModel as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

async function resolvePiModel(
  pi: PiModules,
  modelRef?: string,
  existingModelRuntime?: PiModelRuntime | null,
): Promise<PiResolvedModel> {
  const normalizedModelRef = modelRef?.trim() || '';
  const resolution = normalizedModelRef
    ? resolveRawApiConfigForModelRef(normalizedModelRef)
    : resolveRawApiConfig();

  if (!resolution.config || !resolution.providerMetadata) {
    throw new Error(resolution.error || 'Pi model configuration is unavailable.');
  }

  const builtinModel = buildPiBuiltinModel(pi, resolution);
  const customRuntime = await resolvePiCustomModelRuntime(
    pi,
    resolution,
    builtinModel,
    existingModelRuntime,
  );
  const modelRuntime = customRuntime.modelRuntime;
  const customModel = customRuntime.customModel ?? buildPiCustomModel(resolution);
  const registeredModel = modelRuntime?.getModel(
    resolution.providerMetadata.providerName,
    resolution.config.model,
  );
  const useBuiltinModel = canUsePiBuiltinModel(builtinModel, resolution);

  return {
    model:
      (useBuiltinModel ? builtinModel : null) ??
      (registeredModel && typeof registeredModel === 'object'
        ? (registeredModel as Record<string, unknown>)
        : customModel),
    modelRuntime,
    maxOutputTokens:
      resolution.endpoint?.maxTokens ||
      resolution.providerMetadata.maxTokens ||
      (isLocalProviderName(resolution.providerMetadata.providerName)
        ? DEFAULT_PI_LOCAL_MAX_TOKENS
        : DEFAULT_PI_CLOUD_MAX_TOKENS),
    providerName: resolution.providerMetadata.providerName,
    capabilities: resolution.endpoint?.capabilities ?? resolution.providerMetadata.capabilities,
    requestOptions:
      resolution.providerMetadata.providerName === ProviderName.Zhiyuan
        ? { apiKey: PI_MANAGED_PROXY_API_KEY }
        : resolution.config.apiKey
          ? { apiKey: resolution.config.apiKey }
          : undefined,
  };
}

/** Normalize Pi tool args into a plain record for CoworkMessage metadata. */
function toToolInputRecord(args: unknown): Record<string, unknown> {
  if (args && typeof args === 'object' && !Array.isArray(args)) {
    return args as Record<string, unknown>;
  }
  if (args === undefined || args === null) return {};
  return { value: args };
}

/** Extract a display string from a Pi tool result (string, {text}, array of blocks, or JSON). */
function extractToolResultText(result: unknown): string {
  if (result === undefined || result === null) return '';
  if (typeof result === 'string') return result;
  if (Array.isArray(result)) {
    return result
      .map(b => extractToolResultText(b))
      .filter(Boolean)
      .join('\n');
  }
  if (typeof result === 'object') {
    const obj = result as Record<string, unknown>;
    if (typeof obj.text === 'string') return obj.text;
    if (typeof obj.content === 'string') return obj.content;
    if (Array.isArray(obj.content)) return extractToolResultText(obj.content);
    try {
      return JSON.stringify(obj);
    } catch {
      return String(result);
    }
  }
  return String(result);
}
