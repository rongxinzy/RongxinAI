import { expect, test } from 'vitest';

import { hasCoworkSubmissionContent, hasVisiblePromptContent } from './submissionContent';

test.each([
  '',
  ' \t\r\n',
  '\u200b',
  '\u200c\u200d\u2060\ufeff',
  '\u00ad\u034f\ufe0f',
  '\u0000\u0007',
])('rejects visually empty text %j', prompt => {
  expect(hasVisiblePromptContent(prompt)).toBe(false);
  expect(hasCoworkSubmissionContent({ prompt })).toBe(false);
});

test.each(['你好', ' hello ', '👩‍💻', 'a\u200bb', '附件: D:/notes.txt'])(
  'preserves visible text %j',
  prompt => {
    expect(hasVisiblePromptContent(prompt)).toBe(true);
  },
);

test('accepts a real image payload or a persisted image path without text', () => {
  expect(
    hasCoworkSubmissionContent({
      prompt: '',
      imageAttachments: [{ mimeType: 'image/png', base64Data: 'aW1hZ2U=' }],
    }),
  ).toBe(true);
  expect(
    hasCoworkSubmissionContent({
      prompt: '',
      imageAttachments: [{ mimeType: 'image/png', path: 'D:/images/example.png' }],
    }),
  ).toBe(true);
});

test.each([
  { mimeType: 'image/png', base64Data: '' },
  { mimeType: 'image/png', base64Data: '  ' },
  { mimeType: 'image/png', path: 'inline:broken.png' },
  { mimeType: 'image/png', path: '' },
  { mimeType: 'text/plain', base64Data: 'aW1hZ2U=' },
])('does not treat unusable images as content: %j', image => {
  expect(hasCoworkSubmissionContent({ prompt: '', imageAttachments: [image] })).toBe(false);
});
