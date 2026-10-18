import { expect, test } from 'vitest';

import { StreamingMarkdownSegmenter } from './streamingMarkdownSegments';

test('commits a paragraph only after its blank-line boundary arrives', () => {
  const segmenter = new StreamingMarkdownSegmenter();

  expect(segmenter.update('First paragraph', true)).toEqual({
    committed: '',
    tail: 'First paragraph',
  });
  expect(segmenter.update('First paragraph\n\nSecond paragraph', true)).toEqual({
    committed: 'First paragraph\n\n',
    tail: 'Second paragraph',
  });
});

test('commits a code block only after its closing fence arrives', () => {
  const segmenter = new StreamingMarkdownSegmenter();

  expect(segmenter.update('```ts\nconst answer = 42;\n', true)).toEqual({
    committed: '',
    tail: '```ts\nconst answer = 42;\n',
  });
  expect(segmenter.update('```ts\nconst answer = 42;\n```\n', true)).toEqual({
    committed: '```ts\nconst answer = 42;\n```\n',
    tail: '',
  });
});

test('commits the complete response when streaming finishes', () => {
  const segmenter = new StreamingMarkdownSegmenter();

  segmenter.update('Unfinished paragraph', true);

  expect(segmenter.update('Unfinished paragraph', false)).toEqual({
    committed: 'Unfinished paragraph',
    tail: '',
  });
});
