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
import { CoworkSessionExpertSource } from '../../../shared/cowork/sessionExperts';
import {
  CoworkQueueDelivery,
  type CoworkPendingMessage,
} from '../../../shared/cowork/pendingMessageQueue';
import { CoworkSessionMode } from '../../../shared/cowork/constants';
import { CoworkToolActivityPhase } from '../../../shared/cowork/toolActivity';
import {
  WorkbenchContractKind,
  WorkbenchRunTrigger,
  type WorkbenchTaskContract,
} from '../../../shared/workbenchTask';
import {
  isLocalProviderName,
  ModelCapabilityStatus,
  ProviderModelPiApi,
  ProviderName,
  resolveProviderModelPiReasoning,
} from '../../../shared/providers';
import type { ModelCapabilities } from '../../../shared/providers';
import type { CoworkMessage } from '../../coworkStore';
import type { CoworkStore } from '../../coworkStore';
import { t } from '../../i18n';
import type {
  WorkbenchApprovalRequestedEvent,
  WorkbenchTaskService,
} from '../../workbenchTask/taskService';
import {
  type ApiConfigResolution,
  resolveRawApiConfig,
  resolveRawApiConfigForModelRef,
} from '../claudeSettings';
import { getSkillsRoot, resolveGitBashPathForPi } from '../coworkUtil';
import type { McpServerManager } from '../mcpServerManager';
import { isRasterPreviewDecodable, renderOfficePreview } from '../officePreviewRenderer';
import {
  createPiAskUserQuestionTool,
  PiAskUserQuestionToolName,
  PiAskUserQuestionSystemPrompt,
  PiAskUserQuestionTimeoutMs,
  type PiAskUserQuestionInput,
  type PiAskUserQuestionResponse,
} from './piAskUserQuestion';
import { buildPiAgentLoopTool, PiAgentLoopController, PiAgentLoopMode } from './piAgentLoop';
import { buildPiConversationPrompt } from './piConversationContext';
import { isAcademicResearchSkillSet, PiResearchRunController } from './piResearchRun';
import { buildPiResearchStateTool } from './piResearchStateTool';
import {
  PiShortcutWorkflowController,
  resolveShortcutWorkflowKind,
  ShortcutWorkflowKind,
} from './piShortcutWorkflow';
import { buildPiShortcutWorkflowStateTool } from './piShortcutWorkflowStateTool';
import { registerPiOpenAICompatUpstream } from './piOpenAICompatProxy';
import { buildPiSubagentTool, PiSubagentToolName } from './piSubagentTool';
import { buildPiSkillScriptTool } from './piSkillScriptTool';
import { buildPiSkillRuntimeCapabilitiesTool } from './piSkillRuntimeCapabilitiesTool';
import { PiThinkingLifecycle } from './piThinkingLifecycle';
import { PiPendingMessageQueue } from './piPendingMessageQueue';
import { buildPiWorkAcceptanceTool, PiWorkExecutionController } from './piWorkExecution';
import { createPiLargeFileWriteSystemPrompt, PiWriteTokenLimitRecovery } from './piWriteTokenLimit';
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
  steer(text: string): Promise<void>;
  abort(): Promise<void>;
  abortBash(): void;
  reload(): Promise<void>;
  setModel(model: unknown): Promise<void>;
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
  modelRuntime: PiModelRuntime | null;
  /** System prompt requested by the current Cowork session snapshot. */
  requestedSystemPrompt: string;
  requestedSkillIds: string[] | undefined;
  requestedExpertIds: string[];
  resourceState: PiResourceState;
  /** Message id for the visible answer (text) bubble of the current turn. */
  assistantMessageId: string | null;
  /** Message id for the thinking bubble of the current turn. */
  thinkingMessageId: string | null;
  /** Latest full snapshot of answer text for the current turn. */
  answerText: string;
  /** Latest full snapshot of thinking text for the current turn. */
  thinkingText: string;
  thinkingLifecycle: PiThinkingLifecycle;
  /** Latest completed answer message, promoted to final only when the agent run ends. */
  lastCompletedAnswerMessageId: string | null;
  lastCompletedAnswerText: string;
  confirmationMode: 'modal' | 'text';
  unsubscribe: () => void;
  /** Set to true once stopSession has aborted the turn. continueSession must not
   * reuse the underlying Pi session object after it has been aborted; instead it
   * should reconstruct the conversation from SQLite and create a fresh session. */
  aborted: boolean;
  /** toolCallId → tool_result message id, for streaming updates + de-dup */
  toolResultMessageIdByCallId: Map<string, string>;
  preparingToolCallIdByContentIndex: Map<number, string>;
  toolActivityTracker: ToolActivityTracker;
  /** Long-horizon agent loop controller for this session (agent_loop tool). */
  agentLoop: PiAgentLoopController;
  /** Present only for the controlled academic-research workflow. */
  researchRun: PiResearchRunController | null;
  /** Present for every other first-class sidebar shortcut workflow. */
  shortcutWorkflow: PiShortcutWorkflowController | null;
  /** Present for arbitrary skills loaded in Work mode. */
  workExecution: PiWorkExecutionController | null;
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
  autoApprove: boolean;
  /** True while Pi is executing the current Work/Chat turn. */
  isRunning: boolean;
  /** True when the current turn settled with an unrecoverable Pi error. */
  turnFailed: boolean;
  /** Prevents duplicate queue drains when Pi emits multiple settled events. */
  queueFlushInFlight: boolean;
}

