import {
  PiAssistantEventType,
  PiStreamSegmentKind,
  type PiStreamSegmentKind as PiStreamSegmentKindType,
} from './piStreamConstants';

interface PiStreamContentBlock {
  type: string;
  text?: string;
  thinking?: string;
}

export interface PiStreamMessage {
  content?: string | PiStreamContentBlock[] | null;
}

export interface PiAssistantMessageEvent {
  type: string;
  contentIndex?: number;
  delta?: string;
  content?: string;
}

export interface PiStreamSnapshot {
  text: string;
  thinking: string;
}

interface PiStreamSegment {
  kind: PiStreamSegmentKindType;
  content: string;
}

/**
 * Accumulates Pi 0.84 delta-only message updates while retaining a snapshot
 * fallback for older embedded event producers. message_end remains authoritative.
 */
export class PiStreamAccumulator {
  private readonly segments = new Map<number, PiStreamSegment>();

  reset(): void {
    this.segments.clear();
  }

  update(
    event: PiAssistantMessageEvent | undefined,
    snapshotMessage?: PiStreamMessage,
  ): PiStreamSnapshot {
    // Embedded AgentSession events still provide an accumulating partial
    // message. Prefer it when present so mixed thinking/text blocks cannot be
    // missed; JSON/RPC delta-only consumers fall through to the reducer below.
    if (this.hasUsableSnapshot(snapshotMessage)) {
      this.replaceFromSnapshot(snapshotMessage);
      return this.snapshot();
    }
    if (!event) {
      return this.snapshot();
    }

    const contentIndex = event.contentIndex ?? 0;
    switch (event.type) {
      case PiAssistantEventType.Start:
        if (this.segments.size === 0) this.replaceFromSnapshot(snapshotMessage);
        break;
      case PiAssistantEventType.TextStart:
        this.startSegment(contentIndex, PiStreamSegmentKind.Text);
        break;
      case PiAssistantEventType.TextDelta:
        this.appendSegment(contentIndex, PiStreamSegmentKind.Text, event.delta);
        break;
      case PiAssistantEventType.TextEnd:
        this.finishSegment(contentIndex, PiStreamSegmentKind.Text, event.content);
        break;
      case PiAssistantEventType.ThinkingStart:
        this.startSegment(contentIndex, PiStreamSegmentKind.Thinking);
        break;
      case PiAssistantEventType.ThinkingDelta:
        this.appendSegment(contentIndex, PiStreamSegmentKind.Thinking, event.delta);
        break;
      case PiAssistantEventType.ThinkingEnd:
        this.finishSegment(contentIndex, PiStreamSegmentKind.Thinking, event.content);
        break;
      default:
        if (this.segments.size === 0) this.replaceFromSnapshot(snapshotMessage);
        break;
    }
    return this.snapshot();
  }

  reconcile(message?: PiStreamMessage): PiStreamSnapshot {
    this.replaceFromSnapshot(message);
    return this.snapshot();
  }

  private startSegment(index: number, kind: PiStreamSegmentKindType): void {
    const current = this.segments.get(index);
    if (!current || current.kind !== kind) this.segments.set(index, { kind, content: '' });
  }

  private appendSegment(
    index: number,
    kind: PiStreamSegmentKindType,
    delta: string | undefined,
  ): void {
    const current = this.segments.get(index);
    const content = current?.kind === kind ? current.content : '';
    this.segments.set(index, { kind, content: content + (delta ?? '') });
  }

  private finishSegment(
    index: number,
    kind: PiStreamSegmentKindType,
    content: string | undefined,
  ): void {
    const current = this.segments.get(index);
    this.segments.set(index, {
      kind,
      content: content ?? (current?.kind === kind ? current.content : ''),
    });
  }

  private replaceFromSnapshot(message?: PiStreamMessage): void {
    if (!message?.content) return;
    this.segments.clear();
    if (typeof message.content === 'string') {
      this.segments.set(0, { kind: PiStreamSegmentKind.Text, content: message.content });
      return;
    }
    if (!Array.isArray(message.content)) return;
    for (const [index, block] of message.content.entries()) {
      if (block.type === PiStreamSegmentKind.Text) {
        this.segments.set(index, {
          kind: PiStreamSegmentKind.Text,
          content: block.text ?? '',
        });
      } else if (block.type === PiStreamSegmentKind.Thinking) {
        this.segments.set(index, {
          kind: PiStreamSegmentKind.Thinking,
          content: block.thinking ?? '',
        });
      }
    }
  }

  private hasUsableSnapshot(message?: PiStreamMessage): boolean {
    return typeof message?.content === 'string' || Array.isArray(message?.content);
  }

  private snapshot(): PiStreamSnapshot {
    let text = '';
    let thinking = '';
    for (const [, segment] of [...this.segments.entries()].sort(([a], [b]) => a - b)) {
      if (segment.kind === PiStreamSegmentKind.Text) text += segment.content;
      else thinking += segment.content;
    }
    return { text, thinking };
  }
}
