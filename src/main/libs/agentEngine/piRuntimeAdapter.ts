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
import path from 'path';

import { classifyCoworkError } from '../../../common/coworkError';
import type { OpenClawSessionPatch } from '../../../common/openclawSession';
import type { CoworkMessage } from '../../coworkStore';
import type { CoworkStore } from '../../coworkStore';
import { getCurrentApiConfig } from '../claudeSettings';
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
  getModel: (provider: string, modelId: string) => unknown;
  completeSimple: (
    model: unknown,
    context: { messages: Array<{ role: string; content: string }> },
  ) => Promise<{ content: Array<{ text: string }> }>;
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

export class PiRuntimeAdapter extends EventEmitter implements CoworkRuntime {
  private readonly activeSessions = new Map<string, ActivePiSession>();
  private readonly approvalSessionMap = new Map<string, string>();
  private store: CoworkStore | null = null;
  private mcpServerManager: McpServerManager | null = null;

  setCoworkStore(store: CoworkStore): void { this.store = store; }
  setMcpServerManager(mgr: McpServerManager): void { this.mcpServerManager = mgr; this.mcpInjected = true; }
  hasMcpServerManager(): boolean { return this.mcpInjected; }
  private mcpInjected = false;

  // Throttle state
  private readonly lastMessageUpdateEmitTime = new Map<string, number>();
  private readonly pendingMessageUpdateTimer = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly pendingMessageUpdate = new Map<string, { content: string; metadata?: Record<string, unknown> }>();
  // Separate throttle for synchronous SQLite writes (see STORE_UPDATE_THROTTLE_MS).
  private readonly lastStoreUpdateTime = new Map<string, number>();
  private readonly pendingStoreUpdate = new Map<string, { content: string; metadata: Record<string, unknown> }>();
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
    const hasContent = prompt.trim() || (options.imageAttachments && options.imageAttachments.length > 0);
    if (!hasContent) {
      throw new Error('Prompt is required.');
    }

    if (this.activeSessions.has(sessionId)) {
      this.stopSession(sessionId);
    }

    const pi = await getPiModules();

    // Emit user message to UI (unless the caller already did)
    if (!options.skipInitialUserMessage) {
      const userMsg: CoworkMessage = {
        id: randomUUID(),
        type: 'user',
        content: prompt,
        timestamp: Date.now(),
        metadata: options.skillIds?.length ? { skillIds: options.skillIds } : undefined,
      };
      this.emit('message', sessionId, userMsg);
    }

    const abortController = new AbortController();

    try {
      const sessionOptions: Record<string, unknown> = {
        cwd: options.workspaceRoot || process.cwd(),
      };

      // System prompt — merge user config + skills manifest
      const basePrompt = options.systemPrompt?.trim() || '';
      const skillsPrompt = this.buildSkillsPrompt();
      const mergedPrompt = [basePrompt, skillsPrompt].filter(Boolean).join('\n\n');
      if (mergedPrompt) {
        sessionOptions.systemPrompt = mergedPrompt;
      }

      // MCP tools — wrap as Pi custom tools so the agent can call them
      const mcpTools = this.buildMcpCustomTools();
      if (mcpTools.length > 0) {
        sessionOptions.customTools = mcpTools;
      }

      // Resolve provider and model from RongxinAI's current API config.
      // The config stores apiType (anthropic/openai) + model, but Pi needs a provider name.
      // We infer the provider from which API keys are set in the environment.
      const apiConfig = getCurrentApiConfig('local');
      const modelId = apiConfig?.model || 'claude-sonnet-4-6';
      const provider = resolvePiProvider();
      console.log('[PiRuntime] Starting session with provider:', provider, 'model:', modelId);
      sessionOptions.model = pi.getModel(provider, modelId);

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
        assistantMessageId: null,
        thinkingMessageId: null,
        answerText: '',
        thinkingText: '',
        confirmationMode: options.confirmationMode || 'modal',
        unsubscribe: () => {},
        toolResultMessageIdByCallId: new Map(),
      };

