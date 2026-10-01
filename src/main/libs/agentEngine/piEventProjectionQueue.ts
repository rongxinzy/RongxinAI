import { CoworkRunPolicy, PiRunEvent } from '../../../shared/cowork/runState';
import { transformCoworkTextAsync } from '../../workbenchTask/artifactWorkerPool';
import {
  TextWorkerKind,
  type TextWorkerInput,
  type TextWorkerOutput,
} from '../../workbenchTask/textWorkerOperations';

interface Event {
  type: string;
  result?: unknown;
  displayResultText?: string;
}

/** Preserves SDK event order while pure tool display transforms run in the shared worker pool. */
export class PiEventProjectionQueue<T extends Event> {
  private tail: Promise<void> | undefined;
  private queued = 0;
  private failure: unknown;
  constructor(
    private readonly consume: (event: T) => void,
    private readonly signal: AbortSignal,
    private readonly onError: (error: unknown) => void,
    private readonly transform: (
      input: TextWorkerInput,
      signal?: AbortSignal,
    ) => Promise<TextWorkerOutput> = transformCoworkTextAsync,
  ) {}

  push(event: T): void {
    if (this.signal.aborted || this.failure) return;
    if (!this.tail && event.type === PiRunEvent.ToolEnd) {
      const result = event.result;
      const record =
        result && typeof result === 'object' ? (result as Record<string, unknown>) : undefined;
      const text =
        typeof result === 'string'
          ? result
          : typeof record?.text === 'string'
            ? record.text
            : typeof record?.content === 'string'
              ? record.content
              : result == null
                ? ''
                : undefined;
      // A short existing string needs no scan, join or serialization.
      if (text !== undefined && text.length <= CoworkRunPolicy.ContentChunkCharacters) {
        this.consume({ ...event, displayResultText: text });
        return;
      }
    }
    if (!this.tail && event.type !== PiRunEvent.ToolEnd) {
      this.consume(event);
      return;
    }
    if (++this.queued > 4096) {
      this.failure = new Error('Runtime event projection queue limit exceeded.');
      this.onError(this.failure);
      return;
    }
    const task = (this.tail ?? Promise.resolve())
      .then(async () => {
        if (this.signal.aborted || this.failure) return;
        let projected = event;
        if (event.type === PiRunEvent.ToolEnd) {
          const result = await this.transform(
            { kind: TextWorkerKind.Tool, result: event.result },
            this.signal,
          );
          projected = { ...event, displayResultText: result.content };
        }
        if (!this.signal.aborted) this.consume(projected);
      })
      .catch(error => {
        if (!this.signal.aborted) {
          this.failure = error;
          this.onError(error);
        }
      })
      .finally(() => {
        this.queued -= 1;
        if (this.tail === task) this.tail = undefined;
      });
    this.tail = task;
  }

  async drain(): Promise<void> {
    while (this.tail) await this.tail;
    if (this.failure) throw this.failure;
  }
}
