import { expect, test } from 'vitest';

import { WorkbenchRunStatus, WorkbenchTaskStatus } from '../../shared/workbenchTask';
import {
  assertRunTransition,
  assertTaskTransition,
  WorkbenchStateTransitionError,
} from './stateMachine';

test('allows explicit retry of a completed task while keeping completed runs terminal', () => {
  expect(() =>
    assertTaskTransition(WorkbenchTaskStatus.Completed, WorkbenchTaskStatus.Running),
  ).not.toThrow();
  expect(() =>
    assertRunTransition(WorkbenchRunStatus.Succeeded, WorkbenchRunStatus.Running),
  ).toThrow(WorkbenchStateTransitionError);
});

test('rejects completion before a run reaches verification', () => {
  expect(() =>
    assertRunTransition(WorkbenchRunStatus.Running, WorkbenchRunStatus.Succeeded),
  ).toThrow(WorkbenchStateTransitionError);
});

test('allows user acceptance to promote a needs-review run', () => {
  expect(() =>
    assertRunTransition(WorkbenchRunStatus.NeedsReview, WorkbenchRunStatus.Succeeded),
  ).not.toThrow();
});

test('guards every task status transition', () => {
  const allowed = new Map<string, readonly string[]>([
    [WorkbenchTaskStatus.Draft, [WorkbenchTaskStatus.Planned, WorkbenchTaskStatus.Cancelled]],
    [WorkbenchTaskStatus.Planned, [WorkbenchTaskStatus.Running, WorkbenchTaskStatus.Cancelled]],
    [
      WorkbenchTaskStatus.Running,
      [
        WorkbenchTaskStatus.Paused,
        WorkbenchTaskStatus.NeedsReview,
        WorkbenchTaskStatus.Completed,
        WorkbenchTaskStatus.Failed,
        WorkbenchTaskStatus.Cancelled,
      ],
    ],
    [WorkbenchTaskStatus.Paused, [WorkbenchTaskStatus.Running, WorkbenchTaskStatus.Cancelled]],
    [
      WorkbenchTaskStatus.NeedsReview,
      [
        WorkbenchTaskStatus.Running,
        WorkbenchTaskStatus.Completed,
        WorkbenchTaskStatus.Failed,
        WorkbenchTaskStatus.Cancelled,
      ],
    ],
    [WorkbenchTaskStatus.Completed, [WorkbenchTaskStatus.Running]],
    [WorkbenchTaskStatus.Failed, [WorkbenchTaskStatus.Running]],
    [WorkbenchTaskStatus.Cancelled, []],
  ]);

  for (const from of Object.values(WorkbenchTaskStatus)) {
    for (const to of Object.values(WorkbenchTaskStatus)) {
      const legal = from === to || allowed.get(from)?.includes(to);
      if (legal) expect(() => assertTaskTransition(from, to)).not.toThrow();
      else expect(() => assertTaskTransition(from, to)).toThrow(WorkbenchStateTransitionError);
    }
  }
});

test('guards every run status transition', () => {
  const allowed = new Map<string, readonly string[]>([
    [
      WorkbenchRunStatus.Queued,
      [WorkbenchRunStatus.Running, WorkbenchRunStatus.Cancelled, WorkbenchRunStatus.Failed],
    ],
    [
      WorkbenchRunStatus.Running,
      [
        WorkbenchRunStatus.WaitingApproval,
        WorkbenchRunStatus.Verifying,
        WorkbenchRunStatus.Paused,
        WorkbenchRunStatus.NeedsReview,
        WorkbenchRunStatus.Failed,
        WorkbenchRunStatus.Cancelled,
      ],
    ],
    [
      WorkbenchRunStatus.WaitingApproval,
      [
        WorkbenchRunStatus.Running,
        WorkbenchRunStatus.Paused,
        WorkbenchRunStatus.NeedsReview,
        WorkbenchRunStatus.Failed,
        WorkbenchRunStatus.Cancelled,
      ],
    ],
    [
      WorkbenchRunStatus.Verifying,
      [
        WorkbenchRunStatus.Succeeded,
        WorkbenchRunStatus.NeedsReview,
        WorkbenchRunStatus.Failed,
        WorkbenchRunStatus.Cancelled,
      ],
    ],
    [WorkbenchRunStatus.Paused, []],
    [WorkbenchRunStatus.NeedsReview, [WorkbenchRunStatus.Succeeded]],
    [WorkbenchRunStatus.Succeeded, []],
    [WorkbenchRunStatus.Failed, []],
    [WorkbenchRunStatus.Cancelled, []],
  ]);

  for (const from of Object.values(WorkbenchRunStatus)) {
    for (const to of Object.values(WorkbenchRunStatus)) {
      const legal = from === to || allowed.get(from)?.includes(to);
      if (legal) expect(() => assertRunTransition(from, to)).not.toThrow();
      else expect(() => assertRunTransition(from, to)).toThrow(WorkbenchStateTransitionError);
    }
  }
});
