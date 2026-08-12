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
