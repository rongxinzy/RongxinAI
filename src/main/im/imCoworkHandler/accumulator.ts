/**
 * Tracks pending Channel replies and projects them from the current turn.
 */

import { ActivityStatus } from '../../../shared/activity/constants';
import type { Platform } from '../../../shared/platform';
import type { ActivityService } from '../../activity/activityService';
import type { CoworkMessage, CoworkStore } from '../../coworkStore';
import type { PiRuntime } from '../../libs/agentEngine/types';
import { DEFAULT_IM_EMPTY_REPLY, formatIMReply } from './replies';
import type { MessageAccumulator } from './types';

const ACCUMULATOR_TIMEOUT_MS = 4 * 60 * 1000 + 30 * 1000;

interface IMCoworkAccumulatorDeps {
  coworkStore: CoworkStore;
  activityService?: Pick<ActivityService, 'recordChannelRun'>;
  getConversation: (
    sessionId: string,
  ) => { conversationId: string; platform: Platform } | undefined;
  getLiveStreamTexts: PiRuntime['getLiveStreamTexts'];
  stopSession: (sessionId: string) => void;
}

export class IMCoworkAccumulatorRegistry {
  private readonly deps: IMCoworkAccumulatorDeps;

  private readonly accumulators = new Map<string, MessageAccumulator>();

  constructor(deps: IMCoworkAccumulatorDeps) {
    this.deps = deps;
  }

  get(sessionId: string): MessageAccumulator | undefined {
    return this.accumulators.get(sessionId);
  }

  createResponsePromise(sessionId: string, runId: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const existingAccumulator = this.accumulators.get(sessionId);
      if (existingAccumulator) {
        if (existingAccumulator.timeoutId) {
          clearTimeout(existingAccumulator.timeoutId);
        }
        this.accumulators.delete(sessionId);
        this.emitRunEvent(sessionId, existingAccumulator.runId, ActivityStatus.Failed);
        existingAccumulator.reject?.(new Error('Replaced by a newer IM request'));
      }

      const timeoutId = setTimeout(() => {
        const accumulator = this.accumulators.get(sessionId);
        if (accumulator && accumulator.timeoutId === timeoutId) {
          const partialReply = this.formatReply(sessionId, accumulator, true);
          this.cleanup(sessionId);
          this.deps.stopSession(sessionId);
          if (partialReply === null) return;
          if (partialReply && partialReply !== DEFAULT_IM_EMPTY_REPLY) {
            this.emitRunEvent(
              sessionId,
              accumulator.runId,
              ActivityStatus.Failed,
              undefined,
              '处理超时，已返回部分结果',
            );
            accumulator.resolve?.(partialReply + '\n\n[处理超时，以上为部分结果]');
          } else {
            this.emitRunEvent(
              sessionId,
              accumulator.runId,
              ActivityStatus.Failed,
              undefined,
              '处理超时，请稍后重试',
            );
            accumulator.reject?.(new Error('处理超时，请稍后重试'));
          }
        }
      }, ACCUMULATOR_TIMEOUT_MS);

      this.accumulators.set(sessionId, {
        runId,
        storeMessageCountAtStart: this.deps.coworkStore.messages.countSessionMessages(sessionId),
        resolve,
        reject,
        timeoutId,
      });
    });
  }

  formatReply(
    sessionId: string,
    accumulator: MessageAccumulator,
    includeLiveText = false,
  ): string | null {
    const offset = accumulator.storeMessageCountAtStart;
    if (offset === undefined) return DEFAULT_IM_EMPTY_REPLY;
    let messages: CoworkMessage[];
    try {
      messages = this.deps.coworkStore.messages.getPagedSessionMessages(sessionId, -1, offset);
    } catch (error) {
      this.reject(sessionId, error instanceof Error ? error : new Error(String(error)));
      return null;
    }
    if (!includeLiveText) return formatIMReply(messages);

    const texts = this.deps.getLiveStreamTexts(sessionId);
    return formatIMReply(
      messages.map(message => {
        const live = texts.find(text => text.messageId === message.id);
        return live ? { ...message, content: live.content } : message;
      }),
    );
  }

  reject(sessionId: string, error: Error): void {
    const accumulator = this.accumulators.get(sessionId);
    if (!accumulator) return;
    this.cleanup(sessionId);
    this.emitRunEvent(
      sessionId,
      accumulator.runId,
      ActivityStatus.Failed,
      undefined,
      error.message,
    );
    accumulator.reject?.(error);
  }

  emitRunEvent(
    sessionId: string,
    runId: string,
    status: ActivityStatus,
    reply?: string,
    error?: string,
  ): void {
    const conversation = this.deps.getConversation(sessionId);
    this.deps.activityService?.recordChannelRun({
      id: runId,
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
