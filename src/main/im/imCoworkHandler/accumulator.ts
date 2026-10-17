/**
 * Message accumulation for IM cowork turns: collects streamed messages per
 * session, exposes the response promise, and projects Channel run events.
 */

import { ActivitySource, ActivityStatus } from '../../../shared/activity/constants';
import type { Platform } from '../../../shared/platform';
import type { ActivityService } from '../../activity/activityService';
import type { CoworkMessage, CoworkStore } from '../../coworkStore';
import { generateCorrelationId } from '../../libs/logCorrelation';
import { formatIMReply } from './replies';
import type { IMCoworkBackgroundDelivery, MessageAccumulator } from './types';

const ACCUMULATOR_TIMEOUT_MS = 4 * 60 * 1000 + 30 * 1000;

interface IMCoworkAccumulatorDeps {
  coworkStore: CoworkStore;
  activityService?: ActivityService;
  getConversation: (
    sessionId: string,
  ) => { conversationId: string; platform: Platform } | undefined;
  stopSession: (sessionId: string) => void;
}

export class IMCoworkAccumulatorRegistry {
  private readonly deps: IMCoworkAccumulatorDeps;

  // Track active sessions' message accumulation
  private readonly accumulators = new Map<string, MessageAccumulator>();

  constructor(deps: IMCoworkAccumulatorDeps) {
    this.deps = deps;
  }

  get(sessionId: string): MessageAccumulator | undefined {
    return this.accumulators.get(sessionId);
  }

  has(sessionId: string): boolean {
    return this.accumulators.has(sessionId);
  }

  createResponsePromise(
    sessionId: string,
    runId: string,
    backgroundDelivery?: IMCoworkBackgroundDelivery,
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      const existingAccumulator = this.accumulators.get(sessionId);
      if (existingAccumulator) {
        if (existingAccumulator.timeoutId) {
          clearTimeout(existingAccumulator.timeoutId);
        }
        this.accumulators.delete(sessionId);
        this.emitRunEvent(sessionId, existingAccumulator, ActivityStatus.Failed);
        existingAccumulator.reject?.(new Error('Replaced by a newer IM request'));
      }

      const timeoutId = setTimeout(() => {
        const accumulator = this.accumulators.get(sessionId);
        if (accumulator && accumulator.timeoutId === timeoutId) {
          const partialReply = formatIMReply(sessionId, accumulator.messages);
          this.cleanup(sessionId);
          this.deps.stopSession(sessionId);
          if (partialReply && partialReply !== '处理完成，但没有生成回复。') {
            this.emitRunEvent(
              sessionId,
              accumulator,
              ActivityStatus.Failed,
              undefined,
              '处理超时，已返回部分结果',
            );
            accumulator.resolve?.(partialReply + '\n\n[处理超时，以上为部分结果]');
          } else {
            this.emitRunEvent(
              sessionId,
              accumulator,
              ActivityStatus.Failed,
              undefined,
              '处理超时，请稍后重试',
            );
            accumulator.reject?.(new Error('处理超时，请稍后重试'));
          }
        }
      }, ACCUMULATOR_TIMEOUT_MS);

      // Set up message accumulator
      this.accumulators.set(sessionId, {
        runId,
        messages: [],
        storeMessageCountAtStart: this.deps.coworkStore.getSession(sessionId)?.messages.length ?? 0,
        resolve,
        reject,
        timeoutId,
        backgroundDelivery,
      });
    });
  }

  ensureBackgroundAccumulator(
    sessionId: string,
    firstMessage: CoworkMessage,
  ): MessageAccumulator | null {
    const conversation = this.deps.getConversation(sessionId);
    if (!conversation) {
      return null;
    }

    const existing = this.accumulators.get(sessionId);
    if (existing) {
      return existing;
    }

    const timeoutId = setTimeout(() => {
      const accumulator = this.accumulators.get(sessionId);
      if (!accumulator?.backgroundDelivery || accumulator.timeoutId !== timeoutId) {
        return;
      }
      this.cleanup(sessionId);
      this.emitRunEvent(
        sessionId,
        accumulator,
        ActivityStatus.Failed,
        undefined,
        '处理超时，请稍后重试',
      );
    }, ACCUMULATOR_TIMEOUT_MS);

    const storeMessages = this.deps.coworkStore.getSession(sessionId)?.messages ?? [];
    const firstMessageIndex = storeMessages.findIndex(message => message.id === firstMessage.id);
    const nextAccumulator: MessageAccumulator = {
      runId: generateCorrelationId(),
      messages: [],
      storeMessageCountAtStart: firstMessageIndex >= 0 ? firstMessageIndex : storeMessages.length,
      timeoutId,
      backgroundDelivery: {
        conversationId: conversation.conversationId,
        platform: conversation.platform,
      },
    };
    this.accumulators.set(sessionId, nextAccumulator);
    return nextAccumulator;
  }

  reject(sessionId: string, error: Error): void {
    const accumulator = this.accumulators.get(sessionId);
    if (!accumulator) return;
    this.cleanup(sessionId);
    this.emitRunEvent(sessionId, accumulator, ActivityStatus.Failed, undefined, error.message);
    accumulator.reject?.(error);
  }

  emitRunEvent(
    sessionId: string,
    accumulator: MessageAccumulator,
    status: ActivityStatus,
    reply?: string,
    error?: string,
  ): void {
    // Background delivery is an outbound scheduled-task result. The canonical scheduler owns the
    // Cron activity lifecycle; do not project this accumulator as a second run.
    if (accumulator.backgroundDelivery) return;
    const conversation = accumulator.backgroundDelivery ?? this.deps.getConversation(sessionId);
    this.deps.activityService?.upsertBestEffort({
      id: accumulator.runId,
      source: ActivitySource.Channel,
      status,
      sessionId,
      platform: conversation?.platform,
      conversationId: conversation?.conversationId,
      replyPreview: reply,
      errorMessage: error,
    });
  }

  /**
   * Clean up accumulator
   */
  cleanup(sessionId: string): void {
    const accumulator = this.accumulators.get(sessionId);
    if (accumulator?.timeoutId) {
      clearTimeout(accumulator.timeoutId);
    }
    this.accumulators.delete(sessionId);
  }

  /** Reject and clear every accumulator (handler teardown). */
  destroyAll(): void {
    this.accumulators.forEach(accumulator => {
      if (accumulator.timeoutId) {
        clearTimeout(accumulator.timeoutId);
      }
      accumulator.reject?.(new Error('Handler destroyed'));
    });
    this.accumulators.clear();
  }
}
