/**
 * Assistant and thinking bubbles for one Pi turn.
 *
 * Streaming store writes and the in-process `messageUpdate` bus emit stay
 * throttled; the renderer streams from delta stream parts instead.
 * messageUpdate remains for IM and coding-room full-text consumers only —
 * piUiForwarder drops every non-final messageUpdate on the IPC path.
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
  emitMessageRemoved(sessionId: string, messageId: string): void;
  getActiveSession(sessionId: string): ActivePiSession | undefined;
}

export class PiAssistantTranscript {
  private readonly lastStoreUpdateTime = new Map<string, number>();
  private readonly pendingStoreUpdate = new Map<
    string,
    { content: string; metadata: Record<string, unknown> }
  >();
  private readonly pendingStoreUpdateTimer = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly lastMessageUpdateEmitAt = new Map<string, number>();
  private readonly pendingMessageUpdate = new Map<
    string,
    { content: string; metadata: Record<string, unknown> }
  >();
  private readonly pendingMessageUpdateTimer = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly throttleSessionByMessageId = new Map<string, string>();
  /** Latest in-memory stream body per message id (avoids stale DB reads on close). */
  private readonly lastStreamedContentByMessageId = new Map<string, string>();
  private readonly finalizedMessageIds = new Set<string>();
  private readonly finalizedMessageIdsBySession = new Map<string, Set<string>>();
  private readonly pendingContextUsageBySession = new Map<
    string,
    {
      messageId: string;
      piUsage: PiUsage | undefined;
      model: string | undefined;
      requestStartedAt: number | null;
      firstVisibleTextAt: number | null;
      startupLatency?: PiStartupLatency;
    }
  >();

  constructor(private readonly host: PiAssistantTranscriptHost) {}

  /** Clears streaming/finalized bookkeeping so a retry can reuse the same ids. */
  reopenStreamingMessagesForRetry(sessionId: string, active: ActivePiSession): void {
    for (const entry of [
      { messageId: active.assistantMessageId, kind: 'answer' as const },
      { messageId: active.thinkingMessageId, kind: 'thinking' as const },
    ]) {
      if (!entry.messageId) continue;
      const messageId = entry.messageId;
      this.unnoteFinalized(sessionId, messageId);
      const content = this.resolveStreamedContent(messageId, active, entry.kind);
      this.rememberStreamedContent(messageId, content);
      const metadata =
        entry.kind === 'thinking'
          ? { isStreaming: true, isFinal: false, isThinking: true, streamReopen: true }
          : { isStreaming: true, isFinal: false, streamReopen: true };
      if (this.host.getStore()) {
        this.host
          .getStore()
          .updateMessage(sessionId, messageId, { metadata }, { touchUpdatedAt: false });
      }
      this.host.emitMessageUpdate(sessionId, messageId, content, metadata);
    }
  }

  clearPendingContextUsage(sessionId: string): void {
    this.pendingContextUsageBySession.delete(sessionId);
  }

  /** Runs at most one deferred context-usage sync per session per settled turn. */
  flushContextUsageSync(sessionId: string): void {
    const pending = this.pendingContextUsageBySession.get(sessionId);
    this.pendingContextUsageBySession.delete(sessionId);
    if (!pending) return;
    this.runContextUsageSync(
      sessionId,
      pending.messageId,
      pending.piUsage,
      pending.model,
      pending.requestStartedAt,
      pending.firstVisibleTextAt,
      pending.startupLatency,
    );
  }

  private rememberStreamedContent(messageId: string, content: string): void {
    this.lastStreamedContentByMessageId.set(messageId, content);
  }

  private resolveStreamedContent(
    messageId: string,
    active: ActivePiSession,
    kind: 'answer' | 'thinking',
  ): string {
    if (kind === 'answer' && active.assistantMessageId === messageId) {
      return active.answerText || active.retryPriorAnswer;
    }
    if (kind === 'thinking' && active.thinkingMessageId === messageId) {
      return active.thinkingText;
    }
    return this.lastStreamedContentByMessageId.get(messageId) ?? '';
  }

  private noteThrottleMessage(sessionId: string, messageId: string): void {
    this.throttleSessionByMessageId.set(messageId, sessionId);
  }

  private noteFinalized(sessionId: string, messageId: string): void {
    this.finalizedMessageIds.add(messageId);
    let ids = this.finalizedMessageIdsBySession.get(sessionId);
    if (!ids) {
      ids = new Set();
      this.finalizedMessageIdsBySession.set(sessionId, ids);
    }
    ids.add(messageId);
  }

  private unnoteFinalized(sessionId: string, messageId: string): void {
    this.finalizedMessageIds.delete(messageId);
    this.finalizedMessageIdsBySession.get(sessionId)?.delete(messageId);
  }

  private pruneFinalizedForSession(sessionId: string): void {
    const ids = this.finalizedMessageIdsBySession.get(sessionId);
    if (!ids) return;
    for (const messageId of ids) {
      this.finalizedMessageIds.delete(messageId);
    }
    this.finalizedMessageIdsBySession.delete(sessionId);
  }

  private removeEmptyAnswerPlaceholder(
    sessionId: string,
    messageId: string,
    active: ActivePiSession,
  ): void {
    const store = this.host.getStore();
    if (!store?.deleteMessage) return;
    const existing = store
      .getSession(sessionId)
      ?.messages.find(message => message.id === messageId);
    if (!existing || existing.metadata?.isThinking) return;
    if (existing.content.length > 0) return;
    const streamed = this.lastStreamedContentByMessageId.get(messageId) ?? '';
    if (streamed.length > 0) return;
    const inMemory = active.answerText || active.retryPriorAnswer;
    if (inMemory.length > 0) return;
    if (!store.deleteMessage(sessionId, messageId)) return;
    this.lastStreamedContentByMessageId.delete(messageId);
    this.unnoteFinalized(sessionId, messageId);
    this.host.emitMessageRemoved(sessionId, messageId);
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

  /**
   * Push a streaming (non-final) content snapshot to the answer/thinking
   * message. Both the SQLite write and the bus emit are throttled — the bus
   * event feeds IM/coding-room consumers only, never the renderer stream.
   */
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
    // Throttle the synchronous SQLite write separately from the bus emit so a
    // fast Pi stream doesn't block the main-process event loop every frame.
    this.rememberStreamedContent(messageId, content);
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
    if (kind === 'answer' && !content.trim()) {
      const emptyId = active.assistantMessageId;
      if (emptyId) {
        const resolved = this.resolveStreamedContent(emptyId, active, 'answer');
        if (resolved.trim()) {
          return this.finalizeMessage(sessionId, active, kind, resolved);
        }
        this.flushPendingStoreUpdate(sessionId, emptyId);
        this.flushPendingMessageUpdate(sessionId, emptyId);
        this.removeEmptyAnswerPlaceholder(sessionId, emptyId, active);
        this.clearThrottleMapsForMessage(emptyId);
        active.assistantMessageId = null;
      }
      return;
    }
    const messageId = this.ensureMessage(sessionId, active, kind, content);
    this.rememberStreamedContent(messageId, content);
    this.flushPendingStoreUpdate(sessionId, messageId);
    this.flushPendingMessageUpdate(sessionId, messageId);
    this.clearThrottleMapsForMessage(messageId);
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
    this.noteFinalized(sessionId, messageId);
    if (kind === 'thinking') {
      active.thinkingLifecycle.markMessageFinalized();
    }
  }

  /**
   * Closes placeholder bubbles that never received text, so a finished turn can
   * no longer look like it is still streaming.
   */
  closeIdlePlaceholders(
    sessionId: string,
    active: ActivePiSession,
    options?: { finalize?: boolean },
  ): void {
    const finalize = options?.finalize ?? true;
    const entries: Array<{ messageId: string; kind: 'answer' | 'thinking' }> = [];
    if (active.thinkingMessageId && !active.thinkingLifecycle.isMessageFinalized) {
      entries.push({ messageId: active.thinkingMessageId, kind: 'thinking' });
    }
    if (active.assistantMessageId) {
      entries.push({ messageId: active.assistantMessageId, kind: 'answer' });
    }
    for (const entry of entries) {
      if (finalize && this.finalizedMessageIds.has(entry.messageId)) continue;
      const content = this.resolveStreamedContent(entry.messageId, active, entry.kind);
      const streamingMetadata =
        entry.kind === 'thinking'
          ? { isStreaming: true, isFinal: false, isThinking: true }
          : {
              isStreaming: true,
              isFinal: false,
              ...(active.turnExperts.length ? { experts: active.turnExperts } : {}),
            };
      const finalMetadata =
        entry.kind === 'thinking'
          ? { isStreaming: false, isFinal: true, isThinking: true }
          : {
              isStreaming: false,
              isFinal: true,
              ...(active.turnExperts.length ? { experts: active.turnExperts } : {}),
            };
      const metadata = finalize ? finalMetadata : streamingMetadata;
      this.flushPendingStoreUpdate(sessionId, entry.messageId, content, metadata);
      this.flushPendingMessageUpdate(sessionId, entry.messageId, content, metadata);
      if (!finalize) {
        if (this.host.getStore()) {
          this.host
            .getStore()
            .updateMessage(
              sessionId,
              entry.messageId,
              { content, metadata },
              { touchUpdatedAt: false },
            );
        }
        continue;
      }
      if (entry.kind === 'answer' && !content.trim()) {
        const resolved = this.resolveStreamedContent(entry.messageId, active, 'answer');
        if (!resolved.trim()) {
          this.removeEmptyAnswerPlaceholder(sessionId, entry.messageId, active);
          if (active.assistantMessageId === entry.messageId) {
            active.assistantMessageId = null;
          }
        }
        this.clearThrottleMapsForMessage(entry.messageId);
        continue;
      }
      this.clearThrottleMapsForMessage(entry.messageId);
      if (!this.host.getStore()) continue;
      const existing = this.host
        .getStore()
        .getSession(sessionId)
        ?.messages.find(message => message.id === entry.messageId);
      const mergedMetadata = {
        ...existing?.metadata,
        ...metadata,
      };
      this.host
        .getStore()
        .updateMessage(
          sessionId,
          entry.messageId,
          { content, metadata: mergedMetadata },
          { touchUpdatedAt: false },
        );
      this.host.emitMessageUpdate(sessionId, entry.messageId, content, mergedMetadata);
      this.noteFinalized(sessionId, entry.messageId);
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
    this.flushContextUsageSync(sessionId);
    this.pendingContextUsageBySession.set(sessionId, {
      messageId,
      piUsage,
      model,
      requestStartedAt,
      firstVisibleTextAt,
      startupLatency,
    });
  }

  private runContextUsageSync(
    sessionId: string,
    messageId: string,
    piUsage: PiUsage | undefined,
    model: string | undefined,
    requestStartedAt: number | null,
    firstVisibleTextAt: number | null,
    startupLatency?: PiStartupLatency,
  ): void {
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

  /**
   * Leading+trailing throttle for the in-process `messageUpdate` bus event
   * (IM / coding-room consumers; the renderer stream path drops non-final
   * messageUpdate). The leading call emits immediately; calls inside the
   * window collapse into a single trailing emit of the latest content, and an
   * armed trailing timer is never re-armed or duplicated.
   */
  private throttledEmitMessageUpdate(
    sessionId: string,
    messageId: string,
    content: string,
    metadata: Record<string, unknown>,
  ): void {
    this.noteThrottleMessage(sessionId, messageId);
    const now = Date.now();
    const lastEmit = this.lastMessageUpdateEmitAt.get(messageId) ?? 0;
    const elapsed = now - lastEmit;

    if (elapsed >= MESSAGE_UPDATE_THROTTLE_MS) {
      this.clearPendingMessageUpdate(messageId);
      this.lastMessageUpdateEmitAt.set(messageId, now);
      this.host.emitMessageUpdate(sessionId, messageId, content, metadata);
      return;
    }

    this.pendingMessageUpdate.set(messageId, { content, metadata });
    if (this.pendingMessageUpdateTimer.has(messageId)) return;
    this.pendingMessageUpdateTimer.set(
      messageId,
      setTimeout(() => {
        this.pendingMessageUpdateTimer.delete(messageId);
        const pending = this.pendingMessageUpdate.get(messageId);
        this.pendingMessageUpdate.delete(messageId);
        if (!pending) return;
        this.lastMessageUpdateEmitAt.set(messageId, Date.now());
        this.host.emitMessageUpdate(sessionId, messageId, pending.content, pending.metadata);
      }, MESSAGE_UPDATE_THROTTLE_MS - elapsed),
    );
  }

  private flushPendingStoreUpdate(
    sessionId: string,
    messageId: string,
    content?: string,
    metadata?: Record<string, unknown>,
  ): void {
    const timer = this.pendingStoreUpdateTimer.get(messageId);
    if (timer) {
      clearTimeout(timer);
      this.pendingStoreUpdateTimer.delete(messageId);
    }
    const pending = this.pendingStoreUpdate.get(messageId);
    this.pendingStoreUpdate.delete(messageId);
    const body = content ?? pending?.content;
    const meta = metadata ?? pending?.metadata;
    if (body !== undefined && meta && this.host.getStore()) {
      this.host
        .getStore()
        .updateMessage(
          sessionId,
          messageId,
          { content: body, metadata: meta },
          { touchUpdatedAt: false },
        );
      this.lastStoreUpdateTime.set(messageId, Date.now());
    }
  }

  private flushPendingMessageUpdate(
    sessionId: string,
    messageId: string,
    content?: string,
    metadata?: Record<string, unknown>,
  ): void {
    const timer = this.pendingMessageUpdateTimer.get(messageId);
    if (timer) {
      clearTimeout(timer);
      this.pendingMessageUpdateTimer.delete(messageId);
    }
    const pending = this.pendingMessageUpdate.get(messageId);
    this.pendingMessageUpdate.delete(messageId);
    const body = content ?? pending?.content;
    const meta = metadata ?? pending?.metadata;
    if (body !== undefined && meta) {
      this.lastMessageUpdateEmitAt.set(messageId, Date.now());
      this.host.emitMessageUpdate(sessionId, messageId, body, meta);
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

  private clearPendingMessageUpdate(messageId: string): void {
    const timer = this.pendingMessageUpdateTimer.get(messageId);
    if (timer) {
      clearTimeout(timer);
      this.pendingMessageUpdateTimer.delete(messageId);
    }
    this.pendingMessageUpdate.delete(messageId);
  }

  private clearThrottleMapsForMessage(messageId: string): void {
    this.clearPendingStoreUpdate(messageId);
    this.clearPendingMessageUpdate(messageId);
    this.lastStoreUpdateTime.delete(messageId);
    this.lastMessageUpdateEmitAt.delete(messageId);
    this.throttleSessionByMessageId.delete(messageId);
    this.lastStreamedContentByMessageId.delete(messageId);
  }

  clearThrottleStateBySession(sessionId: string, flush: boolean): void {
    for (const [messageId, owner] of this.throttleSessionByMessageId) {
      if (owner !== sessionId) continue;
      if (flush) {
        const pendingStore = this.pendingStoreUpdate.get(messageId);
        if (pendingStore && this.host.getStore()) {
          this.host.getStore().updateMessage(sessionId, messageId, pendingStore);
        }
        const pendingMessage = this.pendingMessageUpdate.get(messageId);
        if (pendingMessage) {
          this.lastMessageUpdateEmitAt.set(messageId, Date.now());
          this.host.emitMessageUpdate(
            sessionId,
            messageId,
            pendingMessage.content,
            pendingMessage.metadata,
          );
        }
      }
      this.clearPendingStoreUpdate(messageId);
      this.clearPendingMessageUpdate(messageId);
      this.lastStoreUpdateTime.delete(messageId);
      this.lastMessageUpdateEmitAt.delete(messageId);
      this.throttleSessionByMessageId.delete(messageId);
    }
    this.pruneFinalizedForSession(sessionId);
  }
}
