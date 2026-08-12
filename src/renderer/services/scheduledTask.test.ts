import { afterEach, expect, test, vi } from 'vitest';

import type { ScheduledTask } from '../../scheduledTask/types';
import {
  DeliveryMode,
  PayloadKind,
  ScheduleKind,
  SessionTarget,
  WakeMode,
} from '../../scheduledTask/constants';
import { store } from '../store';
import { setListError, setLoading, setTasks } from '../store/slices/scheduledTaskSlice';
import { ScheduledTaskService } from './scheduledTask';

afterEach(() => {
  store.dispatch(setTasks([]));
  store.dispatch(setListError(null));
  store.dispatch(setLoading(false));
  vi.unstubAllGlobals();
});

test('coalesces concurrent task-list loads into one IPC request', async () => {
  let resolveList: ((result: { success: boolean; tasks: ScheduledTask[] }) => void) | null = null;
  const list = vi.fn(
    () =>
      new Promise<{ success: boolean; tasks: ScheduledTask[] }>(resolve => {
        resolveList = resolve;
      }),
  );
  vi.stubGlobal('window', {
    electron: {
      scheduledTasks: { list },
    },
  });
  const service = new ScheduledTaskService();

  const firstLoad = service.loadTasks();
  const secondLoad = service.loadTasks();

  expect(secondLoad).toBe(firstLoad);
  expect(list).toHaveBeenCalledOnce();

  (resolveList as ((result: { success: boolean; tasks: ScheduledTask[] }) => void) | null)?.({
    success: true,
    tasks: [],
  });
  await firstLoad;
  expect(store.getState().scheduledTask.listError).toBeNull();
});

test('queues one trailing load when a gateway refresh arrives during an active load', async () => {
  let resolveFirstList: ((result: { success: boolean; tasks: ScheduledTask[] }) => void) | null =
    null;
  const list = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise<{ success: boolean; tasks: ScheduledTask[] }>(resolve => {
          resolveFirstList = resolve;
        }),
    )
    .mockResolvedValue({ success: true, tasks: [] });
  vi.stubGlobal('window', {
    electron: {
      scheduledTasks: { list },
    },
  });
  const service = new ScheduledTaskService();

  const activeLoad = service.loadTasks();
  const refreshLoad = service.loadTasks({ revalidate: true });

  expect(refreshLoad).toBe(activeLoad);
  expect(list).toHaveBeenCalledOnce();

  (resolveFirstList as ((result: { success: boolean; tasks: ScheduledTask[] }) => void) | null)?.({
    success: true,
    tasks: [],
  });
  await activeLoad;
  await vi.waitFor(() => expect(list).toHaveBeenCalledTimes(2));
});

function makeTaskFixture(id: string): ScheduledTask {
  return {
    id,
    name: 'Morning brief',
    description: '',
    enabled: true,
    schedule: { kind: ScheduleKind.Every, everyMs: 60_000 },
    sessionTarget: SessionTarget.Isolated,
    wakeMode: WakeMode.Now,
    payload: { kind: PayloadKind.AgentTurn, message: 'Summarize updates' },
    delivery: { mode: DeliveryMode.None },
    workspaceId: 'workspace-1',
    sessionKey: null,
    state: {
      nextRunAtMs: null,
      lastRunAtMs: null,
      lastStatus: null,
      lastError: null,
      lastDurationMs: null,
      runningAtMs: null,
      consecutiveErrors: 0,
    },
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

test('runManually flips the task to running before the gateway responds', async () => {
  store.dispatch(setTasks([makeTaskFixture('task-1')]));
  let resolveRun: ((result: { success: boolean; error?: string }) => void) | null = null;
  const runManually = vi.fn(
    () =>
      new Promise<{ success: boolean; error?: string }>(resolve => {
        resolveRun = resolve;
      }),
  );
  const list = vi.fn().mockResolvedValue({ success: true, tasks: [makeTaskFixture('task-1')] });
  const listRuns = vi.fn().mockResolvedValue({ success: true, runs: [] });
  const listAllRuns = vi.fn().mockResolvedValue({ success: true, runs: [] });
  vi.stubGlobal('window', {
    electron: { scheduledTasks: { runManually, list, listRuns, listAllRuns } },
    dispatchEvent: vi.fn(),
  });
  const service = new ScheduledTaskService();

  const pendingRun = service.runManually('task-1');

  // No gateway response yet — the optimistic running state must already show.
  const runningAtMs = store.getState().scheduledTask.tasks.find(t => t.id === 'task-1')
    ?.state.runningAtMs;
  expect(runningAtMs).not.toBeNull();

  (resolveRun as ((result: { success: boolean; error?: string }) => void) | null)?.({
    success: true,
  });
  await pendingRun;

  expect(list).toHaveBeenCalledTimes(2);
  expect(listRuns).toHaveBeenCalledWith('task-1', 20, undefined, undefined);
  expect(listAllRuns).toHaveBeenCalledWith(undefined, undefined, undefined);
});

test('runManually rolls back the optimistic state and toasts when the run fails to start', async () => {
  store.dispatch(setTasks([makeTaskFixture('task-2')]));
  const runManually = vi.fn().mockResolvedValue({ success: false, error: 'gateway offline' });
  const list = vi.fn().mockResolvedValue({ success: true, tasks: [makeTaskFixture('task-2')] });
  const listRuns = vi.fn().mockResolvedValue({ success: true, runs: [] });
  const listAllRuns = vi.fn().mockResolvedValue({ success: true, runs: [] });
  const dispatchEvent = vi.fn();
  vi.stubGlobal('window', {
    electron: { scheduledTasks: { runManually, list, listRuns, listAllRuns } },
    dispatchEvent,
  });
  const service = new ScheduledTaskService();

  await service.runManually('task-2');

  const state = store.getState().scheduledTask;
  expect(state.tasks.find(t => t.id === 'task-2')?.state.runningAtMs).toBeNull();
  expect(state.error).toBe('gateway offline');
  expect(dispatchEvent).toHaveBeenCalledOnce();
  const event = dispatchEvent.mock.calls[0]?.[0] as CustomEvent<string>;
  expect(event.type).toBe('app:showToast');
  expect(event.detail.length).toBeGreaterThan(0);
});
