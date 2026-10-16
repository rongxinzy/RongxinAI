import { expect, test } from 'vitest';

import type { CoworkMessage } from '../../../types/cowork';
import type { ConversationTurn } from './messageGrouping';
import { estimateConversationTurnHeight } from './conversationTurnHeight';

const message = (id: string, content: string): CoworkMessage => ({
  id,
  type: 'assistant',
  content,
  timestamp: 1,
});

const turn = (content: string): ConversationTurn => ({
  id: 'turn-1',
  userMessage: null,
  assistantItems: [{ type: 'assistant', message: message('assistant-1', content) }],
});

test('estimates content-heavy turns above the empty-turn fallback', () => {
  const shortEstimate = estimateConversationTurnHeight(turn('short response'));
  const codeLines = Array.from(
    { length: 80 },
    (_, index) => `const value${index} = ${index};`,
  ).join('\n');
  const codeEstimate = estimateConversationTurnHeight(turn(`\`\`\`ts\n${codeLines}\n\`\`\``));

  expect(shortEstimate).toBeLessThan(300);
  expect(codeEstimate).toBeGreaterThan(1_500);
});

test('bounds thinking block and tool results estimation to avoid virtualizer jumps', () => {
  const longThinkingContent = Array.from({ length: 500 }, (_, i) => `Thinking step ${i}`).join(
    '\n',
  );
  const thinkingTurn: ConversationTurn = {
    id: 'turn-thinking',
    userMessage: null,
    assistantItems: [
      {
        type: 'assistant',
        message: {
          id: 'thought-1',
          type: 'assistant',
          content: longThinkingContent,
          timestamp: 1,
          metadata: { isThinking: true },
        },
      },
      {
        type: 'assistant',
        message: message('assistant-1', 'short answer'),
      },
    ],
  };

  const estimate = estimateConversationTurnHeight(thinkingTurn);
  // Even with 500 lines of thought, estimated height must stay compact (well under 500px)
  expect(estimate).toBeLessThan(400);
  expect(estimate).toBeGreaterThanOrEqual(180);

  const streamingThinkingTurn: ConversationTurn = {
    id: 'turn-thinking-streaming',
    userMessage: null,
    assistantItems: [
      {
        type: 'assistant',
        message: {
          id: 'thought-streaming',
          type: 'assistant',
          content: longThinkingContent,
          timestamp: 1,
          metadata: { isThinking: true, isStreaming: true, isFinal: false },
        },
      },
    ],
  };
  const streamingEstimate = estimateConversationTurnHeight(streamingThinkingTurn);
  // Streaming/expanded thinking adds up to THINKING_MAX_CONTENT_HEIGHT_PX (256px)
  expect(streamingEstimate).toBeGreaterThan(estimate);
  expect(streamingEstimate).toBeLessThanOrEqual(400);
});
