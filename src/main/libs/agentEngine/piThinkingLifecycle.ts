import { ThinkingDurationTracker } from '../../../common/thinkingDuration';

export class PiThinkingLifecycle {
  private readonly durationTracker = new ThinkingDurationTracker();
  private segmentOpen = false;
  private messageFinalized = false;

  start(nowMs?: number): void {
    this.segmentOpen = true;
    this.messageFinalized = false;
    this.durationTracker.start(nowMs);
  }

  markContentStreaming(): void {
    this.messageFinalized = false;
  }

  finish(nowMs?: number): number | undefined {
    this.segmentOpen = false;
    return this.durationTracker.finish(nowMs);
  }

  markMessageFinalized(): void {
    this.segmentOpen = false;
    this.messageFinalized = true;
  }

  reset(): void {
    this.segmentOpen = false;
    this.messageFinalized = false;
    this.durationTracker.reset();
  }

  get isSegmentOpen(): boolean {
    return this.segmentOpen;
  }

  get isMessageFinalized(): boolean {
    return this.messageFinalized;
  }
}
