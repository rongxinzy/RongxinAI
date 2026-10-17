/**
 * Pi event generators + deterministic randomness for the streaming pipeline
 * harness (split out of streamingPipelineHarness.ts to respect the 1000-line cap).
 */

/** mulberry32 PRNG: deterministic, fast, returns floats in [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Split `text` into random chunks of [minPoints, maxPoints] UNICODE CODE POINTS
 * each. Splitting on code-point boundaries guarantees surrogate pairs (emoji)
 * are never cut in half. `low`/`high` are clamped so every chunk makes progress.
 */
export function splitIntoDeltas(
  text: string,
  minPoints: number,
  maxPoints: number,
  random: () => number,
): string[] {
  const codePoints = [...text];
  if (codePoints.length === 0) return [];
  const low = Math.max(1, Math.min(minPoints, maxPoints));
  const high = Math.max(low, Math.max(minPoints, maxPoints));
  const deltas: string[] = [];
  let offset = 0;
  while (offset < codePoints.length) {
    const size = low + Math.floor(random() * (high - low + 1));
    const clamped = Math.min(size, codePoints.length - offset);
    deltas.push(codePoints.slice(offset, offset + clamped).join(''));
    offset += clamped;
  }
  return deltas;
}

const corpusPieces: readonly string[] = [
  '你好，世界。流式传输必须保持增量。',
  '🚀🌟🧩✨焰火与星河🌠',
  '日本語のストリーミングテキストです。',
  '한국어 스트리밍 텍스트.',
  'The quick brown fox jumps over the lazy dog. ',
  'naïve café résumé — em dash … ellipsis ',
  'Ω≈ç√∫˜µ≤≥÷ ±∞ θ ',
  'tabs\tand    multiple spaces\nnewlines\r\n',
  '👨‍👩‍👧‍👦 family emoji sequence ',
  '0123456789 ABCDEFGHIJKLMNOPQRSTUVWXYZ ',
];

/** Random CJK/emoji/latin corpus of exactly `lengthInCodePoints` code points. */
export function buildCorpus(lengthInCodePoints: number, random: () => number): string {
  const codePoints: string[] = [];
  while (codePoints.length < lengthInCodePoints) {
    const piece = corpusPieces[Math.floor(random() * corpusPieces.length)];
    codePoints.push(...(piece ?? ''));
  }
  return codePoints.slice(0, Math.max(0, lengthInCodePoints)).join('');
}

// ─── Pi event shapes (mirror the embedded AgentSession protocol) ─────────────

export type PiContentBlock =
  | { type: 'text'; text: string }
  | { type: 'thinking'; thinking: string };

interface PiMessageSnapshot {
  role: 'assistant';
  content: PiContentBlock[];
  stopReason?: string;
}

export type PiAssistantMessageEventKind =
  | 'text_start'
  | 'text_delta'
  | 'text_end'
  | 'thinking_start'
  | 'thinking_delta'
  | 'thinking_end';

interface PiAssistantMessageEvent {
  type: PiAssistantMessageEventKind;
  contentIndex: number;
  delta?: string;
  /** Full part text carried by `*_end` events. */
  content?: string;
  partial?: PiMessageSnapshot;
}

export type PiStreamEvent =
  | { type: 'agent_start' }
  | { type: 'turn_start' }
  | { type: 'message_start'; message: PiMessageSnapshot }
  | {
      type: 'message_update';
      message: PiMessageSnapshot;
      /** Absent ⇒ non-prefix full-content rewrite (no delta). */
      assistantMessageEvent?: PiAssistantMessageEvent;
    }
  | { type: 'message_end'; message: PiMessageSnapshot }
  | { type: 'turn_end'; message: PiMessageSnapshot }
  | { type: 'agent_end'; messages: PiMessageSnapshot[] }
  | { type: 'agent_settled' };

interface PiPartState {
  kind: 'text' | 'thinking';
  contentIndex: number;
  text: string;
}

/**
 * Builds Pi events whose `message.content` is the CUMULATIVE block snapshot
 * (real AgentSession behavior). Deltas are additive; `rewriteText` emits a
 * delta-less `message_update` whose content does not extend the previous text.
 */
export class PiTurnBuilder {
  private readonly parts: PiPartState[] = [];

  constructor(private readonly random: () => number = Math.random) {}

  agentStart(): PiStreamEvent {
    return { type: 'agent_start' };
  }

  turnStart(): PiStreamEvent {
    return { type: 'turn_start' };
  }

