import { expect, test } from 'vitest';

import { reconcileLocalModelOrder, reorderLocalModelOrder } from './modelOrder';

test('model order preserves saved positions and appends newly discovered models', () => {
  expect(
    reconcileLocalModelOrder(
      ['qwen-0.5b', 'qwen-3', 'qwen-3.5'],
      ['qwen-3', 'removed-model', 'qwen-0.5b'],
    ),
  ).toEqual(['qwen-3', 'qwen-0.5b', 'qwen-3.5']);
});

test('model order reorders a dragged model at the drop target', () => {
  expect(
    reorderLocalModelOrder(['qwen-0.5b', 'qwen-3', 'qwen-3.5'], 'qwen-3.5', 'qwen-0.5b'),
  ).toEqual(['qwen-3.5', 'qwen-0.5b', 'qwen-3']);
});

test('model order ignores drops that do not reference visible cards', () => {
  expect(
    reorderLocalModelOrder(['qwen-0.5b', 'qwen-3'], 'missing-model', 'qwen-3'),
  ).toEqual(['qwen-0.5b', 'qwen-3']);
});
