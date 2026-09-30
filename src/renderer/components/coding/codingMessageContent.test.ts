import { expect, test } from 'vitest';

import { replaceLocalFileLinksWithLabels } from './codingMessageContent';

test('replaces a local file markdown link with its visible file label', () => {
  expect(
    replaceLocalFileLinksWithLabels('Created [report.html](file:///C:/work/report.html).'),
  ).toBe('Created report.html.');
});

test('keeps external markdown links unchanged', () => {
  expect(replaceLocalFileLinksWithLabels('See [documentation](https://example.com/docs).')).toBe(
    'See [documentation](https://example.com/docs).',
  );
});
