import { ThinkingDurationTracker } from '../../common/thinkingDuration';

import type { StreamMessageUpdate } from './rafMessageUpdateBatcher';

type PendingUpdateDiscarder = {
  discard: (sessionId: string, messageId: string) => void;
};

type CompleteThinkingMessageOptions = {
  content: string;
  messageExists: boolean;
  nowMs?: number;
};

export class ThinkingMessageLifecycle {
  private readonly durationTracker = new ThinkingDurationTracker();
  private completed = false;
  private measuredDurationMs: number | undefined;

  constructor(
    private readonly sessionId: string,
    private readonly messageId: string,
    private readonly pendingUpdates: PendingUpdateDiscarder,
    private readonly applyUpdate: (update: StreamMessageUpdate) => void,
  ) {}

  start(nowMs?: number): void {
    this.completed = false;
    this.durationTracker.start(nowMs);
  }

  complete({ content, messageExists, nowMs }: CompleteThinkingMessageOptions): number | undefined {
    this.measuredDurationMs = this.durationTracker.finish(nowMs);
    if (this.completed) return this.measuredDurationMs;

    this.completed = true;
    if (!messageExists) return this.measuredDurationMs;

    this.pendingUpdates.discard(this.sessionId, this.messageId);
    this.applyUpdate({
      sessionId: this.sessionId,
      messageId: this.messageId,
      content,
      metadata: {
        isStreaming: false,
        isFinal: true,
        isThinking: true,
        ...(this.measuredDurationMs !== undefined && {
          thinkingDurationMs: this.measuredDurationMs,
        }),
      },
    });
    return this.measuredDurationMs;
  }

  completeBeforeAnswer(
    content: string,
    messageExists: boolean,
    nowMs?: number,
  ): number | undefined {
    return this.complete({ content, messageExists, nowMs });
  }

  get isComplete(): boolean {
    return this.completed;
  }

  get durationMs(): number | undefined {
    return this.measuredDurationMs;
  }
}
