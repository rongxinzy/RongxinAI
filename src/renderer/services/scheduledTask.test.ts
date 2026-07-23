import { afterEach, expect, test, vi } from 'vitest';

import type { ScheduledTask } from '../../scheduledTask/types';
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
