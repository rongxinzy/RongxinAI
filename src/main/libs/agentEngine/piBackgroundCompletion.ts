import type { AssistantMessage, Context, TextContent } from '@earendil-works/pi-ai';

import {
  SessionMemoryCompletionRole,
  type SessionMemoryCompletionMessage,
} from '../../memory/sessionMemoryExtractor';

const PiBackgroundCompletionStopReason = {
  Aborted: 'aborted',
  Error: 'error',
  Length: 'length',
} as const;

const PiBackgroundCompletionContentType = {
  Text: 'text',
  Thinking: 'thinking',
} as const;

export type PiBackgroundCompletionResult = Pick<AssistantMessage, 'content'> &
  Partial<Pick<AssistantMessage, 'errorMessage' | 'stopReason'>>;

export function buildPiBackgroundCompletionContext(
  messages: readonly SessionMemoryCompletionMessage[],
  now: () => number = Date.now,
): Context {
  const systemPrompts: string[] = [];
  const userMessages: Context['messages'] = [];

  for (const message of messages) {
    if (message.role === SessionMemoryCompletionRole.System) {
      if (message.content.trim()) systemPrompts.push(message.content);
      continue;
    }
    userMessages.push({
      role: SessionMemoryCompletionRole.User,
      content: message.content,
      timestamp: now(),
    });
  }

  if (userMessages.length === 0) {
    throw new Error('Background completion requires at least one user message.');
  }

  const systemPrompt = systemPrompts.join('\n\n');
  return {
    ...(systemPrompt ? { systemPrompt } : {}),
    messages: userMessages,
  };
}

export function extractPiBackgroundCompletionText(result: PiBackgroundCompletionResult): string {
  if (
    result.stopReason === PiBackgroundCompletionStopReason.Error ||
    result.stopReason === PiBackgroundCompletionStopReason.Aborted
  ) {
    throw new Error(
      result.errorMessage || `Pi background completion stopped with ${result.stopReason}.`,
    );
  }
  if (result.stopReason === PiBackgroundCompletionStopReason.Length) {
    throw new Error('Pi background completion reached its output token limit.');
  }

  const text = result.content
    .filter(isTextContent)
    .map(block => block.text)
    .join('');
  if (text.trim()) return text;

  const hasThinking = result.content.some(
    block =>
      typeof block === 'object' &&
      block !== null &&
      'type' in block &&
      block.type === PiBackgroundCompletionContentType.Thinking,
  );
  throw new Error(
    hasThinking
      ? 'Pi background completion returned reasoning without final text.'
      : result.errorMessage || 'Pi background completion returned no text content.',
  );
}

function isTextContent(content: unknown): content is TextContent {
  return (
    typeof content === 'object' &&
    content !== null &&
    'type' in content &&
    content.type === PiBackgroundCompletionContentType.Text &&
    'text' in content &&
    typeof content.text === 'string'
  );
}
