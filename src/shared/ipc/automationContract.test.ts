import { describe, expect, test } from 'vitest';

import { activityContract, scheduledTasksContract } from './automationContract';
import { ActivitySource, ActivityStatus } from '../activity/constants';
import {
  DeliveryMode,
  PayloadKind,
  ScheduleKind,
  SessionTarget,
  TaskStatus,
  WakeMode,
} from '../../scheduledTask/constants';

/**
 * Schema fidelity tests: fixtures below are copied from real renderer call
 * sites (taskFormState.buildTaskInput, ScheduledTaskService) so a schema drift
 * that would reject a valid production invoke fails here, and representative
 * bad inputs are proven rejected.
 */

/** Output of taskFormState.buildTaskInput for a cron announce task. */
const taskInput = {
  name: 'Nightly report',
  description: '',
  enabled: true,
  schedule: { kind: ScheduleKind.Cron, expr: '0 9 * * *', tz: 'Asia/Shanghai' },
  sessionTarget: SessionTarget.Isolated,
  wakeMode: WakeMode.Now,
  payload: {
    kind: PayloadKind.AgentTurn,
    message: 'Generate the nightly report',
    model: 'glm-4.6',
    timeoutSeconds: 600,
  },
  delivery: { mode: DeliveryMode.Announce, channel: 'feishu', to: 'oc_1' },
  workspaceId: 'ws-1',
  sessionKey: null,
};

/** Full `ScheduledTask` row as the SQLite task service returns it. */
const taskRow = {
  ...taskInput,
  id: 'task-1',
  scheduleVersion: 'v3',
  state: {
    nextRunAtMs: 1770000000000,
    lastRunAtMs: null,
    lastStatus: null,
    lastError: null,
    lastDurationMs: null,
    runningAtMs: null,
    consecutiveErrors: 0,
  },
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-02T00:00:00.000Z',
};

describe('scheduledTasks contract args', () => {
  test('create accepts the buildTaskInput payload', () => {
    expect(scheduledTasksContract.create.args.safeParse([taskInput]).success).toBe(true);
    // Minimal variant: no delivery, at-schedule, no model
    expect(
      scheduledTasksContract.create.args.safeParse([
        {
          name: 'One-shot',
          description: '',
          enabled: false,
          schedule: { kind: ScheduleKind.At, at: '2026-10-20T09:00:00.000Z' },
          sessionTarget: SessionTarget.Main,
          wakeMode: WakeMode.NextHeartbeat,
          payload: { kind: PayloadKind.SystemEvent, text: 'reload config' },
          sessionKey: 'zhiyuan:s-1',
        },
      ]).success,
    ).toBe(true);
  });

  test('create rejects an unknown schedule kind', () => {
    expect(
      scheduledTasksContract.create.args.safeParse([
        { ...taskInput, schedule: { kind: 'hourly', everyMs: 3600000 } },
      ]).success,
    ).toBe(false);
    expect(
      scheduledTasksContract.create.args.safeParse([{ ...taskInput, sessionTarget: 'shared' }])
        .success,
    ).toBe(false);
  });

  test('update accepts the partial patch the edit flow sends', () => {
    // ScheduledTaskService.updateTaskById passes Partial<ScheduledTaskInput>
    expect(
      scheduledTasksContract.update.args.safeParse(['task-1', { enabled: false }]).success,
    ).toBe(true);
    expect(
      scheduledTasksContract.update.args.safeParse([
        'task-1',
        { name: 'Renamed', wakeMode: WakeMode.Now },
      ]).success,
    ).toBe(true);
    expect(scheduledTasksContract.update.args.safeParse(['task-1', null]).success).toBe(false);
  });

  test('listRuns accepts the pagination/filter args loadRuns sends', () => {
    // scheduledTaskService.loadRuns(taskId, 20, offset, filter)
    expect(
      scheduledTasksContract.listRuns.args.safeParse([
        'task-1',
        20,
        40,
        { startDate: '2026-10-01', endDate: '2026-10-02', status: 'error' },
      ]).success,
    ).toBe(true);
    expect(scheduledTasksContract.listRuns.args.safeParse(['task-1']).success).toBe(true);
  });
});

describe('scheduledTasks contract results', () => {
  test('list result accepts real task rows', () => {
    expect(
      scheduledTasksContract.list.result.safeParse({ success: true, tasks: [taskRow] }).success,
    ).toBe(true);
    expect(
      scheduledTasksContract.list.result.safeParse({ success: false, error: 'db locked' }).success,
    ).toBe(true);
    // lastStatus values come from the TaskStatus union
    expect(
      scheduledTasksContract.list.result.safeParse({
        success: true,
        tasks: [
          {
            ...taskRow,
            state: { ...taskRow.state, lastStatus: TaskStatus.Skipped },
          },
        ],
      }).success,
    ).toBe(true);
    expect(
      scheduledTasksContract.list.result.safeParse({
        success: true,
        tasks: [{ ...taskRow, state: { ...taskRow.state, lastStatus: 'paused' } }],
      }).success,
    ).toBe(false);
  });

  test('delete/stop keep the boolean result field handlers return', () => {
    // delete reports whether the job existed; stop returns false when a Pi
    // Run was already claimed.
    expect(
      scheduledTasksContract.delete.result.safeParse({ success: true, result: false }).success,
    ).toBe(true);
    expect(
      scheduledTasksContract.stop.result.safeParse({ success: true, result: true }).success,
    ).toBe(true);
  });

  test('preflight result accepts a delivery record projection', () => {
    expect(
      scheduledTasksContract.preflight.result.safeParse({
        success: true,
        preflight: {
          hasChannel: true,
          channel: 'feishu',
          latestDelivery: {
            id: 'd-1',
            runId: 'run-1',
            taskId: 'task-1',
            mode: DeliveryMode.Announce,
            channel: 'feishu',
            to: 'oc_1',
            accountId: 'acc-1',
            status: 'error',
            attemptedAt: '2026-10-02T01:00:00.000Z',
            deliveredAt: null,
            receiptId: null,
            error: 'channel offline',
          },
        },
      }).success,
    ).toBe(true);
  });
});

describe('activity contract', () => {
  test('list result accepts the run projection main.tsx hydrates', () => {
    // main.tsx activity.list → hydrateRuns
    expect(
      activityContract.list.result.safeParse({
        success: true,
        runs: [
          {
            id: 'run-1',
            source: ActivitySource.ScheduledTask,
            status: ActivityStatus.Completed,
            startedAt: 1770000000000,
            updatedAt: 1770000001000,
            sessionId: 's-1',
            taskName: 'Nightly report',
            inputPreview: 'Generate the nightly report',
            replyPreview: 'Report attached',
          },
          {
            id: 'run-2',
            source: ActivitySource.Channel,
            status: ActivityStatus.Failed,
            startedAt: 1770000100000,
            updatedAt: 1770000105000,
            platform: 'feishu',
            conversationId: 'oc_1',
            errorMessage: 'agent crashed',
          },
        ],
      }).success,
    ).toBe(true);
    expect(
      activityContract.list.result.safeParse({
        success: true,
        runs: [{ id: 'run-1', source: 'cron', status: 'completed', startedAt: 1, updatedAt: 2 }],
      }).success,
    ).toBe(false);
  });
});
