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

/** [contentIndex, contentLength] pairs, kept sorted by ascending contentIndex. */
type PiStreamSegmentLengths = ReadonlyArray<readonly [number, number]>;

/** Per-kind segment length tables captured around a single mutation. */
interface PiStreamLengthTables {
  text: PiStreamSegmentLengths;
  thinking: PiStreamSegmentLengths;
}

const EMPTY_LENGTH_TABLES: PiStreamLengthTables = { text: [], thinking: [] };

function sameSegmentLengths(a: PiStreamSegmentLengths, b: PiStreamSegmentLengths): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    const entryA = a[i];
    const entryB = b[i];
    if (entryA === undefined || entryB === undefined) return false;
    if (entryA[0] !== entryB[0] || entryA[1] !== entryB[1]) return false;
  }
  return true;
}

function lastSegmentEntry(lengths: PiStreamSegmentLengths): readonly [number, number] | undefined {
  return lengths.length > 0 ? lengths[lengths.length - 1] : undefined;
}

/**
 * Accumulates Pi 0.84 delta-only message updates while retaining a snapshot
 * fallback for older embedded event producers. message_end remains authoritative.
 *
 * The append-only bookkeeping reads only segment indices and string lengths,
 * never character content. The accumulated text is assembled by
 * `content + delta` and snapshot()'s `text += segment.content`, i.e. V8 cons
 * strings; any character access (charCodeAt, startsWith, endsWith, ===) first
 * flattens the whole rope, which is O(N) per delta. `.length` is a header
 * read on a cons string, so the recorded length tables cost O(segment count)
 * per update and stay independent of content size.
 */
export class PiStreamAccumulator {
  private readonly segments = new Map<number, PiStreamSegment>();
  private priorLengthTables: PiStreamLengthTables = EMPTY_LENGTH_TABLES;
  private currentLengthTables: PiStreamLengthTables = EMPTY_LENGTH_TABLES;

  reset(): void {
    this.segments.clear();
    this.priorLengthTables = EMPTY_LENGTH_TABLES;
    this.currentLengthTables = EMPTY_LENGTH_TABLES;
  }

  update(
    event: PiAssistantMessageEvent | undefined,
    snapshotMessage?: PiStreamMessage,
  ): PiStreamSnapshot {
    const before = this.captureLengthTables();
    const result = this.applyUpdate(event, snapshotMessage);
    this.priorLengthTables = before;
    this.currentLengthTables = this.captureLengthTables();
    return result;
  }

  reconcile(message?: PiStreamMessage): PiStreamSnapshot {
    const before = this.captureLengthTables();
    this.replaceFromSnapshot(message);
    this.priorLengthTables = before;
    this.currentLengthTables = this.captureLengthTables();
    return this.snapshot();
  }

  /**
   * Structural append-only verdict for the most recent update()/reconcile().
   * True iff every segment of `kind` except the last one kept its index and
   * length, and the last one either is the previous last segment grown by
   * exactly `deltaLength`, or is a brand-new trailing segment holding exactly
   * `deltaLength` characters with the previous last segment untouched. Only
   * numbers are compared; segment content is never read (see the class
   * comment for why).
   */
  lastUpdateAppendedOnly(kind: 'text' | 'thinking', deltaLength: number): boolean {
    if (deltaLength <= 0) return false;
    const before = this.priorLengthTables[kind];
    const after = this.currentLengthTables[kind];
    const lastBefore = lastSegmentEntry(before);
    const lastAfter = lastSegmentEntry(after);
    if (lastAfter === undefined) return false;
    if (lastBefore !== undefined && lastAfter[0] === lastBefore[0]) {
      return (
        after.length === before.length &&
        lastAfter[1] === lastBefore[1] + deltaLength &&
        sameSegmentLengths(before.slice(0, -1), after.slice(0, -1))
      );
    }
    return (
      after.length === before.length + 1 &&
      (lastBefore === undefined || lastAfter[0] > lastBefore[0]) &&
      lastAfter[1] === deltaLength &&
      sameSegmentLengths(before, after.slice(0, -1))
    );
  }

  private applyUpdate(
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

  private captureLengthTables(): PiStreamLengthTables {
    const text: Array<[number, number]> = [];
    const thinking: Array<[number, number]> = [];
    for (const [index, segment] of this.segments) {
      // Reading `.length` on a cons string is a header read; it never
      // flattens the content.
      if (segment.kind === PiStreamSegmentKind.Text) {
        text.push([index, segment.content.length]);
      } else {
        thinking.push([index, segment.content.length]);
      }
    }
    text.sort(([a], [b]) => a - b);
    thinking.sort(([a], [b]) => a - b);
    return { text, thinking };
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