      // Subscribe to Pi events before sending the prompt
      active.unsubscribe = session.subscribe((event) => {
        if (abortController.signal.aborted) return;
        this.handlePiEvent(sessionId, active, event);
      });

      this.activeSessions.set(sessionId, active);

      // Send the prompt
      await session.prompt(prompt);

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
      console.log(`[PiRuntime] continueSession: session ${sessionId} not active, falling back to startSession`);
      return this.startSession(sessionId, prompt, options);
    }

    // Reset turn state
    active.answerText = '';
    active.thinkingText = '';
    active.assistantMessageId = null;
    active.thinkingMessageId = null;
    active.toolResultMessageIdByCallId.clear();

    // Emit user message
    const userMsg: CoworkMessage = {
      id: randomUUID(),
      type: 'user',
      content: prompt,
      timestamp: Date.now(),
      metadata: options.skillIds?.length ? { skillIds: options.skillIds } : undefined,
    };
    this.emit('message', sessionId, userMsg);

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
      const provider = resolvePiProvider();
      const model = pi.getModel(provider, patch.model);
      await active.piSession.setModel(model);
      console.log('[PiRuntime] Model updated via patchSession:', patch.model);
    } catch (err) {
      console.warn('[PiRuntime] Failed to update model via patchSession:', err);
    }
  }

  stopSession(sessionId: string): void {
    const active = this.activeSessions.get(sessionId);
    if (!active) return;

    active.abortController.abort();
    active.unsubscribe();
    void active.piSession.abort();
    this.activeSessions.delete(sessionId);
    this.clearApprovalsBySession(sessionId);
    this.clearThrottleStateBySession(sessionId);
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
  }

  // ── Chat mode: direct LLM without agent loop ──

  /**
   * Send a prompt directly to the LLM, bypassing the agent loop.
   * For Chat mode — fast response, no tool execution.
   */
  async chatDirect(prompt: string, modelId?: string): Promise<string> {
    const pi = await getPiModules();
    const provider = resolvePiProvider();
    const model = pi.getModel(provider, modelId || 'claude-sonnet-4-6');
    const result = await pi.completeSimple(model, {
      messages: [{ role: 'user', content: prompt }],
    });
    return result.content
      .filter((c): c is { text: string } => 'text' in c)
      .map((c) => c.text)
      .join('');
  }

  // ── Private: event mapping ──

  private handlePiEvent(
    sessionId: string,
    active: ActivePiSession,
    event: PiEvent,
  ): void {
    // Debug: log all Pi events to diagnose frontend rendering issues
    if (event.type !== 'message_update') {
      console.log('[PiRuntime] Event:', event.type,
        event.message?.role ? `role=${event.message.role}` : '',
        event.message?.stopReason ? `stopReason=${event.message.stopReason}` : '');
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
              ? (typeof event.message.content === 'string' ? event.message.content : JSON.stringify(event.message.content))
              : '(no content)';
            console.error('[PiRuntime] Assistant error:', errMsg, 'detail:', errDetail);
            if (this.store) {
              this.store.updateSession(sessionId, { status: 'error' });
            }
            this.emit('error', sessionId, classifyCoworkError(errMsg));
            return;
          }

          const { text, thinking } = extractStreamingSnapshot(event.message);
          const finalThinking = thinking || active.thinkingText;
          const finalAnswer = text || active.answerText;

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
      metadata: kind === 'thinking'
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
    const metadata = kind === 'thinking'
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
    const metadata = kind === 'thinking'
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
   * Build a skills manifest prompt using Pi's native skill discovery.
   * Pi SDK scans the RongxinAI SKILLs directory for SKILL.md files,
   * parses YAML frontmatter, and formats them as XML with proper escaping.
   *
   * This replaces the hand-rolled XML builder — Pi's formatSkillsForPrompt
   * follows the Agent Skills standard (agentskills.io).
   */
  private buildSkillsPrompt(): string {
    try {
      const skillsDir = path.join(app.getPath('userData'), 'SKILLs');
      // Use Pi's native skill loader (sync, discovers SKILL.md files recursively)
      const { loadSkillsFromDir } = require('@earendil-works/pi-coding-agent/dist/core/skills.js');
      const result = loadSkillsFromDir({ dir: skillsDir, source: 'rongxinai' });
      if (result.skills.length === 0) return '';
      // Use Pi's native formatter (XML escaping, disableModelInvocation support)
      const { formatSkillsForPrompt } = require('@earendil-works/pi-coding-agent/dist/core/skills.js');
      return formatSkillsForPrompt(result.skills);
    } catch {
      return '';
    }
  }

  private buildMcpCustomTools(): Record<string, unknown>[] {
    if (!this.mcpServerManager) return [];
    const manifest = this.mcpServerManager.toolManifest;
    if (manifest.length === 0) return [];

    const mgr = this.mcpServerManager;
    return manifest.map((entry) => ({
      name: `mcp__${sanitizeMcpToolName(entry.server)}__${sanitizeMcpToolName(entry.name)}`,
      description: `[MCP: ${entry.server}] ${entry.description}`,
      parameters: entry.inputSchema as Record<string, unknown>,
      execute: async (args: Record<string, unknown>) => {
        // Pi SDK may pass the call ID string instead of the args object under
        // certain error conditions.  Guard against any non-record value so the
        // tool returns a graceful error instead of passing a string to
        // mgr.callTool (which expects Record<string, unknown>).
        if (!args || typeof args !== 'object' || Array.isArray(args)) {
          console.warn(
            `[PiRuntime] MCP tool "${entry.name}" received non-object args:`,
            typeof args,
          );
          return JSON.stringify({
            error: 'Tool arguments were not passed as a record — this is a Pi SDK internal error.',
          });
        }
        try {
          const result = await mgr.callTool(entry.server, entry.name, args);
          if (typeof result === 'string') return result;
          return JSON.stringify(result);
        } catch (err) {
          return JSON.stringify({
            error: err instanceof Error ? err.message : String(err),
          });
        }
      },
    }));
  }
}

