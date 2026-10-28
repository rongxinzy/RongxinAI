import {
  CodingEventKind,
  CodingStreamContentLengthField,
  CodingStreamUpdateMode,
  type CodingEvent,
  type CodingRoomEventDelta,
  type CodingStreamUpdateMode as CodingStreamUpdateModeType,
} from '../../shared/codingAgent';

type FlushHandler = (delta: CodingRoomEventDelta) => void;

interface SentText {
  length: number;
  /** Last full Replace body. Append mode trusts repository concatenation and stores only the length. */
  text?: string;
}

const isTextStreamKind = (kind: CodingEvent['kind']): boolean =>
  kind === CodingEventKind.Message ||
  kind === CodingEventKind.MessageDelta ||
  kind === CodingEventKind.Reasoning;

const withStreamContent = (
  event: CodingEvent,
  content: string,
  contentLength: number,
  streamUpdateMode: CodingStreamUpdateModeType,
): CodingEvent => ({
  ...event,
  payload: {
    ...event.payload,
    content,
    streamUpdateMode,
    [CodingStreamContentLengthField]: contentLength,
  },
});

/**
 * Coalesces coding-room events per workspace, then emits at most one update
 * per event id. Text streams send the suffix since the previous flush.
 * A shrink or a non-prefix Replace sends the full text.
 */
export class CodingEventDeltaBatcher {
  private readonly pending = new Map<string, Map<string, CodingEvent>>();
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly sent = new Map<string, SentText>();

  constructor(
    private readonly onFlush: FlushHandler,
    private readonly delayMs = 100,
  ) {}

  enqueue(workspaceRoot: string, event: CodingEvent): void {
    const events = this.pending.get(workspaceRoot) ?? new Map<string, CodingEvent>();
    events.set(event.id, event);
    this.pending.set(workspaceRoot, events);
    if (this.timers.has(workspaceRoot)) return;
    this.timers.set(
      workspaceRoot,
      setTimeout(() => {
        this.timers.delete(workspaceRoot);
        const pending = this.pending.get(workspaceRoot);
        this.pending.delete(workspaceRoot);
        if (!pending || pending.size === 0) return;
        this.onFlush({
          workspaceRoot,
          events: [...pending.values()].map(item => this.toWireEvent(workspaceRoot, item)),
        });
      }, this.delayMs),
    );
  }

  flush(workspaceRoot: string): void {
    const timer = this.timers.get(workspaceRoot);
    if (timer) clearTimeout(timer);
    this.timers.delete(workspaceRoot);
    const pending = this.pending.get(workspaceRoot);
    this.pending.delete(workspaceRoot);
    if (!pending || pending.size === 0) return;
    this.onFlush({
      workspaceRoot,
      events: [...pending.values()].map(item => this.toWireEvent(workspaceRoot, item)),
    });
  }

  dispose(): void {
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
    this.pending.clear();
    this.sent.clear();
  }

  private sentKey(workspaceRoot: string, eventId: string): string {
    return `${workspaceRoot}\0${eventId}`;
  }

  private toWireEvent(workspaceRoot: string, event: CodingEvent): CodingEvent {
    const content = event.payload.content;
    const mode = event.payload.streamUpdateMode;
    if (
      typeof content !== 'string' ||
      !isTextStreamKind(event.kind) ||
      (mode !== CodingStreamUpdateMode.Append && mode !== CodingStreamUpdateMode.Replace)
    ) {
      return event;
    }

    const key = this.sentKey(workspaceRoot, event.id);
    const previous = this.sent.get(key);
    const sentLength = previous?.length ?? 0;

    if (mode === CodingStreamUpdateMode.Append) {
      if (sentLength > content.length) {
        this.sent.set(key, { length: content.length });
        return withStreamContent(event, content, content.length, CodingStreamUpdateMode.Replace);
      }
      const suffix = sentLength === 0 ? content : content.slice(sentLength);
      this.sent.set(key, { length: content.length });
      return withStreamContent(event, suffix, content.length, mode);
    }

    const previousText = previous?.text;
    if (previousText !== undefined && content.startsWith(previousText)) {
      const suffix =
        previousText.length === content.length ? '' : content.slice(previousText.length);
      this.sent.set(key, { length: content.length, text: content });
      return withStreamContent(event, suffix, content.length, mode);
    }
    this.sent.set(key, { length: content.length, text: content });
    return withStreamContent(event, content, content.length, mode);
  }
}
