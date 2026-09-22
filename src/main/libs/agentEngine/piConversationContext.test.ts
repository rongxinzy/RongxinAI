import { expect, test } from 'vitest';

import type { CoworkMessage } from '../../coworkStore';
import { CoworkInterruptionCause } from '../../../shared/cowork/interruption';
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

test('restored history preserves the interruption boundary before the current request', () => {
  const prompt = buildPiConversationPrompt(
    [
      message('answer', 'assistant', 'I still need to generate the presentation.'),
      message('stop', 'system', '', {
        interruption: {
          cause: CoworkInterruptionCause.UserStop,
          taskId: 'task',
          sessionId: 'session',
          interruptionId: 'interruption',
          recoverable: false,
        },
      }),
    ],
    '哈哈',
  );
  expect(prompt).toContain('The preceding execution was interrupted.');
  expect(prompt).toContain('unless the current user request explicitly asks to continue or retry');
  expect(prompt.indexOf('Application:')).toBeGreaterThan(prompt.indexOf('Assistant:'));
  expect(prompt.indexOf('Application:')).toBeLessThan(prompt.lastIndexOf('User:'));
  expect(prompt.endsWith('User: 哈哈')).toBe(true);
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

test('preserves the request and recent evidence when the last tool result exceeds the budget', () => {
  const prompt = buildPiConversationPrompt(
    [
      message('request', 'user', 'Keep the approved budget at 180000.'),
      message('call', 'tool_use', '', { toolName: 'bash', toolInput: { command: 'check budget' } }),
      message('result', 'tool_result', `Budget check: ${'x'.repeat(9000)}`),
    ],
    'Continue.',
    { maxChars: calculatePiConversationHistoryCharLimit(16384, 4096) },
  );
  expect(prompt).toContain('Keep the approved budget at 180000.');
  expect(prompt).toContain('Budget check:');
  expect(prompt).toContain('[truncated]');
  expect(prompt.length).toBeLessThan(2300);
});

test('restores references for image-only and file-only messages without leaking base64', () => {
  const prompt = buildPiConversationPrompt(
    [
      message('image', 'user', '', {
        imageAttachments: [
          {
            name: 'reference.png',
            path: '/workspace/reference.png',
            mimeType: 'image/png',
            base64Data: 'PRIVATE_IMAGE_BYTES',
          },
        ],
      }),
      message('file', 'user', '', {
        fileAttachments: [
          { name: 'requirements.pdf', path: '/workspace/requirements.pdf', extension: '.pdf' },
        ],
      }),
    ],
    'Continue.',
  );
  expect(prompt).toContain('/workspace/reference.png');
  expect(prompt).toContain('/workspace/requirements.pdf');
  expect(prompt).toContain('Reopen with the file/image tools');
  expect(prompt).not.toContain('PRIVATE_IMAGE_BYTES');
});

test('explicitly marks attachments that cannot be restored', () => {
  const prompt = buildPiConversationPrompt(
    [
      message('image', 'user', '', {
        imageAttachments: [
          { name: 'reference.png', mimeType: 'image/png', base64Data: 'PRIVATE_IMAGE_BYTES' },
        ],
      }),
    ],
    'Continue.',
  );
  expect(prompt).toContain('unavailable after restore');
  expect(prompt).not.toContain('PRIVATE_IMAGE_BYTES');
});
