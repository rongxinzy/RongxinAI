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
export class PiEventProjection<T extends Event> {
  constructor(
    private readonly observers: readonly ((event: T) => void)[],
    private readonly signal: AbortSignal,
    private readonly onError: (error: unknown) => void,
  ) {}

  push(event: T): void {
    if (this.signal.aborted) return;
    let projected = event;
    try {
      if (event.type === PiRunEvent.ToolEnd) {
        projected = {
          ...event,
          displayResultText: event.displayResultText ?? syncPiToolResultDisplayText(event.result),
        };
      }
    } catch (error) {
      this.report(error);
    }
    for (const observe of this.observers) {
      try {
        observe(projected);
      } catch (error) {
        this.report(error);
      }
    }
  }

  private report(error: unknown): void {
    // Observation and its error reporter must never reject a native Pi event.
    try {
      this.onError(error);
    } catch {
      // Logging failure cannot take execution ownership either.
    }
  }
}
