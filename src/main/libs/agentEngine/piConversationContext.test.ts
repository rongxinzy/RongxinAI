import { expect, test } from 'vitest';

import type { CoworkMessage } from '../../coworkStore';
import {
  buildPiConversationPrompt,
  calculatePiConversationHistoryCharLimit,
} from './piConversationContext';

const message = (
  id: string,
  type: CoworkMessage['type'],
  content: string,
  metadata?: CoworkMessage['metadata'],
): CoworkMessage => ({
  id,
  type,
  content,
  timestamp: 1,
  metadata,
});

test('excludes thinking while preserving user, assistant, and tool facts', () => {
  const prompt = buildPiConversationPrompt(
    [
      message('user-1', 'user', 'Inspect the project.'),
      message('thinking-1', 'assistant', 'Private reasoning.', { isThinking: true }),
      message('tool-1', 'tool_use', '', {
        toolName: 'read',
        toolInput: { path: 'src/app.ts' },
      }),
      message('result-1', 'tool_result', 'export const app = true;'),
      message('answer-1', 'assistant', 'The app entry was found.'),
    ],
    'Continue.',
  );

  expect(prompt).toContain('User: Inspect the project.');
  expect(prompt).toContain('Tool call (read): {"path":"src/app.ts"}');
  expect(prompt).toContain('Tool result: export const app = true;');
  expect(prompt).toContain('Assistant: The app entry was found.');
  expect(prompt).not.toContain('Private reasoning.');
  expect(prompt).toContain('User: Continue.');
});

test('keeps the latest complete entries when recovery context exceeds its budget', () => {
  const messages = Array.from({ length: 10 }, (_, index) =>
    message(`user-${index}`, 'user', `${index}:${'x'.repeat(7_900)}`),
  );
  const prompt = buildPiConversationPrompt(messages, 'Continue.');

  expect(prompt).not.toContain('User: 0:');
  expect(prompt).not.toContain('User: 1:');
  expect(prompt).toContain('User: 9:');
  expect(prompt.length).toBeLessThan(61_000);
});

test('calculates a conservative history budget for the default 32K context', () => {
  expect(calculatePiConversationHistoryCharLimit()).toBe(10_240);
  expect(calculatePiConversationHistoryCharLimit(32_768, 8_192)).toBe(8_192);
});

test('scales history budget down for small and invalid model contexts', () => {
  expect(calculatePiConversationHistoryCharLimit(16_384, 4_096)).toBe(2_048);
  expect(calculatePiConversationHistoryCharLimit(8_192, 2_048)).toBe(2_000);
  expect(calculatePiConversationHistoryCharLimit(0, 0)).toBe(10_240);
  expect(calculatePiConversationHistoryCharLimit(Number.NaN, -1)).toBe(10_240);
});
