import { useMemo, useRef } from 'react';

import type { ConversationTurn } from './messageGrouping';
import { stabilizeConversationTurns } from './messageGrouping';

/**
 * Keeps turn object identity stable across streaming updates: only turns
 * whose messages actually changed get new references, so memoized turn
 * subtrees skip re-rendering on every token (issue #141).
 */
export const useStableConversationTurns = (
  turns: ConversationTurn[],
  sessionId: string | undefined,
): ConversationTurn[] => {
  const stableTurnsRef = useRef<{ sessionId: string | undefined; turns: ConversationTurn[] }>({
    sessionId,
    turns: [],
  });
  return useMemo(() => {
    const previousTurns =
      stableTurnsRef.current.sessionId === sessionId ? stableTurnsRef.current.turns : [];
    const stableTurns = stabilizeConversationTurns(previousTurns, turns);
    stableTurnsRef.current = { sessionId, turns: stableTurns };
    return stableTurns;
  }, [sessionId, turns]);
};