// ── Provider resolution ──

/**
 * Infer the Pi provider name from environment variables.
 * RongxinAI stores keys as DEEPSEEK_API_KEY, ANTHROPIC_API_KEY, etc.
 * Pi SDK looks up providers by name (deepseek, anthropic, openai, etc.).
 */
function resolvePiProvider(): string {
  const candidates = ['deepseek', 'anthropic', 'openai', 'google'];
  for (const provider of candidates) {
    const envKey = `${provider.toUpperCase()}_API_KEY`;
    if (process.env[envKey]) {
      return provider;
    }
  }
  // Fallback: try any provider (Pi will error if the key is missing)
  return 'anthropic';
}

// ── Text extraction helpers ──

/**
 * Extract full text and thinking snapshots from a Pi message.
 *
 * For message_update / message_end, `content` is the FULL accumulating snapshot
 * (array of {type:'text',text} / {type:'thinking',thinking} blocks), NOT a delta.
 * We concatenate each kind so callers can SET (not append) their buffers.
 */
function extractStreamingSnapshot(message?: PiEvent['message']): { text: string; thinking: string } {
  if (!message?.content) return { text: '', thinking: '' };
  if (typeof message.content === 'string') return { text: message.content, thinking: '' };

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

/**
 * Sanitize an MCP server name or tool name so it matches the OpenAI API
 * function name pattern: `^[a-zA-Z0-9_-]+$`.
 * Characters outside this range are replaced with `_`, and consecutive
 * underscores are collapsed to avoid double/mangled names.
 */
function sanitizeMcpToolName(name: string): string {
  return name
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
}

/** Extract a display string from a Pi tool result (string, {text}, array of blocks, or JSON). */
function extractToolResultText(result: unknown): string {
  if (result === undefined || result === null) return '';
  if (typeof result === 'string') return result;
  if (Array.isArray(result)) {
    return result
      .map((b) => extractToolResultText(b))
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
