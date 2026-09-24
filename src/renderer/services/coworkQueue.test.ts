// @vitest-environment jsdom
import { beforeEach, expect, test, vi } from 'vitest';

import { coworkQueueService } from './coworkQueue';

interface EnqueuePayload {
  sessionId: string;
  text: string;
  imageAttachments?: unknown;
  fileAttachments?: unknown;
  skillIds?: string[];
}

const enqueuePendingMessage = vi.hoisted(() =>
  vi.fn(async (_options: EnqueuePayload) => ({ success: true })),
);

beforeEach(() => {
  enqueuePendingMessage.mockClear();
  (window as unknown as { electron: unknown }).electron = {
    cowork: { enqueuePendingMessage },
  };
});

test('forwards both attachment kinds and the skill picks', async () => {
  await coworkQueueService.enqueue(
    'session-1',
    'review this',
    [{ name: 'screen.png', mimeType: 'image/png', base64Data: 'a' }],
    [{ name: 'brief.docx', path: '/tmp/brief.docx', extension: 'DOCX' }],
    ['skill-docx'],
  );

  expect(enqueuePendingMessage).toHaveBeenCalledWith({
    sessionId: 'session-1',
    text: 'review this',
    imageAttachments: [{ name: 'screen.png', mimeType: 'image/png', base64Data: 'a' }],
    fileAttachments: [{ name: 'brief.docx', path: '/tmp/brief.docx', extension: 'DOCX' }],
    skillIds: ['skill-docx'],
  });
});

test('forwards an input that attached nothing as empty fields', async () => {
  await coworkQueueService.enqueue('session-1', 'plain follow-up');

  expect(enqueuePendingMessage).toHaveBeenCalledWith({
    sessionId: 'session-1',
    text: 'plain follow-up',
    imageAttachments: undefined,
    fileAttachments: undefined,
    skillIds: undefined,
  });
});
