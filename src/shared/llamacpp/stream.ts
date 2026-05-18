import type { LlamaCppChatChunk, LlamaCppToolCall } from './types';

export type LlamaCppStreamPhase = 'waiting' | 'thinking' | 'responding' | 'done' | 'error';

export type LlamaCppStreamState = {
  rawContent: string;
  officialThinking: string;
  thinking: string;
  content: string;
  toolCalls: LlamaCppToolCall[];
  done: boolean;
  phase: LlamaCppStreamPhase;
  finalChunk: LlamaCppChatChunk | null;
  error: string | null;
};

export function createLlamaCppStreamState(): LlamaCppStreamState {
  return {
    rawContent: '',
    officialThinking: '',
    thinking: '',
    content: '',
    toolCalls: [],
    done: false,
    phase: 'waiting',
    finalChunk: null,
    error: null,
  };
}

export function reduceLlamaCppStreamChunk(
  state: LlamaCppStreamState,
  chunk: LlamaCppChatChunk,
): LlamaCppStreamState {
  if (chunk.error) {
    return {
      ...state,
      done: true,
      phase: 'error',
      finalChunk: chunk,
      error: chunk.error,
    };
  }

  const message = chunk.message;
  const thinkingDelta = readStringField(message, 'thinking')
    || readStringField(message, 'reasoning_content');
  const contentDelta = typeof message?.content === 'string' ? message.content : '';
  const rawContent = state.rawContent + contentDelta;
  const officialThinking = state.officialThinking + thinkingDelta;
  const legacySplit = splitThinkMarkup(rawContent);
  const thinking = joinThinking(officialThinking, legacySplit.thinking);
  const content = legacySplit.content;
  const toolCalls = Array.isArray(message?.tool_calls)
    ? [...state.toolCalls, ...message.tool_calls]
    : state.toolCalls;

  let phase: LlamaCppStreamPhase = state.phase;
  if (content) {
    phase = 'responding';
  } else if (thinking) {
    phase = 'thinking';
  } else if (phase === 'done' || phase === 'error') {
    phase = 'waiting';
  }
  if (chunk.done) {
    phase = 'done';
  }

  return {
    rawContent,
    officialThinking,
    thinking,
    content,
    toolCalls,
    done: Boolean(chunk.done),
    phase,
    finalChunk: resolveFinalChunk(state.finalChunk, chunk),
    error: null,
  };
}

export function splitThinkMarkup(value: string): { thinking: string; content: string } {
  const tagPattern = /<\/?think>/gi;
  let thinking = '';
  let content = '';
  let cursor = 0;
  let inThinking = false;
  let match: RegExpExecArray | null;

  while ((match = tagPattern.exec(value)) !== null) {
    const segment = value.slice(cursor, match.index);
    if (inThinking) {
      thinking += segment;
    } else {
      content += segment;
    }
    inThinking = match[0].toLowerCase() === '<think>';
    cursor = tagPattern.lastIndex;
  }

  const tail = value.slice(cursor);
  if (inThinking) {
    thinking += tail;
  } else {
    content += tail;
  }

  return { thinking, content };
}

function readStringField(message: unknown, key: string): string {
  if (!message || typeof message !== 'object') return '';
  const value = (message as Record<string, unknown>)[key];
  return typeof value === 'string' ? value : '';
}

function joinThinking(officialThinking: string, legacyThinking: string): string {
  if (!officialThinking) return legacyThinking;
  if (!legacyThinking) return officialThinking;
  return `${officialThinking}\n${legacyThinking}`;
}

function resolveFinalChunk(current: LlamaCppChatChunk | null, next: LlamaCppChatChunk): LlamaCppChatChunk | null {
  if (!next.done) return current;
  if (hasReliableMetrics(next)) return next;
  return current ?? next;
}

function hasReliableMetrics(chunk: LlamaCppChatChunk): boolean {
  return isFiniteNumber(chunk.eval_count)
    || isFiniteNumber(chunk.predicted_per_second)
    || isFiniteNumber(readNestedNumber(chunk.usage, 'completion_tokens'))
    || isFiniteNumber(readNestedNumber(chunk.timings, 'predicted_n'))
    || isFiniteNumber(readNestedNumber(chunk.timings, 'predicted_per_second'));
}

function readNestedNumber(source: unknown, key: string): number | undefined {
  if (!source || typeof source !== 'object') return undefined;
  const value = (source as Record<string, unknown>)[key];
  return typeof value === 'number' ? value : undefined;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}
