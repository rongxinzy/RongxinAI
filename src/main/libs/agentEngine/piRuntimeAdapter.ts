/**
 * Pi Runtime Adapter
 *
 * Implements CoworkRuntime using the Pi SDK (in-process).
 * Pi is an embeddable agent loop library — no subprocess, no HTTP, just import.
 *
 * Architecture:
 *   startSession    → createAgentSession() → session.subscribe() → emit CoworkRuntimeEvents
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

import { classifyCoworkError } from '../../../common/coworkError';
import type { OpenClawSessionPatch } from '../../../common/openclawSession';
import { CoworkSessionExpertSource } from '../../../shared/cowork/sessionExperts';
import { isLocalProviderName, ProviderName } from '../../../shared/providers';
import type { CoworkMessage } from '../../coworkStore';
import type { CoworkStore } from '../../coworkStore';
import {
  type ApiConfigResolution,
  resolveRawApiConfig,
  resolveRawApiConfigForModelRef,
} from '../claudeSettings';
import { getSkillsRoot } from '../coworkUtil';
import type { McpServerManager } from '../mcpServerManager';
import type {
  CoworkContinueOptions,
  CoworkRuntime,
  CoworkRuntimeEvents,
  CoworkStartOptions,
  PermissionResult,
} from './types';

// ── Types ──

/** Minimal type for the Pi AgentSession — only the methods used by this adapter. */
interface PiSession {
  prompt(text: string): Promise<void>;
  abort(): Promise<void>;
  abortBash(): void;
  setModel(model: unknown): Promise<void>;
  subscribe(listener: (event: PiEvent) => void): () => void;
}

interface PiContentBlock {
  type: string;
  text?: string;
  thinking?: string;
}

interface PiEvent {
  type: string;
  message?: {
    id?: string;
    role: string;
    // For message_update / message_end this is the FULL accumulating snapshot
    // (blocks: {type:'text',text} / {type:'thinking',thinking}), NOT a delta.
    content: string | PiContentBlock[];
    stopReason?: string;
    errorMessage?: string;
  };
  // message_update carries the fine-grained streaming delta here.
  assistantMessageEvent?: {
    type: string; // text_delta | thinking_delta | text_end | thinking_end | ...
    delta?: string;
    content?: string;
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
  /** Message id for the visible answer (text) bubble of the current turn. */
  assistantMessageId: string | null;
  /** Message id for the thinking bubble of the current turn. */
  thinkingMessageId: string | null;
  /** Latest full snapshot of answer text for the current turn. */
  answerText: string;
  /** Latest full snapshot of thinking text for the current turn. */
  thinkingText: string;
  confirmationMode: 'modal' | 'text';
  unsubscribe: () => void;
  /** toolCallId → tool_result message id, for streaming updates + de-dup */
  toolResultMessageIdByCallId: Map<string, string>;
}

// ── Dynamic imports ──

interface PiModules {
  createAgentSession: (options: Record<string, unknown>) => Promise<{ session: PiSession }>;
  DefaultResourceLoader: new (options: Record<string, unknown>) => PiResourceLoader;
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

// ── PiRuntimeAdapter ──

// Force ANSI color output from CLI tools (npm, git, jest, etc.) run by
// Pi's bash tool.  Pi executes commands via spawn + pipe, so TTY-aware
// tools won't emit escape sequences without this env var.
if (!process.env.FORCE_COLOR) process.env.FORCE_COLOR = '1';

export class PiRuntimeAdapter extends EventEmitter implements CoworkRuntime {
  private readonly activeSessions = new Map<string, ActivePiSession>();
  private readonly approvalSessionMap = new Map<string, string>();
  private store: CoworkStore | null = null;
  private mcpServerManager: McpServerManager | null = null;

