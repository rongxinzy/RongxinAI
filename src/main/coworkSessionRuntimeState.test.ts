import { test, expect } from 'vitest';

import { CoworkSessionMode, CoworkSessionSource } from '../shared/cowork/constants';
import type { CoworkSessionSummary } from './coworkStore';
import {
  coerceImportedSessionStatus,
  demoteStaleRunningSessions,
  reconcileWorkSessionRuntimeState,
} from './coworkSessionRuntimeState';

const makeSession = (overrides: Partial<CoworkSessionSummary> = {}): CoworkSessionSummary => ({
  id: 'session-1',
  title: 'Session',
  status: 'running',
  mode: CoworkSessionMode.Work,
  pinned: false,
  pinOrder: null,
  workspaceId: 'workspace-1',
  agentId: 'main',
  source: CoworkSessionSource.Manual,
  createdAt: 1,
  updatedAt: 1,
  ...overrides,
});

test('clears a stale running state for a Work session that is absent from the runtime', () => {
  expect(reconcileWorkSessionRuntimeState(makeSession(), false).status).toBe('idle');
});

test('preserves a running state for an active Work session', () => {
  expect(reconcileWorkSessionRuntimeState(makeSession(), true).status).toBe('running');
});

test('does not reconcile direct Chat sessions through the Work runtime', () => {
  expect(
    reconcileWorkSessionRuntimeState(makeSession({ mode: CoworkSessionMode.Chat }), false).status,
  ).toBe('running');
});

test('demoteStaleRunningSessions writes corrections only for stale Work rows', () => {
  const updates: Array<{ id: string; status: string }> = [];
  const store = {
    updateSession: (id: string, patch: { status: string }) => {
      updates.push({ id, status: patch.status });
    },
  };
  const sessions = [
    makeSession({ id: 'stale' }),
    makeSession({ id: 'live' }),
    makeSession({ id: 'idle-row', status: 'idle' }),
    makeSession({ id: 'chat', mode: CoworkSessionMode.Chat }),
  ];

  demoteStaleRunningSessions(store, sessionId => sessionId === 'live', sessions);

  expect(updates).toEqual([{ id: 'stale', status: 'idle' }]);
});

test('imported session statuses never resurrect a running row', () => {
  expect(coerceImportedSessionStatus('running')).toBe('idle');
  expect(coerceImportedSessionStatus('completed')).toBe('completed');
  expect(coerceImportedSessionStatus('error')).toBe('error');
  expect(coerceImportedSessionStatus('idle')).toBe('idle');
  expect(coerceImportedSessionStatus(undefined)).toBe('idle');
});
