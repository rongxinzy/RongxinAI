import { expect, test } from 'vitest';

import { CoworkSessionStatusValue } from '../../types/cowork';
import { CoworkRunPhase } from '../../../shared/cowork/runState';
import {
  resolveDisplayedSessionId,
  selectHasPendingPermissionForSession,
  selectIsStreaming,
  selectIsSessionCompacting,
  selectPendingPermissionForSession,
} from './coworkSelectors';

test('treats native compaction before agent_start as busy only for its own session', () => {
  const state = {
    cowork: { currentSession: { id: 'a' }, streamingSessionIds: [] },
    coworkRun: { bySession: { a: { running: true, phase: CoworkRunPhase.Compacting } } },
  };
  expect(selectIsStreaming(state as never)).toBe(true);
  expect(selectIsSessionCompacting(state as never, 'a')).toBe(true);
  expect(selectIsSessionCompacting(state as never, 'b')).toBe(false);
  state.coworkRun.bySession.a.running = false;
  expect(selectIsStreaming(state as never)).toBe(false);
});

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
  expect(
    selectIsStreaming({ cowork: { streamingSessionIds: [], currentSession: null } } as never),
  ).toBe(false);
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

test('shows the loading target instead of the previous session', () => {
  expect(resolveDisplayedSessionId('session-a', 'session-b')).toBe('session-b');
});

test('keeps the current session visible when it is also the loading target', () => {
  expect(resolveDisplayedSessionId('session-b', 'session-b')).toBe('session-b');
});

test('selects pending permissions only for the requested session', () => {
  const state = {
    cowork: {
      pendingPermissions: [
        { sessionId: 'session-a', requestId: 'request-a' },
        { sessionId: 'session-b', requestId: 'request-b' },
      ],
    },
  };

  expect(selectPendingPermissionForSession(state as never, 'session-a')?.requestId).toBe(
    'request-a',
  );
  expect(selectPendingPermissionForSession(state as never, 'session-c')).toBeNull();
  expect(selectHasPendingPermissionForSession(state as never, 'session-b')).toBe(true);
  expect(selectHasPendingPermissionForSession(state as never, 'session-c')).toBe(false);
});

test('shows the current session when no session is loading', () => {
  expect(resolveDisplayedSessionId('session-a', null)).toBe('session-a');
});
