import type { UIMessageChunk } from 'ai';
import {
  type AnimationFrameScheduler,
  browserAnimationFrameScheduler,
} from './rafMessageUpdateBatcher';

type PendingPart = {
  sessionId: string;
  messageId: string;
  chunk: UIMessageChunk;
};

export class RafStreamPartBatcher {
  private frameId: number | null = null;
  private readonly pending: PendingPart[] = [];

  constructor(
    private readonly apply: (parts: PendingPart[]) => void,
    private readonly scheduler: AnimationFrameScheduler = browserAnimationFrameScheduler,
  ) {}

  enqueue(part: PendingPart): void {
    this.pending.push(part);
    if (this.frameId !== null) return;
    this.frameId = this.scheduler.request(() => {
      this.frameId = null;
      const batch = this.pending.splice(0, this.pending.length);
      if (batch.length > 0) this.apply(batch);
    });
  }

  flush(): void {
    if (this.frameId !== null) {
      this.scheduler.cancel(this.frameId);
      this.frameId = null;
    }
    const batch = this.pending.splice(0, this.pending.length);
    if (batch.length > 0) this.apply(batch);
  }

  dispose(): void {
    this.flush();
  }
}
