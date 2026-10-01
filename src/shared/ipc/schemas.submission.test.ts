import { expect, test } from 'vitest';

import { CoworkSessionContinueSchema, CoworkSessionStartSchema } from './schemas';

test.each(['', ' \n\t', '\u200b\u200d\ufeff'])(
  'both IPC entry points reject empty input %j',
  prompt => {
    expect(CoworkSessionStartSchema.input.safeParse({ prompt }).success).toBe(false);
    expect(
      CoworkSessionContinueSchema.input.safeParse({ sessionId: 'session', prompt }).success,
    ).toBe(false);
  },
);

test('both IPC entry points allow image-only submissions', () => {
  const input = {
    prompt: '',
    imageAttachments: [{ name: 'example.png', mimeType: 'image/png', base64Data: 'aW1hZ2U=' }],
  };
  expect(CoworkSessionStartSchema.input.safeParse(input).success).toBe(true);
  expect(
    CoworkSessionContinueSchema.input.safeParse({ ...input, sessionId: 'session' }).success,
  ).toBe(true);
});

test('attachment array presence alone cannot bypass the guard', () => {
  const input = {
    prompt: '',
    imageAttachments: [{ name: 'broken.png', mimeType: 'image/png', base64Data: '' }],
  };
  expect(CoworkSessionStartSchema.input.safeParse(input).success).toBe(false);
  expect(
    CoworkSessionContinueSchema.input.safeParse({ ...input, sessionId: 'session' }).success,
  ).toBe(false);
});

test('accepts normal text and file-path prompts', () => {
  for (const prompt of ['你好', '附件: D:/notes.txt']) {
    expect(CoworkSessionStartSchema.input.safeParse({ prompt }).success).toBe(true);
    expect(
      CoworkSessionContinueSchema.input.safeParse({ sessionId: 'session', prompt }).success,
    ).toBe(true);
  }
});
