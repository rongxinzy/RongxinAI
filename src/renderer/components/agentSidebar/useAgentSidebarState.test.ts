import { expect, test } from 'vitest';

import { CoworkSessionSource } from '../../../shared/cowork/constants';
import {
  type CoworkSessionStatus,
  CoworkSessionStatusValue,
  type CoworkSessionSummary,
} from '../../types/cowork';
import { AgentSidebarIndicator } from './constants';
import { deriveAgentSidebarIndicator } from './useAgentSidebarState';

const makeSession = (
  id: string,
  status: CoworkSessionStatus,
  createdAt = 100,
  updatedAt = createdAt,
): CoworkSessionSummary => ({
  id,
  title: id,
  status,
  pinned: false,
  pinOrder: null,
  agentId: 'main',
  source: CoworkSessionSource.Manual,
  createdAt,
  updatedAt,
});

test('deriveAgentSidebarIndicator uses the live stream registry for an active session', () => {
  const session = makeSession('active-session', CoworkSessionStatusValue.Idle);

  expect(deriveAgentSidebarIndicator(session, new Set(), new Set(['active-session']))).toBe(
    AgentSidebarIndicator.Running,
  );
});

test('deriveAgentSidebarIndicator marks an unread completed session', () => {
  const session = makeSession('completed-session', CoworkSessionStatusValue.Completed);

  expect(deriveAgentSidebarIndicator(session, new Set(['completed-session']))).toBe(
    AgentSidebarIndicator.CompletedUnread,
  );
});
