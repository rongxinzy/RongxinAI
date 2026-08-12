// @vitest-environment jsdom

import { renderHook } from '@testing-library/react';
import { expect, test } from 'vitest';

import type { ConversationTurn } from './messageGrouping';
import { useStableConversationTurns } from './useStableConversationTurns';

const turn = (id: string): ConversationTurn => ({
  id,
  userMessage: null,
  assistantItems: [],
});

test('does not reuse positional turn state across sessions', () => {
  const sessionATurn = turn('orphan:message-a');
  const sessionBTurn = turn('orphan:message-b');
  const view = renderHook(({ sessionId, turns }) => useStableConversationTurns(turns, sessionId), {
    initialProps: { sessionId: 'session-a', turns: [sessionATurn] },
  });

  view.rerender({ sessionId: 'session-b', turns: [sessionBTurn] });

  expect(view.result.current[0]).toBe(sessionBTurn);
  expect(view.result.current[0]).not.toBe(sessionATurn);
});
