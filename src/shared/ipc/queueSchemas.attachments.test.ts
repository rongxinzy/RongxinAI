import { describe, expect, test } from 'vitest';

import { CoworkQueueAttachmentLimit } from '../cowork/pendingMessageQueue';
import { CoworkQueueEnqueueSchema } from './queueSchemas';

const baseInput = { sessionId: 'session-1', text: 'review this' };

describe('CoworkQueueEnqueueSchema attachment limits', () => {
  test('accepts a bounded image attachment with skill ids', () => {
    const parsed = CoworkQueueEnqueueSchema.parse({
      ...baseInput,
      imageAttachments: [{ name: 'screen.png', mimeType: 'image/png', base64Data: 'a' }],
      skillIds: ['skill-docx'],
    });

    expect(parsed.skillIds).toEqual(['skill-docx']);
  });

  test('strips a source path from a queued image', () => {
    const parsed = CoworkQueueEnqueueSchema.parse({
      ...baseInput,
      imageAttachments: [
        {
          name: 'screen.png',
          mimeType: 'image/png',
          base64Data: 'a',
          path: 'C:\\images\\screen.png',
        },
      ],
    });

    expect(parsed.imageAttachments?.[0]).toEqual({
      name: 'screen.png',
      mimeType: 'image/png',
      base64Data: 'a',
    });
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
