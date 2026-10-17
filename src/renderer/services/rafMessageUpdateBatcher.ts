export type StreamMessageUpdate = {
  sessionId: string;
  messageId: string;
  /**
   * Full message content. Absent on metadata-only updates (terminal
   * dedup): those merge metadata alone and never replace the committed body.
   */
  content?: string;
  metadata?: Record<string, unknown>;
  /**
   * True when this update only merges metadata (terminal dedup). Such an
   * update must never clobber a pending full-content update for the same
   * message within the same frame.
   */
  metadataOnly?: boolean;
};

export type AnimationFrameScheduler = {
  request: (callback: FrameRequestCallback) => number;
  cancel: (id: number) => void;
};

export const browserAnimationFrameScheduler: AnimationFrameScheduler = {
  request: callback => requestAnimationFrame(callback),
  cancel: id => cancelAnimationFrame(id),
};

const getUpdateKey = ({ sessionId, messageId }: StreamMessageUpdate): string =>
  `${sessionId}:${messageId}`;

/**
 * Merges a metadata-only update into the pending update for the same
 * message: the earlier content (if any) survives and the new metadata is
 * layered on top, so a duplicate terminal emission cannot blank the body
 * committed earlier in the same frame. Updates that carry content still
 * replace the pending entry wholesale (last write wins), preserving the
 * pre-existing behavior.
 */
const mergeIntoPending = (
  previous: StreamMessageUpdate,
  next: StreamMessageUpdate,
): StreamMessageUpdate => {
  if (next.metadataOnly !== true) return next;
  const metadata =
    previous.metadata === undefined
      ? next.metadata
      : next.metadata === undefined
        ? previous.metadata
        : { ...previous.metadata, ...next.metadata };
  const content = previous.content;
  return {
    sessionId: next.sessionId,
    messageId: next.messageId,
    ...(content === undefined ? {} : { content }),
    ...(metadata === undefined ? {} : { metadata }),
    ...(content === undefined ? { metadataOnly: true } : {}),
  };
};

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
    const key = getUpdateKey(update);
    const previous = this.pending.get(key);
    this.pending.set(key, previous === undefined ? update : mergeIntoPending(previous, update));
    if (this.frameId !== null) return;

    this.frameId = this.scheduler.request(() => {
      this.frameId = null;
      this.flush();
    });
  }

  discard(sessionId: string, messageId: string): void {
    this.pending.delete(getUpdateKey({ sessionId, messageId }));
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
