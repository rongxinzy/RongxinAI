import { estimateConversationTurnHeight } from './conversationTurnHeight';
import type { ConversationTurn } from './messageGrouping';

/** Turn objects are immutable; completed turns retain their identity during tail updates. */
export function createCachedTurnHeightEstimator(estimate = estimateConversationTurnHeight) {
  const cache = new WeakMap<ConversationTurn, number>();
  return (turn: ConversationTurn): number => {
    const previous = cache.get(turn);
    if (previous !== undefined) return previous;
    const height = estimate(turn);
    cache.set(turn, height);
    return height;
  };
}

export const estimateCachedTurnHeight = createCachedTurnHeightEstimator();
