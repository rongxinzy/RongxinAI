import { PiRunEvent } from '../../../shared/cowork/runState';
import { syncPiToolResultDisplayText } from './piToolResultDisplayText';

interface Event {
  type: string;
  result?: unknown;
  displayResultText?: string;
}

/**
 * Preserves SDK event order. Tool display text is extracted synchronously on the
 * main thread so later stream events (deltas, agent_settled) are never blocked
 * behind the shared artifact worker pool.
 */
export class PiEventProjectionQueue<T extends Event> {
  private failure: unknown;
  constructor(
    private readonly consume: (event: T) => void,
    private readonly signal: AbortSignal,
    private readonly onError: (error: unknown) => void,
  ) {}

  push(event: T): void {
    if (this.signal.aborted || this.failure) return;
    if (event.type === PiRunEvent.ToolEnd) {
      const displayResultText =
        event.displayResultText ?? syncPiToolResultDisplayText(event.result);
      this.consume({ ...event, displayResultText });
      return;
    }
    this.consume(event);
  }

  async drain(): Promise<void> {
    if (this.failure) throw this.failure;
  }
}
