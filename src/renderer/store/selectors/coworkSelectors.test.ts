import { expect, test } from 'vitest';

import { CoworkSessionStatusValue } from '../../types/cowork';
import { selectIsStreaming } from './coworkSelectors';

test('selectIsStreaming follows the active session stream registry', () => {
  const state = {
    cowork: {
      currentSession: { id: 'work-1', status: CoworkSessionStatusValue.Running },
      streamingSessionIds: ['work-1'],
    },
  };

  expect(selectIsStreaming(state as never)).toBe(true);
});

test('selectIsStreaming is false without an active current session', () => {
  expect(selectIsStreaming({ cowork: { streamingSessionIds: [], currentSession: null } } as never)).toBe(false);
  expect(
    selectIsStreaming({
      cowork: {
        streamingSessionIds: [],
        currentSession: { id: 'work-1', status: CoworkSessionStatusValue.Completed },
      },
    } as never),
  ).toBe(false);
});

test('selectIsStreaming preserves a live session stream across a stale session snapshot', () => {
  expect(
    selectIsStreaming({
      cowork: {
        streamingSessionIds: ['local-chat-1'],
        currentSession: { id: 'local-chat-1', status: CoworkSessionStatusValue.Completed },
      },
    } as never),
  ).toBe(true);
});
