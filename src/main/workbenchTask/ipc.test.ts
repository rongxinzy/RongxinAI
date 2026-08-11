import { expect, test, vi } from 'vitest';

import {
  WorkbenchRunTrigger,
  WorkbenchTaskIpc,
  type WorkbenchRun,
  type WorkbenchTask,
  type WorkbenchTaskResumeInput,
} from '../../shared/workbenchTask';
import { registerWorkbenchTaskIpcHandlers } from './ipc';
import type { WorkbenchTaskService } from './taskService';

const electronMocks = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
}));

vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: () => [] },
  ipcMain: {
    handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
      electronMocks.handlers.set(channel, handler);
    }),
  },
}));

test('resume forwards the amendment and execution context to the prepared run starter', async () => {
  electronMocks.handlers.clear();
  const task = { id: 'task-1', sessionId: 'session-1' } as WorkbenchTask;
  const run = { id: 'run-2', taskId: task.id } as WorkbenchRun;
  const service = {
    on: vi.fn(),
    prepareRun: vi.fn(() => ({ task, run })),
    getDetail: vi.fn(() => null),
  } as unknown as WorkbenchTaskService;
  const startPreparedRun = vi.fn(async () => undefined);
  registerWorkbenchTaskIpcHandlers({ getService: () => service, startPreparedRun });
  const input: WorkbenchTaskResumeInput = {
    taskId: task.id,
    amendment: 'Use the revised source file.',
    skillIds: ['documents'],
    expertIds: ['reviewer'],
    goalMode: true,
    imageAttachments: [{ name: 'reference.png', mimeType: 'image/png', base64Data: 'aW1hZ2U=' }],
    fileAttachments: [{ name: 'notes.txt', path: 'D:/notes.txt', extension: '.txt' }],
  };

  const handler = electronMocks.handlers.get(WorkbenchTaskIpc.Resume);
  expect(handler).toBeDefined();
  await expect(handler?.(undefined, input)).resolves.toEqual({ success: true, detail: undefined });
  expect(service.prepareRun).toHaveBeenCalledWith(task.id, WorkbenchRunTrigger.Resume);
  expect(startPreparedRun).toHaveBeenCalledWith(task, run, input);
});

test('resume startup failure returns the same task to paused instead of failing it', async () => {
  electronMocks.handlers.clear();
  const task = { id: 'task-1', sessionId: 'session-1' } as WorkbenchTask;
  const run = { id: 'run-2', taskId: task.id } as WorkbenchRun;
  const pauseRun = vi.fn();
  const failRun = vi.fn();
  const service = {
    on: vi.fn(),
    prepareRun: vi.fn(() => ({ task, run })),
    getDetail: vi.fn(() => ({ task })),
    pauseRun,
    failRun,
  } as unknown as WorkbenchTaskService;
  registerWorkbenchTaskIpcHandlers({
    getService: () => service,
    startPreparedRun: vi.fn(async () => {
      throw new Error('runtime unavailable');
    }),
  });

  const handler = electronMocks.handlers.get(WorkbenchTaskIpc.Resume);
  await expect(handler?.(undefined, { taskId: task.id })).resolves.toEqual({
    success: false,
    error: 'runtime unavailable',
  });
  expect(pauseRun).toHaveBeenCalledWith(task.sessionId, 'runtime unavailable');
  expect(failRun).not.toHaveBeenCalled();
});
