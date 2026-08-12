export type StreamMessageUpdate = {
  sessionId: string;
  messageId: string;
  content: string;
  metadata?: Record<string, unknown>;
};

export type AnimationFrameScheduler = {
  request: (callback: FrameRequestCallback) => number;
  cancel: (id: number) => void;
};

const browserAnimationFrameScheduler: AnimationFrameScheduler = {
  request: callback => requestAnimationFrame(callback),
  cancel: id => cancelAnimationFrame(id),
};

const getUpdateKey = ({ sessionId, messageId }: StreamMessageUpdate): string =>
  `${sessionId}:${messageId}`;

/**
 * Limits rendering updates to one batch per frame without allowing different
 * messages in the same turn to overwrite one another.
 */
export class RafMessageUpdateBatcher {
  private frameId: number | null = null;
  private readonly pending = new Map<string, StreamMessageUpdate>();

  constructor(
    private readonly applyUpdates: (updates: StreamMessageUpdate[]) => void,
    private readonly scheduler: AnimationFrameScheduler = browserAnimationFrameScheduler,
  ) {}

  enqueue(update: StreamMessageUpdate): void {
    this.pending.set(getUpdateKey(update), update);
    if (this.frameId !== null) return;

    this.frameId = this.scheduler.request(() => {
      this.frameId = null;
      this.flush();
    });
  }

  discard(sessionId: string, messageId: string): void {
    this.pending.delete(getUpdateKey({ sessionId, messageId, content: '' }));
    this.cancelFrameWhenIdle();
  }

  flush(): void {
    if (this.frameId !== null) {
      this.scheduler.cancel(this.frameId);
      this.frameId = null;
    }
    const updates = Array.from(this.pending.values());
    this.pending.clear();
    if (updates.length > 0) {
      this.applyUpdates(updates);
    }
  }

  dispose(): void {
    if (this.frameId !== null) {
      this.scheduler.cancel(this.frameId);
      this.frameId = null;
    }
    this.pending.clear();
  }

  private cancelFrameWhenIdle(): void {
    if (this.pending.size > 0 || this.frameId === null) return;
    this.scheduler.cancel(this.frameId);
    this.frameId = null;
  }
}
