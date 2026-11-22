import { test, expect } from 'vitest';

import {
  CoworkSessionMode,
  CoworkSessionSource,
  CoworkSessionStatus,
} from '../shared/cowork/constants';
import type { CoworkSessionSummary } from './coworkStore';
import { projectCoworkSessionRuntimeState } from './coworkSessionRuntimeState';

const makeSession = (overrides: Partial<CoworkSessionSummary> = {}): CoworkSessionSummary => ({
  id: 'session-1',
  title: 'Session',
  status: CoworkSessionStatus.Idle,
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

test.each(Object.values(CoworkSessionMode))('projects %s liveness from Pi', mode => {
  const idle = makeSession({ mode, status: CoworkSessionStatus.Idle });
  const error = makeSession({ mode, status: CoworkSessionStatus.Error });
  expect(projectCoworkSessionRuntimeState(idle, true).status).toBe(CoworkSessionStatus.Running);
  expect(projectCoworkSessionRuntimeState(error, true).status).toBe(CoworkSessionStatus.Running);
  expect(projectCoworkSessionRuntimeState(error, false)).toBe(error);
  expect(projectCoworkSessionRuntimeState(idle, false)).toBe(idle);
});
