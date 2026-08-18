import { test, expect } from 'vitest';

import { CoworkSessionMode, CoworkSessionSource } from '../shared/cowork/constants';
import type { CoworkSessionSummary } from './coworkStore';
import { reconcileWorkSessionRuntimeState } from './coworkSessionRuntimeState';

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
