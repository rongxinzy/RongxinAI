/**
 * Assistant and thinking bubbles for one Pi turn.
 *
 * Streaming updates are throttled twice: the renderer emit, and the
 * synchronous store write. Finalizing a bubble flushes both.
 */

import { randomUUID } from 'crypto';

import type { CoworkMessage, CoworkStore } from '../../coworkStore';
import { hasReportedTokenUsage } from '../../../shared/cowork/messageUsage';
import type { ActivePiSession, PiStartupLatency, PiUsage } from './piRuntimeSessionState';
import { MESSAGE_UPDATE_THROTTLE_MS, STORE_UPDATE_THROTTLE_MS } from './piRuntimeSessionState';

export interface PiAssistantTranscriptHost {
  getStore(): CoworkStore | null;
  emitMessage(sessionId: string, message: CoworkMessage): void;
  emitMessageUpdate(
    sessionId: string,
    messageId: string,
    content: string,
    metadata?: Record<string, unknown>,
  ): void;
  getActiveSession(sessionId: string): ActivePiSession | undefined;
}

export class PiAssistantTranscript {
  private readonly lastMessageUpdateEmitTime = new Map<string, number>();
  private readonly pendingMessageUpdateTimer = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly pendingMessageUpdate = new Map<
    string,
    { content: string; metadata?: Record<string, unknown> }
  >();
  private readonly lastStoreUpdateTime = new Map<string, number>();
  private readonly pendingStoreUpdate = new Map<
    string,
    { content: string; metadata: Record<string, unknown> }
  >();
  private readonly pendingStoreUpdateTimer = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly throttleSessionByMessageId = new Map<string, string>();

  constructor(private readonly host: PiAssistantTranscriptHost) {}