  setCoworkStore(store: CoworkStore): void {
    this.store = store;
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

  // ── CoworkRuntime.on/off ──

  override on<U extends keyof CoworkRuntimeEvents>(
    event: U,
    listener: CoworkRuntimeEvents[U],
  ): this {
    return super.on(event, listener);
  }

  override off<U extends keyof CoworkRuntimeEvents>(
    event: U,
    listener: CoworkRuntimeEvents[U],
  ): this {
    return super.off(event, listener);
  }

  // ── Session lifecycle ──

  async startSession(
    sessionId: string,
    prompt: string,
    options: CoworkStartOptions = {},
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

    try {
      const workspaceRoot = options.workspaceRoot || process.cwd();
      const sessionOptions: Record<string, unknown> = { cwd: workspaceRoot };

      // System prompt — user config only. Skills are discovered and appended
      // by the resource loader (additionalSkillPaths), which renders them via
      // pi's formatSkillsForPrompt — no manual injection here to avoid
      // duplicating the skills section.
      const basePrompt = options.systemPrompt?.trim() || '';
      const history = options.conversationHistory;
      const historyBlock =
        history && history.length > 0
          ? [
              '=== PREVIOUS CONVERSATION (context only, do not re-execute) ===',
              ...history.map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`),
              '=== END PREVIOUS CONVERSATION ===',
            ].join('\n')
          : '';
      const effectiveSystemPrompt = [basePrompt, historyBlock].filter(Boolean).join('\n\n');

      // Pi's createAgentSession does not accept a systemPrompt option. Its
      // default resource loader supplies the Pi Coding Assistant identity,
      // so override that loader per session to keep expert contexts isolated.
      const resourceLoader = await this.createPiResourceLoader(
        pi,
        workspaceRoot,
        effectiveSystemPrompt,
        options.skillIds,
      );
      sessionOptions.resourceLoader = resourceLoader;

      // Resolve model early — needed by both MCP proxy and subagent tool
      const resolvedModel = await resolvePiModel(pi, options.modelOverride);
      sessionOptions.model = resolvedModel.model;
      if (resolvedModel.modelRuntime) {
        sessionOptions.modelRuntime = resolvedModel.modelRuntime;
      }

      // Build custom tools: MCP proxy + optional subagent for Team Leads
      const customTools: Record<string, unknown>[] = [];

      // MCP tools: register a single proxy tool (pi-mcp-adapter pattern)
      const mcpProxyTool = this.buildMcpProxyTool();
      if (mcpProxyTool) {
        customTools.push(mcpProxyTool);
      }

      // Subagent tool: register if the session agent is a Team Lead
      if (this.store) {
        const candidateAgentIds = options.expertIds?.length
          ? options.expertIds
          : options.agentId
            ? [options.agentId]
            : [];
        const agent = candidateAgentIds
          .map(agentId => this.store?.getAgent(agentId))
          .find(
            candidate =>
              candidate?.source === CoworkSessionExpertSource.Package && candidate.presetId,
          );
        if (agent && agent.source === CoworkSessionExpertSource.Package && agent.presetId) {
          // Check if any member agents exist for this team
          const allAgents = this.store.listAgents();
          const hasMembers = allAgents.some(
            a => a.source === CoworkSessionExpertSource.Member && a.presetId === agent.presetId,
          );
          if (hasMembers) {
            const subagentTool = this.buildSubagentTool(
              agent.presetId,
              resolvedModel,
              options.workspaceRoot,
            );
            if (subagentTool) {
              customTools.push(subagentTool);
            }
          }
        }
      }

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
        requestedSystemPrompt: options.systemPrompt?.trim() || '',
        assistantMessageId: null,
        thinkingMessageId: null,
        answerText: '',
        thinkingText: '',
        confirmationMode: options.confirmationMode || 'modal',
        unsubscribe: () => {},
        toolResultMessageIdByCallId: new Map(),
      };

      // Subscribe to Pi events before sending the prompt
      active.unsubscribe = session.subscribe(event => {
        if (abortController.signal.aborted) return;
        this.handlePiEvent(sessionId, active, event);
      });

      this.activeSessions.set(sessionId, active);

      // Send the prompt (may include conversation history for restart restores)
      await session.prompt(options._piPromptOverride || prompt);
    } catch (error) {
      this.activeSessions.delete(sessionId);
      if (abortController.signal.aborted) {
        this.emit('sessionStopped', sessionId);
        return;
      }
      const message = error instanceof Error ? error.message : String(error);
      this.emit('error', sessionId, classifyCoworkError(message));
      throw error;
    }
  }

  async continueSession(
    sessionId: string,
    prompt: string,
    options: CoworkContinueOptions = {},
  ): Promise<void> {
    const active = this.activeSessions.get(sessionId);
    if (!active) {
      console.log(
        `[PiRuntime] continueSession: session ${sessionId} not active, restoring context via prompt`,
      );
      const storedSession = this.store?.getSession(sessionId);
      // Load previous messages and embed them as context prepended to the PI prompt.
      // The user message saved/emitted to the renderer stays the clean original prompt.
      const history = storedSession?.messages ?? [];
      const contextParts = history
        .filter(m => m.type === 'user' || m.type === 'assistant')
        .map(m => `${m.type === 'user' ? 'User' : 'Assistant'}: ${m.content}`);
      const piPrompt =
        contextParts.length > 0 ? `${contextParts.join('\n\n')}\n\nUser: ${prompt}` : prompt;
      return this.startSession(sessionId, prompt, {
        ...options,
        systemPrompt: options.systemPrompt ?? storedSession?.systemPrompt,
        expertIds: options.expertIds ?? storedSession?.experts.map(expert => expert.expertId),
        workspaceRoot: options.workspaceRoot ?? storedSession?.cwd,
        agentId: options.agentId ?? storedSession?.agentId,
        modelOverride: options.modelOverride ?? storedSession?.modelOverride,
        _piPromptOverride: piPrompt,
      });
    }

    const requestedSystemPrompt = options.systemPrompt?.trim();
    if (
      requestedSystemPrompt !== undefined &&
      requestedSystemPrompt !== active.requestedSystemPrompt
    ) {
      const history = this.store?.getSession(sessionId)?.messages ?? [];
      return this.startSession(sessionId, prompt, {
        ...options,
        conversationHistory: history
          .filter(
            (message): message is CoworkMessage & { type: 'user' | 'assistant' } =>
              message.type === 'user' || message.type === 'assistant',
          )
          .map(message => ({ role: message.type, content: message.content })),
      });
    }

    // Reset turn state
    active.answerText = '';
    active.thinkingText = '';
    active.assistantMessageId = null;
    active.thinkingMessageId = null;
    active.toolResultMessageIdByCallId.clear();

    // Emit user message (persisted to SQLite, same as startSession).
    const userMsg: CoworkMessage = {
      id: randomUUID(),
      type: 'user',
      content: prompt,
      timestamp: Date.now(),
      metadata: options.skillIds?.length ? { skillIds: options.skillIds } : undefined,
    };
    const persisted = this.store ? this.store.addMessage(sessionId, userMsg) : userMsg;
    this.emit('message', sessionId, persisted);

    try {
      await active.piSession.prompt(prompt);
    } catch (error) {
      if (active.abortController.signal.aborted) {
        this.emit('sessionStopped', sessionId);
        return;
      }
      const message = error instanceof Error ? error.message : String(error);
      this.emit('error', sessionId, classifyCoworkError(message));
      throw error;
    }
  }

  async patchSession(sessionId: string, patch: OpenClawSessionPatch): Promise<void> {
    const active = this.activeSessions.get(sessionId);
    if (!active || !patch.model) return;

    try {
      const pi = await getPiModules();
      const resolvedModel = await resolvePiModel(pi, patch.model, active.modelRuntime);
      active.modelRuntime = resolvedModel.modelRuntime;
      const model = resolvedModel.model;
      await active.piSession.setModel(model);
      console.log('[PiRuntime] Model updated via patchSession:', patch.model);
    } catch (err) {
      console.warn('[PiRuntime] Failed to update model via patchSession:', err);
    }
  }

  stopSession(sessionId: string): void {
    const active = this.activeSessions.get(sessionId);
    if (!active) return;

    // Only abort the current turn — keep the session alive in activeSessions
    // so continueSession can find it and preserve conversation history.
    // Kill any running bash process first — PI SDK's abort() only stops the
    // AI agent loop, not tool subprocesses (abortBash is only called by dispose).
    active.piSession.abortBash();
    active.abortController.abort();
    void active.piSession.abort();
    this.emit('sessionStopped', sessionId);
  }

  stopAllSessions(): void {
    for (const [sessionId] of this.activeSessions) {
      this.stopSession(sessionId);
    }
  }

  respondToPermission(requestId: string, result: PermissionResult): void {
    const sessionId = this.approvalSessionMap.get(requestId);
    if (!sessionId) return;
    this.approvalSessionMap.delete(requestId);

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

  getSessionConfirmationMode(sessionId: string): 'modal' | 'text' | null {
    return this.activeSessions.get(sessionId)?.confirmationMode || null;
  }

  onSessionDeleted(sessionId: string): void {
    this.stopSession(sessionId);
    this.activeSessions.delete(sessionId);
  }

  // ── Chat mode: direct LLM without agent loop ──

  private async createPiResourceLoader(
    pi: PiModules,
    cwd: string,
    systemPrompt: string,
    skillIds?: string[],
  ): Promise<PiResourceLoader> {
    const resourceLoader = new pi.DefaultResourceLoader({
      cwd,
      agentDir: pi.getAgentDir(),
      // ZhiYuanAgent skills come exclusively from the app-managed SKILLs dirs —
      // never from the developer's global ~/.agents/skills (which would leak
      // dev-only tooling skills like ai-sdk/shadcn into user sessions).
      noSkills: true,
      additionalSkillPaths: this.resolveZhiyuanSkillDirs(),
      skillsOverride:
        skillIds === undefined
          ? undefined
          : (base: { skills: Array<{ name?: string; id?: string }>; diagnostics: unknown[] }) => ({
              ...base,
              skills: base.skills.filter(
                skill => skillIds.includes(skill.id || '') || skillIds.includes(skill.name || ''),
              ),
            }),
      systemPromptOverride: () => systemPrompt || '',
      appendSystemPromptOverride: (): string[] => [],
    });
    await resourceLoader.reload();
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
        break;

      case 'turn_start':
        // New turn → fresh answer + thinking messages, created lazily on first content.
        active.assistantMessageId = null;
        active.thinkingMessageId = null;
        active.answerText = '';
        active.thinkingText = '';
        break;

      case 'message_start':
        break;

      case 'message_update': {
        // message.content is the FULL accumulating snapshot (not a delta), split into
        // text and thinking blocks. Derive full snapshots and SET (never append) —
        // appending the snapshot each tick is what caused the repeated content.
        const { text, thinking } = extractStreamingSnapshot(event.message);
        if (thinking && thinking !== active.thinkingText) {
          active.thinkingText = thinking;
          this.streamInto(sessionId, active, 'thinking', thinking);
        }
        if (text && text !== active.answerText) {
          active.answerText = text;
          this.streamInto(sessionId, active, 'answer', text);
        }
        break;
      }

      case 'message_end': {
        if (event.message?.role === 'assistant') {
          if (event.message.stopReason === 'error') {
            const errMsg = event.message.errorMessage || 'Pi agent error';
            const errDetail = event.message.content
              ? typeof event.message.content === 'string'
                ? event.message.content
                : JSON.stringify(event.message.content)
              : '(no content)';
            console.error('[PiRuntime] Assistant error:', errMsg, 'detail:', errDetail);
            // Persist a system error message so the error survives session
            // switching and is visible in the message list.
            // Store the classified error kind so the renderer can translate it
            // into a user-friendly message via i18n (e.g. "任务执行出错，请重试…").
            // Raw errMsg is kept for console diagnostics only.
            const classified = classifyCoworkError(errMsg);
            if (this.store) {
              this.store.updateSession(sessionId, { status: 'error' });
              this.store.addMessage(sessionId, {
                type: 'system',
                content: '',
                metadata: { error: errMsg, errorKind: classified.kind },
              });
            }
            this.emit('error', sessionId, classified);
            return;
          }

          const { text, thinking } = extractStreamingSnapshot(event.message);
          const finalThinking = thinking || active.thinkingText;
          let finalAnswer = text || active.answerText;

          // Fallback: some Pi models emit the entire response inside thinking
          // blocks and leave the visible text block empty. To avoid showing only
          // a collapsed thinking step with no answer bubble, surface the
          // thinking content as the final answer when no text was produced.
          if (!finalAnswer.trim() && finalThinking.trim()) {
            finalAnswer = finalThinking;
          }

          // Finalize thinking bubble (if any) on its own id.
          if (finalThinking.trim()) {
            active.thinkingText = finalThinking;
            this.finalizeMessage(sessionId, active, 'thinking', finalThinking);
          }
          // Finalize the answer bubble on its own id.
          if (finalAnswer.trim()) {
            active.answerText = finalAnswer;
            this.finalizeMessage(sessionId, active, 'answer', finalAnswer);
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
        // Avoid duplicate result for the same call.
        if (active.toolResultMessageIdByCallId.has(event.toolCallId)) break;
        const resultText = extractToolResultText(event.result);
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

      case 'agent_end':
        // Persist completed status to SQLite so the session shows as "completed"
        // after switching away and back (mirrors OpenClaw adapter pattern).
        if (this.store) {
          this.store.updateSession(sessionId, { status: 'completed' });
        }
        this.emit('complete', sessionId, null);
        break;

      case 'auto_retry_start':
        // Pi is retrying after an error — silently wait
        break;

      default:
        // Silently ignore unknown/internal events
        if (event.type && !event.type.startsWith('_')) {
          console.log('[PiRuntime] Unhandled event type:', event.type);
        }
    }
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
    const metadata =
      kind === 'thinking'
        ? { isStreaming: false, isFinal: true, isThinking: true }
        : { isStreaming: false, isFinal: true };
    if (this.store) {
      this.store.updateMessage(sessionId, messageId, { content, metadata });
    }
    this.emit('messageUpdate', sessionId, messageId, content, metadata);
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

  /**
   * Build a subagent tool that delegates tasks to Team members.
   *
   * Team Lead agents use this tool to schedule member agents. Each member's
   * markdown definition (synced to pi agents dir during registration) is read
   * and used as the system prompt for a sub-session.
   *
   * Currently supports single mode (agent + task). Parallel and chain modes
   * will be added in Phase 3 follow-up.
   */
  private buildSubagentTool(
    presetId: string,
    resolvedModel: { model: Record<string, unknown>; modelRuntime: PiModelRuntime | null },
    workspaceRoot?: string,
  ): Record<string, unknown> | null {
    const piAgentsDir = this.getPiAgentsDir();
    const prefix = `${presetId}--`;

    // Collect available member agents from pi agents directory
    const availableAgents: Array<{ id: string; filePath: string }> = [];
    if (fs.existsSync(piAgentsDir)) {
      for (const entry of fs.readdirSync(piAgentsDir)) {
        if (entry.startsWith(prefix) && entry.endsWith('.md')) {
          // Extract agent ID from filename: <presetId>--<agentId>.md
          const agentId = entry.slice(prefix.length, -3); // Remove prefix and .md
          availableAgents.push({ id: agentId, filePath: path.join(piAgentsDir, entry) });
        }
      }
    }

    if (availableAgents.length === 0) return null;

    const agentList = availableAgents.map(a => `  - ${a.id}`).join('\n');
    const { model, modelRuntime } = resolvedModel;

    return {
      name: 'subagent',
      label: 'Subagent',
      description:
        'Delegate tasks to specialized team members with isolated context. ' +
        'Available members:\n' +
        agentList +
        '\n\n' +
        'Use {agent, task} for single-member delegation. ' +
        'The member will execute independently and return results to you.',
      parameters: {
        type: 'object',
        properties: {
          agent: {
            type: 'string',
            description: `Name of the team member to delegate to. Available: ${availableAgents.map(a => a.id).join(', ')}`,
          },
          task: {
            type: 'string',
            description: 'Complete, self-contained task description with all necessary context.',
          },
        },
        required: ['agent', 'task'],
        additionalProperties: false,
      },

      execute: async (_toolCallId: string, params: Record<string, unknown>) => {
        const agentId = typeof params.agent === 'string' ? params.agent.trim() : '';
        const task = typeof params.task === 'string' ? params.task.trim() : '';

        if (!agentId || !task) {
          return {
            content: [{ type: 'text', text: 'Both "agent" and "task" parameters are required.' }],
            details: {},
          };
        }

        // Find the agent MD file
        const agentFile = availableAgents.find(a => a.id === agentId);
        if (!agentFile) {
          return {
            content: [
              {
                type: 'text',
                text: `Unknown agent "${agentId}". Available agents: ${availableAgents.map(a => a.id).join(', ') || 'none'}`,
              },
            ],
            details: {},
          };
        }

        // Read agent system prompt from MD file
        let systemPrompt: string;
        try {
          const content = fs.readFileSync(agentFile.filePath, 'utf-8');
          // Strip YAML frontmatter to get body as system prompt
          const bodyMatch = content.match(/^---\n.*?\n---\n(.*)/s);
          systemPrompt = bodyMatch ? bodyMatch[1].trim() : content;
        } catch (err) {
          return {
            content: [
              {
                type: 'text',
                text: `Failed to read agent definition for "${agentId}": ${err instanceof Error ? err.message : String(err)}`,
              },
            ],
            details: {},
          };
        }

        // Create a sub-session for the member agent
        const pi = await getPiModules();
        let subSession: PiSession | null = null;

        try {
          const subOptions: Record<string, unknown> = {
            cwd: workspaceRoot || process.cwd(),
            model,
          };
          subOptions.resourceLoader = await this.createPiResourceLoader(
            pi,
            subOptions.cwd as string,
            systemPrompt,
          );
          if (modelRuntime) {
            subOptions.modelRuntime = modelRuntime;
          }

          const { session } = await pi.createAgentSession(subOptions);
          subSession = session;

          // Collect the final output from the sub-session
          const finalOutput = await new Promise<string>((resolve, reject) => {
            const timeout = setTimeout(() => {
              resolve('(subagent timed out after 120s)');
            }, 120_000);

            const unsubscribe = session.subscribe((event: PiEvent) => {
              if (event.type === 'message_end' && event.message?.role === 'assistant') {
                clearTimeout(timeout);
                unsubscribe();

                const msg = event.message;
                if (Array.isArray(msg.content)) {
                  const textBlocks = msg.content
                    .filter((b: PiContentBlock) => b.type === 'text' && b.text)
                    .map((b: PiContentBlock) => b.text!)
                    .join('\n');
                  resolve(textBlocks || '(no output)');
                } else if (typeof msg.content === 'string') {
                  resolve(msg.content || '(no output)');
                } else {
                  resolve('(no output)');
                }
              }

              if (
                event.type === 'error' ||
                (event.type === 'message_end' && event.message?.stopReason === 'error')
              ) {
                clearTimeout(timeout);
                unsubscribe();
                const errorMsg = event.message?.errorMessage || 'Subagent encountered an error';
                resolve(`Error: ${errorMsg}`);
              }
            });

            // Send the task
            session.prompt(task).catch((err: Error) => {
              clearTimeout(timeout);
              unsubscribe();
              reject(err);
            });
          });

          return {
            content: [{ type: 'text', text: finalOutput }],
            details: { agentId },
          };
        } catch (err) {
          return {
            content: [
              {
                type: 'text',
                text: `Subagent "${agentId}" failed: ${err instanceof Error ? err.message : String(err)}`,
              },
            ],
            details: { agentId },
          };
        } finally {
          // Clean up sub-session
          if (subSession) {
            try {
              await subSession.abort();
            } catch {
              // Ignore cleanup errors
            }
          }
        }
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
const DEFAULT_PI_CONTEXT_WINDOW = 32768;
const DEFAULT_PI_MAX_TOKENS = 4096;
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

function buildPiCustomModel(resolution: ApiConfigResolution): Record<string, unknown> {
  const config = resolution.config;
  const providerMetadata = resolution.providerMetadata;
  if (!config || !providerMetadata) {
    throw new Error(resolution.error || 'Pi model configuration is unavailable.');
  }

  return {
    id: config.model,
    name: providerMetadata.modelName || config.model,
    api: config.apiType === 'anthropic' ? 'anthropic-messages' : 'openai-completions',
    provider: providerMetadata.providerName,
    baseUrl: config.baseURL,
    reasoning: false,
    input: providerMetadata.supportsImage ? ['text', 'image'] : ['text'],
    cost: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
    },
    contextWindow:
      providerMetadata.contextWindow || providerMetadata.contextTokens || DEFAULT_PI_CONTEXT_WINDOW,
    maxTokens: providerMetadata.maxTokens || DEFAULT_PI_MAX_TOKENS,
  };
}

async function resolvePiLocalModelRuntime(
  pi: PiModules,
  resolution: ApiConfigResolution,
  existingModelRuntime?: PiModelRuntime | null,
): Promise<PiModelRuntime | null> {
  const config = resolution.config;
  const providerMetadata = resolution.providerMetadata;
  if (!config || !providerMetadata || !isLocalProviderName(providerMetadata.providerName)) {
    return null;
  }

  const modelRuntime = existingModelRuntime ?? (await pi.ModelRuntime.create());
  const model = buildPiCustomModel(resolution);
  const providerId = providerMetadata.providerName;
  modelRuntime.registerProvider(providerId, {
    name: providerId,
    baseUrl: config.baseURL,
    api: model.api,
    models: [model],
  });
  await modelRuntime.setRuntimeApiKey(providerId, config.apiKey?.trim() || PI_LOCAL_API_KEY);
  return modelRuntime;
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
  const modelRuntime = await resolvePiLocalModelRuntime(pi, resolution, existingModelRuntime);
  const customModel = buildPiCustomModel(resolution);
  const localModel = modelRuntime?.getModel(
    resolution.providerMetadata.providerName,
    resolution.config.model,
  );

  return {
    model:
      builtinModel ??
      (localModel && typeof localModel === 'object'
        ? (localModel as Record<string, unknown>)
        : customModel),
    modelRuntime,
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
