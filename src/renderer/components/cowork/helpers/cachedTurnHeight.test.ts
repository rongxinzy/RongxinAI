import { expect, test, vi } from 'vitest';
import type { ConversationTurn } from './messageGrouping';
import { createCachedTurnHeightEstimator } from './cachedTurnHeight';

test('a streaming tail update only re-estimates the changed turn in a large history', () => {
  const estimator = vi.fn(() => 300);
  const cached = createCachedTurnHeightEstimator(estimator);
  const turns: ConversationTurn[] = Array.from({ length: 1000 }, (_, index) => ({
    id: String(index),
    userMessage: null,
    assistantItems: [],
  }));
  turns.map(cached);
  expect(estimator).toHaveBeenCalledTimes(1000);
  const next = [...turns.slice(0, -1), { ...turns.at(-1)!, assistantItems: [] }];
  next.map(cached);
  expect(estimator).toHaveBeenCalledTimes(1001);
  cached(next.at(-1)!);
  expect(estimator).toHaveBeenCalledTimes(1001);
});