  messageStart(): PiStreamEvent {
    return { type: 'message_start', message: { role: 'assistant', content: [] } };
  }

  beginTextPart(contentIndex: number): PiStreamEvent {
    this.parts.push({ kind: 'text', contentIndex, text: '' });
    return this.updateEvent(contentIndex, 'text_start');
  }

  beginThinkingPart(contentIndex: number): PiStreamEvent {
    this.parts.push({ kind: 'thinking', contentIndex, text: '' });
    return this.updateEvent(contentIndex, 'thinking_start');
  }

  appendText(contentIndex: number, delta: string): PiStreamEvent {
    this.ensurePart('text', contentIndex).text += delta;
    return this.updateEvent(contentIndex, 'text_delta', { delta });
  }

  appendThinking(contentIndex: number, delta: string): PiStreamEvent {
    this.ensurePart('thinking', contentIndex).text += delta;
    return this.updateEvent(contentIndex, 'thinking_delta', { delta });
  }

  endTextPart(contentIndex: number): PiStreamEvent {
    return this.updateEvent(contentIndex, 'text_end', {
      content: this.requirePart(contentIndex).text,
    });
  }

  endThinkingPart(contentIndex: number): PiStreamEvent {
    return this.updateEvent(contentIndex, 'thinking_end', {
      content: this.requirePart(contentIndex).text,
    });
  }

  /** Non-prefix rewrite: delta-less message_update with the full new content. */
  rewriteText(newText: string): PiStreamEvent {
    const textPart = this.parts.find(part => part.kind === 'text');
    if (!textPart) throw new Error('rewriteText requires an existing text part');
    textPart.text = newText;
    return { type: 'message_update', message: { role: 'assistant', content: this.blocks() } };
  }

  /** Delta-less rewrite of the thinking part (symmetric to `rewriteText`). */
  rewriteThinking(newText: string): PiStreamEvent {
    const thinkingPart = this.parts.find(part => part.kind === 'thinking');
    if (!thinkingPart) throw new Error('rewriteThinking requires an existing thinking part');
    thinkingPart.text = newText;
    return { type: 'message_update', message: { role: 'assistant', content: this.blocks() } };
  }

  messageEnd(stopReason = 'stop'): PiStreamEvent {
    return {
      type: 'message_end',
      message: { role: 'assistant', content: this.blocks(), stopReason },
    };
  }

  turnEnd(): PiStreamEvent {
    return { type: 'turn_end', message: { role: 'assistant', content: this.blocks() } };
  }

  agentEnd(): PiStreamEvent {
    return { type: 'agent_end', messages: [] };
  }

  agentSettled(): PiStreamEvent {
    return { type: 'agent_settled' };
  }

  /** All text parts joined in contentIndex order (expected answer text). */
  textSoFar(): string {
    return this.sortedParts()
      .filter(part => part.kind === 'text')
      .map(part => part.text)
      .join('');
  }

  /** All thinking parts joined in contentIndex order. */
  thinkingSoFar(): string {
    return this.sortedParts()
      .filter(part => part.kind === 'thinking')
      .map(part => part.text)
      .join('');
  }

  private sortedParts(): PiPartState[] {
    return [...this.parts].sort((left, right) => left.contentIndex - right.contentIndex);
  }

  private blocks(): PiContentBlock[] {
    return this.sortedParts().map(part =>
      part.kind === 'text'
        ? { type: 'text', text: part.text }
        : { type: 'thinking', thinking: part.text },
    );
  }

  /** Deltas may arrive without a *_start event (Pi does not always send one). */
  private ensurePart(kind: PiPartState['kind'], contentIndex: number): PiPartState {
    const existing = this.parts.find(candidate => candidate.contentIndex === contentIndex);
    if (existing) return existing;
    const part: PiPartState = { kind, contentIndex, text: '' };
    this.parts.push(part);
    return part;
  }

  private requirePart(contentIndex: number): PiPartState {
    const part = this.parts.find(candidate => candidate.contentIndex === contentIndex);
    if (!part) throw new Error(`No part registered at contentIndex ${contentIndex}`);
    return part;
  }

  private updateEvent(
    contentIndex: number,
    eventType: PiAssistantMessageEventKind,
    extra?: { delta?: string; content?: string },
  ): PiStreamEvent {
    const content = this.blocks();
    return {
      type: 'message_update',
      message: { role: 'assistant', content },
      assistantMessageEvent: {
        type: eventType,
        contentIndex,
        partial: { role: 'assistant', content },
        ...(extra ?? {}),
      },
    };
  }
}

