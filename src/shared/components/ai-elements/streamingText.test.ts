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
