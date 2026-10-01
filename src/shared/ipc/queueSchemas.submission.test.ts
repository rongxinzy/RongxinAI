import { expect, test } from 'vitest';

import { CoworkQueueEnqueueSchema, CoworkQueueUpdateSchema } from './queueSchemas';

test.each(['', ' \t\n', '\u200b\u200d\ufeff'])(
  'rejects visually empty queued messages %j',
  text => {
    expect(CoworkQueueEnqueueSchema.safeParse({ sessionId: 'session', text }).success).toBe(false);
    expect(
      CoworkQueueUpdateSchema.safeParse({ sessionId: 'session', itemId: 'item', text }).success,
    ).toBe(false);
  },
);

test('accepts visible queued messages', () => {
  expect(CoworkQueueEnqueueSchema.safeParse({ sessionId: 'session', text: '你好' }).success).toBe(
    true,
  );
  expect(
    CoworkQueueUpdateSchema.safeParse({ sessionId: 'session', itemId: 'item', text: '你好' }).success,
  ).toBe(true);
});
