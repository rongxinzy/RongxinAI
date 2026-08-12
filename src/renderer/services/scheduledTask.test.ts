import { afterEach, expect, test, vi } from 'vitest';

import type { ScheduledTask } from '../../scheduledTask/types';
import { ScheduleKind, TaskStatus } from '../../scheduledTask/constants';
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

test('refreshes running and final state around a manual task execution', async () => {
  const idleTask = {
    id: 'task-1',
    schedule: { kind: ScheduleKind.Every, everyMs: 60_000 },
    state: {
      nextRunAtMs: null,
      lastRunAtMs: null,
      lastStatus: null,
      lastError: null,
      lastDurationMs: null,
      runningAtMs: null,
      consecutiveErrors: 0,
    },
  } as ScheduledTask;
  const runningTask = {
    ...idleTask,
    state: { ...idleTask.state, runningAtMs: 100 },
  } as ScheduledTask;
  const finishedTask = {
    ...idleTask,
    state: { ...idleTask.state, lastStatus: TaskStatus.Success, runningAtMs: null },
  } as ScheduledTask;
  let finishRun: ((result: { success: boolean; error?: string }) => void) | null = null;
  const list = vi
    .fn()
    .mockResolvedValueOnce({ success: true, tasks: [runningTask] })
    .mockResolvedValueOnce({ success: true, tasks: [finishedTask] });
  const runManually = vi.fn(
    () =>
      new Promise<{ success: boolean; error?: string }>(resolve => {
        finishRun = resolve;
      }),
  );
  const listRuns = vi.fn().mockResolvedValue({ success: true, runs: [] });
  const listAllRuns = vi.fn().mockResolvedValue({ success: true, runs: [] });
  vi.stubGlobal('window', {
    electron: {
      scheduledTasks: { list, runManually, listRuns, listAllRuns },
    },
  });
  store.dispatch(setTasks([idleTask]));
  const service = new ScheduledTaskService();

  const execution = service.runManually(idleTask.id);
  await vi.waitFor(() =>
    expect(store.getState().scheduledTask.tasks[0]?.state.runningAtMs).toBe(100),
  );
  (finishRun as ((result: { success: boolean }) => void) | null)?.({ success: true });
  await execution;

  expect(list).toHaveBeenCalledTimes(2);
  expect(listRuns).toHaveBeenCalledWith(idleTask.id, 20, undefined, undefined);
  expect(listAllRuns).toHaveBeenCalledWith(undefined, undefined, undefined);
  expect(store.getState().scheduledTask.tasks[0]?.state).toMatchObject({
    lastStatus: TaskStatus.Success,
    runningAtMs: null,
  });
});
