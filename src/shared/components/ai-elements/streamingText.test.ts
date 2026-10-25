import { expect, test } from 'vitest';
import { StreamingTextSegmenter } from './streamingText';

test('reveal animation frames reuse the same Markdown segmentation until the source changes', () => {
  const segmenter = new StreamingTextSegmenter();
  const content = '```text\n' + 'long output\n'.repeat(20_000);
  const initial = segmenter.update(content, true);
  for (let frame = 0; frame < 120; frame++) expect(segmenter.update(content, true)).toBe(initial);
  const completedBlock = segmenter.update(content + '```\n', true);
  expect(completedBlock).toEqual({ committed: content + '```\n', tail: '' });
  expect(completedBlock).not.toBe(initial);
});

test('source rewrites and finalization still invalidate the cached segments', () => {
  const segmenter = new StreamingTextSegmenter();
  segmenter.update('first\n\ntail', true);
  expect(segmenter.update('rewritten tail', true)).toEqual({
    committed: '',
    tail: 'rewritten tail',
  });
  const complete = segmenter.update('rewritten tail', false);
  expect(complete).toEqual({ committed: 'rewritten tail', tail: '' });
  expect(segmenter.update('rewritten tail', false)).toBe(complete);
  expect(segmenter.update('rewritten tail', true)).toEqual({
    committed: '',
    tail: 'rewritten tail',
  });
});

test('batches stable prefixes without splitting the Markdown context', () => {
  const segmenter = new StreamingTextSegmenter();
  const firstBlock = `${'First paragraph\n'.repeat(600)}\n`;
  const first = segmenter.update(`${firstBlock}tail`, true);
  expect(first).toEqual({ committed: firstBlock, tail: 'tail' });
  const growingTail = segmenter.update(`${firstBlock}tail grows`, true);
  expect(growingTail.committed).toBe(first.committed);

  const withCode = segmenter.update(`${firstBlock}tail grows\n\n\`\`\`ts\nconst n = 1;\n`, true);
  expect(withCode.committed).toBe(firstBlock);
  expect(withCode.tail).toBe('tail grows\n\n```ts\nconst n = 1;\n');
  const closed = segmenter.update(
    `${firstBlock}tail grows\n\n\`\`\`ts\nconst n = 1;\n\`\`\`\nnext`,
    true,
  );
  expect(closed.committed).toBe(firstBlock);
  expect(closed.tail).toBe('tail grows\n\n```ts\nconst n = 1;\n```\nnext');
});

test('commits a large closing fence even when the response has no trailing newline', () => {
  const segmenter = new StreamingTextSegmenter();
  const content = '```ts\n' + 'const answer = 42;\n'.repeat(600);
  segmenter.update(content, true);
  expect(segmenter.update(`${content}\`\`\``, true)).toEqual({
    committed: `${content}\`\`\``,
    tail: '',
  });
});
