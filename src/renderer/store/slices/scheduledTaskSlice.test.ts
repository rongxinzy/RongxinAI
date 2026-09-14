import { expect, test } from 'vitest';

import type { ScheduledTaskRunWithName } from '../../../scheduledTask/types';
import scheduledTaskReducer, {
  addOrUpdateRun,
  setListError,
  setTasks,
} from './scheduledTaskSlice';

test('keeps task-list errors separate from operation errors', () => {
  const failedState = scheduledTaskReducer(undefined, setListError('gateway unavailable'));

  expect(failedState.listError).toBe('gateway unavailable');
  expect(failedState.error).toBeNull();

  const recoveredState = scheduledTaskReducer(failedState, setTasks([]));
  expect(recoveredState.listError).toBeNull();
});

test('projects a pushed Run into the task runs and the all-runs history', () => {
  const running: ScheduledTaskRunWithName = {
    id: 'run-1',
    taskId: 'task-1',
    sessionId: null,
    sessionKey: null,
    status: 'running',
    startedAt: '2026-09-14T01:00:00.000Z',
    finishedAt: null,
    durationMs: null,
    error: null,
    taskName: 'reminder',
  };

  const started = scheduledTaskReducer(undefined, addOrUpdateRun(running));
  expect(started.runs['task-1']).toHaveLength(1);
  expect(started.allRuns).toHaveLength(1);

  const finished: ScheduledTaskRunWithName = {
    ...running,
    status: 'success',
    finishedAt: '2026-09-14T01:00:30.000Z',
    durationMs: 30_000,
  };
  const completed = scheduledTaskReducer(started, addOrUpdateRun(finished));
  expect(completed.runs['task-1']).toHaveLength(1);
  expect(completed.allRuns).toHaveLength(1);
  expect(completed.runs['task-1'][0].status).toBe('success');
  expect(completed.allRuns[0].status).toBe('success');
});
