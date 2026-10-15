import { expect, test } from 'vitest';

import type { CoworkMessage } from '../../coworkStore';
import { CoworkInterruptionCause } from '../../../shared/cowork/interruption';
import {
  buildPiConversationPrompt,
  buildPiConversationPromptFromPages,
  calculatePiConversationHistoryCharLimit,
  restorePiConversationPrompt,
  summarizePiHistoryFromStore,
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

test('points at the bundled OCR helper when replayed images have paths', () => {
  const prompt = buildPiConversationPrompt(
    [
      message('image', 'user', '', {
        imageAttachments: [
          { name: 'shot.png', mimeType: 'image/png', path: '/workspace/shot.png' },
        ],
      }),
      message('file', 'user', '', {
        fileAttachments: [
          { name: 'requirements.pdf', path: '/workspace/requirements.pdf', extension: '.pdf' },
        ],
      }),
    ],
    'What did the screenshot say?',
    { ocrCommandFor: imagePath => `ocr-image.ps1 -Path "${imagePath}"` },
  );

  expect(prompt).toContain('ocr-image.ps1 -Path "/workspace/shot.png"');
  // Non-image attachments get no extraction command.
  expect(prompt).not.toContain('ocr-image.ps1 -Path "/workspace/requirements.pdf"');
});

test('replays image references unchanged when no OCR helper is available', () => {
  const prompt = buildPiConversationPrompt(
    [
      message('image', 'user', '', {
        imageAttachments: [
          { name: 'shot.png', mimeType: 'image/png', path: '/workspace/shot.png' },
        ],
      }),
    ],
    'Continue.',
  );

  expect(prompt).toContain('/workspace/shot.png');
  expect(prompt).not.toContain('text extraction');
});

// ── Paged restore: byte-identical output without materializing history ──

const pagedFetchFrom = (
  messages: CoworkMessage[],
): ((offset: number, limit: number) => CoworkMessage[]) => {
  const newestFirst = [...messages].reverse();
  return (offset, limit) => newestFirst.slice(offset, offset + limit);
};

test('paged restore matches the array build byte for byte across page boundaries', () => {
  const fixtures: CoworkMessage[][] = [
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
    // Budget cut mid-history: older entries are dropped either way.
    Array.from({ length: 10 }, (_, index) =>
      message(`user-${index}`, 'user', `${index}:${'x'.repeat(7_900)}`),
    ),
    // Mixed lengths crossing several pages.
    Array.from({ length: 25 }, (_, index) =>
      message(
        `m-${index}`,
        index % 2 === 0 ? 'user' : 'assistant',
        `${index}:${'y'.repeat((index * 137) % 900)}`,
      ),
    ),
  ];

  for (const fixture of fixtures) {
    const expected = buildPiConversationPrompt(fixture, 'Continue.');
    for (const pageSize of [1, 3, 7, 100]) {
      const paged = buildPiConversationPromptFromPages(pagedFetchFrom(fixture), 'Continue.', {
        pageSize,
      });
      expect(paged).toBe(expected);
    }
  }
});

test('paged restore stops fetching once the character budget is filled', () => {
  const messages = Array.from({ length: 50 }, (_, index) =>
    message(`user-${index}`, 'user', `${index}:${'z'.repeat(500)}`),
  );
  const newestFirst = [...messages].reverse();
  const fetchedOffsets: number[] = [];
  const fetchPage = (offset: number, limit: number): CoworkMessage[] => {
    fetchedOffsets.push(offset);
    return newestFirst.slice(offset, offset + limit);
  };

  const paged = buildPiConversationPromptFromPages(fetchPage, 'Continue.', {
    maxChars: 2_000,
    pageSize: 10,
  });

  expect(paged).toBe(buildPiConversationPrompt(messages, 'Continue.', { maxChars: 2_000 }));
  // 2000 chars of budget, ~500+ chars per entry: the first page alone fills it.
  expect(fetchedOffsets).toEqual([0]);
});

test('paged restore returns the bare prompt when history is empty', () => {
  expect(buildPiConversationPromptFromPages(() => [], 'Continue.')).toBe('Continue.');
});

test('restorePiConversationPrompt tolerates a store without paged reads', () => {
  expect(restorePiConversationPrompt(undefined, 's1', 'Continue.')).toBe('Continue.');
  expect(restorePiConversationPrompt({} as never, 's1', 'Continue.')).toBe('Continue.');
});

test('summarizePiHistoryFromStore never breaks a rebuild on a bad store', () => {
  const empty = { messageCount: 0, contentBytes: 0, metadataBytes: 0 };
  expect(summarizePiHistoryFromStore(null, 's1')).toEqual(empty);
  expect(
    summarizePiHistoryFromStore(
      {
        getSessionMessageStats: () => {
          throw new Error('db gone');
        },
      } as never,
      's1',
    ),
  ).toEqual(empty);
  expect(
    summarizePiHistoryFromStore(
      {
        getSessionMessageStats: () => ({ messageCount: 2, contentBytes: 10, metadataBytes: 4 }),
      } as never,
      's1',
    ),
  ).toEqual({ messageCount: 2, contentBytes: 10, metadataBytes: 4 });
});

test('history read failures reject restoration instead of silently discarding context', () => {
  const error = new Error('history read failed');
  expect(() =>
    restorePiConversationPrompt(
      {
        getSessionMessagesDesc: () => {
          throw error;
        },
        getSessionMessageStats: () => ({ messageCount: 0, contentBytes: 0, metadataBytes: 0 }),
      },
      'session',
      'Continue.',
    ),
  ).toThrow(error);
});
