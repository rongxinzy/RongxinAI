import { describe, expect, test } from 'vitest';

import { CoworkQueueAttachmentLimit } from '../cowork/pendingMessageQueue';
import { CoworkQueueEnqueueSchema } from './queueSchemas';

const baseInput = { sessionId: 'session-1', text: 'review this' };

describe('CoworkQueueEnqueueSchema attachment limits', () => {
  test('accepts a bounded image attachment and skill snapshot', () => {
    const parsed = CoworkQueueEnqueueSchema.parse({
      ...baseInput,
      imageAttachments: [{ name: 'screen.png', mimeType: 'image/png', base64Data: 'a' }],
      skillIds: ['skill-docx'],
      skillPrompt: 'Use the document skill.',
    });

    expect(parsed.skillIds).toEqual(['skill-docx']);
  });

  test('rejects image queues beyond the configured limits', () => {
    expect(() =>
      CoworkQueueEnqueueSchema.parse({
        ...baseInput,
        imageAttachments: Array.from({ length: CoworkQueueAttachmentLimit.MaxImages + 1 }, () => ({
          name: 'screen.png',
          mimeType: 'image/png',
          base64Data: 'a',
        })),
      }),
    ).toThrow();
    expect(() =>
      CoworkQueueEnqueueSchema.parse({
        ...baseInput,
        imageAttachments: [
          {
            name: 'screen.png',
            mimeType: 'image/png',
            base64Data: 'a'.repeat(CoworkQueueAttachmentLimit.MaxImageBase64Chars + 1),
          },
        ],
      }),
    ).toThrow();
  });
});