  private noteThrottleMessage(sessionId: string, messageId: string): void {
    this.throttleSessionByMessageId.set(messageId, sessionId);
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
  ensureMessage(
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
    const created = this.host.getStore() ? this.host.getStore().addMessage(sessionId, seed) : seed;
    if (kind === 'thinking') active.thinkingMessageId = created.id;
    else active.assistantMessageId = created.id;
    this.host.emitMessage(sessionId, created);
    return created.id;
  }

  /** Push a streaming (non-final) content snapshot to the answer/thinking message. */
  streamInto(
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
  finalizeMessage(
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
    if (this.host.getStore()) {
      this.host.getStore().updateMessage(sessionId, messageId, { content, metadata });
    }
    this.host.emitMessageUpdate(sessionId, messageId, content, metadata);
    if (kind === 'thinking') {
      active.thinkingLifecycle.markMessageFinalized();
    }
  }

  /**
   * Closes placeholder bubbles that never received text, so a finished turn can
   * no longer look like it is still streaming.
   */
  closeIdlePlaceholders(sessionId: string, active: ActivePiSession): void {
    const placeholderIds = [active.thinkingMessageId, active.assistantMessageId].filter(
      (messageId): messageId is string => Boolean(messageId),
    );
    for (const messageId of placeholderIds) {
      this.clearPendingMessageUpdate(messageId);
      this.clearPendingStoreUpdate(messageId);
    }
    if (!this.host.getStore() || placeholderIds.length === 0) return;

    const messages = this.host.getStore().getSession(sessionId)?.messages ?? [];
    for (const messageId of placeholderIds) {
      const message = messages.find(candidate => candidate.id === messageId);
      // A bubble finalizeMessage already closed (the ordinary turn with text) needs
      // no second write, emit, or session updated_at bump.
      if (!message || message.metadata?.isStreaming !== true) continue;
      const metadata = { ...message.metadata, isStreaming: false, isFinal: true };
      this.host.getStore().updateMessage(sessionId, messageId, { metadata });
      // Republish the row with its own content, so a live view stops spinning
      // without waiting for the session to be reloaded.
      this.host.emitMessageUpdate(sessionId, messageId, message.content, metadata);
      console.debug('[PiRuntime] closed an idle placeholder message for', sessionId);
    }
  }

  finalizeActiveThinking(sessionId: string, active: ActivePiSession): void {
    if (!active.thinkingText.trim() || active.thinkingLifecycle.isMessageFinalized) return;
    this.finalizeMessage(sessionId, active, 'thinking', active.thinkingText);
  }

  markFinalAnswer(sessionId: string, active: ActivePiSession): void {
    const messageId = active.lastCompletedAnswerMessageId;
    const content = active.lastCompletedAnswerText;
    if (!messageId || !content.trim()) return;

    const metadata = {
      isStreaming: false,
      isFinal: true,
      isFinalAnswer: true,
      ...(active.turnExperts.length ? { experts: active.turnExperts } : {}),
    };
    if (this.host.getStore()) {
      const message = this.host
        .getStore()
        .getSession(sessionId)
        ?.messages.find(candidate => candidate.id === messageId);
      this.host.getStore().updateMessage(sessionId, messageId, {
        content,
        metadata: { ...message?.metadata, ...metadata },
      });
    }
    this.host.emitMessageUpdate(sessionId, messageId, content, metadata);
  }

  /**
   * Pi commits usage after emitting the terminal assistant event. Deferring one
   * task ensures the snapshot corresponds to the response just persisted.
   */
  scheduleContextUsageSync(
    sessionId: string,
    messageId: string | null,
    piUsage: PiUsage | undefined,
    model: string | undefined,
    requestStartedAt: number | null,
    firstVisibleTextAt: number | null,
    startupLatency?: PiStartupLatency,
  ): void {
    if (!messageId) return;
    setTimeout(() => {
      const active = this.host.getActiveSession(sessionId);
      const contextUsage = active?.piSession.getContextUsage?.();
      const hasValidContextUsage = Boolean(
        contextUsage &&
        contextUsage.tokens != null &&
        Number.isFinite(contextUsage.tokens) &&
        Number.isFinite(contextUsage.contextWindow) &&
        contextUsage.tokens >= 0 &&
        contextUsage.contextWindow > 0,
      );
      if (!hasValidContextUsage && !piUsage && requestStartedAt === null && !startupLatency) {
        return;
      }

      const message = this.host
        .getStore()
        ?.getSession(sessionId)
        ?.messages.find(item => item.id === messageId);
      if (!message) return;

      const usage = hasValidContextUsage
        ? (() => {
            const contextWindowTokens = Math.round(contextUsage!.contextWindow);
            return {
              usedTokens: Math.min(Math.round(contextUsage!.tokens!), contextWindowTokens),
              contextWindowTokens,
              updatedAt: Date.now(),
            };
          })()
        : undefined;
      // Pi materializes `usage` with zeros and only fills it once the provider
      // reports one; persisting that default would read as a real zero in the
      // stats line (see hasReportedTokenUsage).
      const reportedUsage = piUsage
        ? {
            inputTokens: piUsage.input,
            outputTokens: piUsage.output,
            cacheReadTokens: piUsage.cacheRead,
            cacheWriteTokens: piUsage.cacheWrite,
            reasoningTokens: piUsage.reasoning,
            totalTokens: piUsage.totalTokens,
          }
        : null;
      const metadata = {
        ...message.metadata,
        ...(usage ? { contextUsage: usage } : {}),
        ...(model ? { model } : {}),
        ...(requestStartedAt !== null
          ? {
              metrics: {
                requestStartedAt,
                ...(firstVisibleTextAt !== null ? { firstVisibleTextAt } : {}),
                completedAt: Date.now(),
                ...(startupLatency ?? {}),
              },
            }
          : {}),
        ...(reportedUsage && hasReportedTokenUsage(reportedUsage) ? { usage: reportedUsage } : {}),
      };
      this.host.getStore()?.updateMessage(sessionId, messageId, { metadata });
      this.host.emitMessageUpdate(sessionId, messageId, message.content, metadata);
    }, 0);
  }

  // ── Private: throttling ──

  private throttledEmitMessageUpdate(
    sessionId: string,
    messageId: string,
    content: string,
    metadata?: Record<string, unknown>,
  ): void {
    this.noteThrottleMessage(sessionId, messageId);
    const now = Date.now();
    const lastEmit = this.lastMessageUpdateEmitTime.get(messageId) ?? 0;
    const elapsed = now - lastEmit;

    if (elapsed >= MESSAGE_UPDATE_THROTTLE_MS) {
      this.clearPendingMessageUpdate(messageId);
      this.lastMessageUpdateEmitTime.set(messageId, now);
      this.host.emitMessageUpdate(sessionId, messageId, content, metadata);
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
            this.host.emitMessageUpdate(sessionId, messageId, pending.content, pending.metadata);
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
    this.noteThrottleMessage(sessionId, messageId);
    if (!this.host.getStore()) return;
    const now = Date.now();
    const lastWrite = this.lastStoreUpdateTime.get(messageId) ?? 0;
    const elapsed = now - lastWrite;

    if (elapsed >= STORE_UPDATE_THROTTLE_MS) {
      this.clearPendingStoreUpdate(messageId);
      this.lastStoreUpdateTime.set(messageId, now);
      this.host
        .getStore()
        .updateMessage(sessionId, messageId, { content, metadata }, { touchUpdatedAt: false });
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
          if (pending && this.host.getStore()) {
            this.host
              .getStore()
              .updateMessage(sessionId, messageId, pending, { touchUpdatedAt: false });
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

  clearThrottleStateBySession(sessionId: string, flush: boolean): void {
    for (const [messageId, owner] of this.throttleSessionByMessageId) {
      if (owner !== sessionId) continue;
      if (flush && this.host.getStore()) {
        const pending = this.pendingStoreUpdate.get(messageId);
        if (pending) this.host.getStore().updateMessage(sessionId, messageId, pending);
      }
      if (flush) {
        const pendingEmit = this.pendingMessageUpdate.get(messageId);
        if (pendingEmit) {
          this.host.emitMessageUpdate(
            sessionId,
            messageId,
            pendingEmit.content,
            pendingEmit.metadata,
          );
        }
      }
      this.clearPendingMessageUpdate(messageId);
      this.clearPendingStoreUpdate(messageId);
      this.lastMessageUpdateEmitTime.delete(messageId);
      this.lastStoreUpdateTime.delete(messageId);
      this.throttleSessionByMessageId.delete(messageId);
    }
  }
}