/** A fully-built assistant turn, split so tests can assert BEFORE message_end. */
export interface BuiltTurn {
  /** Everything in emission order (streamEvents + endEvents). */
  readonly events: readonly PiStreamEvent[];
  /** Events before message_end (agent_start … last delta / rewrite). */
  readonly streamEvents: readonly PiStreamEvent[];
  /** Terminal events: message_end, turn_end, agent_end, agent_settled. */
  readonly endEvents: readonly PiStreamEvent[];
  /** Expected answer text (text parts joined in contentIndex order). */
  readonly finalText: string;
  /** Expected reasoning text (thinking parts joined in contentIndex order). */
  readonly finalThinking: string;
  /** Index into `streamEvents` where the non-prefix rewrite fired, if any. */
  readonly rewriteEventIndex?: number;
}

function clampDeltaRange(
  min: number | undefined,
  max: number | undefined,
): { min: number; max: number } {
  const low = Math.max(1, min ?? 8);
  return { min: low, max: Math.max(low, max ?? 40) };
}

function finishBuiltTurn(
  builder: PiTurnBuilder,
  streamEvents: PiStreamEvent[],
  stopReason: string | undefined,
): BuiltTurn {
  const endEvents: PiStreamEvent[] = [
    builder.messageEnd(stopReason),
    builder.turnEnd(),
    builder.agentEnd(),
    builder.agentSettled(),
  ];
  return {
    events: [...streamEvents, ...endEvents],
    streamEvents,
    endEvents,
    finalText: builder.textSoFar(),
    finalThinking: builder.thinkingSoFar(),
  };
}

export interface BuildTextTurnOptions {
  text: string;
  random: () => number;
  /** Code points per delta; defaults 8–40. */
  minDelta?: number;
  maxDelta?: number;
  /** Also emit text_start / text_end (end carries the full part text). */
  emitStartEnd?: boolean;
  stopReason?: string;
}

/** One text part (contentIndex 0) streamed as randomly split deltas. */
export function buildTextTurn(options: BuildTextTurnOptions): BuiltTurn {
  const { min, max } = clampDeltaRange(options.minDelta, options.maxDelta);
  const builder = new PiTurnBuilder(options.random);
  const events: PiStreamEvent[] = [
    builder.agentStart(),
    builder.turnStart(),
    builder.messageStart(),
  ];
  if (options.emitStartEnd) events.push(builder.beginTextPart(0));
  for (const delta of splitIntoDeltas(options.text, min, max, options.random)) {
    events.push(builder.appendText(0, delta));
  }
  if (options.emitStartEnd) events.push(builder.endTextPart(0));
  return finishBuiltTurn(builder, events, options.stopReason);
}

export interface BuildInterleavedThinkingTurnOptions {
  textBefore: string;
  thinking: string;
  textAfter: string;
  random: () => number;
  minDelta?: number;
  maxDelta?: number;
  /** Emit part start/end events per phase; default true. */
  emitStartEnd?: boolean;
  stopReason?: string;
}

/**
 * ONE assistant message with text(contentIndex 0) → thinking(1) → text(2).
 * `finalText` is `textBefore + textAfter` — part ordering must preserve it.
 */
export function buildInterleavedThinkingTurn(
  options: BuildInterleavedThinkingTurnOptions,
): BuiltTurn {
  const { min, max } = clampDeltaRange(options.minDelta, options.maxDelta);
  const emitStartEnd = options.emitStartEnd ?? true;
  const builder = new PiTurnBuilder(options.random);
  const events: PiStreamEvent[] = [
    builder.agentStart(),
    builder.turnStart(),
    builder.messageStart(),
  ];
  if (emitStartEnd) events.push(builder.beginTextPart(0));
  for (const delta of splitIntoDeltas(options.textBefore, min, max, options.random)) {
    events.push(builder.appendText(0, delta));
  }
  if (emitStartEnd) events.push(builder.endTextPart(0));
  if (emitStartEnd) events.push(builder.beginThinkingPart(1));
  for (const delta of splitIntoDeltas(options.thinking, min, max, options.random)) {
    events.push(builder.appendThinking(1, delta));
  }
  if (emitStartEnd) events.push(builder.endThinkingPart(1));
  if (emitStartEnd) events.push(builder.beginTextPart(2));
  for (const delta of splitIntoDeltas(options.textAfter, min, max, options.random)) {
    events.push(builder.appendText(2, delta));
  }
  if (emitStartEnd) events.push(builder.endTextPart(2));
  return finishBuiltTurn(builder, events, options.stopReason);
}
