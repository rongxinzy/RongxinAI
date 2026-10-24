import { expect, test } from 'vitest';

import { StreamingMarkdownSegmenter } from './streamingMarkdownSegments';

test('keeps short paragraphs in the tail until the stable batch is large enough', () => {
  const segmenter = new StreamingMarkdownSegmenter();

  expect(segmenter.update('First paragraph', true)).toEqual({
    committed: '',
    tail: 'First paragraph',
  });
  expect(segmenter.update('First paragraph\n\nSecond paragraph', true)).toEqual({
    committed: '',
    tail: 'First paragraph\n\nSecond paragraph',
  });
});

test('commits a large code block only after its closing fence arrives', () => {
  const segmenter = new StreamingMarkdownSegmenter();
  const content = '```ts\n' + 'const answer = 42;\n'.repeat(600);

  expect(segmenter.update(content, true)).toEqual({ committed: '', tail: content });
  expect(segmenter.update(`${content}\`\`\`\n`, true)).toEqual({
    committed: `${content}\`\`\`\n`,
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