// ── Dynamic imports ──

interface PiModules {
  createAgentSession: (options: Record<string, unknown>) => Promise<{ session: PiSession }>;
  DefaultResourceLoader: new (options: Record<string, unknown>) => PiResourceLoader;
  SettingsManager?: {
    create(cwd: string, agentDir?: string): PiSettingsManager;
  };
  getAgentDir: () => string;
  getModel: (provider: string, modelId: string) => unknown;
  ModelRuntime: {
    create(): Promise<PiModelRuntime>;
  };
  completeSimple: (
    model: unknown,
    context: { messages: Array<{ role: string; content: string }> },
    options?: { apiKey?: string },
  ) => Promise<{ content: Array<{ text: string }> }>;
}

interface PiResourceLoader {
  reload(): Promise<void>;
  settingsManager?: PiSettingsManager | null;
}

interface PiSettingsManager {
  applyOverrides(overrides: { shellPath?: string }): void;
  getShellPath?(): string | undefined;
}

interface PiToolCallEvent {
  toolCallId: string;
  toolName: string;
  input?: unknown;
}

interface PiExtensionApi {
  on(
    event: 'tool_call',
    handler: (event: PiToolCallEvent) => Promise<{ block: true; reason: string } | undefined>,
  ): void;
}

interface PiResourceState {
  systemPrompt: string;
  skillIds: string[] | undefined;
  maxOutputTokens: number;
  fileToolsEnabled: boolean;
}

interface PiModelRuntime {
  registerProvider(provider: string, config: Record<string, unknown>): void;
  setRuntimeApiKey(provider: string, apiKey: string): Promise<void>;
  getModel(provider: string, modelId: string): unknown;
  completeSimple?(
    model: unknown,
    context: { messages: Array<{ role: string; content: string }> },
  ): Promise<{ content: Array<{ text: string }> }>;
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
        SettingsManager: Object.prototype.hasOwnProperty.call(codingAgent, 'SettingsManager')
          ? ((codingAgent as typeof codingAgent & { SettingsManager?: unknown })
              .SettingsManager as PiModules['SettingsManager'])
          : undefined,
        getAgentDir: codingAgent.getAgentDir as PiModules['getAgentDir'],
        ModelRuntime: codingAgent.ModelRuntime as PiModules['ModelRuntime'],
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
 * visible streaming jank. We throttle store writes (like the OpenClaw adapter)
 * and flush the latest content on finalize.
 */
const STORE_UPDATE_THROTTLE_MS = 250;

const normalizeSkillIds = (skillIds: string[] | undefined): string[] | undefined =>
  skillIds === undefined
    ? undefined
    : [...new Set(skillIds.map(skillId => skillId.trim()).filter(Boolean))].sort();

const normalizeExpertIds = (expertIds: string[] | undefined): string[] =>
  expertIds === undefined
    ? []
    : [...new Set(expertIds.map(expertId => expertId.trim()).filter(Boolean))];

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
  private workbenchTaskService: WorkbenchTaskService | null = null;
  private workbenchApprovalListener: ((event: WorkbenchApprovalRequestedEvent) => void) | null =
    null;

