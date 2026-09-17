import { expect, test } from 'vitest';

import { CoworkSessionSource } from '../../../shared/cowork/constants';
import {
  type CoworkSessionStatus,
  CoworkSessionStatusValue,
  type CoworkSessionSummary,
} from '../../types/cowork';
import { sortAgentSidebarTasks } from './sessionSort';

const makeSession = (
  id: string,
  createdAt: number,
  updatedAt = createdAt,
  status: CoworkSessionStatus = CoworkSessionStatusValue.Completed,
  pinned = false,
  pinOrder: number | null = null,
  runStartedAt: number | null = null,
): CoworkSessionSummary => ({
  id,
  title: id,
  status,
  pinned,
  pinOrder,
  agentId: 'main',
  source: CoworkSessionSource.Manual,
  createdAt,
  updatedAt,
  runStartedAt,
});

test('sortAgentSidebarTasks keeps idle sessions ordered by last activity', () => {
  const sorted = sortAgentSidebarTasks([
    makeSession('newer-created-older-update', 300, 200),
    makeSession('middle', 200, 300),
    makeSession('newest-update', 100, 400),
  ]);

  expect(sorted.map(session => session.id)).toEqual([
    'newest-update',
    'middle',
    'newer-created-older-update',
  ]);
});

test('sortAgentSidebarTasks places a just-finished run above a still-running one', () => {
  const sorted = sortAgentSidebarTasks([
    makeSession('still-running', 100, 900, CoworkSessionStatusValue.Running, false, null, 300),
    // Paused at 800: the run start is cleared, so last activity decides.
    makeSession('paused', 200, 800, CoworkSessionStatusValue.Idle),
  ]);

  expect(sorted.map(session => session.id)).toEqual(['paused', 'still-running']);
});

test('sortAgentSidebarTasks ignores message churn while a run is in flight', () => {
  const runA = makeSession('run-a', 100, 500, CoworkSessionStatusValue.Running, false, null, 200);
  const runB = makeSession('run-b', 200, 600, CoworkSessionStatusValue.Running, false, null, 300);
  const idle = makeSession('idle', 300, 250);

  const before = sortAgentSidebarTasks([runA, runB, idle]);
  // Streamed messages keep rewriting updatedAt on both runs.
  const after = sortAgentSidebarTasks([
    { ...runA, updatedAt: 4000 },
    { ...runB, updatedAt: 3000 },
    idle,
  ]);

  expect(before.map(session => session.id)).toEqual(['run-b', 'idle', 'run-a']);
  expect(after.map(session => session.id)).toEqual(['run-b', 'idle', 'run-a']);
});

test('sortAgentSidebarTasks keeps pinned sessions above a running one', () => {
  const sorted = sortAgentSidebarTasks([
    makeSession('pinned', 100, 100, CoworkSessionStatusValue.Completed, true, 1),
    makeSession('running', 200, 900, CoworkSessionStatusValue.Running, false, null, 900),
    makeSession('idle', 300, 800),
  ]);

  expect(sorted.map(session => session.id)).toEqual(['pinned', 'running', 'idle']);
});

test('sortAgentSidebarTasks keeps a running pinned session on its pin order', () => {
  const sorted = sortAgentSidebarTasks([
    makeSession('second-pinned', 100, 900, CoworkSessionStatusValue.Running, true, 2, 900),
    makeSession('first-pinned', 200, 100, CoworkSessionStatusValue.Completed, true, 1),
  ]);

  expect(sorted.map(session => session.id)).toEqual(['first-pinned', 'second-pinned']);
});

test('sortAgentSidebarTasks breaks equal activity times by creation time', () => {
  const sorted = sortAgentSidebarTasks([
    makeSession('older-created', 100, 500),
    makeSession('newer-created', 200, 500),
  ]);

  expect(sorted.map(session => session.id)).toEqual(['newer-created', 'older-created']);
});
