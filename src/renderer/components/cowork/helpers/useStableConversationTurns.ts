import { useMemo, useRef } from 'react';

import type { ConversationTurn } from './messageGrouping';
import { stabilizeConversationTurns } from './messageGrouping';

/**
 * Keeps turn object identity stable across streaming updates: only turns
 * whose messages actually changed get new references, so memoized turn
 * subtrees skip re-rendering on every token (issue #141).
 */
export const useStableConversationTurns = (turns: ConversationTurn[]): ConversationTurn[] => {
  const stableTurnsRef = useRef<ConversationTurn[]>([]);
  return useMemo(() => {
    stableTurnsRef.current = stabilizeConversationTurns(stableTurnsRef.current, turns);
    return stableTurnsRef.current;
  }, [turns]);
};