  setCoworkStore(store: CoworkStore): void {
    this.store = store;
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

    if (this.activeSessions.has(sessionId)) {
      this.stopSession(sessionId);
    }

    const pi = await getPiModules();

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
        metadata: options.skillIds?.length ? { skillIds: options.skillIds } : undefined,
      };
      const persisted = this.store ? this.store.addMessage(sessionId, userMsg) : userMsg;
      this.emit('message', sessionId, persisted);
    }

    const abortController = new AbortController();
    let workbenchRunId: string | null = null;

    try {
      const workspaceRoot = options.workspaceRoot || process.cwd();
      const sessionOptions: Record<string, unknown> = { cwd: workspaceRoot };

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
      };

      const shortcutKindForContract = isAcademicResearchSkillSet(resourceState.skillIds)
        ? null
        : resolveShortcutWorkflowKind(resourceState.skillIds);
      const workbenchContract = this.createWorkbenchContract(
        options.sessionMode,
        resourceState.skillIds,
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
      }

      // Pi's createAgentSession does not accept a systemPrompt option. Its
      // default resource loader supplies the Pi Coding Assistant identity,
      // so override that loader per session to keep expert contexts isolated.
      // Resolve model early — needed by both MCP proxy and subagent tool
      const resolvedModel = await resolvePiModel(pi, options.modelOverride);
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
      if (resolvedModel.modelRuntime) {
        sessionOptions.modelRuntime = resolvedModel.modelRuntime;
      }

      const settingsManager = this.createPiSettingsManager(pi, workspaceRoot);
      const resourceLoader = await this.createPiResourceLoader(pi, workspaceRoot, resourceState, {
        sessionId,
        runId: workbenchRunId,
        settingsManager,
        getAutoApprove: () =>
          this.activeSessions.get(sessionId)?.autoApprove ?? Boolean(options.autoApprove),
      });
      sessionOptions.resourceLoader = resourceLoader;
      if (settingsManager) {
        sessionOptions.settingsManager = settingsManager;
      }

      // Build custom tools: MCP proxy + optional subagent for Team Leads.
      // Each call creates a distinct tool instance for this Pi session, so its
      // sequential execution mode cannot block another session.
      const customTools: Record<string, unknown>[] = [];

      customTools.push(
        createPiAskUserQuestionTool((toolCallId, input, signal) =>
          this.requestAskUserQuestion(sessionId, toolCallId, input, signal),
        ),
      );

      // MCP tools: register a single proxy tool (pi-mcp-adapter pattern)
      const mcpProxyTool = this.buildMcpProxyTool();
      if (mcpProxyTool) {
        customTools.push(mcpProxyTool);
      }

      // Academic research is a controlled workflow, not a prompt-only label.
      // It owns durable state and completion gates for the lifetime of this
      // session (and reloads the same state directory after a session restart).
      const researchRun = isAcademicResearchSkillSet(resourceState.skillIds)
        ? new PiResearchRunController({ sessionId, workspaceRoot, task: prompt })
        : null;
      if (researchRun) {
        researchRun.resumeForPrompt(prompt);
        customTools.push(buildPiResearchStateTool(researchRun));
      }
      const shortcutKind = researchRun ? null : shortcutKindForContract;
      const shortcutWorkflow = shortcutKind
        ? new PiShortcutWorkflowController({
            sessionId,
            workspaceRoot,
            task: prompt,
            kind: shortcutKind,
            validateRasterPreview: isRasterPreviewDecodable,
            renderOfficePreview,
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
      // A selected skill in Work mode is an execution request, not a one-turn
      // chat hint. Run it through Pi's durable loop by default; completion
      // still requires explicit user acceptance because arbitrary skills do
      // not share a safe universal semantic validator.
      const shouldManageSkillExecution =
        options.sessionMode === 'work' &&
        Boolean(resourceState.skillIds?.length) &&
        !researchRun &&
        !shortcutWorkflow;
      const workExecution = shouldManageSkillExecution
        ? new PiWorkExecutionController({ sessionId, workspaceRoot, task: prompt })
        : null;
      if (workExecution) {
        workExecution.start(prompt);
        customTools.push(
          buildPiWorkAcceptanceTool(workExecution, (toolCallId, input, signal) =>
            this.requestAskUserQuestion(sessionId, toolCallId, input, signal),
          ),
        );
      }

      // Subagent tool: registered for every cowork session. When the session
      // agent is a Team Lead from a package, its presetId additionally exposes
      // the team member agents alongside the built-in profiles.
      let subagentPresetId: string | undefined;
      if (this.store) {
        const candidateAgentIds = options.expertIds?.length
          ? options.expertIds
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
        resolvedModel,
        workspaceRoot,
        webSearchSkillPath:
          researchRun || shortcutKind === ShortcutWorkflowKind.DeepResearch
            ? path.join(getSkillsRoot(), 'web-search')
            : undefined,
        createPiResourceLoader: (cwd, systemPrompt, maxOutputTokens, skillIds) =>
          this.createPiResourceLoader(
            pi,
            cwd,
            {
              systemPrompt,
              skillIds,
              maxOutputTokens,
              fileToolsEnabled: true,
            },
            {
              sessionId,
              runId: workbenchRunId,
              getAutoApprove: () =>
                this.activeSessions.get(sessionId)?.autoApprove ?? Boolean(options.autoApprove),
            },
          ),
      });
      if (subagentTool) {
        customTools.push(subagentTool);
      }

      // Agent loop tool: lets the LLM drive multi-iteration long-horizon
      // loops; the controller continues the session on agent_end.
      const completionWorkflow = researchRun || shortcutWorkflow || workExecution;
      const shouldRunGoalLoop =
        options.goalMode === true && options.sessionMode === CoworkSessionMode.Work;
      const agentLoop = new PiAgentLoopController(completionWorkflow || undefined);
      let workLoopPrompt = '';
      if (completionWorkflow || shouldRunGoalLoop) {
        const loopPrompt = agentLoop.start({
          mode: PiAgentLoopMode.Goal,
          goal: completionWorkflow?.goal || prompt,
          passes: 0,
          stages: [],
        });
        if (workExecution || shouldRunGoalLoop) workLoopPrompt = loopPrompt;
      }
      customTools.push(buildPiAgentLoopTool(agentLoop));

      if (customTools.length > 0) {
        sessionOptions.customTools = customTools;
      }

      // Chat mode: disable all built-in tools for direct LLM access
      if (options.confirmationMode === 'text') {
        sessionOptions.noTools = 'all';
      }

      const result = await pi.createAgentSession(sessionOptions);
      const session = result.session;

      const active: ActivePiSession = {
        sessionId,
        piSession: session,
        abortController,
        modelRuntime: resolvedModel.modelRuntime,
        requestedSystemPrompt: basePrompt,
        requestedSkillIds: resourceState.skillIds,
        requestedExpertIds: normalizeExpertIds(options.expertIds),
        resourceState,
        assistantMessageId: null,
        thinkingMessageId: null,
        answerText: '',
        thinkingText: '',
        thinkingLifecycle: new PiThinkingLifecycle(),
        lastCompletedAnswerMessageId: null,
        lastCompletedAnswerText: '',
        confirmationMode: options.confirmationMode || 'modal',
        unsubscribe: () => {},
        aborted: false,
        toolResultMessageIdByCallId: new Map(),
        preparingToolCallIdByContentIndex: new Map(),
        toolActivityTracker: new ToolActivityTracker(),
        agentLoop,
        researchRun,
        shortcutWorkflow,
        workExecution,
        goalMode: options.goalMode === true,
        writeTokenLimitRecovery: new PiWriteTokenLimitRecovery(resolvedModel.maxOutputTokens),
        pendingError: null,
        workbenchRunId,
        workbenchContract,
        workspaceRoot,
        settingsManager,
        autoApprove: Boolean(options.autoApprove),
        isRunning: true,
        turnFailed: false,
        queueFlushInFlight: false,
      };

      // Subscribe to Pi events before sending the prompt
      active.unsubscribe = session.subscribe(event => {
        if (abortController.signal.aborted) return;
        this.handlePiEvent(sessionId, active, event);
      });

      this.activeSessions.set(sessionId, active);

      // Send the prompt (may include conversation history for restart restores)
      let initialPrompt = researchRun
        ? researchRun.buildInitialPrompt(options._piPromptOverride || prompt)
        : shortcutWorkflow
          ? shortcutWorkflow.buildInitialPrompt(options._piPromptOverride || prompt)
          : workExecution
            ? workExecution.buildInitialPrompt(options._piPromptOverride || prompt)
            : options._piPromptOverride || prompt;
      if (workExecution || shouldRunGoalLoop) {
        initialPrompt = `${workLoopPrompt}\n\n${initialPrompt}`;
      }

      // The user may stop the session while the execution-mode question is
      // open. Do not revive an aborted Pi turn when that question resolves.
      if (abortController.signal.aborted) return;

      await session.prompt(initialPrompt);
    } catch (error) {
      this.activeSessions.delete(sessionId);
      if (abortController.signal.aborted) {
        this.emit('sessionStopped', sessionId);
        return;
      }
      const message = error instanceof Error ? error.message : String(error);
      this.workbenchTaskService?.failRun(sessionId, { message });
      this.emit('error', sessionId, classifyCoworkError(message));
      throw error;
    }
  }

  async continueSession(
    sessionId: string,
    prompt: string,
    options: PiContinueOptions = {},
  ): Promise<void> {
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
      const piPrompt = buildPiConversationPrompt(history, prompt);
      return this.startSession(sessionId, prompt, {
        ...options,
        skipInitialUserMessage: options._skipUserMessage,
        systemPrompt: options.systemPrompt ?? storedSession?.systemPrompt,
        expertIds: options.expertIds ?? storedSession?.experts.map(expert => expert.expertId),
        workspaceRoot: options.workspaceRoot ?? storedSession?.cwd,
        agentId: options.agentId ?? storedSession?.agentId,
        modelOverride: options.modelOverride ?? storedSession?.modelOverride,
        goalMode: options.goalMode ?? active?.goalMode,
        _piPromptOverride: piPrompt,
      });
    }

    if (options.autoApprove !== undefined) {
      active.autoApprove = Boolean(options.autoApprove);
    }
    active.isRunning = true;
    active.turnFailed = false;

    const requestedSystemPrompt = options.systemPrompt?.trim();
    const requestedSkillIds =
      options.skillIds === undefined
        ? active.requestedSkillIds
        : normalizeSkillIds(options.skillIds);
    const requestedExpertIds =
      options.expertIds === undefined
        ? active.requestedExpertIds
        : normalizeExpertIds(options.expertIds);
    if (!haveSameStringList(requestedExpertIds, active.requestedExpertIds)) {
      const history = this.store?.getSession(sessionId)?.messages ?? [];
      this.disposeSessionForRecreation(sessionId, active);
      return this.startSession(sessionId, prompt, {
        ...options,
        systemPrompt: requestedSystemPrompt ?? active.requestedSystemPrompt,
        skillIds: requestedSkillIds,
        expertIds: requestedExpertIds,
        goalMode: options.goalMode ?? active.goalMode,
        _piPromptOverride: buildPiConversationPrompt(history, prompt),
      });
    }

    const nextSystemPrompt = requestedSystemPrompt ?? active.requestedSystemPrompt;
    const promptChanged = nextSystemPrompt !== active.requestedSystemPrompt;
    const skillsChanged = !haveSameStringList(requestedSkillIds, active.requestedSkillIds);
    if (skillsChanged) {
      const history = this.store?.getSession(sessionId)?.messages ?? [];
      this.disposeSessionForRecreation(sessionId, active);
      return this.startSession(sessionId, prompt, {
        ...options,
        systemPrompt: nextSystemPrompt,
        skillIds: requestedSkillIds,
        expertIds: requestedExpertIds,
        goalMode: options.goalMode ?? active.goalMode,
        _piPromptOverride: buildPiConversationPrompt(history, prompt),
      });
    }
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
      const sessionMode =
        options.sessionMode ??
        (active.workbenchContract.kind === WorkbenchContractKind.Chat ? 'chat' : 'work');
      const workbenchContract = this.createWorkbenchContract(sessionMode, requestedSkillIds);
      const workbench = this.workbenchTaskService.beginRun({
        sessionId,
        goal: prompt,
        contract: workbenchContract,
        trigger: options._workbenchRunId ? WorkbenchRunTrigger.Resume : WorkbenchRunTrigger.Message,
        preparedRunId: options._workbenchRunId,
      });
      active.workbenchRunId = workbench.run.id;
      active.workbenchContract = workbenchContract;
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
    active.preparingToolCallIdByContentIndex.clear();
    const clearActivity = active.toolActivityTracker.clear();
    if (clearActivity) this.emit('toolActivity', sessionId, clearActivity);
    active.writeTokenLimitRecovery.reset();
    active.pendingError = null;
    active.turnFailed = false;

    // Emit user message (persisted to SQLite, same as startSession).
    if (!options._skipUserMessage) {
      const userMsg: CoworkMessage = {
        id: randomUUID(),
        type: 'user',
        content: prompt,
        timestamp: Date.now(),
        metadata:
          options.skillIds?.length || options._queueDelivery
            ? {
                ...(options.skillIds?.length ? { skillIds: options.skillIds } : {}),
                ...(options._queueDelivery ? { queueDelivery: options._queueDelivery } : {}),
              }
            : undefined,
      };
      const persisted = this.store ? this.store.addMessage(sessionId, userMsg) : userMsg;
      this.emit('message', sessionId, persisted);
    }

    let nextPrompt = prompt;
    const completionWorkflow =
      active.researchRun || active.shortcutWorkflow || active.workExecution;
    if (options.goalMode !== undefined && !completionWorkflow) {
      active.goalMode = options.goalMode;
      if (!active.goalMode && active.agentLoop.getState().active) {
        active.agentLoop.stop();
      }
    }
    const shouldRunGoalLoop =
      active.goalMode && active.workbenchContract.kind !== WorkbenchContractKind.Chat;
    if ((completionWorkflow || shouldRunGoalLoop) && !active.agentLoop.getState().active) {
      completionWorkflow?.resumeForPrompt(prompt);
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
          : active.workExecution
            ? active.workExecution.buildInitialPrompt(prompt)
            : prompt;
      if (!completionWorkflow) {
        nextPrompt = `${loopPrompt}\n\n${nextPrompt}`;
      }
    }

    try {
      const promptOptions = options._streamingBehavior
        ? { streamingBehavior: options._streamingBehavior }
        : undefined;
      if (promptOptions) {
        await active.piSession.prompt(nextPrompt, promptOptions);
      } else {
        await active.piSession.prompt(nextPrompt);
      }
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
    if (!active || !patch.model) return;

    try {
      const pi = await getPiModules();
      const resolvedModel = await resolvePiModel(pi, patch.model, active.modelRuntime);
      const model = resolvedModel.model;
      await active.piSession.setModel(model);
      active.modelRuntime = resolvedModel.modelRuntime;
      active.writeTokenLimitRecovery = new PiWriteTokenLimitRecovery(resolvedModel.maxOutputTokens);
      if (active.resourceState.maxOutputTokens !== resolvedModel.maxOutputTokens) {
        active.resourceState.maxOutputTokens = resolvedModel.maxOutputTokens;
        await active.piSession.reload();
        this.applyPiShellOverride(active.settingsManager);
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
    const clearActivity = active.toolActivityTracker.clear();
    if (clearActivity) this.emit('toolActivity', sessionId, clearActivity);
    active.piSession.abortBash();
    active.abortController.abort();
    active.unsubscribe();
    void active.piSession.abort();
    this.activeSessions.delete(sessionId);
  }

  stopSession(sessionId: string): void {
    this.dismissAskUserQuestionsBySession(sessionId);
    const active = this.activeSessions.get(sessionId);
    if (!active) return;
    const wasRunning = active.isRunning;

    this.finalizeActiveThinking(sessionId, active);

    // Mark the session as aborted so continueSession knows not to reuse the Pi
    // session object, which may be in an inconsistent state after abort.
    active.aborted = true;
    active.isRunning = false;
    active.turnFailed = false;
    active.agentLoop.stop();
    // Drop any deferred error without surfacing it — the user stopped the turn.
    active.pendingError = null;
    const clearActivity = active.toolActivityTracker.clear();
    if (clearActivity) this.emit('toolActivity', sessionId, clearActivity);

    // Only abort the current turn — keep the session entry in activeSessions
    // so isSessionActive still reports true for IM routing, but do not reuse
    // the underlying Pi session for subsequent turns.
    active.piSession.abortBash();
    active.abortController.abort();
    active.unsubscribe();
    void active.piSession.abort();
    this.workbenchTaskService?.pauseRun(sessionId, 'The user stopped this run.');
    this.emit('sessionStopped', sessionId);

    // A user stop ends the current turn without cancelling messages already
    // queued in Work. Start the next follow-up from a fresh Pi session; the
    // internal stop used during that recreation is not running and will not
    // recursively drain the queue.
    if (
      wasRunning &&
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

  stopAllSessions(): void {
    for (const [sessionId] of this.activeSessions) {
      this.stopSession(sessionId);
    }
  }

  /** Applies the global permission mode to sessions that are already running. */
  setAutoApproveForSession(sessionId: string, autoApprove: boolean): void {
    const active = this.activeSessions.get(sessionId);
    if (active) active.autoApprove = autoApprove;
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
      this.workbenchTaskService.respondToApproval({
        approvalId: requestId,
        approved: result.behavior === 'allow',
        reason: result.behavior === 'deny' ? result.message : undefined,
      });
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
      await active.piSession.steer(item.text);
      this.persistQueuedUserMessage(sessionId, item.text, CoworkQueueDelivery.Steer);
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
    text: string,
    delivery: CoworkQueueDelivery,
  ): CoworkMessage {
    const message: CoworkMessage = {
      id: randomUUID(),
      type: 'user',
      content: text,
      timestamp: Date.now(),
      metadata: { queueDelivery: delivery },
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
      if (retryAfterFailure) void this.flushFollowUpQueue(sessionId, active);
    }
  }

  getSessionConfirmationMode(sessionId: string): 'modal' | 'text' | null {
    return this.activeSessions.get(sessionId)?.confirmationMode || null;
  }

  onSessionDeleted(sessionId: string): void {
    this.stopSession(sessionId);
    this.activeSessions.delete(sessionId);
    if (this.pendingMessageQueue.clear(sessionId)) this.emitQueueUpdated(sessionId);
    this.workbenchTaskService?.deleteSession(sessionId);
  }

  // ── Chat mode: direct LLM without agent loop ──

  private createPiSettingsManager(pi: PiModules, cwd: string): PiSettingsManager | null {
    if (!pi.SettingsManager) return null;
    return pi.SettingsManager.create(cwd, pi.getAgentDir());
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
      runId: string | null;
      settingsManager?: PiSettingsManager | null;
      getAutoApprove: () => boolean;
    },
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
      noSkills: true,
      additionalSkillPaths: this.resolveZhiyuanSkillDirs(),
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
      systemPromptOverride: () => resourceState.systemPrompt,
      // Pi bypasses tool promptGuidelines when systemPromptOverride is non-empty.
      // Append this policy so it remains present for both default and custom prompts.
      appendSystemPromptOverride: (): string[] => [
        PiAskUserQuestionSystemPrompt,
        ...(resourceState.fileToolsEnabled
          ? [createPiLargeFileWriteSystemPrompt(resourceState.maxOutputTokens)]
          : []),
      ],
      extensionFactories: approvalContext?.runId
        ? [
            (extensionApi: PiExtensionApi) => {
              extensionApi.on('tool_call', async event => {
                const toolInput =
                  event.input && typeof event.input === 'object'
                    ? (event.input as Record<string, unknown>)
                    : {};
                const authorization = await this.workbenchTaskService?.authorizeToolCall({
                  sessionId: approvalContext.sessionId,
                  runId: approvalContext.runId as string,
                  toolCallId: event.toolCallId,
                  toolName: event.toolName,
                  toolInput,
                  autoApprove: approvalContext.getAutoApprove(),
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
        : [],
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
   * Send a prompt directly to the LLM, bypassing the agent loop.
   * For Chat mode — fast response, no tool execution.
   */
  async chatDirect(prompt: string, modelId?: string): Promise<string> {
    const pi = await getPiModules();
    const resolvedModel = await resolvePiModel(pi, modelId);
    const result = resolvedModel.modelRuntime?.completeSimple
      ? await resolvedModel.modelRuntime.completeSimple(resolvedModel.model, {
          messages: [{ role: 'user', content: prompt }],
        })
      : await pi.completeSimple(
          resolvedModel.model,
          { messages: [{ role: 'user', content: prompt }] },
          resolvedModel.requestOptions,
        );
    return result.content
      .filter((c): c is { text: string } => 'text' in c)
      .map(c => c.text)
      .join('');
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
        active.thinkingLifecycle.reset();
        break;

      case 'message_start':
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
        // message.content is the FULL accumulating snapshot (not a delta), split into
        // text and thinking blocks. Derive full snapshots and SET (never append) —
        // appending the snapshot each tick is what caused the repeated content.
        const { text, thinking } = extractStreamingSnapshot(event.message);
        const segmentEventType = event.assistantMessageEvent?.type;
        const thinkingEnded = segmentEventType === 'thinking_end';
        if (segmentEventType === 'thinking_delta') {
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
            const { thinking } = extractStreamingSnapshot(event.message);
            if (thinking && thinking !== active.thinkingText) {
              active.thinkingText = thinking;
              active.thinkingLifecycle.markContentStreaming();
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

          const { text, thinking } = extractStreamingSnapshot(event.message);
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
            );
          }

          // Turn's segments are done; next turn starts fresh messages.
          active.assistantMessageId = null;
          active.thinkingMessageId = null;
          active.answerText = '';
          active.thinkingText = '';
        }
        break;
      }

      case 'turn_end':
        break;

      case 'tool_execution_start': {
        // Agent invoked a tool → emit a tool_use message so the UI renders the tool card.
        // Mirrors OpenClaw adapter's tool_use construction.
        if (!event.toolCallId || !event.toolName) break;
        const runningActivity = active.toolActivityTracker.upsert(
          {
            toolCallId: event.toolCallId,
            toolName: event.toolName,
            toolInput: toToolActivityInput(event.args),
          },
          CoworkToolActivityPhase.Running,
        );
        if (runningActivity) this.emit('toolActivity', sessionId, runningActivity);
        if (event.toolName === PiSubagentToolName) {
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
        if (event.toolName === PiSubagentToolName) {
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
          },
        };
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
        this.markFinalAnswer(sessionId, active);
        const clearActivity = active.toolActivityTracker.clear();
        if (clearActivity) this.emit('toolActivity', sessionId, clearActivity);
        // Failed attempt (deferred error pending): do not continue the agent
        // loop, mark completed, or emit complete. flushPendingError surfaces
        // the error when the run settles (auto_retry_end / agent_settled).
        if (active.pendingError) break;
        // Agent loop: when the finished iteration signaled "next", continue
        // the session with the next iteration prompt instead of completing.
        const loopDecision = active.agentLoop.handleAgentEnd();
        if (loopDecision.shouldContinue && loopDecision.nextPrompt) {
          // Reset turn state (same as continueSession).
          active.answerText = '';
          active.thinkingText = '';
          active.assistantMessageId = null;
          active.thinkingMessageId = null;
          active.thinkingLifecycle.reset();
          active.lastCompletedAnswerMessageId = null;
          active.lastCompletedAnswerText = '';
          active.toolResultMessageIdByCallId.clear();
          active.piSession.prompt(loopDecision.nextPrompt).catch(error => {
            const message = error instanceof Error ? error.message : String(error);
            this.emit('error', sessionId, classifyCoworkError(message));
          });
          break;
        }
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
        if (this.store) this.store.updateSession(sessionId, { status: 'idle' });
        if (active.workbenchRunId && this.workbenchTaskService) {
          const workflowSnapshot = active.researchRun
            ? active.researchRun.getSnapshot()
            : active.shortcutWorkflow
              ? active.shortcutWorkflow.getSnapshot()
              : active.workExecution?.getSnapshot() || null;
          this.workbenchTaskService.completeRun({
            sessionId,
            runId: active.workbenchRunId,
            workspaceRoot: active.workspaceRoot,
            finalAnswer: active.lastCompletedAnswerText,
            finalMessageId: active.lastCompletedAnswerMessageId,
            workflowCompleted:
              !active.researchRun && !active.shortcutWorkflow && !active.workExecution
                ? undefined
                : active.agentLoop.getState().done,
            workflowSnapshot,
          });
        }
        this.emit('complete', sessionId, null);
        break;
      }

      case 'auto_retry_start':
        // Pi is retrying after an error — silently wait
        break;

      case 'auto_retry_end':
        // Retries exhausted — surface the deferred error, if any.
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
    this.workbenchTaskService?.failRun(sessionId, { message: pending.message });
    // Persist a system error message so the error survives session switching
    // and is visible in the message list. The classified kind lets the renderer
    // translate it into a user-friendly i18n message; the raw message is kept
    // for console diagnostics only.
    if (this.store) {
      this.store.updateSession(sessionId, { status: 'error' });
      this.store.addMessage(sessionId, {
        type: 'system',
        content: '',
        metadata: { error: pending.message, errorKind: pending.classified.kind },
      });
    }
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
          : { isStreaming: true, isFinal: false },
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
        : { isStreaming: true, isFinal: false };
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
        : { isStreaming: false, isFinal: true };
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
      if (sid === sessionId) this.approvalSessionMap.delete(requestId);
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
    const manifest = this.mcpServerManager.toolManifest;
    if (manifest.length === 0) return null;

    const mgr = this.mcpServerManager;

    const toolIndex = manifest.map(e => ({
      server: e.server,
      name: e.name,
      description: e.description,
    }));

    const buildStatusLine = (): string => {
      const servers = this.mcpServerManager?.toolManifest ?? [];
      const serverNames = [...new Set(servers.map(t => t.server))];
      const running = this.mcpServerManager?.isRunning ? 'running' : 'stopped';
      return (
        `MCP ${running} — ${serverNames.length} server(s), ${servers.length} tool(s):\n` +
        serverNames
          .map(s => {
            const count = servers.filter(t => t.server === s).length;
            return `  ${s}: ${count} tool(s)`;
          })
          .join('\n')
      );
    };

    return {
      name: 'mcp',
      label: 'MCP',
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

  private createWorkbenchContract(
    sessionMode: PiStartOptions['sessionMode'],
    skillIds: string[] | undefined,
  ): WorkbenchTaskContract {
    const research = isAcademicResearchSkillSet(skillIds);
    const shortcut = research ? null : resolveShortcutWorkflowKind(skillIds);
    return {
      kind:
        sessionMode === 'chat'
          ? WorkbenchContractKind.Chat
          : research
            ? WorkbenchContractKind.Research
            : shortcut
              ? WorkbenchContractKind.Shortcut
              : WorkbenchContractKind.GenericWork,
      requiresUserAcceptance: sessionMode !== 'chat' && !research && !shortcut,
      metadata: skillIds?.length ? { skillIds } : undefined,
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

const PI_BUILTIN_PROVIDER_ID = {
  [ProviderName.OpenAI]: 'openai',
  [ProviderName.Anthropic]: 'anthropic',
  [ProviderName.Gemini]: 'google',
  [ProviderName.DeepSeek]: 'deepseek',
  [ProviderName.Moonshot]: 'moonshotai-cn',
  [ProviderName.Zhipu]: 'zai',
  [ProviderName.Minimax]: 'minimax-cn',
  [ProviderName.Xiaomi]: 'xiaomi',
  [ProviderName.OpenRouter]: 'openrouter',
  [ProviderName.Copilot]: 'github-copilot',
} as const;

function resolvePiBuiltinProviderId(providerName?: string): string | null {
  if (!providerName) return null;
  return PI_BUILTIN_PROVIDER_ID[providerName as keyof typeof PI_BUILTIN_PROVIDER_ID] ?? null;
}

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
    providerName.startsWith('custom_') &&
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
    const modelRuntime = existingModelRuntime ?? (await pi.ModelRuntime.create());
    await modelRuntime.setRuntimeApiKey(builtinProviderId, apiKey);
    return { modelRuntime, customModel: null };
  }

  const modelRuntime = existingModelRuntime ?? (await pi.ModelRuntime.create());
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
    config.apiKey?.trim() ||
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
    requestOptions: resolution.config.apiKey ? { apiKey: resolution.config.apiKey } : undefined,
  };
}

// ── Text extraction helpers ──

/**
 * Extract full text and thinking snapshots from a Pi message.
 *
 * For message_update / message_end, `content` is the FULL accumulating snapshot
 * (array of {type:'text',text} / {type:'thinking',thinking} blocks), NOT a delta.
 * We concatenate each kind so callers can SET (not append) their buffers.
 */
function extractStreamingSnapshot(message?: PiEvent['message']): {
  text: string;
  thinking: string;
} {
  if (!message?.content) return { text: '', thinking: '' };
  if (typeof message.content === 'string') return { text: message.content, thinking: '' };
  if (typeof message.content[Symbol.iterator] !== 'function') {
    console.warn(
      '[PiRuntime] message.content is not iterable (type=%s), returning empty snapshot',
      typeof message.content,
    );
    return { text: '', thinking: '' };
  }

  let text = '';
  let thinking = '';
  for (const block of message.content) {
    if (block.type === 'text' && block.text) text += block.text;
    else if (block.type === 'thinking' && block.thinking) thinking += block.thinking;
  }
  return { text, thinking };
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
