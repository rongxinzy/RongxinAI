import { expect, test } from 'vitest';

import {
  type CoworkSessionStatus,
  CoworkSessionStatusValue,
  type CoworkSessionSummary,
} from '../../types/cowork';
import { sortAgentSidebarTasks } from './useAgentSidebarState';

const makeSession = (
  id: string,
  createdAt: number,
  updatedAt = createdAt,
  status: CoworkSessionStatus = CoworkSessionStatusValue.Completed,
  pinned = false,
  pinOrder: number | null = null,
): CoworkSessionSummary => ({
  id,
  title: id,
  status,
  pinned,
  pinOrder,
  agentId: 'main',
  createdAt,
  updatedAt,
});

test('sortAgentSidebarTasks keeps unpinned tasks ordered by last update time', () => {
  const sorted = sortAgentSidebarTasks([
    makeSession('newer-created-older-update', 300, 200),
    makeSession('older-created-newer-update', 100, 500, CoworkSessionStatusValue.Running),
    makeSession('middle', 200, 300),
  ]);

  expect(sorted.map(session => session.id)).toEqual([
    'older-created-newer-update',
    'middle',
    'newer-created-older-update',
  ]);
});

test('sortAgentSidebarTasks orders two concurrent streaming sessions by creation time', () => {
  const sessions = [
    makeSession('running-a', 100, 500, CoworkSessionStatusValue.Running),
    makeSession('running-b', 200, 400, CoworkSessionStatusValue.Running),
  ];
  const sorted = sortAgentSidebarTasks(sessions, ['running-a', 'running-b']);

  expect(sorted.map(s => s.id)).toEqual(['running-b', 'running-a']);
});

test('sortAgentSidebarTasks ignores streaming hint when only one session is streaming', () => {
  const sessions = [
    makeSession('completed', 100, 300, CoworkSessionStatusValue.Completed),
    makeSession('running-a', 100, 500, CoworkSessionStatusValue.Running),
  ];
  const sorted = sortAgentSidebarTasks(sessions, ['running-a']);

  // Single streaming session: falls through to normal updatedAt sort
  expect(sorted.map(s => s.id)).toEqual(['running-a', 'completed']);
});

test('sortAgentSidebarTasks keeps pinned tasks in first-pinned-first order', () => {
  const sorted = sortAgentSidebarTasks([
    makeSession('newer-unpinned', 100, 400),
    makeSession('second-pinned', 100, 200, CoworkSessionStatusValue.Completed, true, 2),
    makeSession('middle-unpinned', 200, 300),
    makeSession('first-pinned', 200, 100, CoworkSessionStatusValue.Completed, true, 1),
  ]);

  expect(sorted.map(session => session.id)).toEqual([
    'first-pinned',
    'second-pinned',
    'newer-unpinned',
    'middle-unpinned',
  ]);
});
